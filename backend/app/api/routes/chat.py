from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.agents.attachments import build_prompt
from app.agents.factory import get_agent, reset_agent
from app.schemas.chat import ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])


def _case_state(request: ChatRequest) -> dict[str, str]:
    return {"case_id": str(request.case_id)} if request.case_id else {}


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    prompt = await build_prompt(request.message, request.document_ids)
    agent = get_agent(request.session_id)
    result = await agent.invoke_async(prompt, invocation_state=_case_state(request))
    return ChatResponse(session_id=request.session_id, reply=str(result))


@router.post("/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    # Load attachments before streaming starts so a bad file returns a proper error status.
    prompt = await build_prompt(request.message, request.document_ids)
    agent = get_agent(request.session_id)

    async def token_stream() -> AsyncIterator[str]:
        wrote_text = False
        after_tool = False
        async for event in agent.stream_async(prompt, invocation_state=_case_state(request)):
            if "current_tool_use" in event:
                after_tool = wrote_text
            elif text := event.get("data"):
                # Separate the text before and after a tool call so it doesn't run together.
                if after_tool:
                    yield "\n\n"
                    after_tool = False
                wrote_text = True
                yield text

    return StreamingResponse(token_stream(), media_type="text/plain")


@router.delete("/{session_id}")
async def clear_session(session_id: str) -> dict[str, str]:
    reset_agent(session_id)
    return {"status": "cleared", "session_id": session_id}
