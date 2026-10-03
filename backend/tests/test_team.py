from __future__ import annotations

import hashlib
import json
import sys
import types
from collections.abc import AsyncIterator
from typing import Any

import pytest
from strands import Agent

from app.workflow.model import ModelFailure
from app.workflow.team import MultiAgentProvider
from test_agent_tools import CHANGE, EXCERPT, GOAL, ScriptedModel, context


class TextOnlyScriptedModel(ScriptedModel):
    """Scripted verifier model for an Agent intentionally registered with no tools."""

    async def stream(self, messages: Any, tool_specs: Any = None,
                     system_prompt: str | None = None, **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        del messages, system_prompt, kwargs
        assert tool_specs is None
        action = self.actions[self.calls]
        self.calls += 1
        assert isinstance(action, str)
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"start": {}}}
        yield {"contentBlockDelta": {"delta": {"text": action}}}
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "end_turn"}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1,
                                     "totalTokens": 2}, "metrics": {"latencyMs": 1}}}


def scripted_team(
    orchestrator: list[tuple[str, dict[str, Any]] | str],
    reader: list[tuple[str, dict[str, Any]] | str] | None = None,
    writer: list[tuple[str, dict[str, Any]] | str] | None = None,
    verifier: list[tuple[str, dict[str, Any]] | str] | None = None,
) -> tuple[MultiAgentProvider, dict[str, ScriptedModel], dict[str, list[str]]]:
    """Real Strands Agents driven by local scripted Models; no Bedrock access."""
    provider = MultiAgentProvider("unused-in-test", "us-east-1")
    models = {
        "orchestrator": ScriptedModel(orchestrator),
        "reader": ScriptedModel(reader or []),
        "writer": ScriptedModel(writer or []),
        "verifier": TextOnlyScriptedModel(verifier or []),
    }
    seen_tools: dict[str, list[str]] = {}

    def agent(role: str, tools: list[Any]) -> Agent:
        seen_tools[role] = [item.tool_name for item in tools]
        return Agent(model=models[role], tools=tools, load_tools_from_directory=False,
                     callback_handler=None, retry_strategy=None)

    provider._team_agent = agent
    return provider, models, seen_tools


def _successful_team() -> tuple[MultiAgentProvider, dict[str, ScriptedModel], dict[str, list[str]]]:
    return scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "A PDF edit is ready to preview."],
        [("read_document", {"source_id": "goal-1"}),
         ("read_packet", {"packet_id": "packet-1"}),
         json.dumps({"proposals": [CHANGE], "reply": "Cash reserve is cited."})],
        [("read_document", {"source_id": "goal-1"}),
         ("read_packet", {"packet_id": "packet-1"}),
         ("propose_pdf_edit", {"changes": [CHANGE], "packet_id": "packet-1"}),
         "The edit is ready for preview."],
    )


def test_real_strands_team_delegates_and_stages_only_writer_proposal() -> None:
    provider, models, tools = _successful_team()
    result = provider.plan(GOAL, [EXCERPT], context())
    assert result.pdf_edit is not None
    assert result.pdf_edit.fields["cash_reserve"] == "$120"
    assert result.proposals[0].value == "$120"
    assert tools["orchestrator"] == ["consult_reader", "consult_writer"]
    assert set(tools["reader"]) == {"list_documents", "read_document", "read_packet"}
    assert "propose_pdf_edit" in tools["writer"]
    assert models["orchestrator"].calls == 3
    assert [step["role"] for step in result.agent_steps] == ["reader", "writer", "orchestrator"]


def test_reader_accepts_one_json_fence_without_skipping_grounding() -> None:
    provider, models, _ = _successful_team()
    models["reader"].actions[-1] = ('```json\n' + json.dumps({
        "proposals": [CHANGE], "reply": "Cash reserve is cited.",
    }) + '\n```')
    result = provider.plan(GOAL, [EXCERPT], context())
    assert result.pdf_edit is not None
    assert result.proposals[0].evidence[0].source_id == EXCERPT["source_id"]


def test_writer_before_reader_is_rejected_without_invoking_specialist() -> None:
    provider, models, _ = scripted_team(
        [("consult_writer", {}), "I made the PDF."],
    )
    with pytest.raises(ModelFailure, match="READER_REQUIRED"):
        provider.plan(GOAL, [EXCERPT], context())
    assert models["reader"].calls == 0
    assert models["writer"].calls == 0


