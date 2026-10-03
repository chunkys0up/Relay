from __future__ import annotations

import uuid
from uuid import UUID

from fastapi import APIRouter, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.schemas.document import DocumentUploadResponse
from app.storage.s3 import build_key, upload_bytes

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(
    case_id: UUID = Form(...), file: UploadFile = File(...)
) -> DocumentUploadResponse:
    data = await file.read()
    source_id = uuid.uuid4()
    key = build_key(case_id, source_id, file.filename or "untitled")
    await run_in_threadpool(upload_bytes, data, key, file.content_type)
    return DocumentUploadResponse(
        bucket=settings.s3_bucket,
        key=key,
        case_id=str(case_id),
        source_id=str(source_id),
        filename=file.filename or "untitled",
        content_type=file.content_type,
        size=len(data),
    )
