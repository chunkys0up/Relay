from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.attachments import build_prompt
from app.agents.factory import get_agent, reset_agent
from app.db import conversations as store
from app.schemas.chat import ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])


async def _prepare(request: ChatRequest) -> tuple[Any, Any, dict[str, Any] | None, dict[str, str]]:
    """Agent, prompt, saved AI conversation (if any) and tool state for a request; records the user's message."""
    # Load attachments first so a bad file returns a proper error status before anything is saved.
    prompt = await build_prompt(request.message, request.document_ids)
    conversation = None
    case_id = request.case_id
    session_id, role = request.session_id, "founder"
    if request.conversation_id:
        conversation = await store.get_conversation(request.conversation_id)
        if conversation is None or conversation["kind"] != "ai":
            raise HTTPException(status_code=404, detail="AI conversation not found")
        case_id, role = conversation["case_id"], conversation["owner_role"]
        session_id = f"conv-{conversation['id']}"
        await store.add_message(conversation, role, request.message, await store.file_refs(request.document_ids))
    state = {"case_id": str(case_id)} if case_id else {}
    return get_agent(session_id, role), prompt, conversation, state


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    agent, prompt, conversation, state = await _prepare(request)
    result = await agent.invoke_async(prompt, invocation_state=state)
    reply = str(result).strip()
    if conversation and reply:
        await store.add_message(conversation, "ai", reply)
    return ChatResponse(session_id=request.session_id, reply=reply)


@router.post("/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    agent, prompt, conversation, state = await _prepare(request)

    async def token_stream() -> AsyncIterator[str]:
        parts: list[str] = []
        completed = False
        after_tool = False
        try:
            async for event in agent.stream_async(prompt, invocation_state=state):
                if "current_tool_use" in event:
                    after_tool = bool(parts)
                elif text := event.get("data"):
                    # Separate the text before and after a tool call so it doesn't run together.
                    if after_tool:
                        parts.append("\n\n")
                        yield "\n\n"
                        after_tool = False
                    parts.append(text)
                    yield text
            completed = True
        finally:
            reply = "".join(parts).strip()
            if conversation and reply:
                if completed:
                    # Saved before the stream closes, so the client can refetch right after.
                    await store.add_message(conversation, "ai", reply)
                else:
                    # The client stopped or disconnected: keep the partial reply without blocking cancellation.
                    asyncio.get_running_loop().create_task(store.add_message(conversation, "ai", reply))

    return StreamingResponse(token_stream(), media_type="text/plain")


@router.delete("/{session_id}")
async def clear_session(session_id: str) -> dict[str, str]:
    reset_agent(session_id)
    return {"status": "cleared", "session_id": session_id}
