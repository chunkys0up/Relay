from __future__ import annotations

import threading

from strands.agent.agent import Agent
from strands.models import BedrockModel
from strands_harness import create_harness

from app.agents.case_tools import ADVISOR_INSTRUCTIONS, CASE_TOOLS, INSTRUCTIONS
from app.core.aws_session import create_aws_session
from app.core.config import settings

_agents: dict[str, Agent] = {}
_lock = threading.Lock()


def get_agent(session_id: str, role: str = "founder") -> Agent:
    """Return the cached harness agent for a session, creating one on first use.

    The agent only gets the case tools (checklist, activity, case files); the harness's
    shell/file/web built-ins stay off.
    """
    with _lock:
        agent = _agents.get(session_id)
        if agent is None:
            model: BedrockModel | str | None = settings.strands_model
            if isinstance(model, str) and model.startswith("bedrock/"):
                model = BedrockModel(
                    model_id=model.removeprefix("bedrock/"),
                    boto_session=create_aws_session(settings.aws_region, settings.aws_profile),
                    additional_request_fields={"thinking": {"type": "disabled"}},
                )
            agent = create_harness(
                model=model,
                effort=settings.strands_effort,
                instructions=ADVISOR_INSTRUCTIONS if role == "advisor" else INSTRUCTIONS,
                builtin_tools=[],
                # The harness's own todo plugin would compete with the case checklist tools.
                builtin_plugins=[],
                tools=CASE_TOOLS,
                session={"id": session_id, "dir": settings.session_dir},
            )
            _agents[session_id] = agent
        return agent


def reset_agent(session_id: str) -> None:
    """Drop a cached agent so the next call for this session starts fresh."""
    with _lock:
        _agents.pop(session_id, None)
