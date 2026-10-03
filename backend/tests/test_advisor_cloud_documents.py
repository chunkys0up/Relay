from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.advisor.cloud_documents import install_records, normalize, synthetic_pdf
from app.advisor.store import CASE, P1, P3, PRIVATE, S1
from test_advisor import client


def record(document_id: str = P1, kind: str = "packet") -> dict[str, Any]:
    original = synthetic_pdf("Synthetic test", "Annual revenue: $240,000")
    extraction = normalize({"DocumentMetadata": {"Pages": 1}, "Blocks": [
        {"Id": "line", "BlockType": "LINE", "Text": "Annual revenue: $240,000", "Page": 1, "Confidence": 99},
    ]}, filename="test.pdf", original=original)
    return {"id": document_id, "kind": kind, "original": original, "extraction": extraction,
            "bucket": "test-bucket", "key": "synthetic/test.pdf", "filename": "test.pdf"}


def test_cloud_originals_and_extraction_preserve_grant_and_hash_gates(tmp_path: Path) -> None:
    browser, store, session = client(tmp_path)
    old_hash = session["workspace"]["versions"][0]["hash"]
    packet = record()
    install_records(store, [packet, record(S1, "source"), record(P3), record(PRIVATE, "source")])
    session = browser.get('/api/advisor/session').json()
    version = session["workspace"]["versions"][0]
    assert version["hash"] != old_hash
    base = f'/api/advisor/cases/{CASE}/packets/{P1}'
    assert browser.get(base + '/documents', params={"packet_hash": old_hash}).status_code == 409
    response = browser.get(base + '/documents', params={"packet_hash": version["hash"]})
    assert response.status_code == 200
    docs = response.json()
    actual = docs["versions"][0]
    assert actual["text"] == "Annual revenue: $240,000"
    assert actual["extraction"]["provider"] == "Amazon Textract"
    assert actual["extraction"]["lines"][0]["confidence"] == 99
    assert "bucket" not in actual and "object_key" not in actual
    pdf = browser.get(actual["original_url"])
    assert pdf.status_code == 200 and pdf.content == packet["original"]
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.headers["cache-control"] == "no-store"
    source = next(s for s in docs["sources"] if s["id"] == S1)
    assert browser.get(source["original_url"]).status_code == 200
    assert browser.get(source["original_url"].replace(S1, PRIVATE)).status_code == 404
    assert browser.get(actual["original_url"].replace(P1, P3)).status_code in (404, 409)
    actor = session["workspace"]["advisor"]["id"]
    with store.connection() as db:
        db.execute("DELETE FROM advisor_grants WHERE actor=? AND packet_id=?", (actor, P1))
    assert browser.get(actual["original_url"]).status_code == 404
    browser.cookies.clear()
    assert browser.get(actual["original_url"]).status_code == 401


def test_import_is_atomic_and_original_integrity_checked(tmp_path: Path) -> None:
    browser, store, session = client(tmp_path)
    good = record()
    bad = record(S1, "source")
    bad["original"] = b'corrupted'
    with pytest.raises(ValueError, match="hash mismatch"):
        install_records(store, [good, bad])
    assert browser.get('/api/advisor/session').json()["workspace"]["versions"] == session["workspace"]["versions"]
    install_records(store, [good])
    current = browser.get('/api/advisor/session').json()["workspace"]["versions"][0]
    with store.connection() as db:
        db.execute("UPDATE advisor_cloud_documents SET original=? WHERE id=?", (b'corrupted', P1))
    assert browser.get(f'/api/advisor/cases/{CASE}/packets/{P1}/original', params={"packet_hash": current["hash"]}).status_code == 409


def test_normalize_fields_tables_and_low_confidence_are_visible() -> None:
    response = {"Blocks": [
        {"Id": "line", "BlockType": "LINE", "Text": "Revenue $240,000", "Confidence": 72},
        {"Id": "word1", "BlockType": "WORD", "Text": "Revenue"},
        {"Id": "word2", "BlockType": "WORD", "Text": "$240,000"},
        {"Id": "key", "BlockType": "KEY_VALUE_SET", "EntityTypes": ["KEY"], "Confidence": 98,
         "Relationships": [{"Type": "CHILD", "Ids": ["word1"]}, {"Type": "VALUE", "Ids": ["value"]}]},
        {"Id": "value", "BlockType": "KEY_VALUE_SET", "Relationships": [{"Type": "CHILD", "Ids": ["word2"]}]},
        {"Id": "table", "BlockType": "TABLE", "Relationships": [{"Type": "CHILD", "Ids": ["cell"]}]},
        {"Id": "cell", "BlockType": "CELL", "RowIndex": 1, "ColumnIndex": 1,
         "Relationships": [{"Type": "CHILD", "Ids": ["word2"]}]},
    ]}
    result = normalize(response, filename="test.pdf", original=b'pdf')
    assert result["lines"][0]["confidence"] == 72
    assert result["fields"][0]["value"] == "$240,000"
    assert result["tables"][0]["rows"] == [["$240,000"]]
    with pytest.raises(ValueError, match="Missing"):
        normalize({"Blocks": []}, filename="test.pdf", original=b'pdf')

class FakeCloud:
    def __init__(self, *, corrupt: bool = False) -> None:
        self.objects: dict[str, bytes] = {}
        self.calls = 0
        self.corrupt = corrupt

    def get(self, bucket: str, key: str) -> bytes | None:
        body = self.objects.get(key)
        return b'bad' if self.corrupt and body and key.endswith('.pdf') else body

    def put(self, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.objects[key] = body

    def analyze(self, bucket: str, key: str) -> dict[str, Any]:
        self.calls += 1
        return {"Blocks": [{"Id": "line", "BlockType": "LINE", "Text": "Cloud extracted content", "Confidence": 99}]}


def test_ingest_reuses_s3_extraction_and_fails_before_import_on_corruption(tmp_path: Path) -> None:
    from scripts.ingest_synthetic_packets import ingest
    browser, store, session = client(tmp_path)
    cloud = FakeCloud()
    ingest([record()], cloud, "test", store)
    ingest([record()], cloud, "test", store)
    assert cloud.calls == 1
    assert len(cloud.objects) == 2
    bad_cloud = FakeCloud(corrupt=True)
    before = browser.get('/api/advisor/session').json()["workspace"]["versions"]
    with pytest.raises(ValueError, match="download"):
        ingest([record()], bad_cloud, "test", store)
    assert bad_cloud.calls == 0
    assert browser.get('/api/advisor/session').json()["workspace"]["versions"] == before
