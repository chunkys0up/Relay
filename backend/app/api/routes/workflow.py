from __future__ import annotations

import asyncio
import secrets
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.workflow.actions import resolve_edit
from app.workflow.packet_stages import import_packet, transition_packet
from app.workflow.cloud_sync import CloudSync
from app.workflow.example_packets import create_example_cases
from app.core.config import settings

from app.workflow.repository import Repository, WorkflowError
from app.workflow.sharing import (accessible_case_ids, authorize_case, create_invite,
                                  list_shares, redeem_invite, review_packet,
                                  revoke_invite, session_role, shared_snapshot)
from app.workflow.schemas import ConfirmInput, CreateCase, PacketInput, RelationshipInput, RunInput
from app.workflow.service import WorkflowService


class PdfActionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class PacketStageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    packet_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    target_stage: str


class InviteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    packet_id: str = Field(max_length=128)
    packet_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_ids: list[str] = Field(default_factory=list, max_length=100)


class RedeemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invite_code: str = Field(min_length=1, max_length=256)


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    packet_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    decision: str = Field(pattern="^(approved|questions_returned)$")
    note: str = Field(default="", max_length=4000)


def _local_host(host: str) -> bool:
    return host in ("127.0.0.1", "localhost", "::1", "testserver")


def workflow_router(
    repository: Repository, service: WorkflowService, *, test_mode: bool = False,
) -> APIRouter:
    router = APIRouter(prefix="/api/workflow")
    cloud = CloudSync(repository, settings)

    def schedule_sync(background: BackgroundTasks, owner: str, case_id: str) -> None:
        if not test_mode and settings.database_url and settings.s3_bucket:
            background.add_task(cloud.sync_case, owner, case_id)

    def invalidate_calls(case_id: str) -> None:
        from app.services.chime import invalidate_case
        invalidate_case(case_id)

    def session_id(request: Request) -> str:
        sid = request.cookies.get("relay_workflow_session", "")
        if not sid or repository.session(sid) is None:
            raise HTTPException(status_code=401, detail="SESSION_REQUIRED")
        return sid

    def mutation_session(request: Request, sid: str = Depends(session_id)) -> str:
        csrf = repository.session(sid)
        if csrf is None or not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), csrf):
            raise HTTPException(status_code=403, detail="CSRF_FAILED")
        origin = request.headers.get("origin")
        if origin and not _local_host(urlparse(origin).hostname or ""):
            raise HTTPException(status_code=403, detail="ORIGIN_FORBIDDEN")
        return sid

    def founder_session(sid: str = Depends(mutation_session)) -> str:
        if session_role(repository, sid) != "founder":
            raise WorkflowError("FOUNDER_REQUIRED", 403)
        return sid

    def idem(key: str | None = Header(default=None, alias="Idempotency-Key")) -> str:
        if not key or len(key) > 128:
            raise HTTPException(status_code=400, detail="IDEMPOTENCY_KEY_REQUIRED")
        return key

    @router.get("/session")
    def session(request: Request, response: Response) -> dict[str, Any]:
        sid = request.cookies.get("relay_workflow_session", "")
        csrf = repository.session(sid) if sid else None
        if csrf is None:
            sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            repository.create_session(sid, csrf)
            response.set_cookie("relay_workflow_session", sid, httponly=True,
                                samesite="strict", secure=False)
        if service.provider is None:
            mode, label = "unconfigured", "Bedrock is not configured"
        elif test_mode:
            mode, label = "simulated", service.provider.label
        else:
            mode, label = "live", service.provider.label
        actor_role = session_role(repository, sid)
        return {"demo": True, "mode": mode, "provider": label,
                "csrf_token": csrf, "actor": {"role": actor_role, "name": "Local advisor" if actor_role == "advisor" else "Demo founder"},
                "upload_limits": {"max_bytes": 10 * 1024 * 1024,
                                  "mime_types": ["application/pdf", "text/plain", "text/csv"]}}

    @router.get("/cases")
    def list_cases(sid: str = Depends(session_id)) -> dict[str, Any]:
        return {"items": [shared_snapshot(repository, service,
                    authorize_case(repository, sid, case_id), case_id)
                    for case_id in accessible_case_ids(repository, sid)]}

    @router.post("/invites/redeem")
    def redeem(body: RedeemInput, sid: str = Depends(mutation_session),
               _key: str = Depends(idem)) -> dict[str, Any]:
        return redeem_invite(repository, sid, body.invite_code)

    @router.get("/cases/{case_id}/shares")
    def shares(case_id: str, sid: str = Depends(session_id)) -> dict[str, Any]:
        return {"items": list_shares(repository, sid, case_id)}

    @router.post("/cases/{case_id}/shares", status_code=201)
    def invite(case_id: str, body: InviteInput,
               sid: str = Depends(founder_session), key: str = Depends(idem)) -> dict[str, Any]:
        return create_invite(repository, sid, case_id, body.packet_id,
                             body.packet_hash, body.source_ids, body.expected_revision, key)

    @router.post("/cases/{case_id}/shares/{invite_id}/revoke")
    def revoke(case_id: str, invite_id: str,
               sid: str = Depends(founder_session), _key: str = Depends(idem)) -> dict[str, Any]:
        result = revoke_invite(repository, sid, case_id, invite_id)
        if result["evict_advisor"]:
            from app.services.chime import revoke_actor
            revoke_actor(case_id, result["advisor_id"])
        return result

    @router.post("/cases/{case_id}/packets/{packet_id}/review")
    def review(case_id: str, packet_id: str, body: ReviewInput,
               background: BackgroundTasks, sid: str = Depends(mutation_session),
               key: str = Depends(idem)) -> dict[str, Any]:
        access = authorize_case(repository, sid, case_id)
        if access.role != "advisor":
            raise WorkflowError("ADVISOR_GRANT_REQUIRED", 403)
        result = review_packet(repository, sid, case_id, packet_id,
                               body.packet_hash, body.expected_revision,
                               body.decision, body.note, key)
        schedule_sync(background, access.owner, case_id)
        return result

    @router.post("/cases", status_code=201)
    def create_case(
        body: CreateCase, background: BackgroundTasks,
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        result = service.create_case(sid, key, body.company, body.goal)
        schedule_sync(background, sid, result["id"])
        return result

    @router.post("/cases/examples", status_code=201)
    def load_examples(background: BackgroundTasks, sid: str = Depends(founder_session),
                      key: str = Depends(idem)) -> dict[str, Any]:
        items = create_example_cases(service, sid)
        for item in items:
            schedule_sync(background, sid, item["id"])
        return {"items": items}

    @router.post("/cases/{case_id}/sync")
    def retry_sync(case_id: str, sid: str = Depends(founder_session),
                   _key: str = Depends(idem)) -> dict[str, Any]:
        service.snapshot(sid, case_id)
        return service._public(cloud.sync_case(sid, case_id))

    @router.get("/cases/{case_id}")
    def get_case(case_id: str, sid: str = Depends(session_id)) -> dict[str, Any]:
        return shared_snapshot(repository, service,
                               authorize_case(repository, sid, case_id), case_id)

    @router.websocket("/cases/{case_id}/events")
    async def events(websocket: WebSocket, case_id: str) -> None:
        host = websocket.url.hostname or ""
        peer = websocket.client.host if websocket.client else ""
        allowed = {"127.0.0.1", "localhost", "::1"}
        if test_mode:
            allowed |= {"testserver", "testclient"}
        origin = websocket.headers.get("origin", "")
        if (host not in allowed or peer not in allowed or
                not origin or (urlparse(origin).hostname or "") not in allowed):
            await websocket.close(code=1008)
            return
        sid = websocket.cookies.get("relay_workflow_session", "")
        csrf = repository.session(sid) if sid else None
        if csrf is None:
            await websocket.close(code=1008)
            return
        try:
            service.snapshot(sid, case_id)
        except WorkflowError:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        try:
            first = await asyncio.wait_for(websocket.receive_json(), timeout=5)
            if (not isinstance(first, dict) or
                    not secrets.compare_digest(str(first.get("csrf_token", "")), csrf) or
                    not isinstance(first.get("after_revision"), int)):
                await websocket.send_json({"type": "error", "message": "SESSION_REQUIRED"})
                await websocket.close(code=1008)
                return
            await websocket.send_json({"type": "ready"})
            seen = first["after_revision"]
            while True:
                state = service.snapshot(sid, case_id)
                if state["revision"] != seen:
                    await websocket.send_json({"type": "snapshot", "data": state})
                    seen = state["revision"]
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass
        except (WebSocketDisconnect, asyncio.TimeoutError):
            return

    @router.post("/cases/{case_id}/sources", status_code=201)
    async def upload_source(
        case_id: str, background: BackgroundTasks,
        expected_revision: int = Form(...), file: UploadFile = File(...),
        analyze: bool = Form(False),
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        data = await file.read(10 * 1024 * 1024 + 1)
        result = service.upload_source(sid, case_id, expected_revision, key,
                                       file.filename or "source", file.content_type or "", data,
                                       analyze=analyze)
        schedule_sync(background, sid, case_id)
        if analyze and not result["duplicate"] and service.provider is not None and result["source"]["extraction_status"] == "ready":
            started = service.start_job(sid, case_id, result["case_revision"],
                                        key + ":analysis", "Interpret the uploaded source and identify missing or conflicting packet facts.",
                                        author="Relay")
            result["job_id"] = started["job_id"]
            result["case_revision"] = started["case_revision"]
            background.add_task(service.process_job, sid, case_id, started["job_id"])
        return result

    @router.post("/cases/{case_id}/sources/{source_id}/relationship")
    def source_relationship(
        case_id: str, source_id: str, body: RelationshipInput,
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        return service.set_source_relationship(sid, case_id, source_id,
            body.related_source_id, body.decision, body.expected_revision, key)

    @router.post("/cases/{case_id}/templates", status_code=201)
    async def upload_template(
        case_id: str, expected_revision: int = Form(...), file: UploadFile = File(...),
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        if file.content_type != "application/pdf":
            raise WorkflowError("UNSUPPORTED_FILE", 415)
        data = await file.read(10 * 1024 * 1024 + 1)
        return service.upload_template(sid, case_id, expected_revision, key,
                                       file.filename or "template.pdf", data)

    @router.get("/cases/{case_id}/sources/{source_id}/preview")
    def preview_source(
        case_id: str, source_id: str, sid: str = Depends(session_id),
    ) -> StreamingResponse:
        access = authorize_case(repository, sid, case_id)
        if source_id not in access.source_ids:
            raise WorkflowError("NOT_FOUND", 404)
        state = shared_snapshot(repository, service, access, case_id)
        source = next((s for s in state["sources"] if s["id"] == source_id), None)
        if source is None:
            raise WorkflowError("NOT_FOUND", 404)
        body = repository.blob(access.owner, case_id, source_id, "source")
        import hashlib
        if hashlib.sha256(body).hexdigest() != source["hash"]:
            raise WorkflowError("ORIGINAL_INTEGRITY_ERROR", 409)
        media_type = source["mime_type"].split(";", 1)[0].strip().lower()
        if media_type not in ("application/pdf", "text/plain", "text/csv"):
            raise WorkflowError("UNSUPPORTED_FILE", 415)
        return StreamingResponse(iter([body]), media_type=media_type,
                                 headers={"Content-Disposition": "inline",
                                          "X-Content-Type-Options": "nosniff",
                                          "Content-Security-Policy": "sandbox"})

    @router.post("/cases/{case_id}/run", status_code=202)
    def run(
        case_id: str, body: RunInput, background: BackgroundTasks,
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        result = service.start_job(sid, case_id, body.expected_revision, key, body.goal)
        background.add_task(service.process_job, sid, case_id, result["job_id"])
        return result

    @router.get("/cases/{case_id}/jobs/{job_id}")
    def get_job(case_id: str, job_id: str, sid: str = Depends(session_id)) -> dict[str, Any]:
        state = service.snapshot(sid, case_id)
        job = next((job for job in state["jobs"] if job["id"] == job_id), None)
        if job is None:
            raise WorkflowError("NOT_FOUND", 404)
        return job

    @router.post("/cases/{case_id}/facts/confirm")
    def confirm(
        case_id: str, body: ConfirmInput, sid: str = Depends(founder_session),
        key: str = Depends(idem),
    ) -> dict[str, Any]:
        return service.confirm(sid, case_id, key, body)

    @router.post("/cases/{case_id}/packets", status_code=201)
    def create_packet(
        case_id: str, body: PacketInput, background: BackgroundTasks,
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        result = service.create_packet(sid, case_id, body.expected_revision, key, body.template_id)
        invalidate_calls(case_id)
        schedule_sync(background, sid, case_id)
        return result

    @router.post("/cases/{case_id}/packets/import", status_code=201)
    async def import_existing_packet(
        case_id: str, background: BackgroundTasks,
        expected_revision: int = Form(...), file: UploadFile = File(...),
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        if file.content_type != "application/pdf":
            raise WorkflowError("UNSUPPORTED_FILE", 415)
        data = await file.read(10 * 1024 * 1024 + 1)
        result = import_packet(repository, sid, case_id, expected_revision,
                               key, file.filename or "Imported packet.pdf", data)
        invalidate_calls(case_id)
        schedule_sync(background, sid, case_id)
        return result

    @router.post("/cases/{case_id}/packets/{packet_id}/stage")
    def set_packet_stage(
        case_id: str, packet_id: str, body: PacketStageInput, background: BackgroundTasks,
        sid: str = Depends(founder_session), key: str = Depends(idem),
    ) -> dict[str, Any]:
        result = transition_packet(repository, sid, case_id, packet_id,
                                   body.expected_revision, body.packet_hash, body.target_stage, key)
        schedule_sync(background, sid, case_id)
        return result

    @router.get("/cases/{case_id}/packets/{packet_id}/preview-text")
    def packet_preview_text(case_id: str, packet_id: str,
                            sid: str = Depends(session_id)) -> dict[str, str]:
        from io import BytesIO
        from pypdf import PdfReader
        import hashlib
        access = authorize_case(repository, sid, case_id)
        if access.role == "advisor" and packet_id != access.packet_id:
            raise WorkflowError("NOT_FOUND", 404)
        state = shared_snapshot(repository, service, access, case_id)
        packet = next((item for item in state["packets"] if item["id"] == packet_id), None)
        if packet is None:
            raise WorkflowError("NOT_FOUND", 404)
        body = repository.blob(access.owner, case_id, packet_id, "packet")
        if hashlib.sha256(body).hexdigest() != packet["hash"]:
            raise WorkflowError("ORIGINAL_INTEGRITY_ERROR", 409)
        try:
            reader = PdfReader(BytesIO(body), strict=True)
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages)[:20000]
        except Exception as exc:
            raise WorkflowError("INVALID_PDF", 422) from exc
        return {"status": "readable" if text.strip() else "no_native_text", "text": text}

    @router.get("/cases/{case_id}/packets/{packet_id}/download")
    def download_packet(
        case_id: str, packet_id: str, inline: bool = False,
        sid: str = Depends(session_id),
    ) -> StreamingResponse:
        access = authorize_case(repository, sid, case_id)
        if access.role == "advisor" and packet_id != access.packet_id:
            raise WorkflowError("NOT_FOUND", 404)
        state = shared_snapshot(repository, service, access, case_id)
        packet = next((packet for packet in state["packets"] if packet["id"] == packet_id), None)
        if packet is None:
            raise WorkflowError("NOT_FOUND", 404)
        body = repository.blob(access.owner, case_id, packet_id, "packet")
        import hashlib
        if hashlib.sha256(body).hexdigest() != packet["hash"]:
            raise WorkflowError("ORIGINAL_INTEGRITY_ERROR", 409)
        return StreamingResponse(iter([body]), media_type="application/pdf",
                                 headers={"Content-Disposition":
                                          f'{"inline" if inline else "attachment"}; filename="relay-packet-v{packet["version"]}.pdf"',
                                          "X-Content-SHA256": packet["hash"],
                                          "X-Content-Type-Options": "nosniff",
                                          "Content-Security-Policy": "sandbox"})

    @router.get("/cases/{case_id}/pdf-actions/{action_id}/preview")
    def preview_edit(case_id: str, action_id: str, sid: str = Depends(session_id)) -> StreamingResponse:
        body = repository.blob(sid, case_id, action_id, "pdf_preview")
        return StreamingResponse(iter([body]), media_type="application/pdf",
            headers={"Content-Disposition": "inline; filename=relay-proposed-edit.pdf",
                     "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"})

    @router.post("/cases/{case_id}/pdf-actions/{action_id}/confirm")
    def confirm_edit(case_id: str, action_id: str, body: PdfActionInput,
                     background: BackgroundTasks,
                     sid: str = Depends(founder_session), key: str = Depends(idem)) -> dict[str, Any]:
        result = resolve_edit(repository, sid, case_id, action_id, body.expected_revision,
                              body.preview_hash, key)
        invalidate_calls(case_id)
        schedule_sync(background, sid, case_id)
        return result

    @router.post("/cases/{case_id}/pdf-actions/{action_id}/dismiss")
    def dismiss_edit(case_id: str, action_id: str, body: PdfActionInput,
                     sid: str = Depends(founder_session), key: str = Depends(idem)) -> dict[str, Any]:
        return resolve_edit(repository, sid, case_id, action_id, body.expected_revision,
                            body.preview_hash, key, dismiss=True)

    return router
