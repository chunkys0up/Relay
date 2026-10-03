"""Session-bound packet invitations and exact-version advisor reviews."""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from typing import Any

from .repository import Repository, WorkflowError, canonical
from .service import WorkflowService, now, uid


@dataclass(frozen=True)
class Access:
    actor_id: str
    role: str
    owner: str
    packet_id: str | None
    packet_hash: str | None
    source_ids: tuple[str, ...]


def public_actor_id(sid: str) -> str:
    return hashlib.sha256(("relay-actor:" + sid).encode()).hexdigest()


def session_role(repo: Repository, sid: str) -> str:
    with repo.connection() as conn:
        row = conn.execute("SELECT role FROM session_roles WHERE session_id=?", (sid,)).fetchone()
    return str(row["role"]) if row else "founder"


def authorize_case(repo: Repository, sid: str, case_id: str) -> Access:
    """Resolve authority from the stored session and current active grant."""
    with repo.connection() as conn:
        row = conn.execute("SELECT owner,state FROM cases WHERE id=?", (case_id,)).fetchone()
        if row is None:
            raise WorkflowError("NOT_FOUND", 404)
        owner = str(row["owner"])
        state = json.loads(row["state"])
        if owner == sid and session_role(repo, sid) == "founder":
            packet = next((p for p in state["packets"] if p["id"] == state.get("current_packet_id")), None)
            return Access(public_actor_id(sid), "founder", owner, packet["id"] if packet else None,
                          packet["hash"] if packet else None,
                          tuple(source["id"] for source in state["sources"]))
        grants = conn.execute(
            "SELECT i.packet_id,i.packet_hash,i.source_ids FROM share_grants g "
            "JOIN share_invites i ON i.id=g.invite_id WHERE g.case_id=? AND "
            "g.advisor_session=? AND g.revoked=0 AND i.revoked=0 "
            "ORDER BY g.rowid DESC", (case_id, sid),
        ).fetchall()
        current = next((p for p in state["packets"] if p["id"] == state.get("current_packet_id")), None)
        for grant in grants:
            if current and grant["packet_id"] == current["id"] and grant["packet_hash"] == current["hash"]:
                return Access(public_actor_id(sid), "advisor", owner, current["id"], current["hash"],
                              tuple(json.loads(grant["source_ids"])))
    raise WorkflowError("NOT_FOUND", 404)


def accessible_case_ids(repo: Repository, sid: str) -> list[str]:
    if session_role(repo, sid) == "founder":
        with repo.connection() as conn:
            return [str(row["id"]) for row in conn.execute(
                "SELECT id FROM cases WHERE owner=? ORDER BY rowid DESC", (sid,))]
    with repo.connection() as conn:
        ids = [str(row["case_id"]) for row in conn.execute(
            "SELECT DISTINCT case_id FROM share_grants WHERE advisor_session=? "
            "AND revoked=0 ORDER BY rowid DESC", (sid,))]
    accessible: list[str] = []
    for case_id in ids:
        try:
            authorize_case(repo, sid, case_id)
            accessible.append(case_id)
        except WorkflowError:
            pass
    return accessible


