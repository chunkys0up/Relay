from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.workflow_application import create_workflow_app
from app.workflow.documents import generate_packet_pdf
from app.workflow.example_packets import create_example_cases
from app.workflow.packet_stages import import_packet, transition_packet
from app.workflow.repository import Repository, WorkflowError
from app.workflow.service import WorkflowService
from app.workflow.sharing import (authorize_case, create_invite, redeem_invite,
                                  public_actor_id, review_packet, revoke_invite, session_role,
                                  shared_snapshot)


def setup_review(tmp_path: Path) -> tuple[Repository, WorkflowService, str, str, str, int]:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    service = WorkflowService(repo, None)
    case = service.create_case("founder-session", "create", "Example Studio", "Review")
    packet = import_packet(repo, "founder-session", case["id"], 0, "import",
                           "packet.pdf", generate_packet_pdf({"company_name": "Example Studio"}, 1))
    staged = transition_packet(repo, "founder-session", case["id"], packet["packet_id"],
                               packet["case_revision"], packet["hash"], "in_review", "submit")
    return repo, service, case["id"], packet["packet_id"], packet["hash"], staged["case_revision"]


def test_distinct_session_grant_and_exact_review_persist(tmp_path: Path) -> None:
    repo, service, case_id, packet_id, packet_hash, revision = setup_review(tmp_path)
    invite = create_invite(repo, "founder-session", case_id, packet_id, packet_hash,
                           [], revision, "invite")
    with pytest.raises(WorkflowError) as self_redeem:
        redeem_invite(repo, "founder-session", invite["invite_code"])
    assert self_redeem.value.code == "SEPARATE_ADVISOR_SESSION_REQUIRED"
    with pytest.raises(WorkflowError):
        authorize_case(repo, "stranger", case_id)
    grant = redeem_invite(repo, "advisor-session", invite["invite_code"])
    assert redeem_invite(repo, "advisor-session", invite["invite_code"]) == grant
    assert session_role(repo, "advisor-session") == "advisor"
    assert authorize_case(repo, "advisor-session", case_id).role == "advisor"
    scoped = shared_snapshot(repo, service, authorize_case(repo, "advisor-session", case_id), case_id)
    assert [item["id"] for item in scoped["packets"]] == [packet_id]
    assert scoped["sources"] == []
    assert scoped["facts"] == {}
    with pytest.raises(WorkflowError) as owner_review:
        review_packet(repo, "founder-session", case_id, packet_id, packet_hash,
                      revision, "approved", "", "fake")
    assert owner_review.value.code == "NOT_FOUND"
    with pytest.raises(WorkflowError) as wrong_hash:
        review_packet(repo, "advisor-session", case_id, packet_id, "0" * 64,
                      revision, "approved", "", "wrong")
    assert wrong_hash.value.code == "NOT_FOUND"
    result = review_packet(repo, "advisor-session", case_id, packet_id, packet_hash,
                           revision, "approved", "", "review")
    assert result["stage"] == "approved"
    assert review_packet(repo, "advisor-session", case_id, packet_id, packet_hash,
                         revision, "approved", "", "review") == result
    persisted = WorkflowService(Repository(repo.path), None).snapshot("founder-session", case_id)
    assert persisted["packets"][0]["stage"] == "approved"
    assert persisted["reviews"][0]["reviewer_id"] == public_actor_id("advisor-session")
    assert persisted["reviews"][0]["packet_hash"] == packet_hash
    assert persisted["packets"][0]["stage_events"][-1]["actor"] == public_actor_id("advisor-session")
    assert "advisor-session" not in str(persisted)


