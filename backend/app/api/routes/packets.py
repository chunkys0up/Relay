from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.db import packets as store
from app.db.packets import Decision
from app.services import case_files
from app.storage.s3 import presigned_download_url

router = APIRouter(prefix="/cases/{case_id}/packets", tags=["packets"])

Editor = Literal["founder", "advisor"]


class Packet(BaseModel):
    id: UUID
    case_id: UUID
    version: int
    status: str
    created_at: datetime
    change_note: str | None = None
    created_by: str | None = None
    review_decision: Decision | None = None
    review_notes: str | None = None
    reviewed_at: datetime | None = None
    review_resolved_at: datetime | None = None


class ReviewInput(BaseModel):
    decision: Decision
    notes: str | None = Field(default=None, max_length=4000)


class SummaryEdit(BaseModel):
    summary: str = Field(min_length=1, max_length=8000)
    editor: str = Field(min_length=1, max_length=100)
    role: Editor = "advisor"


class SummaryView(BaseModel):
    summary: str
    edited_by: str | None = None
    edited_at: datetime | None = None


async def _packet(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    packet = await store.get_packet(case_id, packet_id)
    if packet is None:
        raise HTTPException(status_code=404, detail="packet not found")
    return packet


@router.get("", response_model=list[Packet])
async def list_packets(case_id: UUID) -> list[dict[str, Any]]:
    return await store.list_packets(case_id)


@router.post("", response_model=Packet, status_code=201)
async def upload_packet_version(case_id: UUID, file: UploadFile = File(...), role: Editor = Form("advisor"),
                                note: str | None = Form(None)) -> dict[str, Any]:
    """Save an uploaded PDF as the next packet version."""
    try:
        created = await case_files.add_packet_version(case_id, await file.read(), role, (note or "").strip() or None)
    except case_files.FileChangeError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    return await _packet(case_id, created["id"])


@router.get("/{packet_id}/url")
async def packet_url(case_id: UUID, packet_id: UUID) -> dict[str, str]:
    packet = await _packet(case_id, packet_id)
    url = await run_in_threadpool(presigned_download_url, packet["s3_key"], f"Planning packet v{packet['version']}.pdf")
    return {"url": url}


@router.get("/{packet_id}/text")
async def packet_text(case_id: UUID, packet_id: UUID) -> dict[str, list[str]]:
    packet = await _packet(case_id, packet_id)
    return {"pages": await run_in_threadpool(case_files.packet_pages, packet["s3_key"])}


@router.get("/{packet_id}/summary", response_model=SummaryView)
async def packet_summary(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    packet = await _packet(case_id, packet_id)
    try:
        return await run_in_threadpool(case_files.packet_summary, packet["s3_key"])
    except Exception as exc:
        expired = "ExpiredToken" in str(exc)
        raise HTTPException(
            status_code=503,
            detail="The AWS credentials have expired, so the summary can't be generated." if expired
            else "The packet summary could not be generated.",
        ) from exc


@router.put("/{packet_id}/summary", response_model=SummaryView)
async def edit_summary(case_id: UUID, packet_id: UUID, body: SummaryEdit) -> dict[str, Any]:
    """Save someone's version of the summary. Relay's original is kept for reverting."""
    packet = await _packet(case_id, packet_id)
    return await case_files.edit_packet_summary(case_id, packet, body.summary, body.editor, body.role)


@router.delete("/{packet_id}/summary/edit", response_model=SummaryView)
async def revert_summary(case_id: UUID, packet_id: UUID, role: Editor = "advisor") -> dict[str, Any]:
    """Drop the edit and go back to Relay's summary."""
    packet = await _packet(case_id, packet_id)
    return await case_files.revert_packet_summary(case_id, packet, role)


@router.get("/{packet_id}/changes")
async def packet_changes(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    """What changed since the previous version: the saved change note, and Relay's comparison of the two PDFs."""
    packet = await _packet(case_id, packet_id)
    previous = next((p for p in await store.list_packets(case_id) if p["version"] == packet["version"] - 1), None)
    if previous is None:
        return {"previous_version": None, "change_note": packet["change_note"], "created_by": packet["created_by"], "changes": None}
    try:
        changes = await run_in_threadpool(case_files.packet_changes, previous["s3_key"], packet["s3_key"])
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Relay couldn't compare the versions right now.") from exc
    return {"previous_version": previous["version"], "change_note": packet["change_note"], "created_by": packet["created_by"], "changes": changes}


@router.post("/{packet_id}/review", response_model=Packet)
async def review_packet(case_id: UUID, packet_id: UUID, body: ReviewInput) -> dict[str, Any]:
    if body.decision == "questions_returned" and not (body.notes or "").strip():
        raise HTTPException(status_code=422, detail="Add the questions for the founder.")
    packet = await store.review_packet(case_id, packet_id, body.decision, (body.notes or "").strip() or None)
    if packet is None:
        raise HTTPException(status_code=404, detail="packet not found")
    return packet


@router.post("/{packet_id}/review/resolve", response_model=Packet)
async def resolve_review(case_id: UUID, packet_id: UUID) -> dict[str, Any]:
    """The founder marks the advisor's latest decision as resolved, so it stops being shown."""
    packet = await store.resolve_review(case_id, packet_id)
    if packet is None:
        raise HTTPException(status_code=404, detail="packet not found")
    return packet
