from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.workflow.model import ModelFailure
from app.workflow_app import create_workflow_app
from test_pdf_actions import AgentFixture
from test_workflow import new_case, run


class RejectingVerifier(AgentFixture):
    def verify_pdf(self, pdf: bytes, fields: dict[str, str], template_fields: list[str] | None) -> dict[str, Any]:
        del pdf, fields, template_fields
        raise ModelFailure('PDF_VERIFICATION_FAILED')


@pytest.mark.parametrize('corrupt_pdf', [False, True])
def test_failed_verification_never_stages_or_saves(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                 corrupt_pdf: bool) -> None:
    provider = AgentFixture() if corrupt_pdf else RejectingVerifier()
    if corrupt_pdf:
        monkeypatch.setattr('app.workflow.actions.generate_packet_pdf', lambda *_: b'%PDF-invalid')
    app = create_workflow_app(database_path=str(tmp_path / 'blocked.sqlite3'), provider=provider, test_mode=True)
    client = TestClient(app)
    session = client.get('/api/workflow/session').json()
    headers = {'X-CSRF-Token': session['csrf_token']}
    state = run(client, headers, new_case(client, headers),
        'Company: Example\nFounder: Ava\nSummary: Widgets\nAnnual revenue: 100\nCash reserve: 50\nPeriod: 2026')
    assert state['jobs'][-1]['status'] == 'blocked'
    assert state['jobs'][-1]['error'] == 'PDF_VERIFICATION_FAILED'
    assert state.get('pdf_actions', []) == []
    assert state['packets'] == []
    assert all(f['state'] == 'unknown' for f in state['facts'].values())
    assert state['tasks'][-1]['state'] == 'Blocked'
    assert state['messages'][-1]['author'] == 'founder'


def test_manual_draft_cannot_bypass_verifier(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from test_pdf_actions import prepared
    from test_workflow import post
    client, headers, state = prepared(tmp_path)
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    saved = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']})
    assert saved.status_code == 200
    state = client.get(base).json()
    monkeypatch.setattr('app.workflow.documents.generate_packet_pdf', lambda *_: b'%PDF-invalid')
    response = post(client, base + '/packets', headers, {'expected_revision': state['revision']})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'PDF_VERIFICATION_FAILED'
    assert len(client.get(base).json()['packets']) == 1


def test_legacy_unverified_preview_can_only_be_dismissed(tmp_path: Path) -> None:
    from test_pdf_actions import prepared
    from test_workflow import post
    client, headers, state = prepared(tmp_path)
    action = state['pdf_actions'][-1]
    base = f"/api/workflow/cases/{state['id']}"
    repo = client.app.state.workflow_service.repo
    owner = client.cookies.get('relay_workflow_session')
    def remove_report(current: dict[str, Any], job: dict[str, Any]) -> None:
        del job
        current['pdf_actions'][-1].pop('verification')
        current['pdf_actions'][-1]['created_revision'] = current['revision'] + 1
    repo.update_job(owner, state['id'], state['jobs'][-1]['id'], remove_report)
    state = client.get(base).json()
    body = {'expected_revision': state['revision'], 'preview_hash': action['hash']}
    response = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers, body)
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'PDF_VERIFICATION_FAILED'
    assert client.get(base).json()['packets'] == []
    assert post(client, f"{base}/pdf-actions/{action['id']}/dismiss", headers, body).status_code == 200
