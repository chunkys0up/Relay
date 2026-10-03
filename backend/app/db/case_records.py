"""Case checklist and activity feed, shared by the API routes and the chat agent's tools."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from app.db.pool import get_pool

ChecklistState = Literal["todo", "in_progress", "blocked", "done"]
Actor = Literal["agent", "founder", "advisor", "system"]
CHECKLIST_STATES: tuple[ChecklistState, ...] = ("todo", "in_progress", "blocked", "done")

_ITEM_COLUMNS = "id, case_id, title, detail, state, position, created_by, created_at, updated_at"


async def list_checklist(case_id: UUID) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        f"SELECT {_ITEM_COLUMNS} FROM checklist_items WHERE case_id = $1 ORDER BY position, created_at", case_id
    )
    return [dict(row) for row in rows]


async def add_checklist_item(case_id: UUID, title: str, detail: str | None, created_by: Literal["agent", "user"]) -> dict[str, Any]:
    async with get_pool().acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "INSERT INTO checklist_items (case_id, title, detail, position, created_by) "
            "VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM checklist_items WHERE case_id = $1), $4) "
            f"RETURNING {_ITEM_COLUMNS}",
            case_id, title, detail or None, created_by,
        )
        await conn.execute(
            "INSERT INTO case_activity (case_id, actor, text) VALUES ($1, $2, $3)",
            case_id, "agent" if created_by == "agent" else "founder", f"Added to checklist: {title}",
        )
    return dict(row)


async def update_checklist_item(
    case_id: UUID, item_id: UUID, actor: Actor, state: ChecklistState | None = None, detail: str | None = None,
) -> dict[str, Any] | None:
    """Update state and/or detail; logs activity when the state changes. None if the item isn't in this case."""
    async with get_pool().acquire() as conn, conn.transaction():
        before = await conn.fetchrow(
            "SELECT state, title FROM checklist_items WHERE id = $1 AND case_id = $2 FOR UPDATE", item_id, case_id
        )
        if before is None:
            return None
        row = await conn.fetchrow(
            "UPDATE checklist_items SET state = COALESCE($3, state), detail = COALESCE($4, detail), updated_at = now() "
            f"WHERE id = $1 AND case_id = $2 RETURNING {_ITEM_COLUMNS}",
            item_id, case_id, state, detail,
        )
        if state is not None and state != before["state"]:
            label = {"todo": "Reopened", "in_progress": "Started", "blocked": "Blocked", "done": "Completed"}[state]
            await conn.execute(
                "INSERT INTO case_activity (case_id, actor, text) VALUES ($1, $2, $3)",
                case_id, actor, f"{label}: {before['title']}",
            )
    return dict(row)


async def list_activity(case_id: UUID, limit: int = 20) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        "SELECT id, case_id, actor, text, created_at FROM case_activity WHERE case_id = $1 "
        "ORDER BY created_at DESC LIMIT $2",
        case_id, limit,
    )
    return [dict(row) for row in rows]


async def log_activity(case_id: UUID, actor: Actor, text: str) -> dict[str, Any]:
    row = await get_pool().fetchrow(
        "INSERT INTO case_activity (case_id, actor, text) VALUES ($1, $2, $3) "
        "RETURNING id, case_id, actor, text, created_at",
        case_id, actor, text,
    )
    return dict(row)
