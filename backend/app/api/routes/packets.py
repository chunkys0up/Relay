from __future__ import annotations

import json
from datetime import datetime, timezone
from io import BytesIO
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool

from app.core.aws_session import create_aws_session
from app.core.config import settings
from app.db import packets as store
from app.db.case_records import log_activity
from app.db.packets import Decision
from app.storage.s3 import delete_object, download_bytes, head_object, presigned_download_url, upload_bytes

router = APIRouter(prefix="/cases/{case_id}/packets", tags=["packets"])

# Packet PDFs are immutable once saved, so their extracted text can be kept per S3 key.
_text_cache: dict[str, list[str]] = {}


class Packet(BaseModel):
    id: UUID
    case_id: UUID
    version: int
    status: str
    created_at: datetime
    review_decision: Decision | None = None
    review_notes: str | None = None
    reviewed_at: datetime | None = None


class ReviewInput(BaseModel):
    decision: Decision
    notes: str | None = Field(default=None, max_length=4000)


async def _packet(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    packet = await store.get_packet(case_id, packet_id)
    if packet is None:
        raise HTTPException(status_code=404, detail="packet not found")
    return packet


def _pages(s3_key: str) -> list[str]:
    if s3_key not in _text_cache:
        reader = PdfReader(BytesIO(download_bytes(s3_key)))
        _text_cache[s3_key] = [(page.extract_text() or "").strip() for page in reader.pages]
    return _text_cache[s3_key]


@router.get("", response_model=list[Packet])
async def list_packets(case_id: UUID) -> list[dict[str, Any]]:
    return await store.list_packets(case_id)


@router.get("/{packet_id}/url")
async def packet_url(case_id: UUID, packet_id: UUID) -> dict[str, str]:
    packet = await _packet(case_id, packet_id)
    url = await run_in_threadpool(presigned_download_url, packet["s3_key"], f"Planning packet v{packet['version']}.pdf")
    return {"url": url}


@router.get("/{packet_id}/text")
async def packet_text(case_id: UUID, packet_id: UUID) -> dict[str, list[str]]:
    packet = await _packet(case_id, packet_id)
    return {"pages": await run_in_threadpool(_pages, packet["s3_key"])}


_SUMMARY_PROMPT = (
    "Summarize this financial planning packet for the founder and their advisor. Use only facts in the packet. "
    "Write Markdown under 180 words with three short sections: **Overview** (2 sentences), **Key numbers** "
    "(a bullet list), and **Open items** (a bullet list of what is still missing or needs a decision). "
    "No title and no preamble.\n\nPacket text:\n"
)


def _ai_summary(s3_key: str) -> str:
    """Relay's summary of the packet, generated once and stored next to the PDF in S3."""
    summary_key = f"{s3_key}.summary.md"
    if head_object(summary_key):
        return download_bytes(summary_key).decode("utf-8")
    model = (settings.strands_model or "").removeprefix("bedrock/") or "us.anthropic.claude-sonnet-5"
    client = create_aws_session(settings.aws_region, settings.aws_profile).client("bedrock-runtime")
    response = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [{"text": _SUMMARY_PROMPT + "\n\n".join(_pages(s3_key))}]}],
        inferenceConfig={"maxTokens": 600},
    )
    text = "".join(block.get("text", "") for block in response["output"]["message"]["content"]).strip()
    upload_bytes(text.encode("utf-8"), summary_key, "text/markdown")
    return text


def _edit_key(s3_key: str) -> str:
    return f"{s3_key}.summary.edited.json"


def _summary(s3_key: str) -> dict[str, Any]:
    """The advisor's edited summary if there is one, otherwise Relay's."""
    if head_object(_edit_key(s3_key)):
        edit = json.loads(download_bytes(_edit_key(s3_key)))
        return {"summary": edit["text"], "edited_by": edit["edited_by"], "edited_at": edit["edited_at"]}
    return {"summary": _ai_summary(s3_key), "edited_by": None, "edited_at": None}


class SummaryEdit(BaseModel):
    summary: str = Field(min_length=1, max_length=8000)
    editor: str = Field(min_length=1, max_length=100)


class SummaryView(BaseModel):
    summary: str
    edited_by: str | None = None
    edited_at: datetime | None = None


@router.get("/{packet_id}/summary", response_model=SummaryView)
async def packet_summary(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    packet = await _packet(case_id, packet_id)
    try:
        return await run_in_threadpool(_summary, packet["s3_key"])
    except Exception as exc:
        expired = "ExpiredToken" in str(exc)
        raise HTTPException(
            status_code=503,
            detail="The AWS credentials have expired, so the summary can't be generated." if expired
            else "The packet summary could not be generated.",
        ) from exc


@router.put("/{packet_id}/summary", response_model=SummaryView)
async def edit_summary(case_id: UUID, packet_id: UUID, body: SummaryEdit) -> dict[str, Any]:
    """Save the advisor's version of the summary. Relay's original is kept for reverting."""
    packet = await _packet(case_id, packet_id)
    edit = {"text": body.summary.strip(), "edited_by": body.editor, "edited_at": datetime.now(timezone.utc).isoformat()}
    await run_in_threadpool(upload_bytes, json.dumps(edit).encode("utf-8"), _edit_key(packet["s3_key"]), "application/json")
    await log_activity(case_id, "advisor", f"Edited the summary of packet v{packet['version']}")
    return {"summary": edit["text"], "edited_by": edit["edited_by"], "edited_at": edit["edited_at"]}


@router.delete("/{packet_id}/summary/edit", response_model=SummaryView)
async def revert_summary(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    """Drop the advisor's edit and go back to Relay's summary."""
    packet = await _packet(case_id, packet_id)
    await run_in_threadpool(delete_object, _edit_key(packet["s3_key"]))
    await log_activity(case_id, "advisor", f"Restored Relay's summary of packet v{packet['version']}")
    return await run_in_threadpool(_summary, packet["s3_key"])


@router.post("/{packet_id}/review", response_model=Packet)
async def review_packet(case_id: UUID, packet_id: UUID, body: ReviewInput) -> dict[str, Any]:
    if body.decision == "questions_returned" and not (body.notes or "").strip():
        raise HTTPException(status_code=422, detail="Add the questions for the founder.")
    packet = await store.review_packet(case_id, packet_id, body.decision, (body.notes or "").strip() or None)
    if packet is None:
        raise HTTPException(status_code=404, detail="packet not found")
    return packet