def shared_snapshot(repo: Repository, service: WorkflowService, access: Access,
                    case_id: str) -> dict[str, Any]:
    state = service.snapshot(access.owner, case_id)
    if access.role == "founder":
        state["shares"] = list_shares(repo, access.owner, case_id)
        return state
    packet = next((p for p in state["packets"] if p["id"] == access.packet_id
                   and p["hash"] == access.packet_hash), None)
    if packet is None or state.get("current_packet_id") != access.packet_id:
        raise WorkflowError("NOT_FOUND", 404)
    packet = {**packet, "stage_events": [event for event in packet.get("stage_events", [])
              if event.get("action") != "advisor_review"
              or event.get("actor") == access.actor_id]}
    return {"id": state["id"], "company": state["company"], "goal": state["goal"],
            "revision": state["revision"], "created_at": state.get("created_at"),
            "status": state["status"], "ui_state": "Idle", "activity": None,
            "current_packet_id": packet["id"], "packets": [packet],
            "sources": [source for source in state["sources"] if source["id"] in access.source_ids],
            "tasks": [], "flags": [], "facts": {}, "messages": [], "jobs": [],
            "reviews": [review for review in state.get("reviews", [])
                        if review["packet_id"] == packet["id"]
                        and review["reviewer_id"] == access.actor_id],
            "shares": [{"id": "session-grant", "packet_id": packet["id"],
                        "packet_hash": packet["hash"], "source_ids": list(access.source_ids),
                        "created_at": "", "grant_id": "session-grant",
                        "advisor_id": access.actor_id, "active": True}],
            "legacy_sync": {"status": "not_shared"}}


def list_shares(repo: Repository, owner: str, case_id: str) -> list[dict[str, Any]]:
    repo.get_case(owner, case_id)
    with repo.connection() as conn:
        rows = conn.execute(
            "SELECT i.id,i.packet_id,i.packet_hash,i.source_ids,i.created_at,i.revoked,"
            "g.id AS grant_id,g.advisor_session,g.revoked AS grant_revoked "
            "FROM share_invites i LEFT JOIN share_grants g ON g.invite_id=i.id "
            "WHERE i.case_id=? AND i.owner=? ORDER BY i.rowid DESC", (case_id, owner),
        ).fetchall()
    return [{"id": str(row["id"]), "packet_id": str(row["packet_id"]),
             "packet_hash": str(row["packet_hash"]),
             "source_ids": json.loads(row["source_ids"]), "created_at": str(row["created_at"]),
             "grant_id": row["grant_id"], "advisor_id": public_actor_id(str(row["advisor_session"])) if row["advisor_session"] else None,
             "active": row["grant_id"] is not None and not bool(row["revoked"])
                       and not bool(row["grant_revoked"])}
            for row in rows]


def create_invite(repo: Repository, owner: str, case_id: str, packet_id: str,
                  packet_hash: str, source_ids: list[str], expected_revision: int,
                  key: str) -> dict[str, Any]:
    if session_role(repo, owner) != "founder":
        raise WorkflowError("FOUNDER_REQUIRED", 403)
    source_ids = sorted(set(source_ids))
    request = {"packet_id": packet_id, "packet_hash": packet_hash,
               "source_ids": source_ids, "expected_revision": expected_revision}
    request_hash = hashlib.sha256(canonical(request).encode()).hexdigest()
    token = secrets.token_urlsafe(32)
    invite_id = uid()
    with repo.connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute("SELECT revision,state FROM cases WHERE id=? AND owner=?",
                               (case_id, owner)).fetchone()
            if row is None:
                raise WorkflowError("NOT_FOUND", 404)
            prior = conn.execute("SELECT request_hash,response FROM idempotency WHERE "
                                 "owner=? AND case_id=? AND operation='share_invite' AND key=?",
                                 (owner, case_id, key)).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise WorkflowError("IDEMPOTENCY_CONFLICT")
                return json.loads(prior["response"])
            if row["revision"] != expected_revision:
                raise WorkflowError("STALE_REVISION")
            state = json.loads(row["state"])
            packet = next((p for p in state["packets"] if p["id"] == packet_id), None)
            if not packet or state.get("current_packet_id") != packet_id:
                raise WorkflowError("HISTORICAL_PACKET")
            if packet["hash"] != packet_hash:
                raise WorkflowError("STALE_PACKET_HASH")
            if packet.get("stage", "draft") != "in_review":
                raise WorkflowError("PACKET_NOT_IN_REVIEW")
            if not set(source_ids).issubset({source["id"] for source in state["sources"]}):
                raise WorkflowError("NOT_FOUND", 404)
            created = now()
            conn.execute("INSERT INTO share_invites VALUES (?,?,?,?,?,?,?,?,0)",
                         (invite_id, hashlib.sha256(token.encode()).hexdigest(), case_id,
                          owner, packet_id, packet_hash, canonical(source_ids), created))
            response = {"id": invite_id, "invite_code": token, "packet_id": packet_id,
                        "packet_hash": packet_hash, "source_ids": source_ids,
                        "created_at": created, "case_revision": row["revision"]}
            conn.execute("INSERT INTO idempotency VALUES (?,?,?,?,?,?)",
                         (owner, case_id, "share_invite", key, request_hash, canonical(response)))
            conn.execute("COMMIT")
            return response
        except Exception:
            conn.execute("ROLLBACK")
            raise


