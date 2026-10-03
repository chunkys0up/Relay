from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.legacy_workflow_scope import LegacyWorkflowScope
from app.workflow.repository import Repository
from app.workflow.sharing import public_actor_id


def test_legacy_bridge_guards_mirrored_ids_and_replays_bodies(tmp_path: Path) -> None:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    case_id, source_id = str(uuid4()), str(uuid4())
    repo.create_session("owner", "csrf")
    repo.create_session("stranger", "other")
    repo.create_case("owner", case_id, {"id": case_id, "revision": 0})
    with repo.connection() as conn:
        conn.execute("INSERT INTO blobs(id,case_id,kind,body) VALUES (?,?,?,?)",
                     (source_id, case_id, "source", b"pdf"))

    app = FastAPI()

    @app.get("/api/cases/{case_id}/activity")
    async def activity(case_id: str) -> dict[str, str]:
        return {"id": case_id}

    @app.get("/api/documents")
    async def documents(case_id: str) -> dict[str, str]:
        return {"id": case_id}

    @app.get("/api/documents/{document_id}/url")
    async def document_url(document_id: str) -> dict[str, str]:
        return {"id": document_id}

    @app.post("/api/documents/upload")
    async def upload(request: Request) -> dict[str, str]:
        form = await request.form()
        return {"case": str(form["case_id"]), "body": (await form["file"].read()).decode()}

    @app.post("/api/chat/stream")
    async def chat(request: Request) -> dict:
        return await request.json()

    async def lookup(conversation_id: str) -> str | None:
        return case_id if conversation_id == "linked" else None

    legacy_attachment = str(uuid4())

    async def mirror_lookup(kind: str, identifier: str) -> str | None:
        return case_id if (kind, identifier) == ("document", legacy_attachment) else None

    app.add_middleware(LegacyWorkflowScope, repository=repo,
                       conversation_lookup=lookup, mirror_lookup=mirror_lookup)
    with TestClient(app) as client:
        variant = UUID(case_id).hex.upper()
        blob_variant = UUID(source_id).hex.upper()
        urls = [f"/api/cases/{variant}/activity", f"/api/documents?case_id={variant}",
                f"/api/documents/{blob_variant}/url"]
        assert all(client.get(url).status_code == 404 for url in urls)
        client.cookies.set("relay_workflow_session", "stranger")
        assert all(client.get(url).status_code == 404 for url in urls)
        client.cookies.set("relay_workflow_session", "owner")
        assert all(client.get(url).status_code == 200 for url in urls)
        assert client.get(f"/api/cases/{uuid4()}/activity").status_code == 200

        files = {"case_id": (None, variant), "file": ("note.txt", b"hello", "text/plain")}
        assert client.post("/api/documents/upload", files=files).status_code == 404
        response = client.post("/api/documents/upload", files=files, headers={"X-CSRF-Token": "csrf"})
        assert response.status_code == 200
        assert response.json()["body"] == "hello"

        payload = {"case_id": variant, "document_ids": [blob_variant],
                   "session_id": "conv-linked"}
        assert client.post("/api/chat/stream", json=payload).status_code == 404
        response = client.post("/api/chat/stream", json=payload, headers={"X-CSRF-Token": "csrf"})
        assert response.status_code == 200
        assert response.json() == payload
        assert client.post("/api/chat/stream", json={"session_id": "conv-linked"}).status_code == 404
        assert client.post("/api/chat/stream", json={"session_id": "conv-linked"},
                           headers={"X-CSRF-Token": "csrf"}).status_code == 200

        assert client.get(f"/api/documents/{legacy_attachment}/url").status_code == 200
        client.cookies.delete("relay_workflow_session")
        assert client.post("/api/documents/upload",
                           files={"case_id": (None, str(uuid4())), "file": ("x", b"ok")}).status_code == 200


