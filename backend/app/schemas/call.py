from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

CallState = Literal["ringing", "connecting", "connected", "ended", "failed"]


class ActorIn(BaseModel):
    # Demo-only: there is no real auth yet, so the caller states who they are.
    id: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    role: Literal["founder", "advisor"]


class CreateCallRequest(BaseModel):
    actor: ActorIn


class JoinCallRequest(BaseModel):
    actor: ActorIn


class EndCallRequest(BaseModel):
    actor: ActorIn


class Participant(BaseModel):
    actor_id: str
    name: str
    role: Literal["founder", "advisor"]
    joined: bool
    muted: bool = False


class CallSession(BaseModel):
    """Safe call view. No Chime meeting/attendee IDs or tokens."""

    id: str
    case_id: str
    state: CallState
    participants: list[Participant]
    # Capture/transcription are not implemented; always off.
    capture: Literal["off"] = "off"


class JoinConfig(BaseModel):
    """What the official Chime SDK client needs to join. Short-lived; never log or store."""

    call: CallSession
    meeting: dict[str, Any]
    attendee: dict[str, Any]
