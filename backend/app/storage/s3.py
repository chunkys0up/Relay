from __future__ import annotations

import io
import os
import re
import uuid
from functools import lru_cache
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.core.aws_session import create_aws_session
from app.core.config import settings

@lru_cache(maxsize=1)
def _client() -> Any:
    session = create_aws_session(settings.aws_region, settings.aws_profile)
    return session.client("s3")

DEFAULT_URL_TTL_SECONDS = 300
MAX_URL_TTL_SECONDS = 900
_SAFE_EXT = re.compile(r"^\.[a-z0-9]{1,8}$")


def build_key(case_id: str | uuid.UUID, source_id: str | uuid.UUID, filename: str, version: int = 1) -> str:
    # Matches the existing bucket layout (see bootstrap/relay-demo/v1/README.md):
    # tenants/<tenant>/cases/<case>/sources/<source>/versions/<n>/original.<ext>
    # Only a validated extension survives from the user's filename, so no
    # user-controlled path or name ends up in S3. IDs are parsed as UUIDs.
    ext = os.path.splitext(filename)[1].lower()
    if not _SAFE_EXT.match(ext):
        ext = ""
    return (
        f"tenants/{settings.demo_tenant_id}/cases/{uuid.UUID(str(case_id))}"
        f"/sources/{uuid.UUID(str(source_id))}/versions/{int(version)}/original{ext}"
    )


def upload_bytes(data: bytes, key: str, content_type: str | None = None) -> None:
    extra_args = {"ContentType": content_type} if content_type else {}
    _client().upload_fileobj(io.BytesIO(data), settings.s3_bucket, key, ExtraArgs=extra_args)


def download_bytes(key: str) -> bytes:
    return _client().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def head_object(key: str) -> dict | None:
    """Return size/content type/ETag for a key, or None if it does not exist."""
    try:
        head = _client().head_object(Bucket=settings.s3_bucket, Key=key)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return {
        "bytes": head["ContentLength"],
        "content_type": head.get("ContentType"),
        "etag": head["ETag"].strip('"'),
    }


def presigned_download_url(
    key: str,
    filename: str | None = None,
    expires_in: int = DEFAULT_URL_TTL_SECONDS,
    inline: bool = True,
) -> str:
    """Short-lived GET URL for a private object (previews and downloads)."""
    params: dict[str, str] = {"Bucket": settings.s3_bucket, "Key": key}
    if filename:
        safe_name = re.sub(r'[^A-Za-z0-9._ -]', "_", filename)
        disposition = "inline" if inline else "attachment"
        params["ResponseContentDisposition"] = f'{disposition}; filename="{safe_name}"'
    return _client().generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=min(max(expires_in, 1), MAX_URL_TTL_SECONDS),
    )


def presigned_upload_url(
    key: str,
    content_type: str | None = None,
    expires_in: int = DEFAULT_URL_TTL_SECONDS,
) -> str:
    """Short-lived PUT URL; the client must send the same Content-Type header."""
    params: dict[str, str] = {"Bucket": settings.s3_bucket, "Key": key}
    if content_type:
        params["ContentType"] = content_type
    return _client().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=min(max(expires_in, 1), MAX_URL_TTL_SECONDS),
    )


def delete_object(key: str) -> None:
    _client().delete_object(Bucket=settings.s3_bucket, Key=key)
