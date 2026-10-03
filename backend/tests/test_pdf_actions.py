from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.workflow.schemas import ModelResult
from app.workflow_app import create_workflow_app
from test_agent_tools import scripted_provider
from test_workflow import FixtureProvider, new_case, post, run, upload


class AgentFixture(FixtureProvider):
    def plan(self, goal: str, excerpts: list[dict[str, Any]], context: dict[str, Any]) -> ModelResult:
        proposals = self.propose(goal, excerpts).proposals
        if context['current_packet_id']:
            changes = [p.model_dump() for p in proposals if p.evidence[0].source_id == excerpts[-1]['source_id']]
            source_id = excerpts[-1]['source_id']
        else:
            changes = [p.model_dump() for p in proposals]
            source_id = excerpts[0]['source_id']
        provider, _ = scripted_provider([
            ('read_document', {'source_id': source_id}),
            ('read_packet', {'packet_id': context['current_packet_id']}),
            ('propose_pdf_edit', {'changes': changes, 'packet_id': context['current_packet_id'],
                                 'template_id': context['templates'][0]['id'] if context['templates'] else None}),
            'I prepared your requested changes. Review the preview before saving.',
        ])
        return provider.plan(goal, excerpts, context)


def prepared(tmp_path: Path) -> tuple[TestClient, dict[str, str], dict[str, Any]]:
    client = TestClient(create_workflow_app(database_path=str(tmp_path / 'actions.sqlite3'),
                                          provider=AgentFixture(), test_mode=True))
    session = client.get('/api/workflow/session').json()
    headers = {'X-CSRF-Token': session['csrf_token']}
    state = upload(client, headers, new_case(client, headers),
        'Company: Example Studio\nFounder: Ava\nSummary: Makes prototypes\n'
        'Annual revenue: $120,000\nCash reserve: $50,000\nPeriod: 2026')
    return client, headers, run(client, headers, state)


def test_real_agent_preview_confirm_edit_and_immutable_versions(tmp_path: Path) -> None:
    client, headers, state = prepared(tmp_path)
    assert state['jobs'][-1]['error'] is None, state
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    assert state['packets'] == []
    assert all(f['state'] == 'unknown' for f in state['facts'].values())
    assert 'prepared your requested changes' in state['messages'][-1]['text']
    preview = client.get(f"{base}/pdf-actions/{action['id']}/preview").content
    body = {'expected_revision': state['revision'], 'preview_hash': action['hash']}
    response = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers, body, 'same')
    assert response.status_code == 200, response.text
    assert post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers, body, 'same').json() == response.json()
    packet = response.json()
    assert client.get(f"{base}/packets/{packet['packet_id']}/download").content == preview
    assert hashlib.sha256(preview).hexdigest() == action['hash']
    state = client.get(base).json()
    state = run(client, headers, state, 'Cash reserve: $75,000')
    assert state['jobs'][-1]['error'] is None, state
    next_action = state['pdf_actions'][-1]
    assert next_action['fields']['cash_reserve'] == '$75,000'
    assert state['facts']['cash_reserve']['value'] == '$50,000'
    response = post(client, f"{base}/pdf-actions/{next_action['id']}/confirm", headers,
        {'expected_revision': state['revision'], 'preview_hash': next_action['hash']})
    assert response.status_code == 200, response.text
    assert response.json()['version'] == 2
    assert client.get(f"{base}/packets/{packet['packet_id']}/download").content == preview


def test_preview_hash_staleness_dismiss_and_owner_scope(tmp_path: Path) -> None:
    client, headers, state = prepared(tmp_path)
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    endpoint = f"{base}/pdf-actions/{action['id']}"
    response = post(client, endpoint + '/confirm', headers,
        {'expected_revision': state['revision'], 'preview_hash': '0' * 64})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'PREVIEW_MISMATCH'
    state = upload(client, headers, state, 'Additional information')
    body = {'expected_revision': state['revision'], 'preview_hash': action['hash']}
    assert post(client, endpoint + '/confirm', headers, body).json()['error']['code'] == 'STALE_PREVIEW'
    assert post(client, endpoint + '/dismiss', headers, body).status_code == 200
    state = client.get(base).json()
    assert state['packets'] == []
    assert state['pdf_actions'][-1]['status'] == 'dismissed'
    client.cookies.clear()
    session = client.get('/api/workflow/session').json()
    assert client.get(endpoint + '/preview').status_code == 404
    assert post(client, endpoint + '/confirm', {'X-CSRF-Token': session['csrf_token']}, body).status_code == 404


def test_agent_fills_uploaded_form_and_preview_roundtrip(tmp_path: Path) -> None:
    import io
    from pypdf import PdfReader
    from make_browser_fixtures import make_form

    client, headers, state = prepared(tmp_path)
    form = tmp_path / 'form.pdf'
    make_form(form)
    base = f"/api/workflow/cases/{state['id']}"
    response = client.post(base + '/templates', data={'expected_revision': state['revision']},
        files={'file': ('form.pdf', form.read_bytes(), 'application/pdf')},
        headers={**headers, 'Idempotency-Key': 'form-upload'})
    assert response.status_code == 201
    state = run(client, headers, client.get(base).json())
    action = state['pdf_actions'][-1]
    preview = client.get(f"{base}/pdf-actions/{action['id']}/preview").content
    fields = PdfReader(io.BytesIO(preview)).get_fields()
    assert fields['cash_reserve']['/V'] == '$50,000'
    assert fields['company_name']['/V'] == 'Example Studio'
    response = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']})
    assert response.status_code == 200, response.text
    assert client.get(f"{base}/packets/{response.json()['packet_id']}/download").content == preview


def test_chat_only_agent_action_and_dismissed_action_cannot_save(tmp_path: Path) -> None:
    client = TestClient(create_workflow_app(database_path=str(tmp_path / 'chat.sqlite3'),
                                          provider=AgentFixture(), test_mode=True))
    session = client.get('/api/workflow/session').json()
    headers = {'X-CSRF-Token': session['csrf_token']}
    state = run(client, headers, new_case(client, headers),
        'Company: Chat Studio\nFounder: Ari\nSummary: Widgets\n'
        'Annual revenue: 100\nCash reserve: 50\nPeriod: 2026')
    assert state['sources'] == []
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    endpoint = f"{base}/pdf-actions/{action['id']}"
    assert post(client, endpoint + '/dismiss', headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']}).status_code == 200
    state = client.get(base).json()
    response = post(client, endpoint + '/confirm', headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'ACTION_NOT_PENDING'
    assert client.get(base).json()['packets'] == []
