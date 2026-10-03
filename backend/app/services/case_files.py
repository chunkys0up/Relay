"""Reading and changing a case's files: uploaded documents, the packet PDF and its summary.

Shared by the API routes (people editing) and the chat agent's tools (Relay editing), so both
make the same versioned changes. Nothing is overwritten in S3: each change writes a new object.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Literal
from uuid import UUID

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from starlette.concurrency import run_in_threadpool

from app.core.aws_session import create_aws_session
from app.core.config import settings
from app.db import packets as packet_store
from app.db.case_records import log_activity
from app.db.pool import get_pool
from app.storage.s3 import build_key, delete_object, download_bytes, head_object, upload_bytes

Editor = Literal["agent", "founder", "advisor"]

# Files people and Relay can rewrite as text; anything else is replaced by uploading a new file.
TEXT_EXTENSIONS = {".md", ".txt", ".csv", ".json", ".html", ".htm"}
_CONTENT_TYPES = {".md": "text/markdown", ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
                  ".html": "text/html", ".htm": "text/html", ".pdf": "application/pdf"}
_KEY_PARTS = re.compile(r"/sources/([0-9a-f-]{36})/versions/(\d+)/")


class FileChangeError(ValueError):
    pass


def is_text_file(filename: str) -> bool:
    return os.path.splitext(filename)[1].lower() in TEXT_EXTENSIONS


def _next_key(case_id: UUID, s3_key: str, filename: str) -> str:
    match = _KEY_PARTS.search(s3_key)
    source_id, version = (match.group(1), int(match.group(2))) if match else (str(uuid.uuid4()), 0)
    return build_key(case_id, source_id, filename, version + 1)


async def _get_document(case_id: UUID | None, document_id: UUID) -> dict[str, Any]:
    if case_id is None:
        row = await get_pool().fetchrow("SELECT id, case_id, filename, s3_key, uploaded_at FROM documents WHERE id = $1", document_id)
    else:
        row = await get_pool().fetchrow(
            "SELECT id, case_id, filename, s3_key, uploaded_at FROM documents WHERE id = $1 AND case_id = $2", document_id, case_id
        )
    if row is None:
        raise FileChangeError("That file isn't in this case.")
    return dict(row)


def _who(editor: Editor) -> str:
    return {"agent": "Relay", "founder": "The founder", "advisor": "The advisor"}[editor]


# --- Uploaded documents ---------------------------------------------------------------------------------

async def read_document_text(document_id: UUID, case_id: UUID | None = None) -> dict[str, Any]:
    doc = await _get_document(case_id, document_id)
    if not is_text_file(doc["filename"]):
        raise FileChangeError(f"{doc['filename']} isn't a text file, so it can't be edited as text.")
    data = await run_in_threadpool(download_bytes, doc["s3_key"])
    return {**doc, "content": data.decode("utf-8", errors="replace")}


async def replace_document(document_id: UUID, data: bytes, editor: Editor, case_id: UUID | None = None,
                           note: str | None = None, content_type: str | None = None) -> dict[str, Any]:
    """Save new contents for a document as its next version and point the case at it."""
    doc = await _get_document(case_id, document_id)
    key = _next_key(doc["case_id"], doc["s3_key"], doc["filename"])
    ext = os.path.splitext(doc["filename"])[1].lower()
    await run_in_threadpool(upload_bytes, data, key, content_type or _CONTENT_TYPES.get(ext))
    row = await get_pool().fetchrow(
        "UPDATE documents SET s3_key = $2 WHERE id = $1 RETURNING id, case_id, filename, s3_key, uploaded_at", document_id, key
    )
    await log_activity(doc["case_id"], editor, f"{_who(editor)} updated {doc['filename']}" + (f": {note}" if note else ""))
    return dict(row)


async def write_document_text(document_id: UUID, content: str, editor: Editor, case_id: UUID | None = None,
                              note: str | None = None) -> dict[str, Any]:
    doc = await _get_document(case_id, document_id)
    if not is_text_file(doc["filename"]):
        raise FileChangeError(f"{doc['filename']} isn't a text file. Upload a new version of it instead.")
    return await replace_document(document_id, content.encode("utf-8"), editor, case_id, note)


# --- Packet text and summary ----------------------------------------------------------------------------

_text_cache: dict[str, list[str]] = {}


def packet_pages(s3_key: str) -> list[str]:
    """The packet PDF's text, one entry per page. PDFs never change once saved, so this is cached by key."""
    if s3_key not in _text_cache:
        reader = PdfReader(BytesIO(download_bytes(s3_key)))
        _text_cache[s3_key] = [(page.extract_text() or "").strip() for page in reader.pages]
    return _text_cache[s3_key]


