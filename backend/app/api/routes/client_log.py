from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

router = APIRouter(tags=["client-log"])
log = logging.getLogger("relay.client")

# Allowlisted browser-side progress events, so the backend log shows whether
# media really connected. No free-form payloads, tokens or content.
ClientEvent = Literal[
    "start_clicked", "create_ok", "join_ok", "sdk_loaded", "mic_started", "no_mic",
    "camera_started", "no_camera", "session_started", "local_tile", "remote_tile",
    "remote_tile_removed", "chime_stopped", "mute", "unmute", "camera_on",
    "camera_off", "leave", "end_for_everyone", "error",
]


class ClientLogRequest(BaseModel):
    event: ClientEvent
    role: Literal["founder", "advisor"]
    call_id: str | None = Field(default=None, max_length=64)
    detail: str | None = Field(default=None, max_length=200)


@router.post("/client-log", status_code=204)
async def client_log(body: ClientLogRequest) -> Response:
    level = logging.WARNING if body.event == "error" else logging.INFO
    log.log(level, "event=%s role=%s call=%s detail=%s", body.event, body.role, body.call_id, body.detail)
    return Response(status_code=204)
