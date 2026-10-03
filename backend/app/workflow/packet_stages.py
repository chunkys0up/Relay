"""Durable packet stage transitions for the local workflow."""

from __future__ import annotations

import hashlib
from io import BytesIO
from typing import Any

from pypdf import PdfReader

from .repository import Repository, WorkflowError
from .service import now, uid


STAGES = ("draft", "in_review", "questions_returned", "approved")


def validate_pdf(data: bytes) -> int:
    if not data.startswith(b"%PDF-") or not data or len(data) > 10 * 1024 * 1024:
        raise WorkflowError("INVALID_PDF", 422)
    try:
        reader = PdfReader(BytesIO(data), strict=True)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 30:
            raise ValueError("Unsupported PDF")
        for page in reader.pages:
            _ = page.mediabox
    except Exception as exc:
        raise WorkflowError("INVALID_PDF", 422) from exc
    return len(reader.pages)


def import_packet(
    repo: Repository, owner: str, case_id: str, expected_revision: int,
    key: str, filename: str, data: bytes,
) -> dict[str, Any]:
    pages = validate_pdf(data)
    digest = hashlib.sha256(data).hexdigest()
    request = {"expected_revision": expected_revision, "filename": filename, "hash": digest}
    prior = repo.replay(owner, case_id, "import_packet", key, request)
    if prior is not None:
        return prior
    packet_id = uid()

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        version = len(state["packets"]) + 1
        packet = {"id": packet_id, "version": version, "hash": digest,
                  "title": filename[:120], "created_at": now(), "kind": "imported",
                  "pages": pages, "fields": {}, "template_id": None,
                  "verification": {"status": "structure_validated", "pages": pages},
                  "stage": "draft", "stage_events": [],
                  "cloud": {"status": "unconfigured"}}
        state["packets"].append(packet)
        state["current_packet_id"] = packet_id
        state["status"] = "Draft ready"
        state["activity"] = f"Imported packet v{version} is ready for review."
        return ({"packet_id": packet_id, "version": version, "hash": digest},
                [(packet_id, "packet", data)])

    return repo.mutate(owner, case_id, "import_packet", key, request,
                       expected_revision, change)


def transition_packet(
    repo: Repository, owner: str, case_id: str, packet_id: str,
    expected_revision: int, packet_hash: str, target_stage: str, key: str,
    *, synthetic_example: bool = False,
) -> dict[str, Any]:
    request = {"expected_revision": expected_revision, "packet_id": packet_id,
               "packet_hash": packet_hash, "target_stage": target_stage,
               "synthetic_example": synthetic_example}

    def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
        packet = next((p for p in state["packets"] if p["id"] == packet_id), None)
        if packet is None:
            raise WorkflowError("NOT_FOUND", 404)
        if state.get("current_packet_id") != packet_id:
            raise WorkflowError("HISTORICAL_PACKET")
        if packet["hash"] != packet_hash:
            raise WorkflowError("STALE_PACKET_HASH")
        current = packet.get("stage", "draft")
        if synthetic_example:
            permitted = {("draft", "in_review"), ("in_review", "questions_returned"),
                         ("questions_returned", "in_review"), ("in_review", "approved")}
        else:
            permitted = {("draft", "in_review"), ("questions_returned", "in_review")}
        if (current, target_stage) not in permitted:
            raise WorkflowError("INVALID_STAGE_TRANSITION")
        if synthetic_example and not state.get("synthetic_example"):
            raise WorkflowError("EXAMPLE_ONLY", 403)
        if not synthetic_example and state.get("synthetic_example"):
            actor = "example_founder"
        else:
            actor = "synthetic_example" if synthetic_example else "founder"
        event = {"id": uid(), "from_stage": current, "to_stage": target_stage,
                 "actor": actor, "action": "submitted_for_review" if target_stage == "in_review"
                 else "example_questions_returned" if target_stage == "questions_returned"
                 else "example_approved", "at": now(), "packet_hash": packet_hash,
                 "synthetic_example": bool(state.get("synthetic_example"))}
        packet.setdefault("stage_events", []).append(event)
        packet["stage"] = target_stage
        if state.get("synthetic_example"):
            for task in state.get("tasks", []):
                if task.get("key") == "example_review":
                    task["state"] = {"draft": "Pending", "in_review": "In progress",
                                     "questions_returned": "Blocked", "approved": "Done"}[target_stage]
        state["status"] = target_stage.replace("_", " ").capitalize()
        state["activity"] = "Example stage recorded." if state.get("synthetic_example") else "Packet submitted for review."
        return {"packet_id": packet_id, "hash": packet_hash, "stage": target_stage,
                "event": event}, []

    return repo.mutate(owner, case_id, "packet_stage", key, request,
                       expected_revision, change)
