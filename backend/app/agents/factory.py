from __future__ import annotations

import threading

from strands.agent.agent import Agent
from strands_harness import create_harness

from app.core.config import settings

_agents: dict[str, Agent] = {}
_lock = threading.Lock()


def get_agent(session_id: str) -> Agent:
    """Return the cached harness agent for a session, creating one on first use.

    No builtin tools are enabled yet (shell/file/web access) — add them via
    `builtin_tools=[...]` or `tools=[...]` below once there's an actual
    feature that needs them.
    """
    with _lock:
        agent = _agents.get(session_id)
        if agent is None:
            agent = create_harness(
                model=settings.strands_model,
                effort=settings.strands_effort,
                builtin_tools=[],
                tools=[],
                session={"id": session_id, "dir": settings.session_dir},
            )
            _agents[session_id] = agent
        return agent


def reset_agent(session_id: str) -> None:
    """Drop a cached agent so the next call for this session starts fresh."""
    with _lock:
        _agents.pop(session_id, None)
