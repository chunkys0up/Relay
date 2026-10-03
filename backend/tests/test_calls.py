from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.api.routes.calls import router as calls_router
from app.schemas.call import ActorIn
from app.services import chime

PACKET = "packet-1"
HASH = "hash-1"


class FakeChime:
    class NotFoundException(Exception):
        pass

    exceptions = type("Errors", (), {"NotFoundException": NotFoundException})()

    def __init__(self) -> None:
        self.meetings: set[str] = set()
        self.attendees: set[str] = set()
        self.deleted_attendees: list[str] = []
        self.deleted_meetings: list[str] = []
        self.fail_attendee_delete = False
        self.fail_meeting_delete = False

    def create_meeting(self, **_kwargs: Any) -> dict[str, Any]:
        meeting_id = f"meeting-{len(self.meetings) + 1}"
        self.meetings.add(meeting_id)
        return {"Meeting": {"MeetingId": meeting_id}}

    def get_meeting(self, MeetingId: str) -> dict[str, Any]:
        if MeetingId not in self.meetings:
            raise self.NotFoundException()
        return {"Meeting": {"MeetingId": MeetingId}}

    def create_attendee(self, MeetingId: str, ExternalUserId: str) -> dict[str, Any]:
        assert MeetingId in self.meetings
        assert len(ExternalUserId) <= 64
        attendee_id = f"attendee-{len(self.attendees) + 1}"
        self.attendees.add(attendee_id)
        return {"Attendee": {"AttendeeId": attendee_id, "JoinToken": "secret"}}

    def delete_attendee(self, MeetingId: str, AttendeeId: str) -> None:
        if self.fail_attendee_delete:
            raise RuntimeError("attendee deletion unavailable")
        assert MeetingId in self.meetings
        if AttendeeId not in self.attendees:
            raise self.NotFoundException()
        self.attendees.remove(AttendeeId)
        self.deleted_attendees.append(AttendeeId)

    def delete_meeting(self, MeetingId: str) -> None:
        if self.fail_meeting_delete:
            raise RuntimeError("meeting deletion unavailable")
        if MeetingId not in self.meetings:
            raise self.NotFoundException()
        self.meetings.remove(MeetingId)
        self.deleted_meetings.append(MeetingId)
        self.attendees.clear()


@pytest.fixture
def fake_chime(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeChime]:
    fake = FakeChime()
    chime._calls.clear()
    monkeypatch.setattr(chime, "_client", lambda: fake)
    yield fake
    chime._calls.clear()


