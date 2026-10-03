"""Create explicit fictional example packages using actual PDF originals."""
from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

from .documents import extract_document
from .repository import WorkflowError
from .service import WorkflowService, now, uid

EXAMPLES: tuple[dict[str, Any], ...] = (
    {"slug": "cedar-draft", "company": "Cedar Studio", "founder": "Maya Chen",
     "summary": "Fictional design studio preparing a hiring plan.", "revenue": "$180,000",
     "reserve": "Not provided", "stage": "draft", "issue": "Confirm the missing cash reserve before planning is complete."},
    {"slug": "harbor-review", "company": "Harbor Analytics", "founder": "Jordan Lee",
     "summary": "Fictional analytics consultancy planning a new service line.", "revenue": "$320,000",
     "reserve": "$72,000", "stage": "in_review", "issue": "The packet is assembled and awaiting review."},
    {"slug": "juniper-questions", "company": "Juniper Foods", "founder": "Avery Patel",
     "summary": "Fictional food producer comparing two expansion schedules.", "revenue": "Confirmation pending",
     "reserve": "$45,000", "stage": "questions_returned",
     "issue": "The example reviewer requests a source-backed annual revenue figure before proceeding."},
    {"slug": "summit-complete", "company": "Summit Design", "founder": "Riley Brooks",
     "summary": "Fictional product design consultancy with a completed example packet.", "revenue": "$410,000",
     "reserve": "$95,000", "stage": "approved",
     "issue": "All example fields are present. The recorded approval is synthetic, not a real advisor decision."},
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pdf_document(title: str, sections: list[tuple[str, str]]) -> bytes:
    buffer = BytesIO()
    pdf = Canvas(buffer, pagesize=(612, 792), invariant=1)
    pdf.setTitle(title)
    pdf.setAuthor("Relay fictional package examples")
    pdf.setFillColorRGB(.08, .20, .32)
    pdf.rect(0, 746, 612, 46, fill=1, stroke=0)
    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(44, 762, "Relay | " + title)
    pdf.setFillColorRGB(.28, .34, .42)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(44, 723, "SYNTHETIC EXAMPLE - fictional company data; no financial advice")
    y = 687
    for heading, body in sections:
        lines = simpleSplit(body, "Helvetica", 10.5, 520)
        if y - 24 - 15 * len(lines) < 64:
            raise ValueError("Example content exceeds one readable page")
        pdf.setFillColorRGB(.08, .20, .32)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(44, y, heading)
        y -= 21
        pdf.setFillColorRGB(.16, .20, .26)
        pdf.setFont("Helvetica", 10.5)
        for line in lines:
            pdf.drawString(44, y, line)
            y -= 15
        y -= 18
    pdf.setStrokeColorRGB(.82, .86, .90)
    pdf.line(44, 49, 568, 49)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(44, 33, "Fictional planning evidence | Explicit example seed | Page 1")
    pdf.showPage()
    pdf.save()
    data = buffer.getvalue()
    reader = PdfReader(BytesIO(data), strict=True)
    if len(reader.pages) != 1 or not reader.pages[0].extract_text():
        raise ValueError("Example PDF validation failed")
    return data


def prepare_example(example: dict[str, Any]) -> dict[str, Any]:
    fields = {"company_name": example["company"], "founder_name": example["founder"],
              "business_summary": example["summary"], "annual_revenue": example["revenue"],
              "cash_reserve": example["reserve"], "period": "2026"}
    source = pdf_document(example["company"] + " - Intake", [
        ("Company and founder", example["company"] + " | " + example["founder"]),
        ("Business summary", example["summary"]),
        ("Reporting period", "2026"),
        ("Annual revenue", example["revenue"]),
        ("Cash reserve", example["reserve"]),
        ("Outstanding information", example["issue"]),
    ])
    packet = pdf_document(example["company"] + " - Packet", [
        ("Recorded example stage", example["stage"].replace("_", " ").title()),
        ("Planning overview", example["summary"]),
        ("Source-backed fields", "Founder: " + example["founder"] + ". Reporting period: 2026. "
         + "Annual revenue: " + example["revenue"] + ". Cash reserve: " + example["reserve"] + "."),
        ("Next action / completion evidence", example["issue"]),
        ("Source integrity", "Intake PDF SHA-256: " + digest(source)),
        ("Review boundary", "Stage history is synthetic example data. No person approved, received, or signed this document."),
    ])
    return {"definition": example, "fields": fields, "source": source, "packet": packet}


def create_example_cases(service: WorkflowService, owner: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for example in EXAMPLES:
        bundle = prepare_example(example)
        case = service.create_case(owner, "example-case-v1:" + example["slug"],
                                   example["company"], example["issue"])
        case_id = case["id"]
        source_id, packet_id = uid(), uid()
        source_hash, packet_hash = digest(bundle["source"]), digest(bundle["packet"])
        source_name = example["slug"] + "-intake.pdf"
        excerpts = extract_document(bundle["source"], source_name, "application/pdf", source_id)
        text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(bundle["packet"])).pages)

        def install(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if state["sources"] or state["packets"]:
                raise WorkflowError("EXAMPLE_CASE_CHANGED")
            timestamp = now()
            state["synthetic_example"] = True
            state["example_key"] = example["slug"]
            state["sources"] = [{"id": source_id, "name": source_name, "mime_type": "application/pdf",
                                 "bytes": len(bundle["source"]), "hash": source_hash, "created_at": timestamp,
                                 "excerpt_count": len(excerpts), "extraction_status": "ready",
                                 "interpretation_status": "example_data", "status_detail": None,
                                 "cloud": {"status": "unconfigured"},
                                 "excerpts": [{"source_id": e.source_id, "source_hash": e.source_hash,
                                               "page": e.page, "text": e.text} for e in excerpts]}]
            stage = example["stage"]
            path = [] if stage == "draft" else ["in_review"]
            if stage in ("questions_returned", "approved"):
                path.append(stage)
            prior = "draft"
            events = []
            for target in path:
                events.append({"id": uid(), "from_stage": prior, "to_stage": target,
                               "actor": "synthetic_example", "action": "example_" + target,
                               "at": timestamp, "packet_hash": packet_hash, "synthetic_example": True})
                prior = target
            state["packets"] = [{"id": packet_id, "version": 1, "hash": packet_hash,
                                 "created_at": timestamp, "title": example["slug"] + "-packet.pdf",
                                 "kind": "imported", "pages": 1, "fields": bundle["fields"],
                                 "text": text, "template_id": None, "stage": stage, "stage_events": events,
                                 "cloud": {"status": "unconfigured"},
                                 "verification": {"status": "structure_validated", "pages": 1}}]
            state["current_packet_id"] = packet_id
            for field, value in bundle["fields"].items():
                complete = value not in ("Not provided", "Confirmation pending")
                state["facts"][field].update(value=value if complete else None,
                                            state="confirmed" if complete else "unknown",
                                            confirmed_by="synthetic_example" if complete else None)
            fields_complete = all(item["state"] == "confirmed" for item in state["facts"].values())
            review_state = {"draft": "Pending", "in_review": "In progress",
                            "questions_returned": "Blocked", "approved": "Done"}[stage]
            state["tasks"] = [
                {"id": uid(), "key": "example_source", "job_id": None, "title": "Store and read the source PDF",
                 "state": "Done", "order": 1, "detail": "Original bytes stored; text extracted from the PDF."},
                {"id": uid(), "key": "example_fields", "job_id": None, "title": "Complete planning information",
                 "state": "Done" if fields_complete else "Blocked", "order": 2, "detail": example["issue"]},
                {"id": uid(), "key": "example_review", "job_id": None, "title": "Complete the example review",
                 "state": review_state, "order": 3, "detail": "Synthetic stage events only; no real advisor approval."},
            ]
            state["status"] = stage.replace("_", " ").capitalize() + " (example)"
            state["activity"] = example["issue"]
            return {"created": True}, [(source_id, "source", bundle["source"]), (packet_id, "packet", bundle["packet"])]

        service.repo.mutate(owner, case_id, "example_bundle", "example-bundle-v1",
                            {"slug": example["slug"], "bundle_version": 1}, None, install)
        result.append(service.snapshot(owner, case_id))
    return result


def export_examples(output: Path) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    packages: list[dict[str, Any]] = []
    for example in EXAMPLES:
        bundle = prepare_example(example)
        documents = []
        for kind in ("source", "packet"):
            filename = example["slug"] + ("-intake.pdf" if kind == "source" else "-packet.pdf")
            data = bundle[kind]
            (output / filename).write_bytes(data)
            documents.append({"filename": filename, "kind": kind, "sha256": digest(data), "bytes": len(data)})
        packages.append({"company": example["company"], "stage": example["stage"],
                         "synthetic_example": True, "documents": documents})
    manifest = {"schema": "relay-example-packets-v1", "packages": packages}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = export_examples(args.output)
    print(json.dumps({"packages": len(manifest["packages"]), "pdfs": 2 * len(manifest["packages"])}))
