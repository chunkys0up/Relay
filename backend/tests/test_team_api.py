from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.workflow_app import create_workflow_app
from team_fixture import TeamFixture
from test_workflow import new_case, post, run


def test_team_http_flow_verifies_exact_preview_before_save(tmp_path: Path) -> None:
    app = create_workflow_app(database_path=str(tmp_path / 'team.sqlite3'), provider=TeamFixture(), test_mode=True)
    client = TestClient(app)
    session = client.get('/api/workflow/session').json()
    headers = {'X-CSRF-Token': session['csrf_token']}
    state = run(client, headers, new_case(client, headers),
        'Company: Team Studio\nFounder: Ava\nSummary: Widgets\nAnnual revenue: 100\nCash reserve: 50\nPeriod: 2026')
    assert state['jobs'][-1]['error'] is None, state['jobs'][-1]
    assert {step['role'] for step in state['jobs'][-1]['agent_steps']} == {'orchestrator', 'reader', 'writer', 'verifier'}
    action = state['pdf_actions'][-1]
    assert action['verification']['passed'] is True
    assert action['verification']['mode'] == 'deterministic+agent'
    assert action['verification']['hash'] == action['hash']
    assert 'extracted_text' not in action['verification']
    assert state['packets'] == []
    assert {message['author'] for message in state['messages']} == {'founder', 'Relay'}
    base = f"/api/workflow/cases/{state['id']}"
    preview = client.get(f"{base}/pdf-actions/{action['id']}/preview").content
    response = post(client, f"{base}/pdf-actions/{action['id']}/confirm", headers,
        {'expected_revision': state['revision'], 'preview_hash': action['hash']})
    assert response.status_code == 200, response.text
    assert client.get(f"{base}/packets/{response.json()['packet_id']}/download").content == preview
