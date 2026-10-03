"""Require workflow ownership before legacy routes touch mirrored records."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from http.cookies import SimpleCookie
from tempfile import SpooledTemporaryFile
from typing import Any
from urllib.parse import parse_qs
from uuid import UUID

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.workflow.repository import Repository, WorkflowError

ConversationLookup = Callable[[str], Awaitable[str | None]]
MirrorLookup = Callable[[str, str], Awaitable[str | None]]


async def _conversation_case(conversation_id: str) -> str | None:
    try:
        identifier = UUID(conversation_id)
    except ValueError:
        return None
    from app.db.pool import get_pool
    row = await get_pool().fetchrow(
        "SELECT case_id FROM conversations WHERE id = $1", identifier,
    )
    return str(row["case_id"]) if row is not None else None


async def _is_mirrored(kind: str, identifier: str) -> str | None:
    from app.db.pool import get_pool

    value = UUID(identifier)
    if kind == "case":
        row = await get_pool().fetchrow(
            "SELECT id AS case_id FROM cases WHERE id=$1 AND service_type='workflow_packet'",
            value,
        )
    else:
        row = await get_pool().fetchrow(
            """SELECT d.case_id FROM documents d JOIN cases c ON c.id=d.case_id
               WHERE d.id=$1 AND c.service_type='workflow_packet'
               UNION ALL
               SELECT d.case_id FROM drafts d JOIN cases c ON c.id=d.case_id
               WHERE d.id=$1 AND c.service_type='workflow_packet' LIMIT 1""",
            value,
        )
    return str(row["case_id"]) if row is not None else None


def _header(scope: Scope, name: bytes) -> str:
    return next((value.decode("latin-1") for key, value in scope.get("headers", [])
                 if key.lower() == name), "")


def _session_id(scope: Scope) -> str:
    cookies = SimpleCookie()
    try:
        cookies.load(_header(scope, b"cookie"))
    except Exception:
        return ""
    return cookies["relay_workflow_session"].value if "relay_workflow_session" in cookies else ""


def _ids_from_path(path: str) -> tuple[list[str], list[str], str | None]:
    parts = path.strip("/").split("/")
    if len(parts) >= 3 and parts[:2] == ["api", "cases"]:
        return [parts[2]], [], None
    if len(parts) >= 4 and parts[:2] == ["api", "documents"] and parts[3] == "url":
        return [], [parts[2]], None
    if len(parts) == 3 and parts[:2] == ["api", "chat"] and parts[2].startswith("conv-"):
        return [], [], parts[2][5:]
    return [], [], None


def _ids_from_json(value: Any) -> tuple[list[str], list[str], list[str]]:
    if not isinstance(value, dict):
        return [], [], []
    cases = [value["case_id"]] if isinstance(value.get("case_id"), str) else []
    documents = value.get("document_ids")
    documents = [item for item in documents if isinstance(item, str)] if isinstance(documents, list) else []
    conversations = []
    conversation = value.get("conversation_id")
    if isinstance(conversation, str):
        conversations.append(conversation)
    session = value.get("session_id")
    if isinstance(session, str) and session.startswith("conv-"):
        conversations.append(session[5:])
    return cases, documents, conversations


async def _buffer(receive: Receive) -> SpooledTemporaryFile[bytes]:
    body = SpooledTemporaryFile(max_size=1024 * 1024)
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        body.write(message.get("body", b""))
        if not message.get("more_body", False):
            break
    body.seek(0)
    return body


def _replay(body: SpooledTemporaryFile[bytes], original: Receive | None = None) -> Receive:
    finished = False

    async def receive() -> Message:
        nonlocal finished
        if finished:
            return await original() if original is not None else {"type": "http.disconnect"}
        chunk = body.read(64 * 1024)
        if not chunk:
            finished = True
        return {"type": "http.request", "body": chunk, "more_body": bool(chunk)}
    return receive


class LegacyWorkflowScope:
    """Protect workflow IDs while preserving behavior for unrelated legacy IDs."""

    def __init__(
        self, app: ASGIApp, repository: Repository,
        conversation_lookup: ConversationLookup = _conversation_case,
        mirror_lookup: MirrorLookup = _is_mirrored,
    ) -> None:
        self.app = app
        self.repository = repository
        self.conversation_lookup = conversation_lookup
        self.mirror_lookup = mirror_lookup

    def _owners(
        self, case_ids: list[str], document_ids: list[str],
    ) -> tuple[set[str], list[str], list[str]]:
        owners: set[str] = set()
        unknown_cases: list[str] = []
        unknown_documents: list[str] = []

        def canonical(identifier: str) -> str | None:
            try:
                return str(UUID(identifier))
            except ValueError:
                return None

        with self.repository.connection() as connection:
            for case_id in set(case_ids):
                value = canonical(case_id)
                if value is None:
                    continue
                row = connection.execute("SELECT owner FROM cases WHERE id = ?", (value,)).fetchone()
                if row is not None:
                    owners.add(str(row["owner"]))
                else:
                    unknown_cases.append(value)
            for document_id in set(document_ids):
                value = canonical(document_id)
                if value is None:
                    continue
                row = connection.execute(
                    "SELECT c.owner FROM blobs b JOIN cases c ON c.id = b.case_id WHERE b.id = ?",
                    (value,),
                ).fetchone()
                if row is not None:
                    owners.add(str(row["owner"]))
                else:
                    unknown_documents.append(value)
        return owners, unknown_cases, unknown_documents

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith("/api/") or path.startswith(("/api/workflow/", "/api/advisor/")):
            await self.app(scope, receive, send)
            return
        cases, documents, conversation = _ids_from_path(path)
        conversations = [conversation] if conversation else []
        if path == "/api/documents":
            query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
            cases.extend(query.get("case_id", []))

        body: SpooledTemporaryFile[bytes] | None = None
        if (scope["type"] == "http" and scope.get("method") in ("POST", "PUT", "PATCH")
                and path in ("/api/chat", "/api/chat/stream", "/api/documents/upload")):
            body = await _buffer(receive)
            if path == "/api/documents/upload":
                request = Request(scope, receive=_replay(body))
                try:
                    async with request.form() as form:
                        cases.extend(value for value in form.getlist("case_id") if isinstance(value, str))
                except Exception:
                    pass  # Legacy validation handles malformed multipart bodies.
            else:
                try:
                    more_cases, more_documents, parsed_conversations = _ids_from_json(json.load(body))
                    cases.extend(more_cases)
                    documents.extend(more_documents)
                    conversations.extend(parsed_conversations)
                except (ValueError, UnicodeDecodeError):
                    pass  # Legacy validation handles malformed JSON bodies.
            body.seek(0)

        try:
            for conversation_id in set(conversations):
                linked_case = await self.conversation_lookup(conversation_id)
                if linked_case:
                    cases.append(linked_case)
            owners, unknown_cases, unknown_documents = (
                self._owners(cases, documents) if cases or documents else (set(), [], [])
            )
            try:
                mirrored_cases = []
                for identifier in unknown_cases:
                    linked = await self.mirror_lookup("case", identifier)
                    if linked is not None:
                        mirrored_cases.append(linked)
                for identifier in unknown_documents:
                    linked = await self.mirror_lookup("document", identifier)
                    if linked is not None:
                        mirrored_cases.append(linked)
            except Exception:
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1011})
                else:
                    await JSONResponse({"detail": "Access check unavailable"}, status_code=503)(
                        scope, receive, send
                    )
                return
            if mirrored_cases:
                mirror_owners, missing_cases, _ = self._owners(mirrored_cases, [])
                if missing_cases:
                    if scope["type"] == "websocket":
                        await send({"type": "websocket.close", "code": 1008})
                    else:
                        await JSONResponse({"detail": "Not found"}, status_code=404)(
                            scope, receive, send
                        )
                    return
                owners.update(mirror_owners)
            if owners:
                owner = _session_id(scope)
                token = self.repository.session(owner) if owner else None
                allowed = len(owners) == 1 and owner in owners and token is not None
                # Only call routes accept advisor grants. Legacy chat/history remains owner-private.
                parts = path.strip("/").split("/")
                is_call = len(parts) >= 4 and parts[:2] == ["api", "cases"] and parts[3] == "calls"
                if is_call and token is not None:
                    from app.workflow.sharing import authorize_case
                    try:
                        access = authorize_case(self.repository, owner, str(UUID(parts[2])))
                        allowed = True
                        scope.setdefault("state", {})["workflow_actor"] = {
                            "id": access.actor_id, "name": "Founder" if access.role == "founder" else "Advisor",
                            "role": access.role, "packet_id": access.packet_id, "packet_hash": access.packet_hash,
                        }
                    except (WorkflowError, ValueError):
                        allowed = False
                if scope["type"] == "websocket":
                    origin = _header(scope, b"origin")
                    host = _header(scope, b"host").split(":", 1)[0]
                    allowed = allowed and bool(origin) and origin.split("://", 1)[-1].split(":", 1)[0] == host
                elif scope.get("method") not in ("GET", "HEAD", "OPTIONS"):
                    allowed = allowed and _header(scope, b"x-csrf-token") == token
                if not allowed:
                    if scope["type"] == "websocket":
                        await send({"type": "websocket.close", "code": 1008})
                    else:
                        await JSONResponse({"detail": "Not found"}, status_code=404)(scope, receive, send)
                    return
            await self.app(scope, _replay(body, receive) if body is not None else receive, send)
        finally:
            if body is not None:
                body.close()
