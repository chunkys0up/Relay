from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from .model import ModelFailure, ProposalProvider, validated_proposals
from .repository import Repository, WorkflowError
from .schemas import FIELDS, ConfirmInput
from .tasking import reconcile_tasks


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid.uuid4())


def empty_fact() -> dict[str, Any]:
    return {"state": "unknown", "value": None, "candidates": [], "confirmed_by": None,
            "confirmation_message_id": None, "accepted_value": None,
            "acceptance_history": []}


def normalized_source_name(filename: str) -> str:
    """Recognize a suggested revision without treating a filename as authority."""
    stem = filename.rsplit(".", 1)[0].casefold()
    return re.sub(r"(?:[-_ ](?:revised|revision|updated|rev\d*|v\d+))+$", "", stem)


class WorkflowService:
    def __init__(self, repository: Repository, provider: ProposalProvider | None) -> None:
        self.repo = repository
        self.provider = provider

    def create_case(self, owner: str, key: str, company: str, goal: str) -> dict[str, Any]:
        case_id = uid()
        state = {
            "id": case_id, "revision": 0, "company": company, "goal": goal,
            "status": "Information needed", "ui_state": "Idle", "activity": None,
            "created_at": now(), "sources": [], "templates": [],
            "facts": {name: empty_fact() for name in FIELDS},
            "flags": [], "tasks": [], "jobs": [], "packets": [], "messages": [],
            "current_packet_id": None, "analysis_required": False,
        }
        return self.repo.create_case_once(owner, key, {"company": company, "goal": goal},
                                          case_id, state)

    def list_cases(self, owner: str) -> list[dict[str, Any]]:
        return [self._public(state) for state in self.repo.list_cases(owner)]

    def snapshot(self, owner: str, case_id: str) -> dict[str, Any]:
        return self._public(self.repo.get_case(owner, case_id))

    @staticmethod
    def _public(state: dict[str, Any]) -> dict[str, Any]:
        return {**state, "sources": [
            {key: value for key, value in source.items() if key != "excerpts"}
            for source in state["sources"]
        ]}

    def upload_source(
        self, owner: str, case_id: str, expected_revision: int, key: str,
        filename: str, content_type: str, data: bytes, *, analyze: bool = False,
    ) -> dict[str, Any]:
        from .documents import extract_document

        if len(data) > 10 * 1024 * 1024:
            raise WorkflowError("FILE_TOO_LARGE", 413)
        digest = hashlib.sha256(data).hexdigest()
        request = {"expected_revision": expected_revision, "filename": filename,
                   "content_type": content_type, "hash": digest, "analyze": analyze}
        prior = self.repo.replay(owner, case_id, "upload_source", key, request)
        if prior is not None:
            return prior
        source_id = uid()
        failure: str | None = None
        try:
            excerpts = extract_document(data, filename, content_type, source_id)
        except ValueError as exc:
            excerpts = []
            failure = str(exc)[:200]
        source = {
            "id": source_id, "name": filename[:120], "mime_type": content_type,
            "bytes": len(data), "hash": digest, "created_at": now(),
            "excerpt_count": len(excerpts),
            "extraction_status": "ready" if excerpts else
                "unsupported" if "Unsupported" in (failure or "") else "unreadable",
            "interpretation_status": ("pending" if self.provider else "awaiting_model")
                if excerpts else "blocked",
            "status_detail": failure,
        }
        excerpt_rows = [
            {"source_id": e.source_id, "source_hash": e.source_hash,
             "page": e.page, "text": e.text}
            for e in excerpts
        ]

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            duplicate = next((s for s in state["sources"] if s["hash"] == digest), None)
            if duplicate:
                return {"source": {k: v for k, v in duplicate.items() if k != "excerpts"},
                        "duplicate": True, "_no_change": True}, []
            related = next((s for s in reversed(state["sources"])
                            if normalized_source_name(s["name"]) == normalized_source_name(source["name"])), None)
            if related:
                source["relationship_suggestion"] = {
                    "related_source_id": related["id"],
                    "reason": "This has the same filename as an earlier source. Confirm whether it revises that source."}
            state["sources"].append({**source, "excerpts": excerpt_rows})
            if excerpts:
                state["analysis_required"] = True
                state["activity"] = "Source saved; interpretation is pending."
                self._invalidate_pending_previews(state)
            else:
                state["activity"] = "Source saved, but its content cannot be read. Upload a readable text source."
                state["messages"].append({"id": uid(), "author": "Relay", "created_at": now(),
                    "text": "I saved the original, but could not read it: " + (failure or "No readable text")})
            reconcile_tasks(state)
            return {"source": source, "duplicate": False}, [(source_id, "source", data)]

        return self.repo.mutate(owner, case_id, "upload_source", key, request,
                                expected_revision, change)

    @staticmethod
    def _invalidate_pending_previews(state: dict[str, Any]) -> None:
        for action in state.get("pdf_actions", []):
            if action["status"] == "pending":
                action["status"] = "superseded"

    @staticmethod
    def _require_source_coverage(state: dict[str, Any], proposals: list[dict[str, Any]]) -> None:
        cited = {e["source_id"] for proposal in proposals for e in proposal["evidence"]}
        pending = {s["id"] for s in state["sources"]
                   if s.get("extraction_status", "ready") == "ready" and
                   s.get("interpretation_status", "pending") in
                   ("pending", "blocked", "awaiting_model")}
        if not pending <= cited:
            raise ModelFailure("SOURCE_NOT_INTERPRETED")

    def set_source_relationship(
        self, owner: str, case_id: str, source_id: str, related_source_id: str,
        decision: str, expected_revision: int, key: str,
    ) -> dict[str, Any]:
        request = {"source_id": source_id, "related_source_id": related_source_id,
                   "decision": decision, "expected_revision": expected_revision}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            source = next((s for s in state["sources"] if s["id"] == source_id), None)
            related = next((s for s in state["sources"] if s["id"] == related_source_id), None)
            if source is None or related is None or source_id == related_source_id:
                raise WorkflowError("NOT_FOUND", 404)
            if not source.get("relationship_suggestion") or source["relationship_suggestion"]["related_source_id"] != related_source_id:
                raise WorkflowError("RELATIONSHIP_NOT_SUGGESTED")
            if source.get("relationship"):
                raise WorkflowError("RELATIONSHIP_ALREADY_CONFIRMED")
            source["relationship"] = {"related_source_id": related_source_id,
                                      "decision": decision, "confirmed_at": now(),
                                      "confirmed_by": "founder"}
            source.pop("relationship_suggestion", None)
            if decision == "revision":
                self._invalidate_pending_previews(state)
                if source["interpretation_status"] in ("pending", "blocked", "awaiting_model"):
                    state["analysis_required"] = (state["analysis_required"] or
                        source["extraction_status"] == "ready" and
                        source["interpretation_status"] != "blocked")
                state["activity"] = "Revision confirmed. Both originals are retained; check affected facts."
            else:
                state["activity"] = "Sources confirmed as separate originals."
            reconcile_tasks(state)
            return {"source_id": source_id, "related_source_id": related_source_id,
                    "decision": decision}, []

        return self.repo.mutate(owner, case_id, "source_relationship", key,
                                request, expected_revision, change)

    def upload_template(
        self, owner: str, case_id: str, expected_revision: int, key: str,
        filename: str, data: bytes,
    ) -> dict[str, Any]:
        if len(data) > 10 * 1024 * 1024:
            raise WorkflowError("FILE_TOO_LARGE", 413)
        digest = hashlib.sha256(data).hexdigest()
        request = {"expected_revision": expected_revision, "hash": digest, "filename": filename}
        prior = self.repo.replay(owner, case_id, "upload_template", key, request)
        if prior is not None:
            return prior
        try:
            from io import BytesIO
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise ValueError("encrypted")
            fields = reader.get_fields() or {}
            if not fields or any(name not in FIELDS or info.get("/FT") != "/Tx"
                                 for name, info in fields.items()):
                raise ValueError("unsupported fields")
        except Exception as exc:
            raise WorkflowError("INVALID_TEMPLATE", 422) from exc
        template_id = uid()
        template = {"id": template_id, "name": filename[:120], "fields": sorted(fields),
                    "hash": digest, "created_at": now()}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            state["templates"].append(template)
            return {"template": template}, [(template_id, "template", data)]

        return self.repo.mutate(owner, case_id, "upload_template", key, request,
                                expected_revision, change)

    def start_job(
        self, owner: str, case_id: str, expected_revision: int, key: str, goal: str,
        *, author: str = "founder",
    ) -> dict[str, Any]:
        if author not in ("founder", "Relay"):
            raise WorkflowError("INVALID_AUTHOR", 422)
        job_id = uid()
        request = {"expected_revision": expected_revision, "goal": goal, "author": author}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            job = {"id": job_id, "status": "queued", "error": None,
                   "created_at": now(), "started_revision": state["revision"] + 1,
                   "carry_preview_ids": [action["id"] for action in state.get("pdf_actions", [])
                       if action["status"] == "pending" and
                       action.get("created_revision") == state["revision"]]}
            state["jobs"].append(job)
            state["ui_state"] = "Thinking / Working"
            state["activity"] = "Tasks saved; waiting to analyze sources."
            state["goal"] = goal
            message_id = uid()
            state["messages"].append({"id": message_id, "author": author,
                "text": goal, "created_at": now(),
                "hash": hashlib.sha256(goal.encode()).hexdigest()})
            job["goal_message_id"] = message_id
            reconcile_tasks(state)
            return {"job_id": job_id, "status": "queued", "tasks": state["tasks"]}, []

        return self.repo.mutate(owner, case_id, "run", key, request,
                                expected_revision, change)

    def process_job(self, owner: str, case_id: str, job_id: str) -> None:
        state_before = self.repo.get_case(owner, case_id)
        existing = next((job for job in state_before["jobs"] if job["id"] == job_id), None)
        if existing is None or existing["status"] != "queued":
            return
        def working(state: dict[str, Any], job: dict[str, Any]) -> None:
            if job["status"] != "queued":
                raise WorkflowError("INVALID_TRANSITION")
            job["status"] = "working"
            job["work_revision"] = state["revision"] + 1
            state["activity"] = "Reading authorized source excerpts."
            reconcile_tasks(state)

        try:
            self.repo.update_job(owner, case_id, job_id, working)
        except WorkflowError as exc:
            if exc.code == "INVALID_TRANSITION":
                return
            raise
        state = self.repo.get_case(owner, case_id)
        excerpts = [e for s in state["sources"] for e in s["excerpts"]]
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        goal_message = next(m for m in state["messages"] if m["id"] == job["goal_message_id"])
        if goal_message["author"] == "founder":
            excerpts.append({"source_id": goal_message["id"],
                             "source_hash": goal_message["hash"], "page": 1,
                             "text": goal_message["text"]})
        try:
            if len(excerpts) > 50 or any(len(e["text"]) > 1200 for e in excerpts):
                raise ModelFailure("CONTEXT_TOO_LARGE")
            if self.provider is None:
                raise ModelFailure("BEDROCK_NOT_CONFIGURED")
            plan = getattr(self.provider, "plan", None)
            result = (plan(state["goal"], excerpts, self._public(state)) if plan
                      else self.provider.propose(state["goal"], excerpts))
            if getattr(result, "pdf_edit", None) is not None:
                from .actions import stage_edit
                self._require_source_coverage(state,
                    [proposal.model_dump() for proposal in result.pdf_edit.changes])
                planned_revision = state["revision"]
                def verifying(current: dict[str, Any], current_job: dict[str, Any]) -> None:
                    if current["revision"] != planned_revision:
                        raise WorkflowError("STALE_REVISION")
                    current_job["agent_steps"] = result.agent_steps
                    current["activity"] = "Checking the proposed PDF before offering it for review."
                    reconcile_tasks(current)
                state = self.repo.update_job(owner, case_id, job_id, verifying)
                stage_edit(self.repo, owner, state, job_id, result, excerpts,
                           verifier=getattr(self.provider, "verify_pdf", None))
            elif plan and not result.proposals:
                if state["analysis_required"]:
                    raise ModelFailure("NO_CITED_INTERPRETATION")
                def reply_only(current: dict[str, Any], current_job: dict[str, Any]) -> None:
                    if current["revision"] == current_job.get("work_revision"):
                        for action in current.get("pdf_actions", []):
                            if (action["id"] in current_job.get("carry_preview_ids", []) and
                                    action["status"] == "pending" and
                                    action["current_packet_id"] == current["current_packet_id"]):
                                action["created_revision"] = current["revision"] + 1
                    current_job["status"] = "needs_input"
                    current_job["agent_steps"] = result.agent_steps
                    current["ui_state"] = "Needs input"
                    current["activity"] = "Relay replied; no PDF changes saved."
                    current["messages"].append({"id": uid(), "author": "Relay",
                        "text": result.reply or "Please provide more detail.", "created_at": now()})
                    current["analysis_required"] = False
                    reconcile_tasks(current)
                self.repo.update_job(owner, case_id, job_id, reply_only)
            else:
                proposals = validated_proposals(result, excerpts)
                self._require_source_coverage(state, proposals)
                self._finish_job(owner, case_id, job_id, proposals, getattr(result, "reply", None),
                                 result.agent_steps)
        except Exception as exc:
            code = exc.args[0] if isinstance(exc, ModelFailure) and exc.args else "WORKFLOW_FAILED"

            def blocked(state: dict[str, Any], job: dict[str, Any]) -> None:
                self._invalidate_pending_previews(state)
                job["status"] = "blocked"
                job["error"] = code
                state["ui_state"] = "Needs input"
                state["activity"] = "Analysis stopped. Retry the task after checking the source or provider."
                state["messages"].append({"id": uid(), "author": "Relay",
                    "created_at": now(),
                    "text": f"I could not finish analysis ({code}). The source and packet are unchanged; correct the issue and retry."})
                for source in state["sources"]:
                    if source.get("interpretation_status") == "pending":
                        source["interpretation_status"] = "blocked"
                reconcile_tasks(state)

            self.repo.update_job(owner, case_id, job_id, blocked)

    def _finish_job(
        self, owner: str, case_id: str, job_id: str, proposals: list[dict[str, Any]], reply: str | None = None,
        agent_steps: list[dict[str, str]] | None = None,
    ) -> None:
        def finish(state: dict[str, Any], job: dict[str, Any]) -> None:
            if job["status"] != "working":
                raise WorkflowError("INVALID_TRANSITION")
            if proposals:
                self._invalidate_pending_previews(state)
            job["agent_steps"] = agent_steps or []
            grouped: dict[str, list[dict[str, Any]]] = {field: [] for field in FIELDS}
            for proposal in proposals:
                grouped[proposal["field"]].append(proposal)
            flags = []
            for field in FIELDS:
                fact = state["facts"][field]
                candidates = list(fact["candidates"])
                new_candidates: list[dict[str, Any]] = []
                existing = {(p["value"], tuple((e["source_id"], e["source_hash"],
                           e["page"], e["quote"]) for e in p["evidence"]))
                            for p in candidates}
                for proposal in grouped[field]:
                    identity = (proposal["value"], tuple((e["source_id"], e["source_hash"],
                                e["page"], e["quote"]) for e in proposal["evidence"]))
                    if identity not in existing:
                        candidates.append(proposal)
                        new_candidates.append(proposal)
                        existing.add(identity)
                distinct = {p["value"].strip() for p in candidates}
                if fact["state"] == "confirmed":
                    fact["candidates"] = candidates
                    if not any(p["value"].strip() != fact["value"] for p in new_candidates):
                        continue
                    old_value = fact["value"]
                    old_message = next((m for m in state["messages"]
                                        if m["id"] == fact["confirmation_message_id"]), None)
                    if old_message is not None:
                        founder = {"field": field, "value": old_value,
                                   "evidence": [{"source_id": old_message["id"],
                                                 "source_hash": old_message["hash"],
                                                 "page": 1, "quote": old_value}]}
                        if founder not in candidates:
                            candidates.append(founder)
                    distinct.add(old_value)
                fact["candidates"] = candidates
                fact["value"] = sorted(distinct)[0] if len(distinct) == 1 else None
                fact["state"] = ("unknown" if not distinct else "conflicting"
                                 if len(distinct) > 1 else "proposed")
                if fact["state"] in ("unknown", "conflicting"):
                    flags.append({"field": field,
                                  "kind": "missing" if not distinct else "conflict",
                                  "detail": "Founder confirmation required.",
                                  "question": f"What is the {field.replace('_', ' ')}?" if not distinct
                                  else f"Sources disagree about {field.replace('_', ' ')}. Which value should the packet use?"})
            state["flags"] = flags
            state["analysis_required"] = False
            for source in state["sources"]:
                if source.get("extraction_status") == "ready":
                    source["interpretation_status"] = "review_needed" if flags else "interpreted"
            job["status"] = "needs_input"
            state["ui_state"] = "Needs input"
            state["activity"] = "Review and confirm proposed facts before drafting."
            reconcile_tasks(state)
            state["messages"].append({"id": uid(), "author": "Relay",
                "text": reply or (" ".join(f["question"] for f in flags) if flags
                                  else "Review the cited facts and confirm them before drafting."),
                "created_at": now()})

        self.repo.update_job(owner, case_id, job_id, finish)

    def confirm(
        self, owner: str, case_id: str, key: str, values: ConfirmInput,
    ) -> dict[str, Any]:
        from .documents import _validate_packet_fields

        request = values.model_dump()

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            changed_fields = any(
                state["facts"][field]["value"] != value.strip() or
                state["facts"][field]["state"] != "confirmed"
                for field, value in values.values.items()
            )
            for field, value in values.values.items():
                if not value.strip() or len(value) > 1000:
                    raise WorkflowError("INVALID_VALUE", 422)
                try:
                    _validate_packet_fields({field: value}, 1)
                except ValueError as exc:
                    raise WorkflowError("INVALID_VALUE", 422) from exc
                candidates = state["facts"][field]["candidates"]
                cited = {e["source_id"] for p in candidates for e in p["evidence"]}
                acknowledged = set(values.source_acknowledgements.get(field, []))
                if cited != acknowledged:
                    raise WorkflowError("SOURCE_ACKNOWLEDGEMENT_REQUIRED", 409)
            message_id = uid()
            normalized = {field: value.strip() for field, value in values.values.items()}
            text = "\n".join(f"{field}: {value}" for field, value in sorted(normalized.items()))
            state["messages"].append({"id": message_id, "author": "founder",
                "text": text, "values": normalized, "created_at": now(),
                "hash": hashlib.sha256(text.encode()).hexdigest()})
            for field, value in values.values.items():
                fact = state["facts"][field]
                fact["state"] = "confirmed"
                fact["value"] = value.strip()
                fact["confirmed_by"] = "founder"
                fact["confirmation_message_id"] = message_id
                fact["accepted_value"] = value.strip()
                fact.setdefault("acceptance_history", []).append({
                    "value": value.strip(), "message_id": message_id,
                    "accepted_at": now(),
                    "acknowledged_source_ids": sorted(values.source_acknowledgements.get(field, [])),
                })
                fact["candidates"].append({"field": field, "value": value.strip(),
                    "evidence": [{"source_id": message_id,
                                  "source_hash": state["messages"][-1]["hash"],
                                  "page": 1, "quote": f"{field}: {value.strip()}"}]})
            if changed_fields:
                self._invalidate_pending_previews(state)
                state["packet_error"] = None
            state["flags"] = [f for f in state["flags"]
                              if state["facts"][f["field"]]["state"] != "confirmed"]
            state["ui_state"] = "Idle" if all(
                f["state"] == "confirmed" for f in state["facts"].values()
            ) else "Needs input"
            state["activity"] = "Founder confirmation saved."
            reconcile_tasks(state)
            return {"confirmed_fields": sorted(values.values)}, []

        return self.repo.mutate(owner, case_id, "confirm", key, request,
                                values.expected_revision, change)

    def create_packet(
        self, owner: str, case_id: str, expected_revision: int, key: str,
        template_id: str | None,
    ) -> dict[str, Any]:
        from .documents import fill_pdf_form, generate_packet_pdf
        from .actions import verify_rendered_pdf

        request = {"expected_revision": expected_revision, "template_id": template_id}
        prior = self.repo.replay(owner, case_id, "packet", key, request)
        if prior is not None:
            return prior
        state = self.repo.get_case(owner, case_id)
        if any(j["status"] in ("queued", "working") for j in state["jobs"]):
            raise WorkflowError("JOB_IN_PROGRESS")
        if state["revision"] != expected_revision:
            raise WorkflowError("STALE_REVISION")
        if any(f["state"] != "confirmed" for f in state["facts"].values()):
            raise WorkflowError("CONFIRMATION_REQUIRED")
        if state["analysis_required"]:
            raise WorkflowError("ANALYSIS_REQUIRED")
        fields = {name: state["facts"][name]["value"] for name in FIELDS}
        version = len(state["packets"]) + 1
        template_fields = None
        try:
            if template_id:
                template = next((t for t in state["templates"] if t["id"] == template_id), None)
                if template is None:
                    raise WorkflowError("NOT_FOUND", 404)
                template_fields = template["fields"]
                source = self.repo.blob(owner, case_id, template_id, "template")
                pdf = fill_pdf_form(source, {k: fields[k] for k in template["fields"]})
            else:
                pdf = generate_packet_pdf(fields, version)
        except ValueError as exc:
            self._record_packet_failure(owner, case_id, expected_revision,
                                        key, "PACKET_GENERATION_FAILED")
            raise WorkflowError("PACKET_GENERATION_FAILED", 422) from exc
        try:
            verification = verify_rendered_pdf(pdf, fields, template_fields,
                getattr(self.provider, "verify_pdf", None))
        except ModelFailure as exc:
            self._record_packet_failure(owner, case_id, expected_revision,
                                        key, "PDF_VERIFICATION_FAILED")
            raise WorkflowError("PDF_VERIFICATION_FAILED", 422) from exc
        packet_id = uid()
        packet = {"id": packet_id, "version": version,
                  "hash": hashlib.sha256(pdf).hexdigest(), "created_at": now(),
                  "fields": fields, "template_id": template_id, "verification": verification}
        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(f["state"] != "confirmed" for f in state["facts"].values()):
                raise WorkflowError("CONFIRMATION_REQUIRED")
            if state["analysis_required"]:
                raise WorkflowError("ANALYSIS_REQUIRED")
            if len(state["packets"]) + 1 != version:
                raise WorkflowError("STALE_PACKET")
            state["packets"].append(packet)
            state["packet_error"] = None
            state["current_packet_id"] = packet_id
            state["status"] = "Draft ready"
            state["ui_state"] = "Idle"
            state["activity"] = f"Packet v{version} is ready for founder review."
            reconcile_tasks(state)
            return {"packet_id": packet_id, "version": version,
                    "hash": packet["hash"]}, [(packet_id, "packet", pdf)]

        return self.repo.mutate(owner, case_id, "packet", key, request,
                                expected_revision, change)

    def _record_packet_failure(
        self, owner: str, case_id: str, expected_revision: int,
        key: str, code: str,
    ) -> None:
        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            state["packet_error"] = code
            state["activity"] = "Packet generation stopped; review the confirmed fields and retry."
            state["ui_state"] = "Needs input"
            state["messages"].append({"id": uid(), "author": "Relay", "created_at": now(),
                "text": f"I could not create the packet: {code}. Check the confirmed values and try again."})
            reconcile_tasks(state)
            return {"error": code}, []

        try:
            self.repo.mutate(owner, case_id, "packet_failure", key,
                             {"expected_revision": expected_revision, "code": code},
                             expected_revision, change)
        except WorkflowError as exc:
            if exc.code not in ("STALE_REVISION", "NOT_FOUND"):
                raise
