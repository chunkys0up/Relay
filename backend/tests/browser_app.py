"""Explicit simulated provider for local browser tests. Never used by workflow_app.app."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.workflow.schemas import ModelResult
from app.workflow_app import create_workflow_app


class FixtureProvider:
    label = "Simulated fixture provider (no AWS call)"

    def propose(self, goal: str, excerpts: list[dict[str, Any]]) -> ModelResult:
        labels = {
            "company": "company_name", "founder": "founder_name",
            "summary": "business_summary", "annual revenue": "annual_revenue",
            "cash reserve": "cash_reserve", "period": "period",
        }
        proposals = []
        for excerpt in excerpts:
            for line in excerpt["text"].splitlines():
                if ":" not in line:
                    continue
                label, value = line.split(":", 1)
                field = labels.get(label.strip().lower())
                if field and value.strip():
                    proposals.append({"field": field, "value": value.strip(),
                        "evidence": [{"source_id": excerpt["source_id"],
                                      "source_hash": excerpt["source_hash"],
                                      "page": excerpt["page"], "quote": line}]})
        return ModelResult.model_validate({"proposals": proposals})


    def plan(self, goal: str, excerpts: list[dict[str, Any]], context: dict[str, Any]) -> ModelResult:
        if goal.startswith("Team PDF"):
            from team_fixture import TeamFixture
            return TeamFixture().plan(goal, excerpts, context)
        if goal.startswith("Edit PDF"):
            from test_pdf_actions import AgentFixture
            return AgentFixture().plan(goal, excerpts, context)
        return self.propose(goal, excerpts)


    def verify_pdf(self, pdf: bytes, fields: dict[str, str], template_fields: list[str] | None) -> dict[str, Any]:
        from team_fixture import TeamFixture
        return TeamFixture().verify_pdf(pdf, fields, template_fields)


db_path = os.environ.get("RELAY_FIXTURE_DB") or str(
    Path.cwd() / ".relay" / "browser-fixture.sqlite3"
)
app = create_workflow_app(database_path=db_path, provider=FixtureProvider(), test_mode=True)
