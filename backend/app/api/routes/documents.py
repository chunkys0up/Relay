from __future__ import annotations

from uuid import UUID

import asyncpg
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.db.pool import get_pool
from app.schemas.document import DocumentResponse, DocumentUploadResponse
from app.storage.s3 import build_key, delete_object, upload_bytes

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("", response_model=list[DocumentResponse])
async def list_documents(case_id: UUID) -> list[DocumentResponse]:
    rows = await get_pool().fetch(
        "SELECT id, case_id, filename, s3_key, uploaded_at FROM documents "
        "WHERE case_id = $1 ORDER BY uploaded_at",
        case_id,
    )
    return [DocumentResponse(**row) for row in rows]


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    case_id: UUID = Form(...), file: UploadFile = File(...)
) -> DocumentUploadResponse:
    data = await file.read()
    filename = file.filename or "untitled"
    key = build_key(filename)
    await run_in_threadpool(upload_bytes, data, key, file.content_type)

    try:
        row = await get_pool().fetchrow(
            "INSERT INTO documents (case_id, s3_key, filename) VALUES ($1, $2, $3) "
            "RETURNING id, uploaded_at",
            case_id,
            key,
            filename,
        )
    except asyncpg.ForeignKeyViolationError:
        await run_in_threadpool(delete_object, key)
        raise HTTPException(status_code=404, detail=f"case {case_id} not found")

    return DocumentUploadResponse(
        id=row["id"],
        case_id=case_id,
        bucket=settings.s3_bucket,
        key=key,
        filename=filename,
        content_type=file.content_type,
        size=len(data),
        uploaded_at=row["uploaded_at"],
    )
