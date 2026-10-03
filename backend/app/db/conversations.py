"""Saved conversations: private AI chats per role, and shared founder <-> advisor chats."""

from __future__ import annotations

import json
import re
from typing import Any, Literal
from uuid import UUID

from app.db.pool import get_pool

Role = Literal["founder", "advisor"]
Kind = Literal["ai", "human"]
Sender = Literal["founder", "advisor", "ai"]
NEW_CHAT_TITLE = "New chat"

_CONVERSATION_COLUMNS = "c.id, c.case_id, c.kind, c.owner_role, c.title, c.created_at, c.updated_at"
_MESSAGE_COLUMNS = "id, conversation_id, case_id, sender_type, content, files, created_at"


def title_from(text: str) -> str:
    line = re.sub(r"\s+", " ", text).strip()
    return (line[:57] + "…") if len(line) > 60 else (line or NEW_CHAT_TITLE)


def _message(row: Any) -> dict[str, Any]:
    message = dict(row)
    message["files"] = json.loads(message["files"]) if isinstance(message["files"], str) else message["files"]
    return message


def visible_to(conversation: dict[str, Any], role: Role) -> bool:
    return conversation["kind"] == "human" or conversation["owner_role"] == role


async def list_conversations(case_id: UUID, kind: Kind, role: Role) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        f"SELECT {_CONVERSATION_COLUMNS}, m.sender_type AS last_sender, m.content AS last_content, m.created_at AS last_at "
        "FROM conversations c LEFT JOIN LATERAL ("
        "  SELECT sender_type, content, created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1"
        ") m ON true "
        "WHERE c.case_id = $1 AND c.kind = $2 AND (c.kind = 'human' OR c.owner_role = $3) "
        "ORDER BY c.updated_at DESC",
        case_id, kind, role,
    )
    return [dict(row) for row in rows]


async def get_conversation(conversation_id: UUID) -> dict[str, Any] | None:
    row = await get_pool().fetchrow(f"SELECT {_CONVERSATION_COLUMNS} FROM conversations c WHERE c.id = $1", conversation_id)
    return dict(row) if row else None


async def create_conversation(case_id: UUID, kind: Kind, role: Role, title: str = NEW_CHAT_TITLE) -> dict[str, Any]:
    row = await get_pool().fetchrow(
        "INSERT INTO conversations (case_id, kind, owner_role, title) VALUES ($1, $2, $3, $4) "
        "RETURNING id, case_id, kind, owner_role, title, created_at, updated_at",
        case_id, kind, role if kind == "ai" else None, title,
    )
    return dict(row)


async def file_refs(document_ids: list[UUID]) -> list[dict[str, str]]:
    if not document_ids:
        return []
    rows = await get_pool().fetch("SELECT id, filename FROM documents WHERE id = ANY($1::uuid[])", document_ids)
    names = {row["id"]: row["filename"] for row in rows}
    return [{"id": str(doc_id), "name": names[doc_id]} for doc_id in document_ids if doc_id in names]


async def add_message(
    conversation: dict[str, Any], sender: Sender, content: str, files: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Append a message, bump the conversation, and title a new chat from its first human message."""
    async with get_pool().acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            "INSERT INTO messages (conversation_id, case_id, sender_type, content, files) "
            f"VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING {_MESSAGE_COLUMNS}",
            conversation["id"], conversation["case_id"], sender, content, json.dumps(files or []),
        )
        await conn.execute(
            "UPDATE conversations SET updated_at = now(), "
            "title = CASE WHEN title = $2 AND $3 <> 'ai' THEN $4 ELSE title END WHERE id = $1",
            conversation["id"], NEW_CHAT_TITLE, sender, title_from(content),
        )
    return _message(row)


async def list_messages(conversation_id: UUID) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        f"SELECT {_MESSAGE_COLUMNS} FROM messages WHERE conversation_id = $1 ORDER BY created_at", conversation_id
    )
    return [_message(row) for row in rows]


async def recent_messages(case_id: UUID, role: Role, limit: int) -> list[dict[str, Any]]:
    rows = await get_pool().fetch(
        "SELECT m.id, m.conversation_id, m.case_id, m.sender_type, m.content, m.files, m.created_at, c.kind "
        "FROM messages m JOIN conversations c ON c.id = m.conversation_id "
        "WHERE m.case_id = $1 AND (c.kind = 'human' OR c.owner_role = $2) ORDER BY m.created_at DESC LIMIT $3",
        case_id, role, limit,
    )
    return [_message(row) for row in rows]
