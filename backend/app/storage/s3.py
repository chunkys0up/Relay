from __future__ import annotations

import io
import uuid

import boto3

from app.core.config import settings

_session = boto3.Session(profile_name=settings.aws_profile, region_name=settings.aws_region)
_s3 = _session.client("s3")


def build_key(filename: str) -> str:
    return f"documents/{uuid.uuid4()}/{filename}"


def upload_bytes(data: bytes, key: str, content_type: str | None = None) -> None:
    extra_args = {"ContentType": content_type} if content_type else {}
    _s3.upload_fileobj(io.BytesIO(data), settings.s3_bucket, key, ExtraArgs=extra_args)


def delete_object(key: str) -> None:
    _s3.delete_object(Bucket=settings.s3_bucket, Key=key)
