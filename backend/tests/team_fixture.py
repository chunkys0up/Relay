"""Explicit no-network multi-agent fixture using the real Strands SDK."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from app.workflow.schemas import ModelResult
from test_team import scripted_team
from test_workflow import FixtureProvider


class TeamFixture(FixtureProvider):
    label = 'Simulated multi-agent model (real Strands, no AWS calls)'

    def plan(self, goal: str, excerpts: list[dict[str, Any]], context: dict[str, Any]) -> ModelResult:
        proposals = self.propose(goal, excerpts).proposals
        if context['current_packet_id']:
            changes = [p.model_dump() for p in proposals if p.evidence[0].source_id == excerpts[-1]['source_id']]
            source_id = excerpts[-1]['source_id']
        else:
            changes = [p.model_dump() for p in proposals]
            source_id = excerpts[0]['source_id']
        packet = context['current_packet_id']
        provider, _, _ = scripted_team(
            [('consult_reader', {}), ('consult_writer', {}), 'Your PDF is ready for preview and review.'],
            [('read_document', {'source_id': source_id}),
             json.dumps({'proposals': changes, 'reply': 'The supplied facts have citations.'})],
            [('read_document', {'source_id': source_id}), ('read_packet', {'packet_id': packet}),
             ('propose_pdf_edit', {'changes': changes, 'packet_id': packet,
                'template_id': context['templates'][0]['id'] if context['templates'] else None}),
             'The proposed edit is ready.'],
        )
        return provider.plan(goal, excerpts, context)

    def verify_pdf(self, pdf: bytes, fields: dict[str, str], template_fields: list[str] | None) -> dict[str, Any]:
        provider, _, _ = scripted_team([], verifier=[json.dumps({
            'passed': True, 'hash': hashlib.sha256(pdf).hexdigest(), 'issues': []})])
        return provider.verify_pdf(pdf, fields, template_fields)
