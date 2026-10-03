"""Independent acceptance regressions; simulated providers never invoke AWS."""
from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.workflow.schemas import ModelResult
from app.workflow_app import create_workflow_app
from test_pdf_actions import prepared
from test_workflow import FixtureProvider, new_case, post, run, upload


def client_for(tmp_path: Path, provider: FixtureProvider | None = None) -> tuple[TestClient, FixtureProvider, dict[str, str]]:
    chosen = provider or FixtureProvider()
    client = TestClient(create_workflow_app(database_path=str(tmp_path / 'acceptance.sqlite3'), provider=chosen, test_mode=True))
    session = client.get('/api/workflow/session').json()
    return client, chosen, {'X-CSRF-Token': session['csrf_token']}


def intake(client: TestClient, headers: dict[str, str], state: dict[str, Any], name: str, content: bytes) -> dict[str, Any]:
    response = client.post(f"/api/workflow/cases/{state['id']}/sources", data={'expected_revision': state['revision']},
        files={'file': (name, content, 'text/plain')}, headers={**headers, 'Idempotency-Key': str(uuid4())})
    assert response.status_code == 201, response.text
    return client.get(f"/api/workflow/cases/{state['id']}").json()


def confirm(client: TestClient, headers: dict[str, str], state: dict[str, Any], values: dict[str, str]) -> dict[str, Any]:
    acknowledgements = {field: sorted({e['source_id'] for p in state['facts'][field]['candidates'] for e in p['evidence']}) for field in values}
    response = post(client, f"/api/workflow/cases/{state['id']}/facts/confirm", headers,
        {'expected_revision': state['revision'], 'values': values, 'source_acknowledgements': acknowledgements})
    assert response.status_code == 200, response.text
    return client.get(f"/api/workflow/cases/{state['id']}").json()


def test_duplicate_bytes_preserve_verified_preview_and_revision(tmp_path: Path) -> None:
    client, headers, state = prepared(tmp_path)
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    original = client.get(f"{base}/sources/{state['sources'][0]['id']}/preview").content
    after = intake(client, headers, state, 'different-name.txt', original)
    assert after['revision'] == state['revision']
    assert after['sources'] == state['sources']
    assert after['tasks'] == state['tasks']
    assert after['jobs'] == state['jobs']
    response = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers,
        {'expected_revision': after['revision'], 'preview_hash': action['hash']})
    assert response.status_code == 200, response.text


def test_resolved_history_is_retained_without_reopening_unrelated_requirement(tmp_path: Path) -> None:
    client, _provider, headers = client_for(tmp_path)
    state = run(client, headers, upload(client, headers, new_case(client, headers),
        'Annual revenue: 100\nAnnual revenue: 200'))
    state = confirm(client, headers, state, {'annual_revenue': '200'})
    task_id = next(t['id'] for t in state['tasks'] if t.get('key') == 'fact:annual_revenue')
    state = run(client, headers, state, 'Cash reserve: 50')
    assert state['facts']['annual_revenue']['state'] == 'confirmed'
    assert state['facts']['annual_revenue']['value'] == '200'
    assert {'100', '200'} <= {p['value'] for p in state['facts']['annual_revenue']['candidates']}
    assert next(t for t in state['tasks'] if t['id'] == task_id)['state'] == 'Done'
    assert state['facts']['cash_reserve']['state'] != 'confirmed'
    assert state['facts']['cash_reserve']['candidates'][0]['evidence'][0]['source_id'] in {m['id'] for m in state['messages'] if m['author'] == 'founder'}


def test_citing_only_old_source_cannot_complete_new_source_analysis(tmp_path: Path) -> None:
    client, provider, headers = client_for(tmp_path)
    state = run(client, headers, upload(client, headers, new_case(client, headers), 'Annual revenue: 100'))
    prior_candidate = state['facts']['annual_revenue']['candidates'][0]
    state = confirm(client, headers, state, {'annual_revenue': '100'})
    state = intake(client, headers, state, 'other.txt', b'Annual revenue: 200')
    provider.override = ModelResult.model_validate({'proposals': [prior_candidate]})
    state = run(client, headers, state)
    assert state['analysis_required'] is True
    assert state['sources'][-1]['interpretation_status'] not in ('interpreted', 'review_needed')
    assert next(t for t in state['tasks'] if t.get('key') == 'analysis')['state'] != 'Done'
    assert state['facts']['annual_revenue']['value'] == '100'
    state = run(client, headers, state)
    assert state['analysis_required'] is True
    assert next(t for t in state['tasks'] if t.get('key') == 'analysis')['state'] != 'Done'


