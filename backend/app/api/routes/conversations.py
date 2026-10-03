from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import conversations as store
from app.db.conversations import Kind, Role, Sender

router = APIRouter(prefix="/cases/{case_id}", tags=["conversations"])


class FileRef(BaseModel):
    id: str
    name: str


class Conversation(BaseModel):
    id: UUID
    case_id: UUID
    kind: Kind
    owner_role: Role | None
    title: str
    created_at: datetime
    updated_at: datetime
    last_sender: Sender | None = None
    last_content: str | None = None
    last_at: datetime | None = None


class Message(BaseModel):
    id: UUID
    conversation_id: UUID
    case_id: UUID
    sender_type: Sender
    content: str
    files: list[FileRef]
    created_at: datetime


class NewMessage(BaseModel):
    role: Role
    content: str = Field(min_length=1, max_length=8000)
    files: list[FileRef] = Field(default_factory=list, max_length=5)


class NewConversation(BaseModel):
    kind: Kind
    role: Role
    message: NewMessage | None = None


async def _visible(case_id: UUID, conversation_id: UUID, role: Role) -> dict[str, Any]:
    conversation = await store.get_conversation(conversation_id)
    if conversation is None or conversation["case_id"] != case_id or not store.visible_to(conversation, role):
        raise HTTPException(status_code=404, detail="conversation not found")
    return conversation


@router.get("/conversations", response_model=list[Conversation])
async def list_conversations(case_id: UUID, kind: Kind, role: Role) -> list[dict[str, Any]]:
    return await store.list_conversations(case_id, kind, role)


@router.post("/conversations", response_model=Conversation, status_code=201)
async def create_conversation(case_id: UUID, body: NewConversation) -> dict[str, Any]:
    first = body.message
    title = store.title_from(first.content) if first else store.NEW_CHAT_TITLE
    conversation = await store.create_conversation(case_id, body.kind, body.role, title)
    if first:
        await store.add_message(conversation, first.role, first.content, [f.model_dump() for f in first.files])
    return conversation


@router.get("/conversations/{conversation_id}/messages", response_model=list[Message])
async def list_messages(case_id: UUID, conversation_id: UUID, role: Role) -> list[dict[str, Any]]:
    await _visible(case_id, conversation_id, role)
    return await store.list_messages(conversation_id)


@router.post("/conversations/{conversation_id}/messages", response_model=Message, status_code=201)
async def send_message(case_id: UUID, conversation_id: UUID, body: NewMessage) -> dict[str, Any]:
    conversation = await _visible(case_id, conversation_id, body.role)
    if conversation["kind"] != "human":
        raise HTTPException(status_code=400, detail="AI chat messages are sent through /api/chat/stream")
    return await store.add_message(conversation, body.role, body.content, [f.model_dump() for f in body.files])


@router.get("/messages/recent", response_model=list[Message])
async def recent_messages(case_id: UUID, role: Role, limit: int = Query(default=3, ge=1, le=20)) -> list[dict[str, Any]]:
    return await store.recent_messages(case_id, role, limit)
