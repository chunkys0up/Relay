from __future__ import annotations

from pydantic import BaseModel


class DocumentUploadResponse(BaseModel):
    bucket: str
    key: str
    case_id: str
    source_id: str
    filename: str
    content_type: str | None
    size: int
