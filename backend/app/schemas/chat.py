from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from app.agents.attachments import MAX_ATTACHMENTS


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message to send to the agent")
    session_id: str = Field(default="default", description="Conversation/session identifier")
    document_ids: list[UUID] = Field(default_factory=list, max_length=MAX_ATTACHMENTS, description="Case documents to read with this message")
    case_id: UUID | None = Field(default=None, description="Case whose checklist and activity the agent may update")
    conversation_id: UUID | None = Field(default=None, description="Saved AI conversation to append both sides of this exchange to")


class ChatResponse(BaseModel):
    session_id: str
    reply: str
