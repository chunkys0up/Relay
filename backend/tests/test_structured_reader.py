"""Exercise the installed SDK's structured-output stop reason, without AWS."""
from __future__ import annotations
from typing import Any
from strands import Agent
from app.workflow.schemas import ModelResult
from test_team import scripted_team
from test_agent_tools import CHANGE, EXCERPT, GOAL, context


def test_reader_accepts_validated_sdk_structured_tool_result() -> None:
    provider, models, _ = scripted_team(
        [('consult_reader', {}), ('consult_writer', {}), 'Preview ready.'],
        [('read_document', {'source_id': 'goal-1'}),
         ('ModelResult', {'proposals': [CHANGE], 'reply': 'Cited reserve.'})],
        [('read_document', {'source_id': 'goal-1'}),
         ('read_packet', {'packet_id': 'packet-1'}),
         ('propose_pdf_edit', {'changes': [CHANGE], 'packet_id': 'packet-1'}),
         'Ready.'],
    )
    ordinary = provider._team_agent

    def agent(role: str, tools: list[Any]) -> Agent:
        if role == 'reader':
            return Agent(model=models[role], tools=tools, callback_handler=None,
                         structured_output_model=ModelResult, retry_strategy=None)
        return ordinary(role, tools)

    provider._team_agent = agent
    result = provider.plan(GOAL, [EXCERPT], context())
    assert result.pdf_edit is not None
    assert result.pdf_edit.fields['cash_reserve'] == '$120'
    assert result.proposals[0].evidence[0].source_hash == EXCERPT['source_hash']
