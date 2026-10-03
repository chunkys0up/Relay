from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from .model import ModelFailure, ProposalProvider, validated_proposals
from .repository import Repository, WorkflowError
from .schemas import FIELDS, ConfirmInput


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid() -> str:
    return str(uuid.uuid4())


def empty_fact() -> dict[str, Any]:
    return {"state": "unknown", "value": None, "candidates": [], "confirmed_by": None,
            "confirmation_message_id": None}


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
        filename: str, content_type: str, data: bytes,
    ) -> dict[str, Any]:
        from .documents import extract_document

        if len(data) > 10 * 1024 * 1024:
            raise WorkflowError("FILE_TOO_LARGE", 413)
        source_id = uid()
        try:
            excerpts = extract_document(data, filename, content_type, source_id)
        except ValueError as exc:
            raise WorkflowError("INVALID_SOURCE", 422) from exc
        if not excerpts:
            raise WorkflowError("IMAGE_ONLY_FILE", 415)
        digest = hashlib.sha256(data).hexdigest()
        source = {
            "id": source_id, "name": filename[:120], "mime_type": content_type,
            "bytes": len(data), "hash": digest, "created_at": now(),
            "excerpt_count": len(excerpts),
        }
        excerpt_rows = [
            {"source_id": e.source_id, "source_hash": e.source_hash,
             "page": e.page, "text": e.text}
            for e in excerpts
        ]
        request = {"expected_revision": expected_revision, "filename": filename,
                   "content_type": content_type, "hash": digest}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            state["sources"].append({**source, "excerpts": excerpt_rows})
            state["analysis_required"] = True
            state["activity"] = "Source extracted; review its facts before creating a packet."
            return {"source": source}, [(source_id, "source", data)]

        return self.repo.mutate(owner, case_id, "upload_source", key, request,
                                expected_revision, change)

    def upload_template(
        self, owner: str, case_id: str, expected_revision: int, key: str,
        filename: str, data: bytes,
    ) -> dict[str, Any]:
        if len(data) > 10 * 1024 * 1024:
            raise WorkflowError("FILE_TOO_LARGE", 413)
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
        digest = hashlib.sha256(data).hexdigest()
        template = {"id": template_id, "name": filename[:120], "fields": sorted(fields),
                    "hash": digest, "created_at": now()}
        request = {"expected_revision": expected_revision, "hash": digest, "filename": filename}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            state["templates"].append(template)
            return {"template": template}, [(template_id, "template", data)]

        return self.repo.mutate(owner, case_id, "upload_template", key, request,
                                expected_revision, change)

    def start_job(
        self, owner: str, case_id: str, expected_revision: int, key: str, goal: str,
    ) -> dict[str, Any]:
        job_id = uid()
        task_titles = ["Read documents and check evidence", "Prepare proposed document",
                       "Verify generated PDF"]
        request = {"expected_revision": expected_revision, "goal": goal}

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            tasks = [
                {"id": uid(), "job_id": job_id, "order": i + 1, "title": title,
                 "state": "Pending", "detail": None}
                for i, title in enumerate(task_titles)
            ]
            job = {"id": job_id, "status": "queued", "error": None,
                   "created_at": now(), "started_revision": state["revision"] + 1}
            for action in state.get("pdf_actions", []):
                if action["status"] == "pending":
                    action["status"] = "superseded"
            state["jobs"].append(job)
            state["tasks"].extend(tasks)
            state["ui_state"] = "Thinking / Working"
            state["activity"] = "Tasks saved; waiting to analyze sources."
            state["goal"] = goal
            message_id = uid()
            state["messages"].append({"id": message_id, "author": "founder",
                "text": goal, "created_at": now(),
                "hash": hashlib.sha256(goal.encode()).hexdigest()})
            job["goal_message_id"] = message_id
            return {"job_id": job_id, "status": "queued", "tasks": tasks}, []

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
            for task in state["tasks"]:
                if task["job_id"] == job_id and task["order"] == 1:
                    task["state"] = "In progress"
            state["activity"] = "Reading authorized source excerpts."

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
                planned_revision = state["revision"]
                def verifying(current: dict[str, Any], current_job: dict[str, Any]) -> None:
                    if current["revision"] != planned_revision:
                        raise WorkflowError("STALE_REVISION")
                    current_job["agent_steps"] = result.agent_steps
                    current["activity"] = "Checking the proposed PDF before offering it for review."
                    for task in current["tasks"]:
                        if task["job_id"] == job_id:
                            task["state"] = "In progress" if task["order"] == 3 else "Done"
                state = self.repo.update_job(owner, case_id, job_id, verifying)
                stage_edit(self.repo, owner, state, job_id, result, excerpts,
                           verifier=getattr(self.provider, "verify_pdf", None))
            elif plan and not result.proposals:
                def reply_only(current: dict[str, Any], current_job: dict[str, Any]) -> None:
                    current_job["status"] = "needs_input"
                    current_job["agent_steps"] = result.agent_steps
                    current["ui_state"] = "Needs input"
                    current["activity"] = "Relay replied; no PDF changes saved."
                    current["messages"].append({"id": uid(), "author": "Relay",
                        "text": result.reply or "Please provide more detail.", "created_at": now()})
                    for task in current["tasks"]:
                        if task["job_id"] == job_id:
                            task["state"] = "Done"
                            if task["order"] == 3:
                                task["detail"] = "Not required; no PDF was generated."
                self.repo.update_job(owner, case_id, job_id, reply_only)
            else:
                proposals = validated_proposals(result, excerpts)
                self._finish_job(owner, case_id, job_id, proposals, getattr(result, "reply", None),
                                 result.agent_steps)
        except Exception as exc:
            code = exc.args[0] if isinstance(exc, ModelFailure) and exc.args else "WORKFLOW_FAILED"

            def blocked(state: dict[str, Any], job: dict[str, Any]) -> None:
                job["status"] = "blocked"
                job["error"] = code
                state["ui_state"] = "Needs input"
                state["activity"] = "Analysis stopped. Retry the task after checking the source or provider."
                for task in state["tasks"]:
                    if task["job_id"] == job_id and task["state"] != "Done":
                        task["state"] = "Blocked"
                        task["detail"] = code

            self.repo.update_job(owner, case_id, job_id, blocked)

    def _finish_job(
        self, owner: str, case_id: str, job_id: str, proposals: list[dict[str, Any]], reply: str | None = None,
        agent_steps: list[dict[str, str]] | None = None,
    ) -> None:
        def finish(state: dict[str, Any], job: dict[str, Any]) -> None:
            if job["status"] != "working":
                raise WorkflowError("INVALID_TRANSITION")
            job["agent_steps"] = agent_steps or []
            grouped: dict[str, list[dict[str, Any]]] = {field: [] for field in FIELDS}
            for proposal in proposals:
                grouped[proposal["field"]].append(proposal)
            flags = []
            for field in FIELDS:
                candidates = grouped[field]
                distinct = {p["value"].strip() for p in candidates}
                fact = state["facts"][field]
                if fact["state"] == "confirmed":
                    if not distinct or distinct == {fact["value"]}:
                        continue
                    old_value = fact["value"]
                    old_message = next((m for m in state["messages"]
                                        if m["id"] == fact["confirmation_message_id"]), None)
                    if old_message is not None:
                        candidates.append({"field": field, "value": old_value,
                            "evidence": [{"source_id": old_message["id"],
                                          "source_hash": old_message["hash"],
                                          "page": 1, "quote": old_value}]})
                    distinct.add(old_value)
                fact["candidates"] = candidates
                fact["value"] = next(iter(distinct)) if len(distinct) == 1 else None
                fact["state"] = ("unknown" if not distinct else "conflicting"
                                 if len(distinct) > 1 else "proposed")
                if fact["state"] in ("unknown", "conflicting"):
                    flags.append({"field": field,
                                  "kind": "missing" if not distinct else "conflict",
                                  "detail": "Founder confirmation required."})
            state["flags"] = flags
            state["analysis_required"] = False
            job["status"] = "needs_input"
            state["ui_state"] = "Needs input"
            state["activity"] = "Review and confirm proposed facts before drafting."
            for task in state["tasks"]:
                if task["job_id"] == job_id:
                    task["state"] = "Done"
                    if task["order"] == 3:
                        task["detail"] = "Not required; review the proposed facts first."
            state["messages"].append({"id": uid(), "author": "Relay",
                "text": reply or f"Review {len(flags)} missing or conflicting field(s), then confirm all facts.",
                "created_at": now()})

        self.repo.update_job(owner, case_id, job_id, finish)

    def confirm(
        self, owner: str, case_id: str, key: str, values: ConfirmInput,
    ) -> dict[str, Any]:
        request = values.model_dump()

        def change(state: dict[str, Any]) -> tuple[dict[str, Any], list[tuple[str, str, bytes]]]:
            if any(j["status"] in ("queued", "working") for j in state["jobs"]):
                raise WorkflowError("JOB_IN_PROGRESS")
            for field, value in values.values.items():
                if not value.strip() or len(value) > 1000:
                    raise WorkflowError("INVALID_VALUE", 422)
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
            state["flags"] = [f for f in state["flags"]
                              if state["facts"][f["field"]]["state"] != "confirmed"]
            state["ui_state"] = "Idle" if all(
                f["state"] == "confirmed" for f in state["facts"].values()
            ) else "Needs input"
            state["activity"] = "Founder confirmation saved."
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
            raise WorkflowError("PACKET_GENERATION_FAILED", 422) from exc
        try:
            verification = verify_rendered_pdf(pdf, fields, template_fields,
                getattr(self.provider, "verify_pdf", None))
        except ModelFailure as exc:
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
            state["current_packet_id"] = packet_id
            state["status"] = "Draft ready"
            state["ui_state"] = "Idle"
            state["activity"] = f"Packet v{version} is ready for founder review."
            return {"packet_id": packet_id, "version": version,
                    "hash": packet["hash"]}, [(packet_id, "packet", pdf)]

        return self.repo.mutate(owner, case_id, "packet", key, request,
                                expected_revision, change)
