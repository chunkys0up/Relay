"""Tools that let the chat agent maintain the founder's case checklist and activity feed, and read and edit the case's files.

The case comes from the request's invocation_state, so one cached agent never writes to another case.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from starlette.concurrency import run_in_threadpool
from strands import tool
from strands.types.tools import ToolContext

from app.agents.attachments import UnreadableFile, load_file_block
from app.db import case_records
from app.db import packets as packet_store
from app.db.case_records import CHECKLIST_STATES
from app.services import case_files

NO_CASE = "No case is linked to this conversation, so the checklist can't be changed."


def _case_id(tool_context: ToolContext) -> UUID | None:
    value = tool_context.invocation_state.get("case_id")
    return UUID(str(value)) if value else None


@tool(context=True)
async def list_checklist(tool_context: ToolContext) -> str:
    """List the founder's case checklist with each item's id, state and title. Check it before adding items to avoid duplicates."""
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    items = await case_records.list_checklist(case_id)
    if not items:
        return "The checklist is empty."
    return "\n".join(f"{item['id']} | {item['state']} | {item['title']}" + (f" ({item['detail']})" if item["detail"] else "") for item in items)


@tool(context=True)
async def add_checklist_item(title: str, tool_context: ToolContext, detail: str = "") -> str:
    """Add an item to the founder's case checklist.

    Args:
        title: Short imperative task, e.g. "Upload the 2025 balance sheet".
        detail: Optional one-sentence context on why it's needed.
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    item = await case_records.add_checklist_item(case_id, title.strip()[:200], detail.strip()[:500] or None, "agent")
    return f"Added checklist item {item['id']}: {item['title']}"


@tool(context=True)
async def update_checklist_item(item_id: str, state: str, tool_context: ToolContext, detail: str = "") -> str:
    """Change a checklist item's state, e.g. mark it done once the founder provides what it asked for.

    Args:
        item_id: The item id from list_checklist.
        state: One of todo, in_progress, blocked, done.
        detail: Optional replacement one-sentence context.
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    if state not in CHECKLIST_STATES:
        return f"Unknown state {state!r}. Use one of: {', '.join(CHECKLIST_STATES)}."
    try:
        parsed_id = UUID(item_id)
    except ValueError:
        return f"{item_id!r} is not a checklist item id. Call list_checklist to get ids."
    item = await case_records.update_checklist_item(case_id, parsed_id, "agent", state=state, detail=detail.strip()[:500] or None)  # type: ignore[arg-type]
    if item is None:
        return f"No checklist item {item_id} in this case."
    return f"Checklist item {item['id']} is now {item['state']}: {item['title']}"


@tool(context=True)
async def log_activity(text: str, tool_context: ToolContext) -> str:
    """Record a one-line note in the founder's activity feed after meaningful work other than checklist changes,
    e.g. "Reviewed the uploaded P&L". Checklist changes are already logged automatically; don't log them again.

    Args:
        text: The note, in past tense, under 120 characters.
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    await case_records.log_activity(case_id, "agent", text.strip()[:200])
    return "Logged."


@tool(context=True)
async def list_case_documents(tool_context: ToolContext) -> str:
    """List the files the founder has uploaded to this case, with each file's id and upload date."""
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    documents = await case_records.list_case_documents(case_id)
    if not documents:
        return "The founder hasn't uploaded any files yet."
    return "\n".join(f"{doc['id']} | {doc['filename']} | uploaded {doc['uploaded_at']:%Y-%m-%d}" for doc in documents)


