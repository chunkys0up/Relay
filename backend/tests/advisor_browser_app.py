"""Real Strands tool cycles over deterministic local model output for browser checks."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from strands.models.model import Model

from app.advisor.model import AdvisorProvider
from app.advisor.store import P1, P2, S1, S3
from app.workflow_app import create_workflow_app
from browser_app import FixtureProvider


class AdvisorFixtureModel(Model):
    def __init__(self) -> None:
        self.step = 0
        self.plan: list[tuple[str, dict[str, str]]] = []
        self.kind = "answer"

    def update_config(self, **model_config: Any) -> None:
        del model_config

    def get_config(self) -> dict[str, Any]:
        return {"context_window_limit": 100000}

    async def structured_output(self, output_model: Any, prompt: Any,
                                system_prompt: str | None = None,
                                **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        del output_model, prompt, system_prompt, kwargs
        if False:
            yield {}

    def _prepare(self, messages: Any) -> None:
        request = json.loads(messages[0]["content"][0]["text"])
        question = request["question"].lower()
        if len(request["versions"]) == 2 or "compare" in question:
            self.kind = "comparison"
            self.plan = [("read_shared_packet", {"version_id": P1}),
                         ("read_shared_packet", {"version_id": P2})]
        elif "follow" in question or "draft" in question:
            self.kind = "followup_draft"
            self.plan = [("read_shared_source", {"version_id": P1, "source_id": S1}),
                         ("read_shared_source", {"version_id": P1, "source_id": S3})]
        elif "missing" in question or "conflict" in question or "revenue" in question:
            self.kind = "conflict"
            self.plan = [("read_shared_source", {"version_id": P1, "source_id": S1}),
                         ("read_shared_source", {"version_id": P1, "source_id": S3})]
        elif "summary" in question or "summarize" in question:
            self.kind = "answer"
            self.plan = [("read_shared_packet", {"version_id": P1})]
        else:
            self.kind = "unknown"
            self.plan = [("read_shared_packet", {"version_id": P1})]

    def _answer(self, messages: Any) -> str:
        records: dict[str, dict[str, Any]] = {}
        for message in messages:
            for block in message.get("content", []):
                result = block.get("toolResult")
                if isinstance(result, dict):
                    for content in result.get("content", []):
                        row = json.loads(content["text"])
                        records[row["id"]] = row

        def cite(version_id: str, source_id: str, excerpt: str) -> dict[str, str]:
            return {"version_id": version_id, "source_id": source_id,
                    "source_hash": records[source_id]["hash"], "quote": excerpt}

        if self.kind == "comparison":
            evidence = [cite(P1, P1, "Annual revenue: intake shows $240,000; forecast shows $280,000 for 2026."),
                        cite(P2, P2, "Annual revenue: founder clarification reports $260,000 for 2026; intake and forecast still conflict and need review.")]
        elif self.kind in {"conflict", "followup_draft"}:
            evidence = [cite(P1, S1, "2026 annual revenue: $240,000"),
                        cite(P1, S1, "Reserve target: not provided."),
                        cite(P1, S3, "2026 annual revenue forecast: $280,000.")]
        elif self.kind == "answer":
            evidence = [cite(P1, P1, "Reserve target: awaiting founder confirmation.")]
        else:
            evidence = []
        return json.dumps({"kind": self.kind, "evidence": evidence})

    async def stream(self, messages: Any, tool_specs: Any = None,
                     system_prompt: str | None = None,
                     **kwargs: Any) -> AsyncIterator[dict[str, Any]]:
        del system_prompt, kwargs
        assert tool_specs is not None
        if self.step == 0:
            self._prepare(messages)
        yield {"messageStart": {"role": "assistant"}}
        if self.step < len(self.plan):
            name, arguments = self.plan[self.step]
            yield {"contentBlockStart": {"start": {"toolUse": {
                "name": name, "toolUseId": f"fixture-{self.step}"}}}}
            yield {"contentBlockDelta": {"delta": {"toolUse": {
                "input": json.dumps(arguments)}}}}
            reason = "tool_use"
        else:
            yield {"contentBlockStart": {"start": {}}}
            yield {"contentBlockDelta": {"delta": {"text": self._answer(messages)}}}
            reason = "end_turn"
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": reason}}
        yield {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1,
                                    "totalTokens": 2}, "metrics": {"latencyMs": 1}}}
        self.step += 1


db_path = os.environ.get("RELAY_FIXTURE_DB") or str(Path.cwd() / ".relay" / "advisor-browser.sqlite3")
advisor_provider = AdvisorProvider("synthetic-strands-model", "us-east-1",
                                   model_factory=AdvisorFixtureModel)
app = create_workflow_app(database_path=db_path, provider=FixtureProvider(),
                          advisor_provider=advisor_provider, test_mode=True)
