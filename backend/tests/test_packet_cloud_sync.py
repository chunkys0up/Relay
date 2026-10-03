from __future__ import annotations
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from botocore.exceptions import ClientError
import pytest

from app.workflow.cloud_sync import CloudSync
from app.workflow.repository import Repository, WorkflowError


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts = 0
        self.fail = False

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("CLOUD_OFFLINE")
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": BytesIO(self.objects[Key])}

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **kwargs: Any) -> None:
        assert kwargs["IfNoneMatch"] == "*"
        self.puts += 1
        self.objects[Key] = Body


def setup_case(tmp_path: Path) -> tuple[Repository, str, bytes]:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    case_id, packet_id = str(uuid4()), str(uuid4())
    data = b"%PDF-1.7\ncloud-integrity-test"
    state = {"id": case_id, "revision": 0, "company": "Fictional integrity test",
             "facts": {}, "status": "Draft ready", "sources": [], "packets": [],
             "synthetic_example": True}
    repo.create_case("owner", case_id, state)

    def change(value: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        value["packets"].append({"id": packet_id, "hash": sha256(data).hexdigest(),
                                 "version": 1, "stage": "draft", "title": "test.pdf"})
        return {}, [(packet_id, "packet", data)]

    repo.mutate("owner", case_id, "test", "seed", {}, 0, change)
    return repo, case_id, data


def settings(configured: bool = True) -> SimpleNamespace:
    return SimpleNamespace(database_url="postgresql://unused" if configured else None,
                           s3_bucket="private-test", aws_profile=None, aws_region="us-east-1",
                           demo_tenant_id="relay-demo")


def install_s3(monkeypatch: pytest.MonkeyPatch, s3: FakeS3) -> None:
    class Session:
        def __init__(self, **kwargs: Any) -> None:
            pass

        def client(self, name: str, **kwargs: Any) -> FakeS3:
            assert name == "s3"
            return s3

    monkeypatch.setattr("app.workflow.cloud_sync.boto3.Session", Session)


def test_synced_requires_download_hash_and_registration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, case_id, data = setup_case(tmp_path)
    s3 = FakeS3()
    install_s3(monkeypatch, s3)
    sync = CloudSync(repo, settings())
    registrations: list[dict[str, Any]] = []

    async def register(state: dict[str, Any], records: list[dict[str, Any]]) -> None:
        registrations.append({"stage": records[0]["stage"], "hash": records[0]["hash"]})

    monkeypatch.setattr(sync, "_register", register)
    result = sync.sync_case("owner", case_id)
    assert result["legacy_sync"]["status"] == "synced"
    assert result["packets"][0]["cloud"]["original_sha256"] == sha256(data).hexdigest()
    assert len(s3.objects) == s3.puts == 1
    assert registrations == [{"stage": "draft", "hash": sha256(data).hexdigest()}]
    again = sync.sync_case("owner", case_id)
    assert again["legacy_sync"]["status"] == "synced"
    assert s3.puts == 1


def test_remote_integrity_failure_never_registers_or_overwrites(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, case_id, _ = setup_case(tmp_path)
    s3 = FakeS3()
    install_s3(monkeypatch, s3)
    sync = CloudSync(repo, settings())
    state = repo.get_case("owner", case_id)
    packet = state["packets"][0]
    key = "tenants/relay-demo/cases/" + case_id + "/packets/" + packet["id"] + "/sha256/" + packet["hash"] + "/original.pdf"
    s3.objects[key] = b"corrupted"
    called = False

    async def register(state: dict[str, Any], records: list[dict[str, Any]]) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(sync, "_register", register)
    result = sync.sync_case("owner", case_id)
    assert result["legacy_sync"]["status"] == "failed"
    assert result["legacy_sync"]["error"] == "S3_INTEGRITY_FAILED"
    assert not called and s3.puts == 0


def test_cloud_unconfigured_and_failed_are_explicit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, case_id, _ = setup_case(tmp_path)
    result = CloudSync(repo, settings(False)).sync_case("owner", case_id)
    assert result["legacy_sync"]["status"] == "unconfigured"
    s3 = FakeS3()
    s3.fail = True
    install_s3(monkeypatch, s3)
    result = CloudSync(repo, settings()).sync_case("owner", case_id)
    assert result["legacy_sync"]["status"] == "failed"
    assert result["packets"][0]["cloud"]["status"] == "failed"


def test_stale_export_never_claims_new_stage_is_synced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo, case_id, _ = setup_case(tmp_path)
    s3 = FakeS3()
    install_s3(monkeypatch, s3)
    sync = CloudSync(repo, settings())

    async def register(state: dict[str, Any], records: list[dict[str, Any]]) -> None:
        def change(current: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            current["packets"][0]["stage"] = "in_review"
            return {}, []
        repo.mutate("owner", case_id, "test-stage", "stage", {}, state["revision"], change)

    monkeypatch.setattr(sync, "_register", register)
    result = sync.sync_case("owner", case_id)
    assert result["packets"][0]["stage"] == "in_review"
    assert result["legacy_sync"]["status"] == "pending"
    assert result["legacy_sync"]["error"] == "CASE_CHANGED_DURING_SYNC"


def test_other_owner_cannot_sync(tmp_path: Path) -> None:
    repo, case_id, _ = setup_case(tmp_path)
    with pytest.raises(WorkflowError, match="NOT_FOUND"):
        CloudSync(repo, settings()).sync_case("someone-else", case_id)


def test_unified_backend_import_does_not_require_active_aws_profile(tmp_path: Path) -> None:
    import os
    import subprocess
    import sys
    env = os.environ.copy()
    env.update(PYTHON_DOTENV_DISABLED="1", AWS_PROFILE="relay-profile-not-present",
               AWS_CONFIG_FILE=str(tmp_path / "absent-config"),
               AWS_SHARED_CREDENTIALS_FILE=str(tmp_path / "absent-credentials"),
               AWS_EC2_METADATA_DISABLED="true",
               RELAY_WORKFLOW_DB=str(tmp_path / "startup.sqlite3"))
    result = subprocess.run([sys.executable, "-c", "from app.main import app; assert app"],
                            capture_output=True, env=env, timeout=20, check=False)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
