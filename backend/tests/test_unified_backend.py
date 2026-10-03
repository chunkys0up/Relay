from __future__ import annotations

import importlib
from pathlib import Path
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from app.workflow_application import create_workflow_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.chdir(tmp_path)
    for key, value in {
        "PYTHON_DOTENV_DISABLED": "1", "AWS_CONFIG_FILE": "/dev/null",
        "AWS_SHARED_CREDENTIALS_FILE": "/dev/null", "AWS_ACCESS_KEY_ID": "offline-test",
        "AWS_SECRET_ACCESS_KEY": "offline-test", "AWS_EC2_METADATA_DISABLED": "true",
    }.items():
        monkeypatch.setenv(key, value)
    main = importlib.import_module("app.main")
    calls: list[str] = []

    async def start() -> None:
        calls.append("start")

    async def stop() -> None:
        calls.append("stop")

    monkeypatch.setattr(main, "init_pool", start)
    monkeypatch.setattr(main, "close_pool", stop)
    child = create_workflow_app(database_path=str(tmp_path / "test.sqlite3"), test_mode=True)
    with TestClient(main.create_app(child)) as connection:
        assert calls == ["start"]
        yield connection
    assert calls == ["start", "stop"]


def test_all_api_families_and_websocket_share_app(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/").json()["status"] == "ok"
    # Invalid legacy requests must hit validation, not the packet fallback or AWS.
    assert client.post("/api/chat", json={}).status_code == 422
    assert client.post("/api/documents/upload").status_code == 422
    workflow = client.get("/api/workflow/session")
    assert workflow.status_code == 200
    assert client.get("/api/advisor/session").status_code == 200
    assert "relay_workflow_session" in client.cookies
    assert "relay_advisor_session" in client.cookies
    csrf = workflow.json()["csrf_token"]
    created = client.post("/api/workflow/cases", json={"company": "Offline", "goal": "Review"},
                          headers={"X-CSRF-Token": csrf, "Idempotency-Key": "create"})
    assert created.status_code == 201
    case = created.json()
    with client.websocket_connect(f"/api/workflow/cases/{case['id']}/events",
                                  headers={"origin": "http://testserver"}) as socket:
        socket.send_json({"csrf_token": csrf, "after_revision": case["revision"]})
        assert socket.receive_json() == {"type": "ready"}


def test_packet_guards_survive_mount(client: TestClient) -> None:
    assert client.get("/api/workflow/cases").status_code == 401
    client.get("/api/workflow/session")
    assert client.post("/api/workflow/cases", json={"company": "Offline", "goal": "Review"},
                       headers={"Idempotency-Key": "missing-csrf"}).status_code == 403
    for path in ("/api/workflow/session", "/api/advisor/session"):
        assert client.get(path, headers={"origin": "https://outside.example"}).status_code == 403
        assert client.get(path, headers={"host": "outside.example"}).status_code == 403
    assert client.get("/api/workflow/cases/missing").status_code == 404
