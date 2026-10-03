from __future__ import annotations

import os
import re
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.db.pool import get_pool
from app.storage.s3 import download_bytes

# Bedrock Converse limits for files passed inline with a message.
MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_BYTES = int(4.5 * 1024 * 1024)
_DOCUMENT_FORMATS = {"pdf", "csv", "doc", "docx", "xls", "xlsx", "html", "txt", "md"}
_IMAGE_FORMATS = {"png": "png", "jpg": "jpeg", "jpeg": "jpeg", "gif": "gif", "webp": "webp"}


class UnreadableFile(ValueError):
    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


def _extension(filename: str) -> str:
    return os.path.splitext(filename)[1].lower().lstrip(".")


def check_readable(filename: str) -> None:
    """Fail before downloading if the model can't read this file type."""
    ext = _extension(filename)
    if ext not in _DOCUMENT_FORMATS and ext not in _IMAGE_FORMATS:
        raise UnreadableFile(
            f"{filename} can't be read by the assistant. Supported: PDF, Word, Excel, CSV, text, Markdown, "
            "HTML, PNG, JPEG, GIF, WebP.",
            415,
        )


def _document_name(filename: str, index: int) -> str:
    # Bedrock document names allow only letters, digits, single spaces, hyphens, parentheses and
    # brackets, and must be unique within a request.
    stem = os.path.splitext(filename)[0]
    name = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9\s\-()\[\]]", " ", stem)).strip()
    return f"{name or 'document'} ({index})"


def file_block(filename: str, data: bytes, index: int = 1) -> dict[str, Any]:
    """A Bedrock document or image content block for a file's bytes."""
    check_readable(filename)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise UnreadableFile(f"{filename} is over 4.5 MB, the most the assistant can read.", 413)
    ext = _extension(filename)
    if ext in _IMAGE_FORMATS:
        return {"image": {"format": _IMAGE_FORMATS[ext], "source": {"bytes": data}}}
    return {"document": {"format": ext, "name": _document_name(filename, index), "source": {"bytes": data}}}


async def load_file_block(filename: str, s3_key: str, index: int = 1) -> dict[str, Any]:
    check_readable(filename)
    data = await run_in_threadpool(download_bytes, s3_key)
    return file_block(filename, data, index)


async def build_prompt(message: str, document_ids: list[UUID]) -> str | list[dict[str, Any]]:
    """The user's message, preceded by any attached case documents loaded from S3."""
    if not document_ids:
        return message
    rows = await get_pool().fetch(
        "SELECT id, filename, s3_key FROM documents WHERE id = ANY($1::uuid[])", document_ids
    )
    found = {row["id"]: row for row in rows}
    blocks: list[dict[str, Any]] = []
    for index, document_id in enumerate(document_ids, start=1):
        row = found.get(document_id)
        if row is None:
            raise HTTPException(status_code=404, detail=f"document {document_id} not found")
        try:
            blocks.append(await load_file_block(row["filename"], row["s3_key"], index))
        except UnreadableFile as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    blocks.append({"text": message})
    return blocks
