from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class DocumentUploadResponse(BaseModel):
    id: UUID
    source_id: UUID
    case_id: UUID
    bucket: str
    key: str
    filename: str
    content_type: str | None
    size: int
    uploaded_at: datetime


class DocumentResponse(BaseModel):
    id: UUID
    case_id: UUID
    filename: str
    s3_key: str
    uploaded_at: datetime
