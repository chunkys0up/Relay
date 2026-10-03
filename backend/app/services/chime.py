from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from app.core.config import settings
from app.core.aws_session import create_aws_session
from app.schemas.call import ActorIn, CallSession, JoinConfig, Participant

@lru_cache(maxsize=1)
def _client() -> Any:
    session = create_aws_session(settings.chime_region, settings.aws_profile or None)
    return session.client("chime-sdk-meetings", region_name=settings.chime_region)
log = logging.getLogger("relay.chime")


class CallError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class _Participant:
    actor: ActorIn
    attendees: dict[str, str] = field(default_factory=dict)


@dataclass
class _Call:
    id: str
    case_id: str
    packet_id: str
    packet_hash: str
    meeting_id: str  # server-side only
    state: str = "ringing"
    participants: dict[str, _Participant] = field(default_factory=dict)
    cancelled_joins: set[tuple[str, str]] = field(default_factory=set)


# In-memory registry: meeting references stay server-side. Lost on restart;
# move to Postgres once the schema has a calls table.
_calls: dict[str, _Call] = {}
_lock = threading.Lock()


def _view(call: _Call) -> CallSession:
    return CallSession(
        id=call.id,
        case_id=call.case_id,
        state=call.state,  # type: ignore[arg-type]
        participants=[
            Participant(
                actor_id=p.actor.id, name=p.actor.name, role=p.actor.role,
                joined=bool(p.attendees),
            )
            for p in call.participants.values()
        ],
    )


def _get(case_id: str, call_id: str, packet_id: str | None = None,
         packet_hash: str | None = None) -> _Call:
    call = _calls.get(call_id)
    # Same 404 for unknown and wrong-case IDs so IDs don't leak across cases.
    if (call is None or call.case_id != case_id or
            (packet_id is not None and call.packet_id != packet_id) or
            (packet_hash is not None and call.packet_hash != packet_hash)):
        log.warning("call not found call=%s case=%s", call_id, case_id)
        raise CallError(404, "Call not found")
    return call


def _end_locked(call: _Call) -> None:
    if call.state == "ended":
        return
    try:
        _client().delete_meeting(MeetingId=call.meeting_id)
    except _client().exceptions.NotFoundException:
        pass
    call.state = "ended"
    for part in call.participants.values():
        part.attendees.clear()


def create_call(case_id: str, actor: ActorIn, packet_id: str, packet_hash: str) -> CallSession:
    with _lock:
        for existing in _calls.values():
            if existing.case_id == case_id and existing.state != "ended":
                if (existing.packet_id, existing.packet_hash) != (packet_id, packet_hash):
                    _end_locked(existing)
                    continue
                try:
                    _client().get_meeting(MeetingId=existing.meeting_id)
                except _client().exceptions.NotFoundException:
                    existing.state = "ended"
                    for part in existing.participants.values():
                        part.attendees.clear()
                    continue
                existing.participants.setdefault(actor.id, _Participant(actor))
                log.info("call reused call=%s case=%s actor=%s role=%s state=%s",
                         existing.id, case_id, actor.id, actor.role, existing.state)
                return _view(existing)
        call_id = str(uuid.uuid4())
        meeting = _client().create_meeting(
            ClientRequestToken=call_id,
            MediaRegion=settings.chime_region,
            ExternalMeetingId=f"relay-{call_id}"[:64],
        )["Meeting"]
        call = _Call(id=call_id, case_id=case_id, packet_id=packet_id,
                     packet_hash=packet_hash, meeting_id=meeting["MeetingId"])
        call.participants[actor.id] = _Participant(actor)
        _calls[call_id] = call
        log.info("call created call=%s case=%s actor=%s role=%s", call_id, case_id, actor.id, actor.role)
        return _view(call)