def test_leave_revokes_only_own_join_and_rejoin_uses_live_meeting(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    advisor = ActorIn(id="advisor-1", name="Advisor", role="advisor")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    first = chime.join_call("case-1", call.id, founder, PACKET, HASH, "join-1")
    second = chime.join_call("case-1", call.id, founder, PACKET, HASH, "join-2")
    other = chime.join_call("case-1", call.id, advisor, PACKET, HASH, "join-3")
    assert len(fake_chime.attendees) == 3

    state = chime.leave_call("case-1", call.id, founder, "join-1")
    assert state.participants[0].joined
    assert first.attendee["AttendeeId"] in fake_chime.deleted_attendees
    assert second.attendee["AttendeeId"] in fake_chime.attendees
    assert other.attendee["AttendeeId"] in fake_chime.attendees
    chime.leave_call("case-1", call.id, founder, "join-2")
    state = chime.leave_call("case-1", call.id, advisor, "join-3")
    assert state.state == "ringing"
    assert all(not participant.joined for participant in state.participants)

    reused = chime.create_call("case-1", founder, PACKET, HASH)
    assert reused.id == call.id
    rejoined = chime.join_call("case-1", call.id, founder, PACKET, HASH, "join-4")
    assert rejoined.attendee["AttendeeId"] in fake_chime.attendees
    assert len(fake_chime.meetings) == 1


def test_cancel_before_join_and_end_cleanup(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    chime.leave_call("case-1", call.id, founder, "cancelled-join")
    with pytest.raises(chime.CallError) as cancelled:
        chime.join_call("case-1", call.id, founder, PACKET, HASH, "cancelled-join")
    assert cancelled.value.status == 409
    assert not fake_chime.attendees

    joined = chime.join_call("case-1", call.id, founder, PACKET, HASH, "valid-join")
    ended = chime.end_call("case-1", call.id, founder)
    assert ended.state == "ended"
    assert not ended.participants[0].joined
    assert len(fake_chime.deleted_meetings) == 1
    assert joined.attendee["AttendeeId"] not in fake_chime.attendees
    with pytest.raises(chime.CallError) as rejected:
        chime.join_call("case-1", call.id, founder, PACKET, HASH, "after-end")
    assert rejected.value.status == 409


def test_expired_meeting_is_replaced_on_reconnect(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    old = chime.create_call("case-1", founder, PACKET, HASH)
    chime.join_call("case-1", old.id, founder, PACKET, HASH, "old-join")
    fake_chime.meetings.clear()
    replacement = chime.create_call("case-1", founder, PACKET, HASH)
    assert replacement.id != old.id
    assert chime.get_call("case-1", old.id, PACKET, HASH).state == "ended"
    assert not chime.get_call("case-1", old.id, PACKET, HASH).participants[0].joined
    assert chime.join_call("case-1", replacement.id, founder, PACKET, HASH, "new-join").call.state == "connecting"


def test_revoking_advisor_disconnects_only_advisor(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    advisor = ActorIn(id="advisor-1", name="Advisor", role="advisor")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    owner = chime.join_call("case-1", call.id, founder, PACKET, HASH, "owner-join")
    guest = chime.join_call("case-1", call.id, advisor, PACKET, HASH, "advisor-join")
    chime.revoke_actor("case-1", advisor.id)
    assert guest.attendee["AttendeeId"] in fake_chime.deleted_attendees
    assert owner.attendee["AttendeeId"] in fake_chime.attendees
    assert not chime.get_call("case-1", call.id, PACKET, HASH).participants[1].joined


def test_revoke_falls_back_to_meeting_and_preserves_retry_state(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    advisor = ActorIn(id="advisor-1", name="Advisor", role="advisor")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    chime.join_call("case-1", call.id, advisor, PACKET, HASH, "advisor-join")
    fake_chime.fail_attendee_delete = True
    fake_chime.fail_meeting_delete = True
    with pytest.raises(RuntimeError):
        chime.revoke_actor("case-1", advisor.id)
    assert chime.get_call("case-1", call.id, PACKET, HASH).participants[1].joined
    fake_chime.fail_meeting_delete = False
    chime.revoke_actor("case-1", advisor.id)
    assert chime.get_call("case-1", call.id, PACKET, HASH).state == "ended"
    assert len(fake_chime.deleted_meetings) == 1


def test_call_routes_ignore_spoofed_actor_and_fail_closed(fake_chime: FakeChime) -> None:
    actual = {"id": "founder-1", "name": "Founder", "role": "founder",
              "packet_id": PACKET, "packet_hash": HASH}
    spoofed = {"id": "advisor-1", "name": "Advisor", "role": "advisor"}
    app = FastAPI()
    app.include_router(calls_router)
    with TestClient(app) as unauthenticated:
        denied = unauthenticated.post("/cases/case-1/calls", json={"actor": spoofed})
        assert denied.status_code == 403
        assert not fake_chime.meetings

    authorized_app = FastAPI()
    authorized_app.include_router(calls_router)

    @authorized_app.middleware("http")
    async def authorized_actor(request: Request, call_next: Any) -> Any:
        request.state.workflow_actor = actual
        return await call_next(request)

    with TestClient(authorized_app) as authenticated:
        created = authenticated.post("/cases/case-1/calls", json={"actor": spoofed})
        assert created.status_code == 201
        call_id = created.json()["id"]
        assert created.json()["participants"][0]["actor_id"] == actual["id"]
        joined = authenticated.post(
            f"/cases/case-1/calls/{call_id}/join",
            json={"actor": spoofed, "join_id": str(uuid4())},
        )
        assert joined.status_code == 200
        assert joined.json()["call"]["participants"][0]["actor_id"] == actual["id"]


def test_shutdown_removes_active_meetings(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    chime.join_call("case-1", call.id, founder, PACKET, HASH, "active-join")
    chime.shutdown_calls()
    assert len(fake_chime.deleted_meetings) == 1
    assert chime.get_call("case-1", call.id, PACKET, HASH).state == "ended"
    assert not chime.get_call("case-1", call.id, PACKET, HASH).participants[0].joined


def test_packet_change_invalidates_old_call_and_attendees(fake_chime: FakeChime) -> None:
    founder = ActorIn(id="founder-1", name="Founder", role="founder")
    call = chime.create_call("case-1", founder, PACKET, HASH)
    chime.join_call("case-1", call.id, founder, PACKET, HASH, "old-join")
    with pytest.raises(chime.CallError) as stale:
        chime.get_call("case-1", call.id, "packet-2", "hash-2")
    assert stale.value.status == 404
    chime.invalidate_case("case-1")
    assert call.id in chime._calls
    assert chime.get_call("case-1", call.id, PACKET, HASH).state == "ended"
    assert not fake_chime.attendees
    replacement = chime.create_call("case-1", founder, "packet-2", "hash-2")
    assert replacement.id != call.id
