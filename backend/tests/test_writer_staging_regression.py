"""Actual-Strands regressions for server-bound reader proposals and writer stops."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.workflow.model import ModelFailure
from app.workflow.schemas import Proposal
from app.workflow.tools import ScopedPdfTools
from test_verification_regressions import (
    BatchAction,
    BatchScriptedModel,
    analysis,
    batch_team,
    case_updates,
    reads,
)


class TokenCapModel(BatchScriptedModel):
    """Report a real Strands output budget hit after a selected model turn."""

    def __init__(self, actions: list[BatchAction], capped_turn: int) -> None:
        super().__init__(actions)
        self.capped_turn = capped_turn

    async def stream(
        self, messages: Any, tool_specs: Any = None,
        system_prompt: str | None = None, **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        async for event in super().stream(
            messages, tool_specs=tool_specs, system_prompt=system_prompt, **kwargs,
        ):
            if "metadata" in event and self.calls == self.capped_turn:
                event = {"metadata": {"usage": {"inputTokens": 1,
                                                 "outputTokens": 1800,
                                                 "totalTokens": 1801},
                                      "metrics": {"latencyMs": 1}}}
            yield event


def test_bound_writer_stages_all_six_reader_fields_with_one_explicit_call() -> None:
    snapshot, excerpts, changes = case_updates(6)
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"})] + reads(excerpts),
         [("stage_reader_proposals", {})], "Ready for preview."],
    )

    result = provider.plan("Update all six PDF fields.", excerpts, snapshot)

    assert result.pdf_edit is not None
    assert [item.model_dump() for item in result.pdf_edit.changes] == changes
    assert {step["role"] for step in result.agent_steps} == {
        "reader", "writer", "orchestrator"}
    assert models["writer"].calls == 3


def test_fresh_founder_shape_stages_six_fields_from_one_source() -> None:
    facts = [("company_name", "Company", "Synthetic Studio"),
             ("founder_name", "Founder", "Ava"),
             ("business_summary", "Summary", "Makes widgets"),
             ("annual_revenue", "Annual revenue", "$100,000"),
             ("cash_reserve", "Cash reserve", "$50,000"),
             ("period", "Period", "2026")]
    source_text = "\n".join(f"{label}: {value}" for _, label, value in facts)
    source_hash = hashlib.sha256(source_text.encode()).hexdigest()
    excerpt = {"source_id": "synthetic", "source_hash": source_hash,
               "page": 1, "text": source_text}
    changes = [{"field": field, "value": value, "evidence": [{
        "source_id": "synthetic", "source_hash": source_hash,
        "page": 1, "quote": f"{label}: {value}",
    }]} for field, label, value in facts]
    snapshot, _, _ = case_updates(1)
    snapshot.update({"current_packet_id": None, "packets": [], "facts": {},
                     "analysis_required": True})
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [[("read_document", {"source_id": "synthetic"})], analysis(changes)],
        [[("read_packet", {})],
         [("read_document", {"source_id": "synthetic"})],
         [("stage_reader_proposals", {})], "Ready for preview."],
    )

    result = provider.plan("Prepare a PDF preview using exactly these facts.",
                           [excerpt], snapshot)

    assert result.pdf_edit is not None
    assert result.pdf_edit.base_packet_id is None
    assert [item.model_dump() for item in result.pdf_edit.changes] == changes
    assert result.pdf_edit.fields == {field: value for field, _, value in facts}
    assert models["writer"].calls == 4


def test_writer_tool_specs_support_empty_packet_and_stage_calls() -> None:
    snapshot, excerpts, changes = case_updates(1)
    scope = ScopedPdfTools(snapshot, excerpts,
                           reader_proposals=[Proposal.model_validate(changes[0])])
    specs = {entry.tool_name: entry.tool_spec["inputSchema"]["json"]
             for entry in scope.build()}

    assert "packet_id" not in specs["read_packet"].get("required", [])
    assert specs["stage_reader_proposals"] == {"properties": {}, "type": "object"}
    assert "changes" not in specs["propose_pdf_edit"].get("required", [])

    unbound = ScopedPdfTools(snapshot, excerpts)
    unbound_propose = next(entry for entry in unbound.build()
                           if entry.tool_name == "propose_pdf_edit")
    assert "changes" in unbound_propose.tool_spec["inputSchema"]["json"]["required"]
    with pytest.raises(TypeError):
        unbound_propose()


def test_bound_legacy_omission_cannot_switch_packet_or_template() -> None:
    snapshot, excerpts, changes = case_updates(1)
    scope = ScopedPdfTools(snapshot, excerpts,
                           reader_proposals=[Proposal.model_validate(changes[0])])
    by_name = {entry.tool_name: entry for entry in scope.build()}
    by_name["read_packet"](packet_id="packet-1")
    by_name["read_document"](source_id=excerpts[0]["source_id"])

    assert by_name["propose_pdf_edit"](packet_id="other") == {
        "error": "WRITER_SCOPE_MISMATCH"}
    assert by_name["propose_pdf_edit"](template_id="other") == {
        "error": "WRITER_SCOPE_MISMATCH"}
    assert scope.proposal is None


def test_bound_legacy_tool_without_changes_stages_exact_reader_proposals() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"})] + reads(excerpts),
         [("propose_pdf_edit", {})], "Ready for preview."],
    )

    result = provider.plan("Update the PDF.", excerpts, snapshot)

    assert result.pdf_edit is not None
    assert [item.model_dump() for item in result.pdf_edit.changes] == changes


def test_bound_legacy_tool_without_changes_requires_reads() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("propose_pdf_edit", {})], "Ready for preview."],
    )

    with pytest.raises(ModelFailure, match="PACKET_NOT_READ"):
        provider.plan("Update the PDF.", excerpts, snapshot)


def test_bound_legacy_tool_explicit_empty_changes_remains_invalid() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"})] + reads(excerpts),
         [("propose_pdf_edit", {"changes": []})], "Ready for preview."],
    )

    with pytest.raises(ModelFailure, match="INVALID_PDF_EDIT"):
        provider.plan("Update the PDF.", excerpts, snapshot)


def test_optional_discovery_does_not_exhaust_writer_before_staging() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("list_documents", {})],
         [("read_packet", {"packet_id": "packet-1"})],
         reads(excerpts),
         [("stage_reader_proposals", {})],
         "Ready for preview."],
    )

    result = provider.plan("Update the PDF.", excerpts, snapshot)

    assert result.pdf_edit is not None
    assert models["writer"].calls == 5


def test_six_sequential_source_reads_fit_existing_eight_tool_cap() -> None:
    snapshot, excerpts, changes = case_updates(6)
    writer_actions: list[BatchAction] = [
        [("read_packet", {"packet_id": "packet-1"})],
        *[[("read_document", {"source_id": row["source_id"]})] for row in excerpts],
        [("stage_reader_proposals", {})],
        "Ready for preview.",
    ]
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)], writer_actions,
    )

    result = provider.plan("Update six PDF fields.", excerpts, snapshot)

    assert result.pdf_edit is not None
    assert len(result.pdf_edit.changes) == 6
    assert models["writer"].calls == 9


def test_bound_writer_still_requires_every_cited_source_read() -> None:
    snapshot, excerpts, changes = case_updates(2)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"}), reads(excerpts)[0]],
         [("stage_reader_proposals", {})], "Ready for preview."],
    )

    with pytest.raises(ModelFailure, match="SOURCE_NOT_READ"):
        provider.plan("Update two PDF fields.", excerpts, snapshot)


def test_legacy_writer_tool_cannot_substitute_another_valid_citation() -> None:
    snapshot, excerpts, changes = case_updates(1)
    alternate_excerpt = {"source_id": "alternate", "source_hash": "b" * 64,
                         "page": 1, "text": "Company: Acme Two"}
    alternate_change = {**changes[0], "evidence": [{
        "source_id": "alternate", "source_hash": "b" * 64,
        "page": 1, "quote": "Company: Acme Two",
    }]}
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"}),
          ("read_document", {"source_id": "alternate"})],
         [("propose_pdf_edit", {"changes": [alternate_change],
                                "packet_id": "packet-1"})],
         "Ready for preview."],
    )

    with pytest.raises(ModelFailure, match="WRITER_SCOPE_MISMATCH"):
        provider.plan("Update the PDF.", excerpts + [alternate_excerpt], snapshot)


def test_output_budget_stop_after_tool_staging_is_terminal() -> None:
    snapshot, excerpts, changes = case_updates(1)
    writer_actions: list[BatchAction] = [
        [("read_packet", {"packet_id": "packet-1"})],
        reads(excerpts),
        [("stage_reader_proposals", {})],
        "Ready for preview.",
    ]
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)], writer_actions,
    )
    models["writer"] = TokenCapModel(writer_actions, capped_turn=3)

    with pytest.raises(ModelFailure, match="MODEL_BUDGET_EXHAUSTED"):
        provider.plan("Update the PDF.", excerpts, snapshot)
    assert models["writer"].calls == 3


def test_nested_writer_sdk_error_keeps_safe_failure_code() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
    )
    original_team_agent = provider._team_agent

    def failing_writer(role: str, tools: list[Any]) -> Any:
        if role == "writer":
            def fail(*args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("private request marker")

            return fail
        return original_team_agent(role, tools)

    provider._team_agent = failing_writer
    with pytest.raises(ModelFailure, match="BEDROCK_UNAVAILABLE") as failure:
        provider.plan("Update the PDF.", excerpts, snapshot)
    assert "private request marker" not in str(failure.value)


def test_prebody_tool_schema_error_has_safe_writer_trace(
    caplog: pytest.LogCaptureFixture,
) -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [[("read_packet", {"packet_id": "packet-1"})] + reads(excerpts),
         [("propose_pdf_edit", {"changes": "invalid"})], "Ready for preview."],
    )

    with caplog.at_level("WARNING", logger="app.workflow.team"):
        with pytest.raises(ModelFailure, match="PDF_EDIT_NOT_STAGED"):
            provider.plan("private request marker", excerpts, snapshot)

    trace = "\n".join(record.message for record in caplog.records
                      if record.name == "app.workflow.team")
    assert '"tool": "propose_pdf_edit", "status": "error"' in trace
    assert '"stop_reason": "end_turn"' in trace
    assert '"model_turns": 3' in trace
    assert "private request marker" not in trace
