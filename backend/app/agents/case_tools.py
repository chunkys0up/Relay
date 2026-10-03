"""Tools that let the chat agent maintain the founder's case checklist and activity feed.

The case comes from the request's invocation_state, so one cached agent never writes to another case.
"""

from __future__ import annotations

from uuid import UUID

from strands import tool
from strands.types.tools import ToolContext

from app.db import case_records
from app.db.case_records import CHECKLIST_STATES

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


CASE_TOOLS = [list_checklist, add_checklist_item, update_checklist_item, log_activity]

INSTRUCTIONS = """You are Relay, helping a startup founder prepare a financial planning packet for their advisor.

You keep the founder's case checklist and activity feed up to date with your tools:
- When the founder needs to provide, decide or do something for the packet, or you spot something missing, add it to the checklist. Call list_checklist first so you don't add duplicates. Use short imperative titles, and write any detail to the founder as "you".
- When the founder provides or completes something on the checklist, mark that item done.
- Checklist changes appear in the founder's activity feed automatically. Use log_activity only for other meaningful work, such as reviewing an attached document.
Mention checklist changes briefly in your reply, but never name the tools themselves. Keep replies concise."""