def join_call(case_id: str, call_id: str, actor: ActorIn, packet_id: str,
              packet_hash: str, join_id: str) -> JoinConfig:
    with _lock:
        call = _get(case_id, call_id, packet_id, packet_hash)
        if call.state == "ended":
            log.warning("join refused, call ended call=%s actor=%s", call_id, actor.id)
            raise CallError(409, "Call has ended")
        if (actor.id, join_id) in call.cancelled_joins:
            raise CallError(409, "Join was cancelled")
        if any(join_id in part.attendees for part in call.participants.values()):
            raise CallError(409, "Join already exists")
        meeting = _client().get_meeting(MeetingId=call.meeting_id)["Meeting"]
        attendee = _client().create_attendee(
            MeetingId=call.meeting_id,
            ExternalUserId=f"{actor.id[:42]}-{uuid.uuid4().hex[:12]}",
        )["Attendee"]
        part = call.participants.setdefault(actor.id, _Participant(actor))
        part.attendees[join_id] = attendee["AttendeeId"]
        # "connecting" = server authorized a join; real media readiness is client-side.
        call.state = "connecting"
        log.info("attendee joined call=%s case=%s actor=%s role=%s joined=%d/%d",
                 call.id, case_id, actor.id, actor.role,
                 sum(1 for p in call.participants.values() if p.attendees), len(call.participants))
        return JoinConfig(call=_view(call), meeting=meeting, attendee=attendee)


def leave_call(case_id: str, call_id: str, actor: ActorIn, join_id: str) -> CallSession:
    with _lock:
        call = _get(case_id, call_id)
        part = call.participants.get(actor.id)
        if part is None:
            raise CallError(403, "Not a participant in this call")
        attendee_id = part.attendees.get(join_id)
        if attendee_id is not None and call.state != "ended":
            try:
                _client().delete_attendee(MeetingId=call.meeting_id, AttendeeId=attendee_id)
            except _client().exceptions.NotFoundException:
                pass  # Already removed by Chime after disconnect or meeting expiry.
        part.attendees.pop(join_id, None)
        call.cancelled_joins.add((actor.id, join_id))
        if call.state != "ended" and not any(p.attendees for p in call.participants.values()):
            call.state = "ringing"
        log.info("attendee left call=%s case=%s actor=%s", call_id, case_id, actor.id)
        return _view(call)


def revoke_actor(case_id: str, actor_id: str) -> None:
    """Disconnect every live attendee for an advisor whose case grant was revoked."""
    with _lock:
        for call in _calls.values():
            if call.case_id != case_id or call.state == "ended":
                continue
            part = call.participants.get(actor_id)
            if part is None:
                continue
            for join_id, attendee_id in tuple(part.attendees.items()):
                try:
                    _client().delete_attendee(MeetingId=call.meeting_id, AttendeeId=attendee_id)
                except _client().exceptions.NotFoundException:
                    pass
                except Exception:
                    # A failed attendee removal must not leave a usable grant token.
                    # Meeting deletion also disconnects the founder; preserve registry
                    # state if it fails so the owner can retry revocation cleanup.
                    _end_locked(call)
                    break
                part.attendees.pop(join_id, None)
                call.cancelled_joins.add((actor_id, join_id))
            if call.state != "ended" and not any(
                participant.attendees for participant in call.participants.values()
            ):
                call.state = "ringing"


def get_call(case_id: str, call_id: str, packet_id: str, packet_hash: str) -> CallSession:
    with _lock:
        return _view(_get(case_id, call_id, packet_id, packet_hash))


def end_call(case_id: str, call_id: str, actor: ActorIn) -> CallSession:
    with _lock:
        call = _get(case_id, call_id)
        if actor.id not in call.participants:
            log.warning("end refused, not a participant call=%s actor=%s", call_id, actor.id)
            raise CallError(403, "Not a participant in this call")
        if call.state != "ended":
            _end_locked(call)
            log.info("call ended call=%s case=%s by=%s role=%s (meeting deleted)",
                     call.id, case_id, actor.id, actor.role)
        return _view(call)


def invalidate_case(case_id: str) -> None:
    """End active media when a case's current packet is replaced or invalidated."""
    with _lock:
        for call in _calls.values():
            if call.case_id == case_id:
                _end_locked(call)


def shutdown_calls() -> None:
    """Delete meetings held by this process during a normal server shutdown."""
    with _lock:
        for call in _calls.values():
            if call.state == "ended":
                continue
            try:
                _client().delete_meeting(MeetingId=call.meeting_id)
            except _client().exceptions.NotFoundException:
                pass
            except Exception as exc:
                log.error("meeting cleanup failed call=%s error=%s", call.id, type(exc).__name__)
                continue
            call.state = "ended"
            for part in call.participants.values():
                part.attendees.clear()
