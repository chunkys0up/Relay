"""Locked verification-loop regressions using real Strands and no network calls."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from strands import Agent

from app.workflow.model import ModelFailure
from app.workflow.team import MultiAgentProvider
from test_agent_tools import ScriptedModel, context

ToolCall = tuple[str, dict[str, Any]]
BatchAction = list[ToolCall] | str


class BatchScriptedModel(ScriptedModel):
    """Emit several real tool uses in one model turn, matching supported SDK behavior."""

    def __init__(self, actions: list[BatchAction]) -> None:
        super().__init__([])
        self.batch_actions = actions

    async def stream(
        self, messages: Any, tool_specs: Any = None,
        system_prompt: str | None = None, **kwargs: Any,
    ) -> AsyncIterator[dict[str, Any]]:
        del messages, system_prompt, kwargs
        action = self.batch_actions[self.calls]
        self.calls += 1
        yield {"messageStart": {"role": "assistant"}}
        if isinstance(action, str):
            yield {"contentBlockStart": {"start": {}}}
            yield {"contentBlockDelta": {"delta": {"text": action}}}
            yield {"contentBlockStop": {}}
            reason = "end_turn"
        else:
            assert tool_specs is not None
            for index, (name, arguments) in enumerate(action):
                assert name in {spec["name"] for spec in tool_specs}
                yield {"contentBlockStart": {"start": {"toolUse": {
                    "name": name, "toolUseId": f"call-{self.calls}-{index}",
                }}}}
                yield {"contentBlockDelta": {"delta": {"toolUse": {
                    "input": json.dumps(arguments),
                }}}}
                yield {"contentBlockStop": {}}
            reason = "tool_use"
        yield {"messageStop": {"stopReason": reason}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1,
                                       "totalTokens": 2}, "metrics": {"latencyMs": 1}}}


def batch_team(
    orchestrator: list[BatchAction], reader: list[BatchAction],
    writer: list[BatchAction] | None = None,
) -> tuple[MultiAgentProvider, dict[str, BatchScriptedModel]]:
    provider = MultiAgentProvider("unused-offline", "us-east-1")
    models = {"orchestrator": BatchScriptedModel(orchestrator),
              "reader": BatchScriptedModel(reader),
              "writer": BatchScriptedModel(writer or [])}

    def agent(role: str, tools: list[Any]) -> Agent:
        return Agent(model=models[role], tools=tools, load_tools_from_directory=False,
                     callback_handler=None, retry_strategy=None)

    provider._team_agent = agent
    return provider, models


def case_updates(source_count: int) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    values = [("company_name", "Acme Two"), ("founder_name", "Ari Two"),
              ("business_summary", "Widgets Two"), ("annual_revenue", "$600"),
              ("cash_reserve", "$120"), ("period", "2027")][:source_count]
    excerpts = [{"source_id": f"source-{index}", "source_hash": str(index) * 64,
                 "page": 1, "text": f"{field}: {value}"}
                for index, (field, value) in enumerate(values)]
    changes = [{"field": field, "value": value, "evidence": [{
        "source_id": excerpts[index]["source_id"],
        "source_hash": excerpts[index]["source_hash"], "page": 1,
        "quote": excerpts[index]["text"],
    }]} for index, (field, value) in enumerate(values)]
    snapshot = context()
    snapshot["sources"] = [{"id": row["source_id"], "name": f"Note {index}",
                            "excerpt_count": 1} for index, row in enumerate(excerpts)]
    return snapshot, excerpts, changes


def reads(excerpts: list[dict[str, Any]]) -> list[ToolCall]:
    return [("read_document", {"source_id": row["source_id"]}) for row in excerpts]


def analysis(changes: list[dict[str, Any]], reply: str = "The supplied values have citations.") -> str:
    return json.dumps({"proposals": changes, "reply": reply})


@pytest.mark.parametrize("claim", [
    "The PDF was delivered to your advisor.",
    "I emailed the finished packet.",
    "The PDF is now complete.",
    "Done.",
    "Your final PDF is ready.",
])
def test_no_edit_cannot_return_an_unperformed_success_claim(claim: str) -> None:
    snapshot, excerpts, _ = case_updates(1)
    provider, models = batch_team(
        [[("consult_reader", {})], "Done."], [analysis([], claim)],
    )
    result = provider.plan("Update the PDF.", excerpts, snapshot)
    assert result.pdf_edit is None
    assert models["writer"].calls == 0
    assert result.reply == "I need more information to prepare that PDF edit."


@pytest.mark.parametrize("claim", [
    "The PDF was delivered to your advisor.", "I emailed the finished packet.",
])
def test_staged_edit_reply_describes_only_actual_preview_state(claim: str) -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], claim],
        [reads(excerpts), analysis(changes)],
        [reads(excerpts) + [("read_packet", {"packet_id": "packet-1"})],
         [("propose_pdf_edit", {"changes": changes, "packet_id": "packet-1"})], claim],
    )
    result = provider.plan("Update the PDF.", excerpts, snapshot)
    assert result.pdf_edit is not None
    assert result.reply == "A PDF edit is ready to preview and confirm."


@pytest.mark.parametrize("source_count", [5, 6])
def test_valid_multisource_edit_fits_bounded_specialist_budgets(source_count: int) -> None:
    snapshot, excerpts, changes = case_updates(source_count)
    provider, models = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts) + [("list_documents", {}),
                           ("read_packet", {"packet_id": "packet-1"})], analysis(changes)],
        [reads(excerpts) + [("read_packet", {"packet_id": "packet-1"})],
         [("propose_pdf_edit", {"changes": changes, "packet_id": "packet-1"})],
         "Ready for preview."],
    )
    result = provider.plan("Update the PDF using the supplied notes.", excerpts, snapshot)
    assert result.pdf_edit is not None
    assert {change.field: change.value for change in result.pdf_edit.changes} == {
        change["field"]: change["value"] for change in changes}
    assert {name: model.calls for name, model in models.items()} == {
        "orchestrator": 3, "reader": 2, "writer": 3}


def test_shared_tool_budget_exhaustion_cannot_return_prior_staged_success() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})],
         [("consult_reader", {})] * 13, "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [reads(excerpts) + [("read_packet", {"packet_id": "packet-1"})],
         [("propose_pdf_edit", {"changes": changes, "packet_id": "packet-1"})],
         "Ready for preview."],
    )
    with pytest.raises(ModelFailure, match="TOOL_BUDGET_EXHAUSTED"):
        provider.plan("Update the PDF.", excerpts, snapshot)


def test_reader_local_budget_exhaustion_cannot_return_clarification_success() -> None:
    snapshot, excerpts, _ = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], "Please provide a source."],
        [[("list_documents", {})] * 9, analysis([], "Please provide a source.")],
    )
    with pytest.raises(ModelFailure, match="TOOL_BUDGET_EXHAUSTED"):
        provider.plan("Update the PDF.", excerpts, snapshot)


def test_writer_local_budget_exhaustion_cannot_return_prior_staged_success() -> None:
    snapshot, excerpts, changes = case_updates(1)
    provider, _ = batch_team(
        [[("consult_reader", {})], [("consult_writer", {})], "Ready for preview."],
        [reads(excerpts), analysis(changes)],
        [reads(excerpts) + [("read_packet", {"packet_id": "packet-1"})],
         [("propose_pdf_edit", {"changes": changes, "packet_id": "packet-1"})],
         [("list_documents", {})] * 6, "Ready for preview."],
    )
    with pytest.raises(ModelFailure, match="TOOL_BUDGET_EXHAUSTED"):
        provider.plan("Update the PDF.", excerpts, snapshot)


@pytest.mark.parametrize("staged", [False, True])
@pytest.mark.parametrize("claim", [
    "The PDF was delivered to your advisor.", "I emailed the finished packet.",
])
def test_legacy_provider_replies_follow_actual_staging_state(staged: bool, claim: str) -> None:
    from test_agent_tools import scripted_provider

    snapshot, excerpts, changes = case_updates(1)
    actions: list[ToolCall | str] = []
    if staged:
        actions.extend(reads(excerpts))
        actions.append(("read_packet", {"packet_id": "packet-1"}))
        actions.append(("propose_pdf_edit", {"changes": changes, "packet_id": "packet-1"}))
    actions.append(claim)
    provider, model = scripted_provider(actions)
    result = provider.plan("Update the PDF.", excerpts, snapshot)
    assert (result.pdf_edit is not None) is staged
    assert result.reply == ("A PDF edit is ready to preview and confirm." if staged else
                            "I need more information to prepare that PDF edit.")
    assert model.calls == (4 if staged else 1)


@pytest.mark.parametrize("code", ["ServiceUnavailableException", "invalid code\nprivate-marker"])
def test_team_failure_logging_excludes_raw_aws_messages(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, code: str,
) -> None:
    import logging
    from botocore.exceptions import ClientError

    provider = MultiAgentProvider("unused-offline", "us-east-1")
    message = "simulated-private-request-body-marker"

    def fail_agent(role: str, tools: list[Any]) -> Any:
        del role, tools
        raise ClientError({"Error": {"Code": code, "Message": message}}, "Converse")

    monkeypatch.setattr(provider, "_team_agent", fail_agent)
    with caplog.at_level(logging.WARNING, logger="app.workflow.team"):
        with pytest.raises(ModelFailure, match="BEDROCK_UNAVAILABLE"):
            provider.plan("Update the PDF.", [], context())
    expected = code if code.isalnum() else "unavailable"
    assert f"exception=ClientError code={expected}" in caplog.text
    assert message not in caplog.text
    assert "private-marker" not in caplog.text