def redeem_invite(repo: Repository, sid: str, token: str) -> dict[str, Any]:
    if not token or len(token) > 256:
        raise WorkflowError("INVALID_INVITE", 404)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with repo.connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if conn.execute("SELECT 1 FROM cases WHERE owner=? LIMIT 1", (sid,)).fetchone():
                raise WorkflowError("SEPARATE_ADVISOR_SESSION_REQUIRED", 403)
            invite = conn.execute("SELECT * FROM share_invites WHERE token_hash=?", (digest,)).fetchone()
            if not invite or invite["revoked"] or invite["owner"] == sid:
                raise WorkflowError("INVALID_INVITE", 404)
            state_row = conn.execute("SELECT state FROM cases WHERE id=? AND owner=?",
                                     (invite["case_id"], invite["owner"])).fetchone()
            state = json.loads(state_row["state"]) if state_row else None
            packet = next((p for p in state["packets"] if p["id"] == invite["packet_id"]), None) if state else None
            if not packet or state["current_packet_id"] != packet["id"] or packet["hash"] != invite["packet_hash"] or packet.get("stage", "draft") != "in_review":
                raise WorkflowError("STALE_INVITE")
            prior = conn.execute("SELECT id,advisor_session,revoked FROM share_grants WHERE invite_id=?",
                                 (invite["id"],)).fetchone()
            if prior:
                if prior["advisor_session"] != sid or prior["revoked"]:
                    raise WorkflowError("INVITE_USED")
                grant_id = str(prior["id"])
            else:
                grant_id = uid()
                conn.execute("INSERT INTO share_grants VALUES (?,?,?,?,?,0)",
                             (grant_id, invite["id"], invite["case_id"], sid, now()))
            conn.execute("INSERT INTO session_roles(session_id,role) VALUES (?,'advisor') "
                         "ON CONFLICT(session_id) DO UPDATE SET role='advisor'", (sid,))
            conn.execute("COMMIT")
            return {"grant_id": grant_id, "case_id": str(invite["case_id"]),
                    "packet_id": str(invite["packet_id"]), "packet_hash": str(invite["packet_hash"])}
        except Exception:
            conn.execute("ROLLBACK")
            raise


def revoke_invite(repo: Repository, owner: str, case_id: str, invite_id: str) -> dict[str, Any]:
    repo.get_case(owner, case_id)
    with repo.connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            prior = conn.execute("SELECT advisor_session FROM share_grants WHERE invite_id=?",
                                 (invite_id,)).fetchone()
            changed = conn.execute("UPDATE share_invites SET revoked=1 WHERE id=? AND "
                                   "case_id=? AND owner=?", (invite_id, case_id, owner))
            if changed.rowcount == 0:
                raise WorkflowError("NOT_FOUND", 404)
            conn.execute("UPDATE share_grants SET revoked=1 WHERE invite_id=?", (invite_id,))
            advisor_id = str(prior["advisor_session"]) if prior else None
            conn.execute("COMMIT")
            return {"id": invite_id, "active": False,
                    "advisor_id": public_actor_id(advisor_id) if advisor_id else None,
                    "evict_advisor": bool(advisor_id)}
        except Exception:
            conn.execute("ROLLBACK")
            raise


