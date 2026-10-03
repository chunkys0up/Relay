from __future__ import annotations

import uuid
from uuid import UUID

import asyncpg
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.db.case_records import log_activity
from app.db.pool import get_pool
from app.schemas.document import DocumentResponse, DocumentUploadResponse
from app.services import case_files
from app.storage.s3 import build_key, delete_object, presigned_download_url, upload_bytes

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentResponse])
async def list_documents(case_id: UUID) -> list[DocumentResponse]:
    rows = await get_pool().fetch(
        "SELECT id, case_id, filename, s3_key, uploaded_at FROM documents "
        "WHERE case_id = $1 ORDER BY uploaded_at",
        case_id,
    )
    return [DocumentResponse(**row) for row in rows]


@router.get("/{document_id}/url")
async def document_url(document_id: UUID) -> dict[str, str]:
    row = await get_pool().fetchrow(
        "SELECT s3_key, filename FROM documents WHERE id = $1", document_id
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"document {document_id} not found")
    url = await run_in_threadpool(presigned_download_url, row["s3_key"], row["filename"])
    return {"url": url}


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    case_id: UUID = Form(...), file: UploadFile = File(...)
) -> DocumentUploadResponse:
    data = await file.read()
    filename = file.filename or "untitled"
    source_id = uuid.uuid4()
    key = build_key(case_id, source_id, filename)
    await run_in_threadpool(upload_bytes, data, key, file.content_type)

    try:
        row = await get_pool().fetchrow(
            "INSERT INTO documents (id, case_id, s3_key, filename) VALUES ($1, $2, $3, $4) "
            "RETURNING id, uploaded_at",
            source_id,
            case_id,
            key,
            filename,
        )
    except asyncpg.ForeignKeyViolationError:
        await run_in_threadpool(delete_object, key)
        raise HTTPException(status_code=404, detail=f"case {case_id} not found")

    await log_activity(case_id, "founder", f"Uploaded {filename}")
    return DocumentUploadResponse(
        id=row["id"],
        source_id=row["id"],
        case_id=case_id,
        bucket=settings.s3_bucket,
        key=key,
        filename=filename,
        content_type=file.content_type,
        size=len(data),
        uploaded_at=row["uploaded_at"],
    )


Editor = Literal["founder", "advisor"]


class DocumentText(BaseModel):
    id: UUID
    filename: str
    content: str


class DocumentTextEdit(BaseModel):
    content: str = Field(max_length=200_000)
    role: Editor = "advisor"
    note: str | None = Field(default=None, max_length=200)


async def _change(action: Any) -> Any:
    try:
        return await action
    except case_files.FileChangeError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc


@router.get("/{document_id}/text", response_model=DocumentText)
async def document_text(document_id: UUID) -> dict[str, Any]:
    """A text file's contents, for editing."""
    return await _change(case_files.read_document_text(document_id))


@router.put("/{document_id}/text", response_model=DocumentResponse)
async def edit_document_text(document_id: UUID, body: DocumentTextEdit) -> DocumentResponse:
    """Save edited text as the file's next version."""
    row = await _change(case_files.write_document_text(document_id, body.content, body.role, note=body.note))
    return DocumentResponse(**row)


@router.post("/{document_id}/versions", response_model=DocumentResponse)
async def upload_document_version(document_id: UUID, file: UploadFile = File(...), role: Editor = Form("advisor")) -> DocumentResponse:
    """Replace a file with a newly uploaded version. Earlier versions stay in S3."""
    row = await _change(case_files.replace_document(document_id, await file.read(), role, content_type=file.content_type))
    return DocumentResponse(**row)