def test_reader_must_ground_proposals_and_writer_must_stage() -> None:
    provider, models, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "Done."],
        [json.dumps({"proposals": [{**CHANGE, "value": "$999"}], "reply": "Ready."})],
    )
    with pytest.raises(ModelFailure):
        provider.plan(GOAL, [EXCERPT], context())
    assert models["writer"].calls == 0


def test_reader_cannot_cite_a_source_it_did_not_read() -> None:
    provider, models, _ = scripted_team(
        [("consult_reader", {}), "Ready."],
        [json.dumps({"proposals": [CHANGE], "reply": "Cash reserve is cited."})],
    )
    with pytest.raises(ModelFailure):
        provider.plan(GOAL, [EXCERPT], context())
    assert models["reader"].calls == 1
    assert models["writer"].calls == 0


def test_conflicting_grounded_reader_values_require_human_review() -> None:
    conflicting_excerpt = {"source_id": "goal-2", "source_hash": "b" * 64,
                           "page": 1, "text": "Set cash reserve to $130."}
    conflicting_change = {"field": "cash_reserve", "value": "$130", "evidence": [{
        "source_id": "goal-2", "source_hash": "b" * 64, "page": 1,
        "quote": "cash reserve to $130"}]}
    provider, models, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "I staged an edit."],
        [("read_document", {"source_id": "goal-1"}),
         ("read_document", {"source_id": "goal-2"}),
         json.dumps({"proposals": [CHANGE, conflicting_change], "reply": "Ready."})],
        [("read_document", {"source_id": "goal-1"}),
         ("read_packet", {"packet_id": "packet-1"}),
         ("propose_pdf_edit", {"changes": [CHANGE], "packet_id": "packet-1"}),
         "Ready."],
    )
    result = provider.plan(GOAL, [EXCERPT, conflicting_excerpt], context())
    assert result.pdf_edit is None
    assert {proposal.value for proposal in result.proposals} == {"$120", "$130"}
    assert "Conflicting source values" in result.reply
    assert models["writer"].calls == 0
    assert [step["role"] for step in result.agent_steps] == ["reader", "orchestrator"]


def test_partial_proposal_without_packet_requests_missing_fields() -> None:
    fresh = {**context(), "current_packet_id": None, "packets": []}
    provider, models, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "Ready."],
        [("read_document", {"source_id": "goal-1"}),
         json.dumps({"proposals": [CHANGE], "reply": "Cash reserve is supported."})],
    )
    result = provider.plan(GOAL, [EXCERPT], fresh)
    assert result.pdf_edit is None
    assert result.proposals[0].value == "$120"
    assert "company name" in result.reply
    assert "annual revenue" in result.reply
    assert "cash reserve" not in result.reply
    assert models["writer"].calls == 0


def test_full_review_requires_all_six_reader_fields_even_with_complete_packet() -> None:
    review = {**context(), "analysis_required": True}
    provider, models, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "Ready."],
        [("read_document", {"source_id": "goal-1"}),
         json.dumps({"proposals": [CHANGE], "reply": "Cash reserve is supported."})],
    )
    result = provider.plan(GOAL, [EXCERPT], review)
    assert result.pdf_edit is None
    assert result.proposals[0].value == "$120"
    assert "company name" in result.reply
    assert "annual revenue" in result.reply
    assert models["writer"].calls == 0


def test_writer_cannot_silently_drop_a_grounded_reader_change() -> None:
    revenue_excerpt = {"source_id": "goal-2", "source_hash": "b" * 64,
                       "page": 1, "text": "Set annual revenue to $700."}
    revenue_change = {"field": "annual_revenue", "value": "$700", "evidence": [{
        "source_id": "goal-2", "source_hash": "b" * 64, "page": 1,
        "quote": "annual revenue to $700"}]}
    provider, models, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "A PDF edit is ready."],
        [("read_document", {"source_id": "goal-1"}),
         ("read_document", {"source_id": "goal-2"}),
         json.dumps({"proposals": [CHANGE, revenue_change], "reply": "Both are supported."})],
        [("read_document", {"source_id": "goal-1"}),
         ("read_packet", {"packet_id": "packet-1"}),
         ("propose_pdf_edit", {"changes": [CHANGE], "packet_id": "packet-1"}),
         "A PDF edit is ready."],
    )
    with pytest.raises(ModelFailure, match="WRITER_SCOPE_MISMATCH"):
        provider.plan(GOAL, [EXCERPT, revenue_excerpt], context())
    assert models["writer"].calls == 4


