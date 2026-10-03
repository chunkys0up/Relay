from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app.workflow.documents import generate_packet_pdf
from app.workflow.packet_stages import import_packet, transition_packet
from app.workflow.repository import Repository, WorkflowError
from app.workflow.service import WorkflowService


def test_imported_pdf_persists_exact_bytes_and_stage(tmp_path: Path) -> None:
    path = str(tmp_path / "workflow.sqlite3")
    repository = Repository(path)
    service = WorkflowService(repository, None)
    owner = "session-one"
    case = service.create_case(owner, "create", "Example Studio", "Review a PDF")
    body = generate_packet_pdf({"company_name": "Example Studio"}, 1)
    result = import_packet(repository, owner, case["id"], 0, "import",
                           "example.pdf", body)
    assert result["hash"] == hashlib.sha256(body).hexdigest()
    reloaded = WorkflowService(Repository(path), None).snapshot(owner, case["id"])
    packet = reloaded["packets"][0]
    assert packet["stage"] == "draft"
    assert packet["title"] == "example.pdf"
    assert repository.blob(owner, case["id"], packet["id"], "packet") == body
    with pytest.raises(WorkflowError) as foreign:
        repository.blob("other-session", case["id"], packet["id"], "packet")
    assert foreign.value.code == "NOT_FOUND"
    submitted = transition_packet(repository, owner, case["id"], packet["id"],
                                  reloaded["revision"], packet["hash"], "in_review",
                                  "submit")
    assert submitted["stage"] == "in_review"
    reloaded = WorkflowService(Repository(path), None).snapshot(owner, case["id"])
    assert reloaded["packets"][0]["stage_events"][0]["packet_hash"] == packet["hash"]
    with pytest.raises(WorkflowError) as fake_approval:
        transition_packet(repository, owner, case["id"], packet["id"],
                          reloaded["revision"], packet["hash"], "approved", "approve")
    assert fake_approval.value.code == "INVALID_STAGE_TRANSITION"


def test_historical_packet_cannot_change_stage(tmp_path: Path) -> None:
    repository = Repository(str(tmp_path / "workflow.sqlite3"))
    service = WorkflowService(repository, None)
    case = service.create_case("owner", "create", "Example Studio", "Review")
    body = generate_packet_pdf({"company_name": "Example Studio"}, 1)
    first = import_packet(repository, "owner", case["id"], 0, "first", "one.pdf", body)
    second = import_packet(repository, "owner", case["id"], first["case_revision"],
                           "second", "two.pdf", body)
    with pytest.raises(WorkflowError) as historical:
        transition_packet(repository, "owner", case["id"], first["packet_id"],
                          second["case_revision"], first["hash"], "in_review",
                          "old")
    assert historical.value.code == "HISTORICAL_PACKET"


def test_old_packet_snapshot_has_explicit_compatibility_stage(tmp_path: Path) -> None:
    repository = Repository(str(tmp_path / "workflow.sqlite3"))
    service = WorkflowService(repository, None)
    case = service.create_case("owner", "create", "Example Studio", "Review")
    body = generate_packet_pdf({"company_name": "Example Studio"}, 1)
    result = import_packet(repository, "owner", case["id"], 0, "import", "old.pdf", body)
    with repository.connection() as connection:
        row = connection.execute("SELECT state FROM cases WHERE id=?", (case["id"],)).fetchone()
        import json
        state = json.loads(row["state"])
        packet = state["packets"][0]
        packet.pop("stage")
        packet.pop("stage_events")
        packet.pop("title")
        packet.pop("cloud")
        connection.execute("UPDATE cases SET state=? WHERE id=?",
                           (json.dumps(state), case["id"]))
    snapshot = service.snapshot("owner", case["id"])
    packet = snapshot["packets"][0]
    assert packet["stage"] == "draft"
    assert packet["stage_events"][0]["actor"] == "system_migration"
    assert packet["hash"] == result["hash"]
