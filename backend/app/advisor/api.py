"""Isolated local advisor API; sessions and grants are server-derived."""

from __future__ import annotations

import secrets
import threading
import time
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from .model import AdvisorProvider
from .store import CASE, AdvisorError, AdvisorStore


class VersionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ConversationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    versions: list[VersionInput] = Field(min_length=1, max_length=2)


class QuestionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)


def advisor_router(store: AdvisorStore, provider: AdvisorProvider | None,
                   *, test_mode: bool = False) -> APIRouter:
    router = APIRouter(prefix="/api/advisor")
    capacity = threading.BoundedSemaphore(2)
    active: set[str] = set()
    active_lock = threading.Lock()

    def session(request: Request) -> tuple[str, str, str]:
        sid = request.cookies.get("relay_advisor_session", "")
        found = store.session(sid) if sid else None
        if found is None:
            raise AdvisorError("SESSION_REQUIRED", 401)
        return sid, found[0], found[1]

    def mutation_session(request: Request, details: tuple[str, str, str] = Depends(session)) -> str:
        _sid, actor, csrf = details
        if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), csrf):
            raise AdvisorError("CSRF_FAILED", 403)
        origin = request.headers.get("origin")
        if origin and (urlparse(origin).hostname or "") not in {
                "127.0.0.1", "localhost", "::1", "testserver" if test_mode else ""}:
            raise AdvisorError("ORIGIN_FORBIDDEN", 403)
        return actor

    def idem(key: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
        if not key or len(key) > 128:
            raise AdvisorError("IDEMPOTENCY_KEY_REQUIRED", 400)
        return key

    @router.get("/session")
    def bootstrap(request: Request, response: Response) -> dict[str, Any]:
        sid = request.cookies.get("relay_advisor_session", "")
        found = store.session(sid) if sid else None
        if found is None:
            sid, csrf = store.new_session()
            actor = store.session(sid)[0]
            response.set_cookie("relay_advisor_session", sid, httponly=True,
                                samesite="strict", secure=False)
        else:
            actor, csrf = found
        versions = store.versions(actor, CASE)
        return {"demo": True, "mode": "simulated" if test_mode and provider else
                "live" if provider else "unconfigured",
                "provider": provider.label if provider else "Bedrock is not configured",
                "csrf_token": csrf,
                "workspace": {"kind": "server_synthetic", "case_id": CASE,
                              "company": "Northstar Labs", "advisor": {"id": actor,
                              "name": "Maya Chen"},
                              "versions": versions}}

    @router.get("/cases/{case_id}/conversations")
    def list_conversations(case_id: str, version_id: str, version_hash: str,
                           compare_id: str | None = None, compare_hash: str | None = None,
                           details: tuple[str, str, str] = Depends(session)) -> dict[str, Any]:
        versions = [{"id": version_id, "hash": version_hash}]
        if bool(compare_id) != bool(compare_hash):
            raise AdvisorError("INVALID_VERSIONS", 400)
        if compare_id and compare_hash:
            versions.append({"id": compare_id, "hash": compare_hash})
        return {"items": store.list_conversations(details[1], case_id, versions)}

    @router.post("/cases/{case_id}/conversations", status_code=201)
    def create_conversation(case_id: str, body: ConversationInput,
                            actor: str = Depends(mutation_session),
                            key: str = Depends(idem)) -> dict[str, Any]:
        return store.create_conversation(actor, case_id,
                                         [item.model_dump() for item in body.versions], key)

    @router.get("/cases/{case_id}/conversations/{conversation_id}")
    def get_conversation(case_id: str, conversation_id: str,
                         details: tuple[str, str, str] = Depends(session)) -> dict[str, Any]:
        return store.conversation(details[1], case_id, conversation_id)

    @router.post("/cases/{case_id}/conversations/{conversation_id}/messages")
    def ask(case_id: str, conversation_id: str, body: QuestionInput,
            actor: str = Depends(mutation_session), key: str = Depends(idem)) -> dict[str, Any]:
        if provider is None:
            raise AdvisorError("MODEL_UNCONFIGURED", 503, True)
        if not body.text.strip():
            raise AdvisorError("INVALID_QUESTION", 400)
        with active_lock:
            if conversation_id in active:
                raise AdvisorError("CONVERSATION_BUSY", 409, True)
        replay = store.begin_request(actor, case_id, conversation_id, key, body.text)
        if replay is not None:
            return replay
        if not capacity.acquire(blocking=False):
            store.fail_request(actor, conversation_id, key, "CAPACITY_BUSY")
            raise AdvisorError("CAPACITY_BUSY", 429, True)
        with active_lock:
            if conversation_id in active:
                capacity.release()
                store.fail_request(actor, conversation_id, key, "CONVERSATION_BUSY")
                raise AdvisorError("CONVERSATION_BUSY", 409, True)
            active.add(conversation_id)
        answer: dict[str, Any] = {}
        completed = threading.Event()
        cancel = threading.Event()
        deadline = time.monotonic() + 60

        def invoke() -> None:
            try:
                conversation = store.conversation(actor, case_id, conversation_id)
                answer["value"] = provider.answer(body.text, store, actor, case_id,
                                                  conversation["versions"],
                                                  history=conversation["messages"],
                                                  cancel=cancel, deadline=deadline)
            except Exception as exc:
                answer["error"] = exc
            finally:
                with active_lock:
                    active.discard(conversation_id)
                capacity.release()
                completed.set()

        threading.Thread(target=invoke, daemon=True, name="relay-advisor-model").start()
        if not completed.wait(60):
            cancel.set()
            store.fail_request(actor, conversation_id, key, "MODEL_TIMEOUT")
            raise AdvisorError("MODEL_TIMEOUT", 504, True)
        error = answer.get("error")
        if error:
            code = error.code if isinstance(error, AdvisorError) else "MODEL_UNAVAILABLE"
            store.fail_request(actor, conversation_id, key, code)
            if isinstance(error, AdvisorError):
                raise error
            raise AdvisorError(code, 503, True) from error
        try:
            return store.finish_request(actor, case_id, conversation_id, key,
                                        body.text, answer["value"])
        except AdvisorError as exc:
            store.fail_request(actor, conversation_id, key, exc.code)
            raise

    @router.get("/cases/{case_id}/packets/{version_id}/preview")
    def packet_preview(case_id: str, version_id: str, packet_hash: str,
                       details: tuple[str, str, str] = Depends(session)) -> PlainTextResponse:
        context = store.scope(details[1], case_id, [{"id": version_id, "hash": packet_hash}])
        packet = context["versions"][0]
        return PlainTextResponse(packet["text"], headers={"X-Content-SHA256": packet["hash"],
                                 "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "sandbox"})

    @router.get("/cases/{case_id}/sources/{source_id}/preview")
    def source_preview(case_id: str, source_id: str, version_id: str, packet_hash: str,
                       source_hash: str,
                       details: tuple[str, str, str] = Depends(session)) -> PlainTextResponse:
        context = store.scope(details[1], case_id, [{"id": version_id, "hash": packet_hash}])
        source = next((s for s in context["sources"] if s["id"] == source_id
                       and s["hash"] == source_hash), None)
        if source is None:
            raise AdvisorError("NOT_FOUND", 404)
        return PlainTextResponse(source["text"], headers={"X-Content-SHA256": source["hash"],
                                 "X-Content-Type-Options": "nosniff",
                                 "Content-Security-Policy": "sandbox"})

    return router