def test_reader_clarification_does_not_call_writer() -> None:
    provider, models, _ = scripted_team(
        [("consult_reader", {}), "Please provide a source for cash reserve."],
        [json.dumps({"proposals": [], "reply": "Please provide a source."})],
    )
    result = provider.plan(GOAL, [EXCERPT], context())
    assert result.pdf_edit is None
    assert result.reply == "Please provide a source."
    assert models["writer"].calls == 0


def test_writer_cannot_expand_reader_scope() -> None:
    revenue = {"field": "annual_revenue", "value": "$500", "evidence": [{
        "source_id": "goal-2", "source_hash": "b" * 64, "page": 1,
        "quote": "Annual revenue is $500"}]}
    excerpt = {"source_id": "goal-2", "source_hash": "b" * 64, "page": 1,
               "text": "Annual revenue is $500"}
    provider, _, _ = scripted_team(
        [("consult_reader", {}), ("consult_writer", {}), "Ready."],
        [("read_document", {"source_id": "goal-1"}),
         json.dumps({"proposals": [CHANGE], "reply": "Cash reserve supported."})],
        [("read_document", {"source_id": "goal-2"}),
         ("read_packet", {"packet_id": "packet-1"}),
         ("propose_pdf_edit", {"changes": [revenue], "packet_id": "packet-1"}),
         "Ready."],
    )
    with pytest.raises(ModelFailure):
        provider.plan(GOAL, [EXCERPT, excerpt], context())


def test_reader_turn_limit_prevents_unbounded_calls() -> None:
    provider, models, _ = scripted_team(
        [("consult_reader", {}), "Done."],
        [("read_document", {"source_id": "goal-1"})] * 5,
    )
    with pytest.raises(ModelFailure):
        provider.plan(GOAL, [EXCERPT], context())
    assert models["reader"].calls == 4


def test_verifier_requires_deterministic_pass_exact_hash_and_clean_agent_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf = b"sample PDF bytes for mocked inspection"
    digest = hashlib.sha256(pdf).hexdigest()
    module = types.ModuleType("app.workflow.pdf_verification")
    module.inspect_pdf = lambda data, fields, template_fields: {
        "passed": True, "hash": digest, "checks": ["text present"],
        "extracted_text": "Cash reserve: $120", "fields": fields,
    }
    monkeypatch.setitem(sys.modules, module.__name__, module)
    provider, models, tools = scripted_team([], verifier=[json.dumps({
        "passed": True, "hash": digest, "issues": []})])
    report = provider.verify_pdf(pdf, {"cash_reserve": "$120"})
    assert report["mode"] == "deterministic+agent"
    assert "extracted_text" not in report
    assert tools["verifier"] == []
    assert models["verifier"].calls == 1

    provider, _, _ = scripted_team([], verifier=['```json\n' + json.dumps({
        "passed": True, "hash": digest, "issues": []}) + '\n```'])
    assert provider.verify_pdf(pdf, {"cash_reserve": "$120"})["mode"] == "deterministic+agent"

    provider, _, _ = scripted_team([], verifier=[json.dumps({
        "passed": True, "hash": "wrong", "issues": []})])
    with pytest.raises(ModelFailure, match="PDF_VERIFICATION_FAILED"):
        provider.verify_pdf(pdf, {"cash_reserve": "$120"})

    module.inspect_pdf = lambda data, fields, template_fields: {
        "passed": False, "hash": digest, "checks": [], "extracted_text": "", "fields": fields,
    }
    provider, models, _ = scripted_team([], verifier=[json.dumps({
        "passed": True, "hash": digest, "issues": []})])
    with pytest.raises(ModelFailure, match="PDF_VERIFICATION_FAILED"):
        provider.verify_pdf(pdf, {"cash_reserve": "$120"})
    assert models["verifier"].calls == 0