@tool(context=True)
async def read_case_document(document_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read the contents of one of the founder's uploaded files, so you can answer questions about it.

    Args:
        document_id: The file id from list_case_documents.
    """
    def error(text: str) -> dict[str, Any]:
        return {"status": "error", "content": [{"text": text}]}

    case_id = _case_id(tool_context)
    if case_id is None:
        return error(NO_CASE)
    try:
        parsed_id = UUID(document_id)
    except ValueError:
        return error(f"{document_id!r} is not a file id. Call list_case_documents to get ids.")
    doc = await case_records.get_case_document(case_id, parsed_id)
    if doc is None:
        return error(f"No file {document_id} in this case.")
    try:
        block = await load_file_block(doc["filename"], doc["s3_key"])
    except UnreadableFile as exc:
        return error(str(exc))
    return {"status": "success", "content": [{"text": f"Contents of {doc['filename']}:"}, block]}


def _file_id(document_id: str) -> UUID | None:
    try:
        return UUID(document_id)
    except ValueError:
        return None


@tool(context=True)
async def read_packet(tool_context: ToolContext) -> str:
    """Read the case's latest planning packet: its version, review status, the advisor's notes, its current summary,
    and the full text of the packet PDF. Read it before changing the packet or its summary."""
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    packets = await packet_store.list_packets(case_id)
    if not packets:
        return "This case has no planning packet yet."
    latest = packets[0]
    summary = await run_in_threadpool(case_files.packet_summary, latest["s3_key"])
    pages = await run_in_threadpool(case_files.packet_pages, latest["s3_key"])
    review = f"Advisor decision: {latest['review_decision']}" + (f" — {latest['review_notes']}" if latest["review_notes"] else "") if latest["review_decision"] else "No advisor decision yet."
    return (
        f"Packet v{latest['version']} (status: {latest['status']}). {review}\n\n"
        f"Current summary ({'edited by ' + summary['edited_by'] if summary['edited_by'] else 'written by Relay'}):\n{summary['summary']}\n\n"
        "Packet text:\n" + "\n\n".join(f"[Page {i + 1}]\n{page}" for i, page in enumerate(pages))
    )


@tool(context=True)
async def update_text_document(document_id: str, new_content: str, change_note: str, tool_context: ToolContext) -> str:
    """Replace the full contents of one of the case's text files (Markdown, plain text, CSV, JSON or HTML).
    The previous version is kept. Only use this when the user asks you to change the file.

    Args:
        document_id: The file id from list_case_documents.
        new_content: The complete new contents of the file, not just the changed part.
        change_note: A short past-tense note on what changed, e.g. "Corrected the 2026 revenue forecast".
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    parsed_id = _file_id(document_id)
    if parsed_id is None:
        return f"{document_id!r} is not a file id. Call list_case_documents to get ids."
    try:
        doc = await case_files.write_document_text(parsed_id, new_content, "agent", case_id, change_note.strip()[:160] or None)
    except case_files.FileChangeError as exc:
        return str(exc)
    return f"Saved a new version of {doc['filename']}."


@tool(context=True)
async def update_packet_summary(new_summary: str, tool_context: ToolContext) -> str:
    """Replace the summary shown with the latest planning packet. Relay's original summary is kept so people can revert.
    Write Markdown with **Overview**, **Key numbers** and **Open items** sections, under 200 words.

    Args:
        new_summary: The complete new summary in Markdown.
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    packets = await packet_store.list_packets(case_id)
    if not packets:
        return "This case has no planning packet yet."
    await case_files.edit_packet_summary(case_id, packets[0], new_summary, "Relay assistant", "agent")
    return f"Updated the summary of packet v{packets[0]['version']}."


@tool(context=True)
async def revise_packet(content_markdown: str, change_note: str, tool_context: ToolContext) -> str:
    """Create the next version of the planning packet PDF from complete revised content. Earlier versions are kept,
    and the new version goes to the advisor for review. Call read_packet first and keep everything that isn't changing.

    Args:
        content_markdown: The whole revised packet in Markdown: a "# Company name" title, "## " section headings,
            "- " bullets and **bold**. Write tables as bullet lists.
        change_note: A short past-tense note on what changed, e.g. "Raised the reserve target to 12 months".
    """
    case_id = _case_id(tool_context)
    if case_id is None:
        return NO_CASE
    try:
        packet = await case_files.revise_packet(case_id, content_markdown, "agent", change_note.strip()[:160] or None)
    except case_files.FileChangeError as exc:
        return str(exc)
    return f"Created packet v{packet['version']}. It's waiting for the advisor's review."


CASE_TOOLS = [
    list_checklist, add_checklist_item, update_checklist_item, log_activity, list_case_documents, read_case_document,
    read_packet, update_text_document, update_packet_summary, revise_packet,
]

_EDITING = """
You can also change the case's files, but only when the user asks you to:
- Text files (Markdown, plain text, CSV, JSON, HTML): read the file first, then save the complete new contents. Other files, such as PDFs, can't be edited this way; tell the user to upload a new version instead.
- The packet summary: read the packet first, then write the full new summary.
- The planning packet itself: read the packet first, then create a new version with the complete revised content, keeping everything that isn't changing. The new version goes to the advisor for review.
Earlier versions are always kept. After changing a file, say in one line what you changed."""

INSTRUCTIONS = """You are Relay, helping a startup founder prepare a financial planning packet for their advisor.

You keep the founder's case checklist and activity feed up to date with your tools:
- When the founder needs to provide, decide or do something for the packet, or you spot something missing, add it to the checklist. Call list_checklist first so you don't add duplicates. Use short imperative titles, and write any detail to the founder as "you".
- When the founder provides or completes something on the checklist, mark that item done.
- Checklist changes appear in the founder's activity feed automatically. Use log_activity only for other meaningful work, such as reviewing a document.
- You can read the files the founder has uploaded to the case. When they ask about their documents, or a question depends on a file's contents, call list_case_documents and then read_case_document. Never ask them to re-upload a file that's already in the case. When an uploaded file covers a checklist item, mark it done.
In your reply, briefly mention checklist changes you actually made. Don't narrate checks that changed nothing, or your own process, and never name the tools. Keep replies concise.""" + _EDITING

ADVISOR_INSTRUCTIONS = """You are Relay, helping a financial advisor review a startup founder's planning packet.

You can list and read the files the founder has uploaded to the case, read the planning packet, and see the case checklist. Use them to answer the advisor's questions accurately. Only change the checklist or log activity when the advisor asks you to. Never name the tools themselves. Keep replies concise.""" + _EDITING
