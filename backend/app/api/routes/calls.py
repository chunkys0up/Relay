from __future__ import annotations

import logging

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.schemas.call import (
    CallSession,
    JoinConfig,
    JoinCallRequest,
    LeaveCallRequest,
    ActorIn,
)
from app.services import chime

router = APIRouter(prefix="/cases/{case_id}/calls", tags=["calls"])
log = logging.getLogger("relay.calls")


def _access(request: Request) -> tuple[ActorIn, str, str]:
    value = getattr(request.state, "workflow_actor", None)
    if not isinstance(value, dict):
        raise HTTPException(status_code=403, detail="Call access denied")
    packet_id, packet_hash = value.get("packet_id"), value.get("packet_hash")
    if not isinstance(packet_id, str) or not packet_id or not isinstance(packet_hash, str) or not packet_hash:
        raise HTTPException(status_code=403, detail="Call access denied")
    return ActorIn.model_validate(value), packet_id, packet_hash


async def _run(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except chime.CallError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    except (ClientError, BotoCoreError) as exc:
        code = exc.response.get("Error", {}).get("Code") if isinstance(exc, ClientError) else type(exc).__name__
        log.error("AWS call failed in %s: %s", getattr(fn, "__name__", "?"), code)
        # Don't leak AWS details to the client.
        raise HTTPException(status_code=502, detail="Call service unavailable") from exc


@router.post("", response_model=CallSession, status_code=201)
async def create_call(case_id: str, request: Request) -> CallSession:
    actor, packet_id, packet_hash = _access(request)
    return await _run(chime.create_call, case_id, actor, packet_id, packet_hash)


@router.get("/{call_id}", response_model=CallSession)
async def get_call(case_id: str, call_id: str, request: Request) -> CallSession:
    _, packet_id, packet_hash = _access(request)
    return await _run(chime.get_call, case_id, call_id, packet_id, packet_hash)


@router.post("/{call_id}/join", response_model=JoinConfig)
async def join_call(case_id: str, call_id: str, body: JoinCallRequest, request: Request) -> JoinConfig:
    actor, packet_id, packet_hash = _access(request)
    return await _run(chime.join_call, case_id, call_id, actor, packet_id, packet_hash, str(body.join_id))


@router.post("/{call_id}/leave", response_model=CallSession)
async def leave_call(case_id: str, call_id: str, body: LeaveCallRequest, request: Request) -> CallSession:
    actor, _, _ = _access(request)
    return await _run(chime.leave_call, case_id, call_id, actor, str(body.join_id))


@router.post("/{call_id}/end", response_model=CallSession)
async def end_call(case_id: str, call_id: str, request: Request) -> CallSession:
    actor, _, _ = _access(request)
    return await _run(chime.end_call, case_id, call_id, actor)
