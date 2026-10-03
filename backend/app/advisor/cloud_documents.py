"""S3-backed synthetic advisor documents and lossless Textract display data."""
from __future__ import annotations

from io import BytesIO
import json
from typing import Any
from urllib.parse import urlencode

from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import simpleSplit

from .store import AdvisorError, AdvisorStore, CASE, digest, now

SCHEMA = """CREATE TABLE IF NOT EXISTS advisor_cloud_documents (
    id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, original_hash TEXT NOT NULL,
    bucket TEXT NOT NULL, object_key TEXT NOT NULL, filename TEXT NOT NULL,
    original BLOB NOT NULL, extraction TEXT NOT NULL)"""


def synthetic_pdf(title: str, text: str) -> bytes:
    """One deterministic, readable page for each bounded synthetic seed record."""
    buffer = BytesIO()
    pdf = Canvas(buffer, pagesize=(612, 792), invariant=1)
    pdf.setTitle(title)
    pdf.setFillColorRGB(.12, .25, .3)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(48, 742, "Relay | Northstar Labs")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(48, 721, "SYNTHETIC DEMO - fictional planning information")
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(48, 683, title)
    pdf.setFillColorRGB(.12, .12, .12)
    pdf.setFont("Helvetica", 11)
    y = 650
    for paragraph in text.splitlines():
        for line in simpleSplit(paragraph, "Helvetica", 11, 516):
            if y < 70:
                raise ValueError("Synthetic record exceeds one-page limit")
            pdf.drawString(48, y, line)
            y -= 17
        y -= 6
    pdf.setFont("Helvetica", 9)
    pdf.drawString(48, 38, "Synthetic evidence only | Page 1")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def normalize(response: dict[str, Any], *, filename: str, original: bytes) -> dict[str, Any]:
    blocks = response.get("Blocks", [])
    if not blocks or len(blocks) > 20000:
        raise ValueError("Missing or oversized extraction")
    lookup = {block["Id"]: block for block in blocks}

    def children(block: dict[str, Any], relation: str) -> list[dict[str, Any]]:
        return [lookup[item] for rel in block.get("Relationships", []) if rel["Type"] == relation
                for item in rel["Ids"] if item in lookup]

    def words(block: dict[str, Any]) -> str:
        return " ".join(child.get("Text", "[selected]" if child.get("SelectionStatus") == "SELECTED" else "[unselected]")
                        for child in children(block, "CHILD"))

    lines = [{"page": b.get("Page", 1), "text": b["Text"], "confidence": b.get("Confidence", 0)}
             for b in blocks if b["BlockType"] == "LINE"]
    if not lines:
        raise ValueError("No extracted text")
    fields = []
    tables = []
    for block in blocks:
        if block["BlockType"] == "KEY_VALUE_SET" and "KEY" in block.get("EntityTypes", []):
            fields.append({"key": words(block), "value": " ".join(words(v) for v in children(block, "VALUE")),
                           "page": block.get("Page", 1), "confidence": block.get("Confidence", 0)})
        if block["BlockType"] == "TABLE":
            cells = [c for c in children(block, "CHILD") if c["BlockType"] == "CELL"]
            nr = max((c["RowIndex"] for c in cells), default=0)
            nc = max((c["ColumnIndex"] for c in cells), default=0)
            if nr * nc > 10000:
                raise ValueError("Oversized table")
            rows = [["" for _ in range(nc)] for _ in range(nr)]
            for cell in cells:
                rows[cell["RowIndex"] - 1][cell["ColumnIndex"] - 1] = words(cell)
            tables.append({"page": block.get("Page", 1), "rows": rows})
    return {"provider": "Amazon Textract", "status": "succeeded", "filename": filename,
            "content_type": "application/pdf", "original_sha256": digest(original), "bytes": len(original),
            "pages": response.get("DocumentMetadata", {}).get("Pages", 1), "extracted_at": now(),
            "lines": lines, "fields": fields, "tables": tables}


def install_records(store: AdvisorStore, records: list[dict[str, Any]]) -> None:
    """Publish only a fully extracted batch; old exact-context requests become stale."""
    with store.connection() as db:
        db.execute(SCHEMA)
        db.execute("BEGIN IMMEDIATE")
        try:
            for record in records:
                table = "advisor_packets" if record["kind"] == "packet" else "advisor_sources"
                row = db.execute(f"SELECT hash FROM {table} WHERE id=? AND case_id=?", (record["id"], CASE)).fetchone()
                if row is None:
                    raise ValueError("Unknown synthetic document")
                original = record["original"]
                extraction = record["extraction"]
                if digest(original) != extraction["original_sha256"]:
                    raise ValueError("Original hash mismatch")
                body = "\n".join(line["text"] for line in extraction["lines"]).encode()
                content_hash = digest(body)
                db.execute(f"UPDATE {table} SET body=?,hash=? WHERE id=?", (body, content_hash, record["id"]))
                if record["kind"] == "source":
                    db.execute("UPDATE advisor_sources SET name=?,locator=? WHERE id=?",
                               (record["filename"], json.dumps({"page": 1}), record["id"]))
                column = "packet" if record["kind"] == "packet" else "source"
                # Update only grants for the previously authorized exact content.
                db.execute(f"UPDATE advisor_grants SET {column}_hash=? WHERE {column}_id=? AND {column}_hash=?",
                           (content_hash, record["id"], row["hash"]))
                db.execute("INSERT OR REPLACE INTO advisor_cloud_documents VALUES (?,?,?,?,?,?,?,?)",
                           (record["id"], content_hash, digest(original), record["bucket"], record["key"],
                            record["filename"], original, json.dumps(extraction)))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise


def attach_cloud_documents(store: AdvisorStore, context: dict[str, Any]) -> dict[str, Any]:
    """Call only after scope(), so cached extraction never expands a grant."""
    with store.connection() as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='advisor_cloud_documents'").fetchone() is None:
            return context
        for item in [*context["versions"], *context["sources"]]:
            row = db.execute("SELECT extraction FROM advisor_cloud_documents WHERE id=? AND content_hash=?",
                             (item["id"], item["hash"])).fetchone()
            if row is None:
                continue
            item["extraction"] = json.loads(row["extraction"])
            base = f'/api/advisor/cases/{context["case_id"]}'
            if "version_id" in item:
                version = next(v for v in context["versions"] if v["id"] == item["version_id"])
                query = urlencode({"version_id": version["id"], "packet_hash": version["hash"], "source_hash": item["hash"]})
                item["original_url"] = f'{base}/sources/{item["id"]}/original?{query}'
            else:
                item["original_url"] = f'{base}/packets/{item["id"]}/original?{urlencode({"packet_hash": item["hash"]})}'
    return context


def original_document(store: AdvisorStore, document_id: str, content_hash: str) -> bytes:
    with store.connection() as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='advisor_cloud_documents'").fetchone() is None:
            raise AdvisorError("ORIGINAL_NOT_IMPORTED", 404)
        row = db.execute("SELECT original,original_hash FROM advisor_cloud_documents WHERE id=? AND content_hash=?",
                         (document_id, content_hash)).fetchone()
        if row is None:
            raise AdvisorError("ORIGINAL_NOT_IMPORTED", 404)
        if digest(row["original"]) != row["original_hash"]:
            raise AdvisorError("ORIGINAL_INTEGRITY_ERROR", 409)
        return row["original"]
