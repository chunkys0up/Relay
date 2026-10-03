"""Case-scoped, in-memory Strands tools for planning a PDF edit.

These tools can only read supplied metadata/excerpts and return a proposal.
They never access repositories, blobs, files, or external services.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import ValidationError
from strands import tool

from .schemas import FIELDS, ModelResult, PdfEditProposal, Proposal


def _failure(code: str) -> Exception:
    from .model import ModelFailure

    return ModelFailure(code)


def _index(rows: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(rows, list):
        raise _failure("INVALID_CONTEXT")
    index: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise _failure("INVALID_CONTEXT")
        if row["id"] in index:
            raise _failure("INVALID_CONTEXT")
        index[row["id"]] = row
    return index


def _baseline(context: dict[str, Any], packet_id: str | None) -> tuple[dict[str, str], str | None]:
    packets = _index(context.get("packets", []))
    if packet_id is not None:
        packet = packets.get(packet_id)
        if packet is None:
            raise _failure("UNKNOWN_PACKET")
        fields = packet.get("fields")
        if not isinstance(fields, dict) or set(fields) - set(FIELDS):
            raise _failure("INVALID_CONTEXT")
        if any(not isinstance(value, str) or not value.strip() for value in fields.values()):
            raise _failure("INVALID_CONTEXT")
        return dict(fields), packet.get("template_id")
    facts = context.get("facts", {})
    if not isinstance(facts, dict):
        raise _failure("INVALID_CONTEXT")
    fields: dict[str, str] = {}
    for field in FIELDS:
        fact = facts.get(field)
        if isinstance(fact, dict) and fact.get("state") == "confirmed":
            value = fact.get("value")
            if not isinstance(value, str) or not value.strip():
                raise _failure("INVALID_CONTEXT")
            fields[field] = value
    return fields, None


def _validated_changes(changes: list[Proposal], excerpts: list[dict[str, Any]]) -> dict[str, str]:
    from .model import validated_proposals

    validated = validated_proposals(
        ModelResult(proposals=changes),
        excerpts,
    )
    distinct: dict[str, str] = {}
    for proposal in validated:
        field, value = proposal["field"], proposal["value"].strip()
        if field in distinct:
            raise _failure("CONFLICTING_VALUES")
        distinct[field] = value
    return distinct


def validate_pdf_edit(
    proposal: PdfEditProposal | dict[str, Any], context: dict[str, Any],
    excerpts: list[dict[str, Any]],
) -> PdfEditProposal:
    """Re-derive every PDF field; reject invented baselines or hidden overwrites."""
    try:
        edit = PdfEditProposal.model_validate(proposal)
    except ValidationError as exc:
        raise _failure("INVALID_PDF_EDIT") from exc
    if not isinstance(context, dict) or not isinstance(excerpts, list):
        raise _failure("INVALID_CONTEXT")
    baseline, inherited_template = _baseline(context, edit.base_packet_id)
    templates = _index(context.get("templates", []))
    if edit.template_id is not None and edit.template_id not in templates:
        raise _failure("UNKNOWN_TEMPLATE")
    if edit.base_packet_id is not None and edit.template_id != inherited_template:
        # A caller may explicitly switch templates, but a hidden omission cannot.
        if edit.template_id is None and inherited_template is not None:
            raise _failure("TEMPLATE_MISMATCH")
    changes = _validated_changes(edit.changes, excerpts)
    facts = context.get("facts", {})
    if not isinstance(facts, dict):
        raise _failure("INVALID_CONTEXT")
    for field in FIELDS:
        fact = facts.get(field)
        if not isinstance(fact, dict):
            continue
        state = fact.get("state")
        if not isinstance(state, str):
            raise _failure("INVALID_CONTEXT")
        if state == "confirmed" and edit.base_packet_id is not None:
            current = fact.get("value")
            if not isinstance(current, str) or not current.strip():
                raise _failure("INVALID_CONTEXT")
            if baseline.get(field) != current and field not in changes:
                raise _failure("STALE_PACKET_FACTS")
        elif state in {"unknown", "proposed", "conflicting"}:
            if field in baseline and field not in changes:
                raise _failure("UNRESOLVED_PACKET_FACTS")
            if state == "conflicting" and field in changes:
                candidates = fact.get("candidates")
                if not isinstance(candidates, list) or not candidates:
                    raise _failure("INVALID_CONTEXT")
                candidate_sources: set[str] = set()
                for candidate in candidates:
                    if not isinstance(candidate, dict) or not isinstance(candidate.get("evidence"), list):
                        raise _failure("INVALID_CONTEXT")
                    for evidence in candidate["evidence"]:
                        if not isinstance(evidence, dict) or not isinstance(evidence.get("source_id"), str):
                            raise _failure("INVALID_CONTEXT")
                        candidate_sources.add(evidence["source_id"])
                cited_sources = {e.source_id for change in edit.changes
                                 if change.field == field for e in change.evidence}
                if not candidate_sources or not candidate_sources <= cited_sources:
                    raise _failure("SOURCE_ACKNOWLEDGEMENT_REQUIRED")
    if context.get("analysis_required") and set(changes) != set(FIELDS):
        raise _failure("NEEDS_SOURCE_REVIEW")
    if edit.template_id is not None:
        template_fields = templates[edit.template_id].get("fields")
        if not isinstance(template_fields, list) or set(template_fields) - set(FIELDS):
            raise _failure("INVALID_CONTEXT")
        if set(changes) - set(template_fields):
            raise _failure("UNRENDERED_CHANGE")
    expected = {**baseline, **changes}
    if set(expected) != set(FIELDS):
        raise _failure("MISSING_FIELDS")
    if not expected or edit.fields != expected:
        raise _failure("UNSUPPORTED_PDF_FIELDS")
    return edit


class ScopedPdfTools:
    """Immutable case snapshot plus a bounded record of successful tool reads."""

    def __init__(self, context: dict[str, Any], excerpts: list[dict[str, Any]]) -> None:
        self.context = deepcopy(context)
        self.excerpts = deepcopy(excerpts)
        self.sources = _index(self.context.get("sources", []))
        self.packets = _index(self.context.get("packets", []))
        self.templates = _index(self.context.get("templates", []))
        self.excerpts_by_source: dict[str, list[dict[str, Any]]] = {}
        for excerpt in self.excerpts:
            source_id = excerpt.get("source_id")
            if not isinstance(source_id, str):
                raise _failure("INVALID_CONTEXT")
            self.excerpts_by_source.setdefault(source_id, []).append(excerpt)
        self.read_sources: set[str] = set()
        self.read_packets: set[str | None] = set()
        self.proposal: PdfEditProposal | None = None
        self.call_count = 0

    def _count(self) -> None:
        self.call_count += 1
        if self.call_count > 8:
            raise _failure("TOOL_BUDGET_EXHAUSTED")

    def build(self) -> list[Any]:
        scope = self

        @tool
        def list_documents() -> dict[str, Any]:
            """List only documents and templates already authorized in this case."""
            scope._count()
            sources = [{"id": row["id"], "name": row.get("name"),
                        "excerpt_count": row.get("excerpt_count")}
                       for row in scope.sources.values()]
            for source_id, rows in scope.excerpts_by_source.items():
                if source_id not in scope.sources:
                    sources.append({"id": source_id, "name": "Current user request",
                                    "excerpt_count": len(rows)})
            return {"sources": sources,
                    "packets": [{"id": row["id"], "version": row.get("version")}
                                for row in scope.packets.values()],
                    "templates": [{"id": row["id"], "name": row.get("name"),
                                   "fields": row.get("fields")}
                                  for row in scope.templates.values()]}

        @tool
        def read_document(source_id: str) -> dict[str, Any]:
            """Read bounded, cited excerpts from an authorized source ID."""
            scope._count()
            if source_id not in scope.excerpts_by_source:
                return {"error": "UNKNOWN_SOURCE"}
            scope.read_sources.add(source_id)
            rows = scope.excerpts_by_source[source_id]
            return {"source_id": source_id, "excerpts": rows[:50]}

        @tool
        def read_packet(packet_id: str | None = None) -> dict[str, Any]:
            """Read a packet by ID, or the current packet and confirmed facts."""
            scope._count()
            selected = packet_id or scope.context.get("current_packet_id")
            if selected is not None and selected not in scope.packets:
                return {"error": "UNKNOWN_PACKET"}
            scope.read_packets.add(selected)
            if selected is not None:
                packet = scope.packets[selected]
                return {"packet_id": selected, "version": packet.get("version"),
                        "template_id": packet.get("template_id"),
                        "fields": packet.get("fields")}
            fields, _ = _baseline(scope.context, None)
            return {"packet_id": None, "confirmed_fields": fields}

        @tool
        def propose_pdf_edit(
            changes: list[dict[str, Any]], packet_id: str | None = None,
            template_id: str | None = None,
        ) -> dict[str, Any]:
            """Stage cited field changes for a human-reviewed PDF preview; never save or send."""
            scope._count()
            selected = packet_id or scope.context.get("current_packet_id")
            try:
                if selected is not None and selected not in scope.read_packets:
                    raise _failure("PACKET_NOT_READ")
                if selected is None and None not in scope.read_packets:
                    raise _failure("CONFIRMED_FACTS_NOT_READ")
                parsed = [Proposal.model_validate(row) for row in changes]
                if not parsed or len(parsed) > 6:
                    raise _failure("INVALID_PDF_EDIT")
                if any(e.source_id not in scope.read_sources
                       for change in parsed for e in change.evidence):
                    raise _failure("SOURCE_NOT_READ")
                baseline, inherited_template = _baseline(scope.context, selected)
                chosen_template = template_id if template_id is not None else inherited_template
                updates = _validated_changes(parsed, scope.excerpts)
                edit = PdfEditProposal(base_packet_id=selected,
                    template_id=chosen_template, fields={**baseline, **updates}, changes=parsed)
                scope.proposal = validate_pdf_edit(edit, scope.context, scope.excerpts)
                return {"status": "staged_for_preview", "proposal": scope.proposal.model_dump()}
            except Exception as exc:
                from .model import ModelFailure

                if isinstance(exc, ModelFailure):
                    return {"error": exc.args[0] if exc.args else "INVALID_PDF_EDIT"}
                return {"error": "INVALID_PDF_EDIT"}

        return [list_documents, read_document, read_packet, propose_pdf_edit]