class ClarificationOnly(FixtureProvider):
    def plan(self, goal: str, excerpts: list[dict[str, Any]], context: dict[str, Any]) -> ModelResult:
        return ModelResult(proposals=[], reply='Please explain this source.')


def test_empty_model_reply_never_claims_uninterpreted_source_done(tmp_path: Path) -> None:
    client, _provider, headers = client_for(tmp_path, ClarificationOnly())
    state = run(client, headers, upload(client, headers, new_case(client, headers), 'Annual revenue: 100'))
    assert state['analysis_required'] is True
    assert state['jobs'][-1]['status'] == 'blocked'
    assert next(t for t in state['tasks'] if t.get('key') == 'analysis')['state'] == 'Blocked'
    assert state['messages'][-1]['author'] == 'Relay'
    assert any(word in state['messages'][-1]['text'].lower() for word in ('stopped', 'failed', 'unable', 'could not', 'blocked'))


def test_unreadable_revision_does_not_clear_other_source_obligations(tmp_path: Path) -> None:
    client, _provider, headers = client_for(tmp_path)
    state = intake(client, headers, new_case(client, headers), 'record.txt', b'Annual revenue: 100')
    state = intake(client, headers, state, 'record-revised.txt', b'\x00unreadable')
    response = post(client, f"/api/workflow/cases/{state['id']}/sources/{state['sources'][-1]['id']}/relationship", headers,
        {'expected_revision': state['revision'], 'related_source_id': state['sources'][0]['id'], 'decision': 'revision'})
    assert response.status_code == 200, response.text
    after = client.get(f"/api/workflow/cases/{state['id']}").json()
    assert after['analysis_required'] is True
    assert any(t['state'] == 'Blocked' and 'record-revised.txt' in t['title'] for t in after['tasks'])
    assert len(after['sources']) == 2


@pytest.mark.parametrize('value', ['not known', '-100', 'NaN'])
def test_invalid_money_is_not_accepted_as_completed_fact(tmp_path: Path, value: str) -> None:
    client, _provider, headers = client_for(tmp_path)
    state = new_case(client, headers)
    response = post(client, f"/api/workflow/cases/{state['id']}/facts/confirm", headers,
        {'expected_revision': state['revision'], 'values': {'annual_revenue': value}})
    assert response.status_code == 422, response.text
    after = client.get(f"/api/workflow/cases/{state['id']}").json()
    assert after['facts']['annual_revenue']['state'] != 'confirmed'
    assert not any(t.get('key') == 'fact:annual_revenue' and t['state'] == 'Done' for t in after['tasks'])


def test_manual_confirmation_task_graph_has_no_dangling_dependencies(tmp_path: Path) -> None:
    client, _provider, headers = client_for(tmp_path)
    state = confirm(client, headers, new_case(client, headers), {'annual_revenue': '100'})
    ids = {task['id'] for task in state['tasks']}
    assert ids
    for task in state['tasks']:
        assert set(task['dependencies']) <= ids
        assert task.get('completion_rule')
        assert task['id'] not in task['dependencies']


def test_verified_pending_pdf_has_a_human_review_task_not_false_completion(tmp_path: Path) -> None:
    client, headers, state = prepared(tmp_path)
    action = state['pdf_actions'][-1]
    review = next(task for task in state['tasks'] if task.get('key') == 'packet')
    assert review['state'] == 'Pending'
    assert review['responsible_party'] == 'founder'
    assert 'review' in review['title'].lower()
    assert state['packets'] == []
    assert action['verification']['passed'] is True
    assert all(fact['state'] == 'unknown' for fact in state['facts'].values())
    by_id = {task['id']: task for task in state['tasks']}
    assert all(by_id[dependency]['state'] == 'Done' for dependency in review['dependencies'])
    response = post(client, f"/api/workflow/cases/{state['id']}/pdf-actions/{action['id']}/confirm", headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']})
    assert response.status_code == 200, response.text
    after = client.get(f"/api/workflow/cases/{state['id']}").json()
    assert next(task for task in after['tasks'] if task['id'] == review['id'])['state'] == 'Done'