_SUMMARY_PROMPT = (
    "Summarize this financial planning packet for the founder and their advisor. Use only facts in the packet. "
    "Write Markdown under 180 words with three short sections: **Overview** (2 sentences), **Key numbers** "
    "(a bullet list), and **Open items** (a bullet list of what is still missing or needs a decision). "
    "No title and no preamble.\n\nPacket text:\n"
)


def _ai_summary(s3_key: str) -> str:
    """Relay's summary of the packet, generated once and stored next to the PDF in S3."""
    summary_key = f"{s3_key}.summary.md"
    if head_object(summary_key):
        return download_bytes(summary_key).decode("utf-8")
    model = (settings.strands_model or "").removeprefix("bedrock/") or "us.anthropic.claude-sonnet-5"
    client = create_aws_session(settings.aws_region, settings.aws_profile).client("bedrock-runtime")
    response = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [{"text": _SUMMARY_PROMPT + "\n\n".join(packet_pages(s3_key))}]}],
        inferenceConfig={"maxTokens": 600},
    )
    text = "".join(block.get("text", "") for block in response["output"]["message"]["content"]).strip()
    upload_bytes(text.encode("utf-8"), summary_key, "text/markdown")
    return text


def _edit_key(s3_key: str) -> str:
    return f"{s3_key}.summary.edited.json"


def packet_summary(s3_key: str) -> dict[str, Any]:
    """The edited summary if someone changed it, otherwise Relay's."""
    if head_object(_edit_key(s3_key)):
        edit = json.loads(download_bytes(_edit_key(s3_key)))
        return {"summary": edit["text"], "edited_by": edit["edited_by"], "edited_at": edit["edited_at"]}
    return {"summary": _ai_summary(s3_key), "edited_by": None, "edited_at": None}


async def edit_packet_summary(case_id: UUID, packet: dict[str, Any], text: str, editor_name: str, editor: Editor) -> dict[str, Any]:
    edit = {"text": text.strip(), "edited_by": editor_name, "edited_at": datetime.now(timezone.utc).isoformat()}
    await run_in_threadpool(upload_bytes, json.dumps(edit).encode("utf-8"), _edit_key(packet["s3_key"]), "application/json")
    await log_activity(case_id, editor, f"{_who(editor)} edited the summary of packet v{packet['version']}")
    return {"summary": edit["text"], "edited_by": edit["edited_by"], "edited_at": edit["edited_at"]}


async def revert_packet_summary(case_id: UUID, packet: dict[str, Any], editor: Editor) -> dict[str, Any]:
    await run_in_threadpool(delete_object, _edit_key(packet["s3_key"]))
    await log_activity(case_id, editor, f"{_who(editor)} restored Relay's summary of packet v{packet['version']}")
    return await run_in_threadpool(packet_summary, packet["s3_key"])


_CHANGES_PROMPT = (
    "Compare two versions of a financial planning packet. List what changed from the earlier version to the later one "
    "as 2 to 6 short Markdown bullets, most important first. Mention only real content changes (numbers, ownership, "
    "priorities, documents, questions), not wording or layout. If nothing meaningful changed, write a single bullet "
    "saying so. No heading and no preamble."
)


