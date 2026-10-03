"""Founder responses to an exact returned packet review."""

from __future__ import annotations

from hashlib import sha256
from html import escape
from io import BytesIO
import re
from typing import Any

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer

from .documents import _packet_font
from .packet_stages import validate_pdf
from .repository import Repository, WorkflowError
from .service import now, uid
from .sharing import public_actor_id


def _returned_review(state: dict[str, Any], packet_id: str, packet_hash: str,
                     review_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    packet = next((item for item in state["packets"] if item["id"] == packet_id), None)
    review = next((item for item in state.get("reviews", []) if item["id"] == review_id), None)
    if packet is None or review is None:
        raise WorkflowError("NOT_FOUND", 404)
    if state.get("current_packet_id") != packet_id or packet.get("stage") != "questions_returned":
        raise WorkflowError("RETURNED_REVIEW_NOT_CURRENT")
    if packet["hash"] != packet_hash or review["packet_hash"] != packet_hash:
        raise WorkflowError("STALE_PACKET_HASH")
    if review["packet_id"] != packet_id or review["decision"] != "questions_returned":
        raise WorkflowError("INVALID_RETURNED_REVIEW")
    if not review.get("note", "").strip():
        raise WorkflowError("REVIEW_NOTE_REQUIRED")
    return packet, review


def _append_answer(base: bytes, version: int, review: dict[str, Any],
                   base_hash: str, answer: str) -> tuple[bytes, int]:
    stream = BytesIO()
    font = _packet_font()
    if font == "Helvetica" and any(ord(char) > 255 for char in answer + review["note"]):
        raise WorkflowError("UNICODE_FONT_UNAVAILABLE", 422)
    document = BaseDocTemplate(stream, pagesize=letter, leftMargin=54, rightMargin=54,
                               topMargin=64, bottomMargin=54)
    frame = Frame(54, 54, letter[0] - 108, letter[1] - 118,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def chrome(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#00205B"))
        canvas.rect(0, letter[1] - 12, letter[0], 12, fill=1, stroke=0)
        canvas.setFont(font, 8)
        canvas.drawString(54, 34, f"Founder response appendix · Packet version {version}")
        canvas.drawRightString(letter[0] - 54, 34, f"Appendix page {doc.page}")
        canvas.restoreState()

    document.addPageTemplates(PageTemplate(id="answer", frames=frame, onPage=chrome))
    heading = ParagraphStyle("heading", fontName=font, fontSize=17, leading=23,
                             textColor=colors.HexColor("#00205B"), spaceAfter=13)
    label = ParagraphStyle("label", fontName=font, fontSize=9, leading=14,
                           textColor=colors.HexColor("#52627A"), spaceBefore=13, spaceAfter=4)
    value = ParagraphStyle("value", fontName=font, fontSize=10, leading=16,
                           textColor=colors.HexColor("#202C3D"))
    details = (f"Response to packet v{version - 1}, SHA-256 {base_hash}. "
               f"Returned review {review['id']} by advisor {review['reviewer_id']}.")
    story: list[Any] = [Paragraph("Founder response to advisor questions", heading),
                        Paragraph(escape(details), value), Spacer(1, 10),
                        Paragraph("Advisor question", label),
                        Paragraph(escape(review["note"]).replace("\n", "<br/>"), value),
                        Paragraph("Founder response", label),
                        Paragraph(escape(answer).replace("\n", "<br/>"), value)]
    document.build(story)
    appendix = stream.getvalue()
    try:
        original = PdfReader(BytesIO(base), strict=True)
        added = PdfReader(BytesIO(appendix), strict=True)
        writer = PdfWriter()
        writer.append(original)
        writer.append(added)
        output = BytesIO()
        writer.write(output)
        data = output.getvalue()
        pages = validate_pdf(data)
        final = PdfReader(BytesIO(data), strict=True)
        added_text = "\n".join(page.extract_text() or "" for page in final.pages[len(original.pages):])
        normalized = re.sub(r"\s+", " ", added_text)
        if not all(re.sub(r"\s+", " ", piece.strip()) in normalized
                   for piece in (review["note"], answer)):
            raise WorkflowError("ANSWER_APPENDIX_VERIFICATION_FAILED", 422)
        return data, pages
    except WorkflowError:
        raise
    except Exception as exc:
        raise WorkflowError("ANSWER_APPENDIX_VERIFICATION_FAILED", 422) from exc


def preview_answer(repo: Repository, owner: str, case_id: str, packet_id: str,
                   packet_hash: str, review_id: str, answer: str,
                   expected_revision: int, key: str) -> dict[str, Any]:
    response_text = answer.strip()
    if not response_text or len(response_text) > 4000:
        raise WorkflowError("ANSWER_REQUIRED", 422)
    request = {"packet_id": packet_id, "packet_hash": packet_hash,
               "review_id": review_id, "answer": response_text,
               "expected_revision": expected_revision}
    prior = repo.replay(owner, case_id, "answer_preview", key, request)
    if prior is not None:
        return prior
    original = repo.blob(owner, case_id, packet_id, "packet")
    if sha256(original).hexdigest() != packet_hash:
        raise WorkflowError("ORIGINAL_INTEGRITY_ERROR")
    preview_id = uid()

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        packet, review = _returned_review(state, packet_id, packet_hash, review_id)
        version = len(state["packets"]) + 1
        result, pages = _append_answer(original, version, review, packet_hash, response_text)
        digest = sha256(result).hexdigest()
        state.setdefault("answer_previews", []).append({
            "id": preview_id, "packet_id": packet_id, "packet_hash": packet_hash,
            "review_id": review_id, "answer": response_text, "hash": digest,
            "version": version, "pages": pages, "status": "pending", "created_at": now(),
        })
        return ({"preview_id": preview_id, "preview_hash": digest,
                 "packet_id": packet["id"], "packet_hash": packet_hash,
                 "review_id": review_id, "version": version, "pages": pages},
                [(preview_id, "answer_preview", result)])

    return repo.mutate(owner, case_id, "answer_preview", key, request,
                       expected_revision, change)


def confirm_answer(repo: Repository, owner: str, case_id: str, preview_id: str,
                   preview_hash: str, expected_revision: int, key: str) -> dict[str, Any]:
    request = {"preview_id": preview_id, "preview_hash": preview_hash,
               "expected_revision": expected_revision}
    prior = repo.replay(owner, case_id, "confirm_answer", key, request)
    if prior is not None:
        return prior
    body = repo.blob(owner, case_id, preview_id, "answer_preview")
    if sha256(body).hexdigest() != preview_hash:
        raise WorkflowError("ANSWER_PREVIEW_INTEGRITY_ERROR")
    pages = validate_pdf(body)
    new_packet_id = uid()
    answer_id = uid()

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        preview = next((item for item in state.get("answer_previews", [])
                        if item["id"] == preview_id), None)
        if preview is None or preview["status"] != "pending":
            raise WorkflowError("ANSWER_PREVIEW_NOT_CURRENT")
        if preview["hash"] != preview_hash or preview["pages"] != pages:
            raise WorkflowError("ANSWER_PREVIEW_INTEGRITY_ERROR")
        base, review = _returned_review(state, preview["packet_id"],
                                        preview["packet_hash"], preview["review_id"])
        if preview["version"] != len(state["packets"]) + 1:
            raise WorkflowError("ANSWER_PREVIEW_NOT_CURRENT")
        packet = {"id": new_packet_id, "version": preview["version"],
                  "hash": preview_hash, "title": f"{base['title']} · response",
                  "created_at": now(), "kind": "founder_answer",
                  "pages": pages, "fields": base.get("fields", {}),
                  "template_id": base.get("template_id"),
                  "previous_packet_id": base["id"], "returned_review_id": review["id"],
                  "answer_id": answer_id,
                  "verification": {"status": "appendix_text_verified", "pages": pages,
                                   "base_packet_hash": base["hash"], "preview_hash": preview_hash},
                  "stage": "draft", "stage_events": [],
                  "cloud": {"status": "unconfigured"}}
        answer_record = {"id": answer_id, "author_id": public_actor_id(owner),
                         "review_id": review["id"], "reviewer_id": review["reviewer_id"],
                         "packet_id": base["id"], "packet_hash": base["hash"],
                         "new_packet_id": new_packet_id, "new_packet_hash": preview_hash,
                         "text": preview["answer"], "created_at": now()}
        state["packets"].append(packet)
        state.setdefault("answers", []).append(answer_record)
        state["current_packet_id"] = new_packet_id
        state["status"] = "Draft ready"
        state["activity"] = f"Founder response saved in private packet v{packet['version']}."
        preview["status"] = "applied"
        return ({"packet_id": new_packet_id, "packet_hash": preview_hash,
                 "version": packet["version"], "stage": "draft", "answer": answer_record},
                [(new_packet_id, "packet", body)])

    return repo.mutate(owner, case_id, "confirm_answer", key, request,
                       expected_revision, change)


def discard_answer(repo: Repository, owner: str, case_id: str, preview_id: str,
                   preview_hash: str, expected_revision: int, key: str) -> dict[str, Any]:
    request = {"preview_id": preview_id, "preview_hash": preview_hash,
               "expected_revision": expected_revision}

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        preview = next((item for item in state.get("answer_previews", [])
                        if item["id"] == preview_id), None)
        if preview is None or preview["status"] != "pending":
            raise WorkflowError("ANSWER_PREVIEW_NOT_CURRENT")
        if preview["hash"] != preview_hash:
            raise WorkflowError("ANSWER_PREVIEW_INTEGRITY_ERROR")
        preview["status"] = "discarded"
        return {"preview_id": preview_id, "status": "discarded"}, []

    return repo.mutate(owner, case_id, "discard_answer", key, request,
                       expected_revision, change)
