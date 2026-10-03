"""Deterministic case task reconciliation. Agents cannot complete these tasks."""

from __future__ import annotations

from typing import Any

from .schemas import FIELDS


LABELS = {
    "company_name": "company name", "founder_name": "founder name",
    "business_summary": "business summary", "annual_revenue": "annual revenue",
    "cash_reserve": "cash reserve", "period": "reporting period",
}


def reconcile_tasks(state: dict[str, Any]) -> None:
    """Keep identities stable and derive completion from saved case state."""
    tasks = state.setdefault("tasks", [])
    legacy = [task for task in tasks if not task.get("key")]
    if legacy:
        state.setdefault("legacy_tasks", []).extend(legacy)
        state["tasks"] = [task for task in tasks if task.get("key")]
        tasks = state["tasks"]
    by_key = {task.get("key"): task for task in tasks if task.get("key")}

    def task_id(key: str) -> str:
        return f"task:{state['id']}:{key}"

    def upsert(key: str, title: str, party: str, condition: str,
               rule: dict[str, Any], dependencies: list[str], status: str,
               reason: str | None = None,
               job_id: str | None = None) -> None:
        task = by_key.get(key)
        if task is None:
            task = {"id": task_id(key), "key": key,
                    "order": len(tasks) + 1, "job_id": job_id, "detail": None}
            tasks.append(task)
            by_key[key] = task
        task.update(title=title, responsible_party=party,
                    completion_condition=condition, completion_rule=rule,
                    dependencies=[task_id(dependency) for dependency in dependencies],
                    state=status, blocking_reason=reason)
        if job_id is not None:
            task["job_id"] = job_id
        task["detail"] = reason

    if state["sources"] or state["jobs"]:
        latest = state["jobs"][-1] if state["jobs"] else None
        status = "Pending"
        reason = None
        if latest:
            status = {"queued": "Pending", "working": "In progress",
                      "blocked": "Blocked"}.get(latest["status"], "Done")
            if latest["status"] == "blocked":
                reason = latest.get("error") or "Analysis failed"
        if state.get("analysis_required") and status == "Done":
            status = "Pending"
        unreadable = [s for s in state["sources"]
                      if s.get("extraction_status", "ready") != "ready"]
        if unreadable:
            status, reason = "Blocked", "A source cannot be read; provide a supported readable file."
        if not latest and any(s.get("interpretation_status") == "awaiting_model"
                              for s in state["sources"]):
            status, reason = "Blocked", "AI interpretation is not configured."
        upsert("analysis", "Read sources and check evidence", "Relay",
               "All readable sources have been interpreted with validated citations.",
               {"kind": "sources_interpreted"}, [], status, reason,
               latest["id"] if latest else None)

    for source in state["sources"]:
        source_key = f"source:{source['id']}"
        readable = source.get("extraction_status", "ready") == "ready"
        upsert(source_key, f"Read {source['name']}", "Relay",
               "The stored original has readable, page-linked excerpts.",
               {"kind": "source_readable", "source_id": source["id"]}, [],
               "Done" if readable else "Blocked",
               None if readable else source.get("status_detail") or "This source cannot be read.")
        if source.get("relationship_suggestion") or source.get("relationship"):
            resolved = bool(source.get("relationship"))
            upsert(f"relationship:{source['id']}",
                   f"Confirm relationship for {source['name']}", "founder",
                   "Founder explicitly accepts a revision or marks the sources separate.",
                   {"kind": "source_relationship_confirmed", "source_id": source["id"]},
                   [source_key], "Done" if resolved else "Pending",
                   None if resolved else "Confirm whether this source revises the earlier original.")

    if state["sources"] or state["jobs"] or any(
        fact["state"] != "unknown" for fact in state["facts"].values()
    ):
        for field in FIELDS:
            fact = state["facts"][field]
            kind = fact["state"]
            if kind == "confirmed":
                status, reason = "Done", None
            elif kind == "conflicting":
                status, reason = "Blocked", "Conflicting source values need founder confirmation."
            elif kind == "unknown":
                status, reason = "Blocked", "This value is missing; ask the founder."
            else:
                status, reason = "Pending", "Review the cited candidate and confirm it."
            verb = "Provide" if kind == "unknown" else "Resolve" if kind == "conflicting" else "Confirm"
            title = f"{verb} {LABELS[field]}"
            upsert(f"fact:{field}", title, "founder",
                   f"Founder confirms {field} against retained source evidence.",
                   {"kind": "fact_confirmed", "field": field},
                   ["analysis"] if "analysis" in by_key else [], status, reason)

        confirmed = all(fact["state"] == "confirmed" for fact in state["facts"].values())
        current = next((p for p in state["packets"]
                        if p["id"] == state["current_packet_id"]), None)
        matches = bool(current and confirmed and not state["analysis_required"] and
                       not state.get("packet_error") and
                       all(current["fields"].get(name) == state["facts"][name]["value"]
                           for name in FIELDS))
        preview = next((action for action in reversed(state.get("pdf_actions", []))
                        if action["status"] == "pending" and
                        action.get("created_revision") == state["revision"] + 1 and
                        action.get("current_packet_id") == state["current_packet_id"] and
                        action.get("verification", {}).get("passed") is True), None)
        if preview:
            upsert("packet", "Review verified PDF preview", "founder",
                   "Founder confirms the exact verified preview hash before an immutable version is saved.",
                   {"kind": "verified_preview_confirmed", "action_id": preview["id"]},
                   ["analysis"] if "analysis" in by_key else [], "Pending",
                   "Preview the PDF and confirm its exact version to save it.")
        else:
            upsert("packet", "Review and save packet", "founder",
                   "A verified PDF with the confirmed current fields is saved as a new immutable version.",
                   {"kind": "current_packet_matches_confirmed_facts"},
                   [f"fact:{field}" for field in FIELDS],
                   "Done" if matches else "Blocked" if state.get("packet_error") else
                   "Pending" if confirmed and not state["analysis_required"]
                   else "Blocked", None if matches else
                   state.get("packet_error") if state.get("packet_error") else
                   "Confirm current facts and finish source analysis first." if not confirmed or state["analysis_required"]
                   else "Preview and confirm the verified PDF.")
