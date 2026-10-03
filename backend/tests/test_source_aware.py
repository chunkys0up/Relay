"""Source-aware workflow API and transaction regressions."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.workflow.model import ModelFailure
from app.workflow.schemas import FIELDS, ModelResult
from app.workflow.tasking import reconcile_tasks
from app.workflow_app import create_workflow_app
from test_pdf_actions import AgentFixture, prepared
from test_workflow import FixtureProvider, new_case, post, run, upload


def setup_client(tmp_path: Path) -> tuple[TestClient, dict[str, str]]:
    app = create_workflow_app(database_path=str(tmp_path / "sources.sqlite3"),
                              provider=FixtureProvider(), test_mode=True)
    client = TestClient(app)
    csrf = client.get("/api/workflow/session").json()["csrf_token"]
    return client, {"X-CSRF-Token": csrf}


def source_post(client: TestClient, headers: dict[str, str], case: dict[str, Any],
                name: str, data: bytes, *, analyze: bool = False,
                key: str | None = None) -> Any:
    return client.post(f"/api/workflow/cases/{case['id']}/sources",
        data={"expected_revision": case["revision"], "analyze": str(analyze).lower()},
        files={"file": (name, data, "text/plain")},
        headers={**headers, "Idempotency-Key": key or str(uuid4())})


def snapshot(client: TestClient, case_id: str) -> dict[str, Any]:
    return client.get(f"/api/workflow/cases/{case_id}").json()


def test_upload_can_start_interpretation_and_persist_citations(tmp_path: Path) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    response = source_post(client, headers, case, "statement.txt",
                           b"Company: Northstar\nAnnual revenue: 100", analyze=True)
    assert response.status_code == 201, response.text
    assert response.json()["job_id"]
    state = snapshot(client, case["id"])
    assert state["jobs"][-1]["status"] == "needs_input"
    assert state["sources"][0]["interpretation_status"] == "review_needed"
    candidate = state["facts"]["annual_revenue"]["candidates"][0]
    assert candidate["evidence"][0]["source_id"] == state["sources"][0]["id"]
    assert state["facts"]["annual_revenue"]["state"] == "proposed"
    trigger = next(message for message in state["messages"]
                   if message["id"] == state["jobs"][-1]["goal_message_id"])
    assert trigger["author"] == "Relay"


def test_upload_idempotency_includes_analysis_choice(tmp_path: Path) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    key = str(uuid4())
    first = source_post(client, headers, case, "record.txt", b"Annual revenue: 100",
                        analyze=False, key=key)
    assert first.status_code == 201
    changed = source_post(client, headers, case, "record.txt", b"Annual revenue: 100",
                          analyze=True, key=key)
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    after = snapshot(client, case["id"])
    assert len(after["sources"]) == 1
    assert after["jobs"] == []


def test_legacy_fixed_rows_are_archived_on_reconciliation() -> None:
    old = {"id": "old-task", "job_id": "old-job", "order": 1,
           "title": "Prepare proposed document", "state": "Done", "detail": None}
    state: dict[str, Any] = {"id": "case", "tasks": [old], "sources": [], "jobs": [],
        "facts": {field: {"state": "unknown", "value": None} for field in FIELDS},
        "packets": [], "current_packet_id": None, "analysis_required": False}
    reconcile_tasks(state)
    assert state["tasks"] == []
    assert state["legacy_tasks"] == [old]
    state["sources"].append({"id": "new-source", "name": "record.txt",
                             "extraction_status": "ready", "interpretation_status": "pending"})
    reconcile_tasks(state)
    assert state["legacy_tasks"] == [old]
    assert all(task.get("key") for task in state["tasks"])
    assert len({task["id"] for task in state["tasks"]}) == len(state["tasks"])


def test_revision_decision_is_scoped_idempotent_and_keeps_both_originals(tmp_path: Path) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    first = source_post(client, headers, case, "statement.txt", b"Annual revenue: 100")
    assert first.status_code == 201
    case = snapshot(client, case["id"])
    second = source_post(client, headers, case, "statement-revised.txt", b"Annual revenue: 200")
    assert second.status_code == 201
    case = snapshot(client, case["id"])
    source_id, related_id = case["sources"][1]["id"], case["sources"][0]["id"]
    assert case["sources"][1]["relationship_suggestion"]["related_source_id"] == related_id
    endpoint = f"/api/workflow/cases/{case['id']}/sources/{source_id}/relationship"
    body = {"expected_revision": case["revision"], "related_source_id": related_id,
            "decision": "revision"}
    key = str(uuid4())
    accepted = post(client, endpoint, headers, body, key)
    assert accepted.status_code == 200, accepted.text
    assert post(client, endpoint, headers, body, key).json() == accepted.json()
    assert post(client, endpoint, headers, {**body, "decision": "separate"}, key).status_code == 409
    assert post(client, endpoint, headers,
                {**body, "expected_revision": accepted.json()["case_revision"]}).status_code == 409
    case = snapshot(client, case["id"])
    assert len(case["sources"]) == 2
    assert case["sources"][1]["relationship"]["decision"] == "revision"
    assert client.get(f"/api/workflow/cases/{case['id']}/sources/{related_id}/preview").content == b"Annual revenue: 100"
    outsider = TestClient(client.app)
    outsider.get("/api/workflow/session")
    assert outsider.get(f"/api/workflow/cases/{case['id']}/sources/{related_id}/preview").status_code == 404
    outsider_csrf = outsider.get("/api/workflow/session").json()["csrf_token"]
    assert post(outsider, endpoint, {"X-CSRF-Token": outsider_csrf},
                {"expected_revision": case["revision"], "related_source_id": related_id,
                 "decision": "separate"}).status_code == 404


def test_same_revision_concurrent_uploads_have_one_winner(tmp_path: Path) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)

    def attempt(number: int) -> int:
        return source_post(client, headers, case, f"source-{number}.txt",
                           f"Annual revenue: {number}".encode()).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = sorted(pool.map(attempt, [100, 200]))
    assert codes == [201, 409]
    state = snapshot(client, case["id"])
    assert len(state["sources"]) == 1
    assert len({task["id"] for task in state["tasks"]}) == len(state["tasks"])


def test_unreadable_source_is_visible_and_never_completes_source_task(tmp_path: Path) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    response = source_post(client, headers, case, "broken.txt", b"\x00broken", analyze=True)
    assert response.status_code == 201, response.text
    assert "job_id" not in response.json()
    case = snapshot(client, case["id"])
    assert case["sources"][0]["extraction_status"] == "unreadable"
    assert case["sources"][0]["interpretation_status"] == "blocked"
    assert any(task["key"].startswith("source:") and task["state"] == "Blocked"
               for task in case["tasks"])
    assert case["messages"][-1]["author"] == "Relay"


def test_manual_pdf_verification_failure_is_persisted_without_packet(
    tmp_path: Path, monkeypatch: Any,
) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    values = {"company_name": "Northstar", "founder_name": "Ava",
              "business_summary": "Makes tools", "annual_revenue": "100",
              "cash_reserve": "50", "period": "2026"}
    confirmed = post(client, f"/api/workflow/cases/{case['id']}/facts/confirm", headers,
                     {"expected_revision": case["revision"], "values": values})
    assert confirmed.status_code == 200, confirmed.text
    case = snapshot(client, case["id"])

    def reject(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise ModelFailure("PDF_VERIFICATION_FAILED")

    monkeypatch.setattr("app.workflow.actions.verify_rendered_pdf", reject)
    result = post(client, f"/api/workflow/cases/{case['id']}/packets", headers,
                  {"expected_revision": case["revision"]})
    assert result.status_code == 422
    case = snapshot(client, case["id"])
    assert case["packet_error"] == "PDF_VERIFICATION_FAILED"
    assert case["packets"] == []
    assert case["messages"][-1]["author"] == "Relay"
    assert next(task for task in case["tasks"] if task["key"] == "packet")["state"] == "Blocked"


def test_verified_agent_preview_creates_human_review_task(tmp_path: Path) -> None:
    _client, _headers, case = prepared(tmp_path)
    action = case["pdf_actions"][-1]
    task = next(task for task in case["tasks"] if task["key"] == "packet")
    assert action["status"] == "pending"
    assert task["state"] == "Pending"
    assert task["responsible_party"] == "founder"
    assert task["completion_rule"] == {
        "kind": "verified_preview_confirmed", "action_id": action["id"]}
    assert all(case["facts"][field]["state"] == "unknown" for field in action["fields"])


def test_reply_only_chat_preserves_unmodified_verified_preview(tmp_path: Path) -> None:
    client, headers, case = prepared(tmp_path)
    action = case["pdf_actions"][-1]
    provider = client.app.state.workflow_service.provider
    assert provider is not None
    provider.plan = lambda _goal, _excerpts, _context: ModelResult(
        proposals=[], reply="Please review the current preview.")
    case = run(client, headers, case, "What is the current status?")
    preserved = next(item for item in case["pdf_actions"] if item["id"] == action["id"])
    assert preserved["status"] == "pending"
    assert preserved["created_revision"] == case["revision"]
    result = post(client,
        f"/api/workflow/cases/{case['id']}/pdf-actions/{action['id']}/confirm",
        headers, {"expected_revision": case["revision"], "preview_hash": action["hash"]})
    assert result.status_code == 200, result.text


def test_verifier_retry_promotes_covered_source_and_preview_task(
    tmp_path: Path, monkeypatch: Any,
) -> None:
    app = create_workflow_app(database_path=str(tmp_path / "retry.sqlite3"),
                              provider=AgentFixture(), test_mode=True)
    client = TestClient(app)
    csrf = client.get("/api/workflow/session").json()["csrf_token"]
    headers = {"X-CSRF-Token": csrf}
    case = upload(client, headers, new_case(client, headers),
        "Company: Northstar\nFounder: Ava\nSummary: Widgets\n"
        "Annual revenue: 100\nCash reserve: 50\nPeriod: 2026")
    from app.workflow import actions

    original = actions.verify_rendered_pdf

    def reject(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise ModelFailure("PDF_VERIFICATION_FAILED")

    monkeypatch.setattr(actions, "verify_rendered_pdf", reject)
    case = run(client, headers, case)
    assert case["jobs"][-1]["status"] == "blocked"
    assert case["sources"][0]["interpretation_status"] == "blocked"
    monkeypatch.setattr(actions, "verify_rendered_pdf", original)
    case = run(client, headers, case)
    assert case["jobs"][-1]["status"] == "needs_input"
    assert case["sources"][0]["interpretation_status"] == "review_needed"
    assert next(task for task in case["tasks"] if task["key"] == "packet")["state"] == "Pending"


@pytest.mark.parametrize('content_type, expected_type', [
    ('text/plain; charset=utf-8', 'text/plain'),
    ('TEXT/PLAIN', 'text/plain'),
    ('text/csv; charset=utf-8', 'text/csv'),
])
def test_supported_mime_variants_roundtrip_source_preview(
    tmp_path: Path, content_type: str, expected_type: str,
) -> None:
    client, headers = setup_client(tmp_path)
    case = new_case(client, headers)
    body = b'Company: Studio'
    response = client.post(f"/api/workflow/cases/{case['id']}/sources",
        data={'expected_revision': case['revision']},
        files={'file': ('record.txt', body, content_type)},
        headers={**headers, 'Idempotency-Key': str(uuid4())})
    assert response.status_code == 201, response.text
    source = response.json()['source']
    assert source['extraction_status'] == 'ready'
    preview = client.get(f"/api/workflow/cases/{case['id']}/sources/{source['id']}/preview")
    assert preview.status_code == 200, preview.text
    assert preview.content == body
    assert preview.headers['content-type'].split(';', 1)[0] == expected_type
    assert preview.headers['x-content-type-options'] == 'nosniff'
    assert preview.headers['content-security-policy'] == 'sandbox'