def test_revoked_and_stale_grants_fail(tmp_path: Path) -> None:
    repo, _service, case_id, packet_id, packet_hash, revision = setup_review(tmp_path)
    invite = create_invite(repo, "founder-session", case_id, packet_id, packet_hash,
                           [], revision, "invite")
    redeem_invite(repo, "advisor-session", invite["invite_code"])
    revoke_invite(repo, "founder-session", case_id, invite["id"])
    with pytest.raises(WorkflowError):
        authorize_case(repo, "advisor-session", case_id)
    with pytest.raises(WorkflowError):
        review_packet(repo, "advisor-session", case_id, packet_id, packet_hash,
                      revision, "approved", "", "revoked")
    new_invite = create_invite(repo, "founder-session", case_id, packet_id,
                               packet_hash, [], revision, "new-invite")
    redeem_invite(repo, "second-advisor", new_invite["invite_code"])
    new_packet = import_packet(repo, "founder-session", case_id, revision,
                               "new-packet", "new.pdf",
                               generate_packet_pdf({"company_name": "New Version"}, 2))
    assert new_packet["packet_id"] != packet_id
    with pytest.raises(WorkflowError):
        authorize_case(repo, "second-advisor", case_id)
    with pytest.raises(WorkflowError):
        review_packet(repo, "second-advisor", case_id, packet_id, packet_hash,
                      new_packet["case_revision"], "approved", "", "historical")


def test_invite_redeem_requires_current_review_stage(tmp_path: Path) -> None:
    repo, service, case_id, packet_id, packet_hash, revision = setup_review(tmp_path)
    invite = create_invite(repo, "founder-session", case_id, packet_id, packet_hash,
                           [], revision, "invite")
    review_packet_after = redeem_invite(repo, "first-advisor", invite["invite_code"])
    assert review_packet_after["packet_id"] == packet_id
    second_invite = create_invite(repo, "founder-session", case_id, packet_id,
                                  packet_hash, [], revision, "second-invite")
    redeem_invite(repo, "second-advisor", second_invite["invite_code"])
    review_packet(repo, "first-advisor", case_id, packet_id, packet_hash,
                  revision, "questions_returned", "Please clarify the revenue.", "review")
    second_view = shared_snapshot(repo, service,
                                  authorize_case(repo, "second-advisor", case_id), case_id)
    assert second_view["reviews"] == []
    assert "Please clarify the revenue." not in str(second_view)
    with pytest.raises(WorkflowError) as stale:
        redeem_invite(repo, "second-advisor", invite["invite_code"])
    assert stale.value.code == "STALE_INVITE"


def test_actual_advisor_review_updates_example_review_task(tmp_path: Path) -> None:
    repo = Repository(str(tmp_path / "examples.sqlite3"))
    service = WorkflowService(repo, None)
    case = next(item for item in create_example_cases(service, "founder-session")
                if item["company"] == "Harbor Analytics")
    packet = case["packets"][0]
    invite = create_invite(repo, "founder-session", case["id"], packet["id"],
                           packet["hash"], [], case["revision"], "invite")
    redeem_invite(repo, "advisor-session", invite["invite_code"])
    review_packet(repo, "advisor-session", case["id"], packet["id"], packet["hash"],
                  case["revision"], "approved", "", "review")
    reloaded = service.snapshot("founder-session", case["id"])
    task = next(item for item in reloaded["tasks"] if item.get("key") == "example_review")
    assert task["state"] == "Done"
    assert task["detail"] == "Advisor approved this exact packet."


