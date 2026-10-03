"""Put the Northstar demo case back to a clean starting point, ready to show packet v1 -> v2 live.

After this: no chats; packet v1 is in review with no advisor decision and Relay's own summary;
later packet versions are gone; the checklist has one item done; the activity feed is a short history.
Uploaded files are kept. Re-run it before every demo.

Run from backend/:  uv run python -m scripts.reset_demo
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from uuid import UUID

from app.db.pool import close_pool, get_pool, init_pool
from app.storage.s3 import delete_object, head_object

CASE = UUID("22222222-2222-2222-2222-222222222222")
DONE_ITEM = "Upload Articles of Incorporation/Organization"
# The checklist the demo starts from; anything Relay added during a run is removed.
CHECKLIST = [
    DONE_ITEM, "Upload EIN confirmation letter", "Provide current cap table",
    "Upload founders' agreement", "Upload IP assignment agreements", "Upload bylaws or operating agreement",
]


async def main() -> None:
    await init_pool()
    pool = get_pool()
    try:
        async with pool.acquire() as conn, conn.transaction():
            chats = await conn.execute("DELETE FROM conversations WHERE case_id = $1", CASE)
            await conn.execute("DELETE FROM messages WHERE case_id = $1", CASE)

            # Packet v1 only, in review, no decisions.
            v1 = await conn.fetchrow("SELECT id, s3_key, created_at FROM drafts WHERE case_id = $1 AND version = 1", CASE)
            if v1 is None:
                raise SystemExit("No packet v1. Create it first: uv run python -m scripts.create_demo_packet")
            later = await conn.fetch("DELETE FROM drafts WHERE case_id = $1 AND version > 1 RETURNING version", CASE)
            await conn.execute("DELETE FROM advisor_actions WHERE case_id = $1", CASE)
            await conn.execute(
                "UPDATE drafts SET status = 'in_review', change_note = 'First version, prepared from the founder''s documents', "
                "created_by = 'Relay' WHERE id = $1",
                v1["id"],
            )

            # Checklist: the original items only; the Articles are in, everything else is still to do.
            await conn.execute("DELETE FROM checklist_items WHERE case_id = $1 AND NOT (title = ANY($2::text[]))", CASE, CHECKLIST)
            await conn.execute(
                "UPDATE checklist_items SET state = CASE WHEN title = $2 THEN 'done' ELSE 'todo' END, updated_at = now() "
                "WHERE case_id = $1",
                CASE, DONE_ITEM,
            )
            items = await conn.fetch("SELECT title, state FROM checklist_items WHERE case_id = $1 ORDER BY position", CASE)
            docs = await conn.fetch("SELECT filename, uploaded_at FROM documents WHERE case_id = $1 ORDER BY uploaded_at", CASE)

            # A short, believable history leading up to packet v1.
            await conn.execute("DELETE FROM case_activity WHERE case_id = $1", CASE)
            start = (docs[0]["uploaded_at"] if docs else v1["created_at"]) - timedelta(hours=2)
            history: list[tuple[str, str, object]] = [
                ("agent", f"Added to checklist: {item['title']}", start + timedelta(minutes=i)) for i, item in enumerate(items)
            ]
            history += [("founder", f"Uploaded {doc['filename']}", doc["uploaded_at"]) for doc in docs]
            history.append(("founder", f"Completed: {DONE_ITEM}", start + timedelta(minutes=30)))
            history.append(("agent", "Prepared planning packet v1 for advisor review", v1["created_at"]))
            await conn.executemany(
                "INSERT INTO case_activity (case_id, actor, text, created_at) VALUES ($1, $2, $3, $4)",
                [(CASE, actor, text, at) for actor, text, at in history],
            )

        # Relay's own summary for v1, not an edited one.
        edited = f"{v1['s3_key']}.summary.edited.json"
        if head_object(edited):
            delete_object(edited)

        print(f"Removed {chats.split()[-1]} chats and packet versions {[r['version'] for r in later] or 'none'} after v1.")
        print("Packet v1: in review, no decision, Relay's summary.")
        print("Checklist:", ", ".join(f"{i['title']} ({i['state']})" for i in items))
        print(f"Activity: {len(history)} entries. Files kept: {len(docs)}.")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
