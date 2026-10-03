"""Packet versions (the `drafts` table) and the advisor's review decisions (`advisor_actions`)."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from app.db.case_records import log_activity
from app.db.pool import get_pool

Decision = Literal["approved", "questions_returned"]

_PACKET_COLUMNS = (
    "d.id, d.case_id, d.version, d.status, d.s3_key, d.created_at, "
    "a.decision AS review_decision, a.notes AS review_notes, a.created_at AS reviewed_at"
)
_LATEST_REVIEW = (
    "LEFT JOIN LATERAL (SELECT decision, notes, created_at FROM advisor_actions "
    "WHERE draft_id = d.id ORDER BY created_at DESC LIMIT 1) a ON true"
)


async def list_packets(case_id: UUID) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        f"SELECT {_PACKET_COLUMNS} FROM drafts d {_LATEST_REVIEW} WHERE d.case_id = $1 ORDER BY d.version DESC",
        case_id,
    )
    return [dict(row) for row in rows]


async def get_packet(case_id: UUID, packet_id: UUID) -> dict[str, Any] | None:
    row = await get_pool().fetchrow(
        f"SELECT {_PACKET_COLUMNS} FROM drafts d {_LATEST_REVIEW} WHERE d.case_id = $1 AND d.id = $2",
        case_id, packet_id,
    )
    return dict(row) if row else None


async def create_packet(case_id: UUID, s3_key: str, status: str = "in_review") -> dict[str, Any]:
    row = await get_pool().fetchrow(
        "INSERT INTO drafts (case_id, version, s3_key, status) "
        "VALUES ($1, COALESCE((SELECT max(version) FROM drafts WHERE case_id = $1), 0) + 1, $2, $3) "
        "RETURNING id, version",
        case_id, s3_key, status,
    )
    return dict(row)


async def review_packet(case_id: UUID, packet_id: UUID, decision: Decision, notes: str | None) -> dict[str, Any] | None:
    """Record the advisor's decision on one exact version and move the packet to that stage."""
    async with get_pool().acquire() as conn, conn.transaction():
        packet = await conn.fetchrow(
            "SELECT d.version, c.advisor_id FROM drafts d JOIN cases c ON c.id = d.case_id "
            "WHERE d.case_id = $1 AND d.id = $2 FOR UPDATE OF d",
            case_id, packet_id,
        )
        if packet is None:
            return None
        await conn.execute(
            "INSERT INTO advisor_actions (case_id, advisor_id, draft_id, decision, notes) VALUES ($1, $2, $3, $4, $5)",
            case_id, packet["advisor_id"], packet_id, decision, notes,
        )
        await conn.execute("UPDATE drafts SET status = $2 WHERE id = $1", packet_id, decision)
    verb = "Approved" if decision == "approved" else "Returned questions on"
    await log_activity(case_id, "advisor", f"{verb} packet v{packet['version']}" + (f": {notes}" if notes else ""))
    return await get_packet(case_id, packet_id)
