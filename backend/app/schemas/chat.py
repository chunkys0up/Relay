from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message to send to the agent")
    session_id: str = Field(default="default", description="Conversation/session identifier")


class ChatResponse(BaseModel):
    session_id: str
    reply: str
