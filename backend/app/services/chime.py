from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field

import boto3

from app.core.config import settings
from app.schemas.call import ActorIn, CallSession, JoinConfig, Participant

_session = boto3.Session(profile_name=settings.aws_profile or None, region_name=settings.chime_region)
_chime = _session.client("chime-sdk-meetings", region_name=settings.chime_region)
log = logging.getLogger("relay.chime")


class CallError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class _Participant:
    actor: ActorIn
    attendee_id: str | None = None


@dataclass
class _Call:
    id: str
    case_id: str
    meeting_id: str  # server-side only
    state: str = "ringing"
    participants: dict[str, _Participant] = field(default_factory=dict)
    checked_at: float = 0.0  # last time the meeting was confirmed to still exist in Chime


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
                joined=p.attendee_id is not None,
            )
            for p in call.participants.values()
        ],
    )


def _get(case_id: str, call_id: str) -> _Call:
    call = _calls.get(call_id)
    # Same 404 for unknown and wrong-case IDs so IDs don't leak across cases.
    if call is None or call.case_id != case_id:
        log.warning("call not found call=%s case=%s", call_id, case_id)
        raise CallError(404, "Call not found")
    return call


def create_call(case_id: str, actor: ActorIn) -> CallSession:
    with _lock:
        for existing in _calls.values():
            if existing.case_id == case_id and existing.state != "ended":
                # Chime may have closed an abandoned meeting; start a fresh one instead of reusing it.
                try:
                    _chime.get_meeting(MeetingId=existing.meeting_id)
                except _chime.exceptions.NotFoundException:
                    existing.state = "ended"
                    continue
                existing.participants.setdefault(actor.id, _Participant(actor))
                log.info("call reused call=%s case=%s actor=%s role=%s state=%s",
                         existing.id, case_id, actor.id, actor.role, existing.state)
                return _view(existing)
        call_id = str(uuid.uuid4())
        meeting = _chime.create_meeting(
            ClientRequestToken=call_id,
            MediaRegion=settings.chime_region,
            ExternalMeetingId=f"relay-{call_id}"[:64],
        )["Meeting"]
        call = _Call(id=call_id, case_id=case_id, meeting_id=meeting["MeetingId"])
        call.participants[actor.id] = _Participant(actor)
        _calls[call_id] = call
        log.info("call created call=%s case=%s actor=%s role=%s", call_id, case_id, actor.id, actor.role)
        return _view(call)


def join_call(case_id: str, call_id: str, actor: ActorIn) -> JoinConfig:
    with _lock:
        call = _get(case_id, call_id)
        if call.state == "ended":
            log.warning("join refused, call ended call=%s actor=%s", call_id, actor.id)
            raise CallError(409, "Call has ended")
        attendee = _chime.create_attendee(
            MeetingId=call.meeting_id, ExternalUserId=actor.id
        )["Attendee"]
        part = call.participants.setdefault(actor.id, _Participant(actor))
        part.attendee_id = attendee["AttendeeId"]
        # "connecting" = server authorized a join; real media readiness is client-side.
        call.state = "connecting"
        log.info("attendee joined call=%s case=%s actor=%s role=%s joined=%d/%d",
                 call.id, case_id, actor.id, actor.role,
                 sum(1 for p in call.participants.values() if p.attendee_id), len(call.participants))
        meeting = _chime.get_meeting(MeetingId=call.meeting_id)["Meeting"]
        return JoinConfig(call=_view(call), meeting=meeting, attendee=attendee)


def get_call(case_id: str, call_id: str) -> CallSession:
    with _lock:
        return _view(_get(case_id, call_id))


def end_call(case_id: str, call_id: str, actor: ActorIn) -> CallSession:
    with _lock:
        call = _get(case_id, call_id)
        if actor.id not in call.participants:
            log.warning("end refused, not a participant call=%s actor=%s", call_id, actor.id)
            raise CallError(403, "Not a participant in this call")
        if call.state != "ended":
            try:
                _chime.delete_meeting(MeetingId=call.meeting_id)
            except _chime.exceptions.NotFoundException:
                pass  # already expired/deleted in Chime
            call.state = "ended"
            log.info("call ended call=%s case=%s by=%s role=%s (meeting deleted)",
                     call.id, case_id, actor.id, actor.role)
        return _view(call)


def _end_locked(call: _Call) -> None:
    if call.state == "ended":
        return
    try:
        _chime.delete_meeting(MeetingId=call.meeting_id)
    except _chime.exceptions.NotFoundException:
        pass
    call.state = "ended"


def revoke_actor(case_id: str, actor_id: str) -> None:
    """Disconnect an advisor whose packet share was revoked."""
    with _lock:
        for call in _calls.values():
            if call.case_id != case_id or call.state == "ended":
                continue
            part = call.participants.get(actor_id)
            if part is None or part.attendee_id is None:
                continue
            try:
                _chime.delete_attendee(MeetingId=call.meeting_id, AttendeeId=part.attendee_id)
            except _chime.exceptions.NotFoundException:
                pass
            except Exception:
                _end_locked(call)
                continue
            part.attendee_id = None


def invalidate_case(case_id: str) -> None:
    """End active calls when a case's current packet is replaced."""
    with _lock:
        for call in _calls.values():
            if call.case_id == case_id:
                _end_locked(call)


def shutdown_calls() -> None:
    """Delete meetings held by this process when the server shuts down."""
    with _lock:
        for call in _calls.values():
            try:
                _end_locked(call)
            except Exception as exc:
                log.error("meeting cleanup failed call=%s error=%s", call.id, type(exc).__name__)


# How often active_call re-checks with Chime that a meeting still exists. Chime ends a
# meeting on its own a few minutes after everyone disconnects.
_RECHECK_SECONDS = 30


def active_call(case_id: str) -> CallSession | None:
    """The case's open call, if any. Calls whose Chime meeting has gone away are marked ended."""
    with _lock:
        for call in _calls.values():
            if call.case_id != case_id or call.state == "ended":
                continue
            if time.monotonic() - call.checked_at > _RECHECK_SECONDS:
                try:
                    _chime.get_meeting(MeetingId=call.meeting_id)
                    call.checked_at = time.monotonic()
                except _chime.exceptions.NotFoundException:
                    call.state = "ended"
                    log.info("call expired in Chime call=%s case=%s", call.id, case_id)
                    continue
            return _view(call)
        return None


def leave_call(case_id: str, call_id: str, actor: ActorIn) -> CallSession:
    """Remove one person from the call; the meeting ends when nobody is left."""
    with _lock:
        call = _get(case_id, call_id)
        part = call.participants.get(actor.id)
        if call.state != "ended" and part is not None and part.attendee_id is not None:
            try:
                _chime.delete_attendee(MeetingId=call.meeting_id, AttendeeId=part.attendee_id)
            except _chime.exceptions.NotFoundException:
                pass
            part.attendee_id = None
            log.info("attendee left call=%s case=%s actor=%s", call.id, case_id, actor.id)
            if not any(p.attendee_id for p in call.participants.values()):
                _end_locked(call)
                log.info("call ended, nobody left call=%s case=%s", call.id, case_id)
        return _view(call)
