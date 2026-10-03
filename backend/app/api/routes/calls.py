from __future__ import annotations

import logging

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from app.schemas.call import (
    CallSession,
    CreateCallRequest,
    EndCallRequest,
    JoinCallRequest,
    JoinConfig,
)
from app.services import chime

router = APIRouter(prefix="/cases/{case_id}/calls", tags=["calls"])
log = logging.getLogger("relay.calls")


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
async def create_call(case_id: str, body: CreateCallRequest) -> CallSession:
    return await _run(chime.create_call, case_id, body.actor)


@router.get("/active", response_model=CallSession | None)
async def active_call(case_id: str) -> CallSession | None:
    return await _run(chime.active_call, case_id)


@router.get("/{call_id}", response_model=CallSession)
async def get_call(case_id: str, call_id: str) -> CallSession:
    return await _run(chime.get_call, case_id, call_id)


@router.post("/{call_id}/join", response_model=JoinConfig)
async def join_call(case_id: str, call_id: str, body: JoinCallRequest) -> JoinConfig:
    return await _run(chime.join_call, case_id, call_id, body.actor)


@router.post("/{call_id}/end", response_model=CallSession)
async def end_call(case_id: str, call_id: str, body: EndCallRequest) -> CallSession:
    return await _run(chime.end_call, case_id, call_id, body.actor)


@router.post("/{call_id}/leave", response_model=CallSession)
async def leave_call(case_id: str, call_id: str, body: EndCallRequest) -> CallSession:
    return await _run(chime.leave_call, case_id, call_id, body.actor)
