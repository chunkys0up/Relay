from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.workflow_app import create_workflow_app


def test_explicit_examples_repeat_and_isolate(tmp_path: Path) -> None:
    app = create_workflow_app(database_path=str(tmp_path / "cases.sqlite3"), test_mode=True)
    first = TestClient(app)
    session = first.get("/api/workflow/session").json()
    headers = {"X-CSRF-Token": session["csrf_token"],
               "Idempotency-Key": str(uuid4()), "Origin": "http://localhost:5189"}
    response = first.post("/api/workflow/cases/examples", headers=headers)
    assert response.status_code == 201, response.text
    items = response.json()["items"]
    assert len(items) == 4
    assert {item["packets"][0]["stage"] for item in items} == {
        "draft", "in_review", "questions_returned", "approved"}
    assert all(item["synthetic_example"] for item in items)
    for case in items:
        assert len(case["sources"]) == 1 and len(case["packets"]) == 1
        packet = case["packets"][0]
        source = case["sources"][0]
        pdf = first.get(f"/api/workflow/cases/{case['id']}/packets/{packet['id']}/download")
        original = first.get(f"/api/workflow/cases/{case['id']}/sources/{source['id']}/preview")
        assert pdf.content.startswith(b"%PDF-") and original.content.startswith(b"%PDF-")
        assert hashlib.sha256(pdf.content).hexdigest() == packet["hash"]
        assert hashlib.sha256(original.content).hexdigest() == source["hash"]
        preview = first.get(f"/api/workflow/cases/{case['id']}/packets/{packet['id']}/preview-text")
        assert preview.status_code == 200
        assert "SYNTHETIC EXAMPLE" in preview.json()["text"]
        assert len(packet["stage_events"]) == {
            "draft": 0, "in_review": 1, "questions_returned": 2, "approved": 2
        }[packet["stage"]]
    again = first.post("/api/workflow/cases/examples",
                       headers={**headers, "Idempotency-Key": str(uuid4())})
    assert again.status_code == 201, again.text
    assert [item["id"] for item in again.json()["items"]] == [item["id"] for item in items]
    assert len(first.get("/api/workflow/cases").json()["items"]) == 4
    outsider = TestClient(app)
    outsider.get("/api/workflow/session")
    case = items[0]
    assert outsider.get(f"/api/workflow/cases/{case['id']}").status_code == 404
    assert outsider.get(f"/api/workflow/cases/{case['id']}/packets/{case['packets'][0]['id']}/download").status_code == 404


def test_example_review_task_follows_server_transition(tmp_path: Path) -> None:
    client = TestClient(create_workflow_app(database_path=str(tmp_path / "cases.sqlite3"),
                                            test_mode=True))
    session = client.get("/api/workflow/session").json()
    headers = {"X-CSRF-Token": session["csrf_token"],
               "Idempotency-Key": str(uuid4()), "Origin": "http://localhost:5189"}
    case = client.post("/api/workflow/cases/examples", headers=headers).json()["items"][0]
    packet = case["packets"][0]
    response = client.post(
        f"/api/workflow/cases/{case['id']}/packets/{packet['id']}/stage",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"expected_revision": case["revision"],
              "packet_hash": packet["hash"], "target_stage": "in_review"})
    assert response.status_code == 200, response.text
    saved = client.get(f"/api/workflow/cases/{case['id']}").json()
    assert saved["packets"][0]["stage"] == "in_review"
    task = next(task for task in saved["tasks"] if task["key"] == "example_review")
    assert task["state"] == "In progress"