def test_lost_local_record_still_denies_cloud_mirror(tmp_path: Path) -> None:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    case_id, document_id = str(uuid4()), str(uuid4())
    repo.create_session("old-owner", "csrf")
    repo.create_case("old-owner", case_id, {"id": case_id})
    with repo.connection() as conn:
        conn.execute("INSERT INTO blobs(id,case_id,kind,body) VALUES (?,?,?,?)",
                     (document_id, case_id, "source", b"pdf"))
        conn.execute("DELETE FROM blobs WHERE id=?", (document_id,))
        conn.execute("DELETE FROM cases WHERE id=?", (case_id,))

    app = FastAPI()

    @app.get("/api/documents")
    async def documents(case_id: str) -> dict[str, str]:
        return {"id": case_id}

    @app.get("/api/documents/{document_id}/url")
    async def document_url(document_id: str) -> dict[str, str]:
        return {"id": document_id}

    async def mirror_lookup(kind: str, identifier: str) -> str | None:
        return case_id if (kind, identifier) in {("case", case_id), ("document", document_id)} else None

    app.add_middleware(LegacyWorkflowScope, repository=repo, mirror_lookup=mirror_lookup)
    with TestClient(app) as client:
        client.cookies.set("relay_workflow_session", "old-owner")
        assert client.get(f"/api/documents?case_id={UUID(case_id).hex.upper()}").status_code == 404
        assert client.get(f"/api/documents/{UUID(document_id).hex.upper()}/url").status_code == 404

    async def unavailable(_kind: str, _identifier: str) -> str | None:
        raise RuntimeError("Postgres unavailable")

    fail_closed = FastAPI()
    fail_closed.add_middleware(LegacyWorkflowScope, repository=repo, mirror_lookup=unavailable)

    @fail_closed.get("/api/documents")
    async def legacy(case_id: str) -> dict[str, str]:
        return {"id": case_id}

    with TestClient(fail_closed) as client:
        assert client.get(f"/api/documents?case_id={case_id}").status_code == 503


def test_calls_use_session_grant_and_do_not_open_private_legacy_routes(tmp_path: Path) -> None:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    case_id, packet_id = str(uuid4()), str(uuid4())
    for sid, csrf in (("owner", "owner-csrf"), ("advisor", "advisor-csrf"),
                      ("stranger", "stranger-csrf")):
        repo.create_session(sid, csrf)
    repo.create_case("owner", case_id, {
        "id": case_id, "current_packet_id": packet_id,
        "packets": [{"id": packet_id, "hash": "packet-hash"}], "sources": [],
    })
    with repo.connection() as conn:
        conn.execute("INSERT INTO session_roles VALUES (?,?)", ("advisor", "advisor"))
        conn.execute("INSERT INTO share_invites VALUES (?,?,?,?,?,?,?,?,0)",
                     ("invite", "hash", case_id, "owner", packet_id, "packet-hash", "[]", "now"))
        conn.execute("INSERT INTO share_grants VALUES (?,?,?,?,?,0)",
                     ("grant", "invite", case_id, "advisor", "now"))

    app = FastAPI()

    @app.get("/api/cases/{case_id}/calls")
    async def get_call_actor(case_id: str, request: Request) -> dict[str, str]:
        return request.state.workflow_actor

    @app.post("/api/cases/{case_id}/calls")
    async def post_call_actor(case_id: str, request: Request) -> dict[str, str]:
        return request.state.workflow_actor

    @app.get("/api/cases/{case_id}/activity")
    async def private_activity(case_id: str) -> dict[str, str]:
        return {"id": case_id}

    async def no_cloud_mirror(_kind: str, _identifier: str) -> str | None:
        return None

    app.add_middleware(LegacyWorkflowScope, repository=repo, mirror_lookup=no_cloud_mirror)
    with TestClient(app) as client:
        client.cookies.set("relay_workflow_session", "stranger")
        assert client.get(f"/api/cases/{case_id}/calls").status_code == 404
        client.cookies.set("relay_workflow_session", "owner")
        assert client.get(f"/api/cases/{case_id}/calls").json()["role"] == "founder"
        client.cookies.set("relay_workflow_session", "advisor")
        assert client.get(f"/api/cases/{case_id}/calls").json()["role"] == "advisor"
        assert client.get(f"/api/cases/{case_id}/activity").status_code == 404
        assert client.post(f"/api/cases/{case_id}/calls",
                           json={"actor": {"id": "owner", "role": "founder"}}).status_code == 404
        allowed = client.post(f"/api/cases/{case_id}/calls",
                              json={"actor": {"id": "owner", "role": "founder"}},
                              headers={"X-CSRF-Token": "advisor-csrf"})
        assert allowed.status_code == 200
        assert allowed.json()["id"] == public_actor_id("advisor")
        with repo.connection() as conn:
            conn.execute("UPDATE share_grants SET revoked=1 WHERE id='grant'")
        assert client.get(f"/api/cases/{case_id}/calls").status_code == 404