def review_packet(repo: Repository, sid: str, case_id: str, packet_id: str,
                  packet_hash: str, expected_revision: int, decision: str,
                  note: str, key: str) -> dict[str, Any]:
    if decision not in ("approved", "questions_returned"):
        raise WorkflowError("INVALID_REVIEW", 422)
    if decision == "questions_returned" and not note.strip():
        raise WorkflowError("REVIEW_NOTE_REQUIRED", 422)
    request = {"packet_id": packet_id, "packet_hash": packet_hash,
               "expected_revision": expected_revision, "decision": decision, "note": note}
    request_hash = hashlib.sha256(canonical(request).encode()).hexdigest()
    with repo.connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute("SELECT owner,revision,state FROM cases WHERE id=?", (case_id,)).fetchone()
            if row is None or row["owner"] == sid or session_role(repo, sid) != "advisor":
                raise WorkflowError("NOT_FOUND", 404)
            state = json.loads(row["state"])
            grant = conn.execute(
                "SELECT i.packet_id,i.packet_hash FROM share_grants g JOIN share_invites i "
                "ON i.id=g.invite_id WHERE g.case_id=? AND g.advisor_session=? "
                "AND g.revoked=0 AND i.revoked=0 AND i.packet_id=? AND i.packet_hash=?",
                (case_id, sid, packet_id, packet_hash),
            ).fetchone()
            if grant is None:
                raise WorkflowError("NOT_FOUND", 404)
            packet = next((p for p in state["packets"] if p["id"] == packet_id), None)
            if not packet or state["current_packet_id"] != packet_id:
                raise WorkflowError("HISTORICAL_PACKET")
            if packet["hash"] != packet_hash:
                raise WorkflowError("STALE_PACKET_HASH")
            prior = conn.execute("SELECT request_hash,response FROM idempotency WHERE owner=? "
                                 "AND case_id=? AND operation='advisor_review' AND key=?",
                                 (sid, case_id, key)).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise WorkflowError("IDEMPOTENCY_CONFLICT")
                return json.loads(prior["response"])
            if row["revision"] != expected_revision:
                raise WorkflowError("STALE_REVISION")
            if packet.get("stage", "draft") != "in_review":
                raise WorkflowError("PACKET_NOT_IN_REVIEW")
            event = {"id": uid(), "from_stage": "in_review", "to_stage": decision,
                     "actor": public_actor_id(sid), "action": "advisor_review", "at": now(),
                     "packet_hash": packet_hash, "note": note.strip()}
            packet.setdefault("stage_events", []).append(event)
            packet["stage"] = decision
            review = {"id": event["id"], "reviewer_id": public_actor_id(sid),
                      "packet_id": packet_id, "packet_hash": packet_hash,
                      "decision": decision, "note": note.strip(), "created_at": event["at"]}
            state.setdefault("reviews", []).append(review)
            for task in state.get("tasks", []):
                if task.get("key") == "example_review":
                    task["state"] = "Done" if decision == "approved" else "Blocked"
                    task["detail"] = ("Advisor approved this exact packet." if decision == "approved"
                                      else "Advisor returned questions on this exact packet.")
            state["status"] = "Approved" if decision == "approved" else "Questions returned"
            state["activity"] = "Advisor reviewed the current packet."
            state["revision"] = row["revision"] + 1
            response = {"review": review, "packet_id": packet_id, "hash": packet_hash,
                        "stage": decision, "case_revision": state["revision"]}
            conn.execute("UPDATE cases SET revision=?,state=? WHERE id=?",
                         (state["revision"], canonical(state), case_id))
            conn.execute("INSERT INTO idempotency VALUES (?,?,?,?,?,?)",
                         (sid, case_id, "advisor_review", key, request_hash, canonical(response)))
            conn.execute("COMMIT")
            return response
        except Exception:
            conn.execute("ROLLBACK")
            raise
