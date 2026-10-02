from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.schemas.document import DocumentUploadResponse
from app.storage.s3 import build_key, upload_bytes

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("/upload", response_model=DocumentUploadResponse)
async def upload_document(file: UploadFile = File(...)) -> DocumentUploadResponse:
    data = await file.read()
    key = build_key(file.filename or "untitled")
    await run_in_threadpool(upload_bytes, data, key, file.content_type)
    return DocumentUploadResponse(
        bucket=settings.s3_bucket,
        key=key,
        filename=file.filename or "untitled",
        content_type=file.content_type,
        size=len(data),
    )
