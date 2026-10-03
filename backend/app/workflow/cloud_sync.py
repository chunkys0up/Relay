"""Verified S3 originals and legacy Postgres registration for workflow cases."""
from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.aws_session import create_aws_session

from .repository import Repository, WorkflowError, canonical


class CloudSync:
    """Local state remains canonical; cloud failures never become success."""

    def __init__(self, repository: Repository, settings: Any) -> None:
        self.repository = repository
        self.settings = settings
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def sync_case(self, owner: str, case_id: str) -> dict[str, Any]:
        with self._guard:
            lock = self._locks.setdefault(case_id, threading.Lock())
        with lock:
            state = self.repository.get_case(owner, case_id)
            if not self.settings.database_url or not self.settings.s3_bucket:
                self._publish(owner, case_id, state, [], "unconfigured", "CLOUD_CONFIGURATION_REQUIRED")
                return self.repository.get_case(owner, case_id)
            self._publish(owner, case_id, state, [], "pending", None)
            state = self.repository.get_case(owner, case_id)
            records: list[dict[str, Any]] = []
            try:
                session = create_aws_session(self.settings.aws_region, self.settings.aws_profile)
                s3 = session.client("s3", config=Config(connect_timeout=5, read_timeout=20,
                                    retries={"max_attempts": 2, "mode": "standard"}))
                for kind, collection in (("source", state["sources"]), ("packet", state["packets"])):
                    for item in collection:
                        original = self.repository.blob(owner, case_id, item["id"], kind)
                        if hashlib.sha256(original).hexdigest() != item["hash"]:
                            raise ValueError("LOCAL_INTEGRITY_FAILED")
                        extension = "pdf" if original.startswith(b"%PDF-") else "txt"
                        key = ("tenants/" + self.settings.demo_tenant_id + "/cases/" + str(UUID(case_id))
                               + "/" + kind + "s/" + str(UUID(item["id"])) + "/sha256/"
                               + item["hash"] + "/original." + extension)
                        content_type = "application/pdf" if extension == "pdf" else item.get("mime_type", "text/plain")
                        self._verified_object(s3, key, original, content_type)
                        records.append({"id": item["id"], "kind": kind, "hash": item["hash"],
                                        "key": key, "name": item.get("name") or item.get("title")
                                        or ("packet-v" + str(item.get("version", 1)) + ".pdf"),
                                        "version": item.get("version"), "stage": item.get("stage", "draft")})
                asyncio.run(self._register(state, records))
                self._publish(owner, case_id, state, records, "synced", None)
            except Exception as exc:
                # Do not expose URLs, credentials, document bodies, or SDK error messages.
                if isinstance(exc, ValueError) and str(exc) in {"LOCAL_INTEGRITY_FAILED", "S3_INTEGRITY_FAILED", "POSTGRES_INTEGRITY_FAILED"}:
                    error = str(exc)
                else:
                    error = type(exc).__name__
                self._publish(owner, case_id, state, records, "failed", error)
            return self.repository.get_case(owner, case_id)

    def _verified_object(self, s3: Any, key: str, original: bytes, content_type: str) -> None:
        bucket = self.settings.s3_bucket
        try:
            response = s3.get_object(Bucket=bucket, Key=key)
            stored = response["Body"].read()
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") not in {"NoSuchKey", "404", "NotFound"}:
                raise
            try:
                s3.put_object(Bucket=bucket, Key=key, Body=original, ContentType=content_type,
                              ServerSideEncryption="AES256", IfNoneMatch="*")
            except ClientError as conflict:
                if conflict.response.get("Error", {}).get("Code") not in {"PreconditionFailed", "412"}:
                    raise
            stored = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        if hashlib.sha256(stored).digest() != hashlib.sha256(original).digest():
            raise ValueError("S3_INTEGRITY_FAILED")

    async def _register(self, state: dict[str, Any], records: list[dict[str, Any]]) -> None:
        connection = await asyncpg.connect(self.settings.database_url, timeout=15, command_timeout=20)
        try:
            async with connection.transaction():
                await connection.execute(
                    """CREATE TABLE IF NOT EXISTS workflow_cloud_records (
                        id UUID PRIMARY KEY, case_id UUID NOT NULL REFERENCES cases(id),
                        kind TEXT NOT NULL, original_sha256 TEXT NOT NULL,
                        bucket TEXT NOT NULL, object_key TEXT NOT NULL,
                        packet_stage TEXT, synthetic_example BOOLEAN NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
                founder = state.get("facts", {}).get("founder_name", {}).get("value") or state["company"]
                await connection.execute(
                    """INSERT INTO cases (id,founder_name,service_type,status)
                       VALUES ($1,$2,'workflow_packet',$3)
                       ON CONFLICT (id) DO UPDATE SET founder_name=EXCLUDED.founder_name,status=EXCLUDED.status""",
                    UUID(state["id"]), founder, state["status"])
                for record in records:
                    if record["kind"] == "source":
                        await connection.execute(
                            """INSERT INTO documents (id,case_id,s3_key,filename) VALUES ($1,$2,$3,$4)
                               ON CONFLICT (id) DO UPDATE SET s3_key=EXCLUDED.s3_key,filename=EXCLUDED.filename
                               WHERE documents.case_id=EXCLUDED.case_id""",
                            UUID(record["id"]), UUID(state["id"]), record["key"], record["name"])
                    else:
                        await connection.execute(
                            """INSERT INTO drafts (id,case_id,version,s3_key,status) VALUES ($1,$2,$3,$4,$5)
                               ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status
                               WHERE drafts.case_id=EXCLUDED.case_id AND drafts.s3_key=EXCLUDED.s3_key""",
                            UUID(record["id"]), UUID(state["id"]), record["version"], record["key"], record["stage"])
                    await connection.execute(
                        """INSERT INTO workflow_cloud_records
                           (id,case_id,kind,original_sha256,bucket,object_key,packet_stage,synthetic_example)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                           ON CONFLICT (id) DO UPDATE SET packet_stage=EXCLUDED.packet_stage,updated_at=now()
                           WHERE workflow_cloud_records.original_sha256=EXCLUDED.original_sha256
                           AND workflow_cloud_records.case_id=EXCLUDED.case_id""",
                        UUID(record["id"]), UUID(state["id"]), record["kind"], record["hash"],
                        self.settings.s3_bucket, record["key"], record["stage"] if record["kind"] == "packet" else None,
                        bool(state.get("synthetic_example")))
                saved = await connection.fetch(
                    "SELECT id,original_sha256,object_key FROM workflow_cloud_records WHERE case_id=$1",
                    UUID(state["id"]))
                checked = {str(row["id"]): row for row in saved}
                for record in records:
                    row = checked.get(record["id"])
                    if row is None or row["original_sha256"] != record["hash"] or row["object_key"] != record["key"]:
                        raise ValueError("POSTGRES_INTEGRITY_FAILED")
        finally:
            await connection.close()

    def _publish(self, owner: str, case_id: str, exported: dict[str, Any],
                 records: list[dict[str, Any]], status: str, error: str | None) -> None:
        with self.repository.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                row = connection.execute("SELECT revision,state FROM cases WHERE id=? AND owner=?",
                                         (case_id, owner)).fetchone()
                if row is None:
                    raise WorkflowError("NOT_FOUND", 404)
                state = json.loads(row["state"])
                # Do not claim a stale snapshot represents newer edits or stage transitions.
                if status == "synced" and row["revision"] != exported["revision"]:
                    status = "pending"
                    error = "CASE_CHANGED_DURING_SYNC"
                saved = {record["id"]: record for record in records}
                for item in [*state["sources"], *state["packets"]]:
                    record = saved.get(item["id"])
                    item_status = status if record or status != "synced" else "pending"
                    item["cloud"] = {"status": item_status}
                    if record and record["hash"] == item["hash"]:
                        item["cloud"].update(bucket=self.settings.s3_bucket, key=record["key"],
                                             original_sha256=record["hash"])
                    if error:
                        item["cloud"]["error"] = error
                state["legacy_sync"] = {"status": status, "error": error,
                                        "at": datetime.now(timezone.utc).isoformat()}
                state["revision"] = row["revision"] + 1
                connection.execute("UPDATE cases SET state=?,revision=? WHERE id=?",
                                   (canonical(state), state["revision"], case_id))
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