def packet_changes(previous_key: str, current_key: str) -> str:
    """Relay's list of what changed between two packet versions, generated once and stored next to the newer PDF."""
    changes_key = f"{current_key}.changes.md"
    if head_object(changes_key):
        return download_bytes(changes_key).decode("utf-8")
    before, after = "\n\n".join(packet_pages(previous_key)), "\n\n".join(packet_pages(current_key))
    model = (settings.strands_model or "").removeprefix("bedrock/") or "us.anthropic.claude-sonnet-5"
    client = create_aws_session(settings.aws_region, settings.aws_profile).client("bedrock-runtime")
    response = client.converse(
        modelId=model,
        messages=[{"role": "user", "content": [{"text": f"{_CHANGES_PROMPT}\n\nEarlier version:\n{before}\n\nLater version:\n{after}"}]}],
        inferenceConfig={"maxTokens": 400},
    )
    text = "".join(block.get("text", "") for block in response["output"]["message"]["content"]).strip()
    upload_bytes(text.encode("utf-8"), changes_key, "text/markdown")
    return text


# --- New packet versions --------------------------------------------------------------------------------

_styles = getSampleStyleSheet()
_NAVY = colors.HexColor("#00205B")
_H1 = ParagraphStyle("p_h1", parent=_styles["Title"], alignment=0, textColor=_NAVY, fontSize=22, leading=26, spaceAfter=4)
_H2 = ParagraphStyle("p_h2", parent=_styles["Heading2"], textColor=_NAVY, fontSize=14, leading=18, spaceBefore=12, spaceAfter=6)
_BODY = ParagraphStyle("p_body", parent=_styles["Normal"], fontSize=10.5, leading=15, spaceAfter=6)
_BULLET = ParagraphStyle("p_bullet", parent=_BODY, leftIndent=14, bulletIndent=2, spaceAfter=3)
_MUTED = colors.HexColor("#5B6B86")


def _inline(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


def markdown_to_pdf(markdown: str, footer: str) -> bytes:
    """A plain, readable PDF from simple Markdown: # headings, - bullets, **bold** and paragraphs."""
    story: list[Any] = []
    for raw in markdown.splitlines():
        line = raw.rstrip()
        if not line.strip():
            story.append(Spacer(1, 4))
        elif line.startswith("# "):
            story.append(Paragraph(_inline(line[2:]), _H1))
        elif re.match(r"^#{2,6} ", line):
            story.append(Paragraph(_inline(line.lstrip("#").strip()), _H2))
        elif re.match(r"^\s*[-*•] ", line):
            story.append(Paragraph(_inline(re.sub(r"^\s*[-*•] ", "", line)), _BULLET, bulletText="•"))
        else:
            story.append(Paragraph(_inline(line), _BODY))

    def draw_footer(canvas, doc) -> None:  # noqa: ANN001 - reportlab callback signature
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(_MUTED)
        canvas.drawString(inch, 0.6 * inch, footer)
        canvas.drawRightString(LETTER[0] - inch, 0.6 * inch, f"Page {doc.page}")
        canvas.restoreState()

    out = BytesIO()
    SimpleDocTemplate(out, pagesize=LETTER, leftMargin=inch, rightMargin=inch, topMargin=0.9 * inch,
                      bottomMargin=0.9 * inch).build(story or [Paragraph(" ", _BODY)], onFirstPage=draw_footer, onLaterPages=draw_footer)
    return out.getvalue()


async def add_packet_version(case_id: UUID, pdf: bytes, editor: Editor, note: str | None = None) -> dict[str, Any]:
    """Save a PDF as the case's next packet version, ready for the advisor's review."""
    if not pdf.startswith(b"%PDF"):
        raise FileChangeError("A packet version has to be a PDF.")
    key = build_key(case_id, uuid.uuid4(), "packet.pdf")
    await run_in_threadpool(upload_bytes, pdf, key, "application/pdf")
    packet = await packet_store.create_packet(case_id, key, change_note=note, created_by=_who(editor))
    await log_activity(case_id, editor, f"{_who(editor)} created packet v{packet['version']}" + (f": {note}" if note else ""))
    return packet


async def revise_packet(case_id: UUID, markdown: str, editor: Editor, note: str | None = None) -> dict[str, Any]:
    latest = (await packet_store.list_packets(case_id))
    version = (latest[0]["version"] + 1) if latest else 1
    footer = f"Founder planning packet v{version} · Revised by {_who(editor)} · Fictional demo data, not financial advice"
    pdf = await run_in_threadpool(markdown_to_pdf, markdown, footer)
    return await add_packet_version(case_id, pdf, editor, note)