def test_http_sessions_never_expose_cookie_secret_and_block_role_spoof(tmp_path: Path) -> None:
    app = create_workflow_app(database_path=str(tmp_path / "http.sqlite3"), test_mode=True)
    with TestClient(app) as founder, TestClient(app) as advisor:
        founder_csrf = founder.get("/api/workflow/session").json()["csrf_token"]
        advisor_csrf = advisor.get("/api/workflow/session").json()["csrf_token"]
        founder_sid = founder.cookies.get("relay_workflow_session")
        advisor_sid = advisor.cookies.get("relay_workflow_session")
        assert founder_sid and advisor_sid and founder_sid != advisor_sid
        founder_headers = {"X-CSRF-Token": founder_csrf, "Idempotency-Key": "create"}
        advisor_headers = {"X-CSRF-Token": advisor_csrf, "Idempotency-Key": "redeem"}
        created = founder.post("/api/workflow/cases", json={"company": "Example", "goal": "Review"},
                               headers=founder_headers)
        assert created.status_code == 201
        case_id = created.json()["id"]
        body = generate_packet_pdf({"company_name": "Example"}, 1)
        private_body = generate_packet_pdf({"company_name": "Private Example"}, 2)
        first_source = founder.post(f"/api/workflow/cases/{case_id}/sources",
                                    data={"expected_revision": 0},
                                    files={"file": ("shared.pdf", body, "application/pdf")},
                                    headers={**founder_headers, "Idempotency-Key": "source-one"})
        assert first_source.status_code == 201
        shared_source_id = first_source.json()["source"]["id"]
        second_source = founder.post(f"/api/workflow/cases/{case_id}/sources",
                                     data={"expected_revision": first_source.json()["case_revision"]},
                                     files={"file": ("private.pdf", private_body, "application/pdf")},
                                     headers={**founder_headers, "Idempotency-Key": "source-two"})
        assert second_source.status_code == 201
        private_source_id = second_source.json()["source"]["id"]
        imported = founder.post(f"/api/workflow/cases/{case_id}/packets/import",
                                data={"expected_revision": second_source.json()["case_revision"]},
                                files={"file": ("packet.pdf", body, "application/pdf")},
                                headers={**founder_headers, "Idempotency-Key": "import"})
        assert imported.status_code == 201
        packet = imported.json()
        stage = founder.post(f"/api/workflow/cases/{case_id}/packets/{packet['packet_id']}/stage",
                             json={"expected_revision": packet["case_revision"],
                                   "packet_hash": packet["hash"], "target_stage": "in_review"},
                             headers={**founder_headers, "Idempotency-Key": "stage"})
        assert stage.status_code == 200
        revision = stage.json()["case_revision"]
        invite = founder.post(f"/api/workflow/cases/{case_id}/shares",
                              json={"expected_revision": revision, "packet_id": packet["packet_id"],
                                    "packet_hash": packet["hash"], "source_ids": [shared_source_id]},
                              headers={**founder_headers, "Idempotency-Key": "invite"})
        assert invite.status_code == 201
        code = invite.json()["invite_code"]
        assert founder.post(f"/api/workflow/cases/{case_id}/packets/{packet['packet_id']}/review",
                            json={"expected_revision": revision, "packet_hash": packet["hash"],
                                  "decision": "approved"}, headers=founder_headers).status_code == 403
        assert advisor.get(f"/api/workflow/cases/{case_id}").status_code == 404
        redeem = advisor.post("/api/workflow/invites/redeem", json={"invite_code": code},
                              headers=advisor_headers)
        assert redeem.status_code == 200
        assert advisor.get("/api/workflow/session").json()["actor"]["role"] == "advisor"
        assert advisor.post(f"/api/workflow/cases/{case_id}/packets/{packet['packet_id']}/stage",
                            json={"expected_revision": revision, "packet_hash": packet["hash"],
                                  "target_stage": "approved"}, headers=advisor_headers).status_code == 403
        shared_original = advisor.get(f"/api/workflow/cases/{case_id}/sources/{shared_source_id}/preview")
        assert shared_original.status_code == 200
        assert shared_original.content == body
        assert advisor.get(f"/api/workflow/cases/{case_id}/sources/{private_source_id}/preview").status_code == 404
        responses = [created, first_source, second_source, imported, stage, invite, redeem,
                     founder.get(f"/api/workflow/cases/{case_id}"),
                     advisor.get("/api/workflow/cases"),
                     advisor.get(f"/api/workflow/cases/{case_id}"),
                     shared_original,
                     advisor.get(f"/api/workflow/cases/{case_id}/packets/{packet['packet_id']}/download")]
        reviewed = advisor.post(f"/api/workflow/cases/{case_id}/packets/{packet['packet_id']}/review",
                                json={"expected_revision": revision, "packet_hash": packet["hash"],
                                      "decision": "approved"},
                                headers={**advisor_headers, "Idempotency-Key": "review"})
        assert reviewed.status_code == 200
        responses += [reviewed, founder.get(f"/api/workflow/cases/{case_id}"),
                      advisor.get(f"/api/workflow/cases/{case_id}"),
                      founder.get(f"/api/workflow/cases/{case_id}/shares"),
                      founder.get("/api/workflow/session"),
                      advisor.get("/api/workflow/session")]
        revoked = founder.post(f"/api/workflow/cases/{case_id}/shares/{invite.json()['id']}/revoke",
                               headers={**founder_headers, "Idempotency-Key": "revoke"})
        assert revoked.status_code == 200
        responses += [revoked, advisor.get("/api/workflow/cases")]
        for response in responses:
            assert founder_sid not in response.text
            assert advisor_sid not in response.text
