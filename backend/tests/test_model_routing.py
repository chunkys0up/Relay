from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import boto3
import botocore.session
import pytest
import strands

from app.workflow.model import BedrockProvider, parse_model_json, validated_proposals
from app.workflow.schemas import ModelResult
from app.workflow.team import MultiAgentProvider
from app.workflow_app import create_workflow_app


SONNET = "us.anthropic.claude-sonnet-5"
HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
ROLES = ("extractor", "orchestrator", "reader", "writer", "verifier")


@pytest.fixture
def offline_bedrock(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Use the real BedrockModel constructor with an inert local client."""
    sessions: list[dict[str, Any]] = []

    class Session:
        def __init__(self, **kwargs: Any) -> None:
            sessions.append(kwargs)
            self.region_name = kwargs["region_name"]

        def client(self, **_kwargs: Any) -> Any:
            return SimpleNamespace(meta=SimpleNamespace(region_name=self.region_name))

    monkeypatch.setattr(boto3, "Session", Session)
    store = SimpleNamespace(set_config_variable=lambda _key, _value: None)
    monkeypatch.setattr(botocore.session, "get_session",
                        lambda: SimpleNamespace(
                            available_profiles={"workshop"},
                            get_component=lambda _name: store,
                        ))
    monkeypatch.setattr(strands, "Agent", lambda **kwargs: SimpleNamespace(**kwargs))
    return sessions


def test_each_role_constructs_its_configured_bedrock_model(
    offline_bedrock: list[dict[str, Any]],
) -> None:
    overrides = {
        "extractor": HAIKU,
        "orchestrator": SONNET,
        "reader": HAIKU,
        "writer": SONNET,
        "verifier": HAIKU,
    }
    provider = MultiAgentProvider("fallback-model", "us-east-1", "workshop",
                                  role_model_ids=overrides)
    agents = {"extractor": provider._agent()}
    agents.update({role: provider._team_agent(role, []) for role in ROLES[1:]})

    assert len(offline_bedrock) == 5
    assert all(session == {"profile_name": "workshop", "region_name": "us-east-1"}
               for session in offline_bedrock)
    for role, agent in agents.items():
        config = agent.model.config
        assert config["model_id"] == overrides[role]
        assert config["max_tokens"] == 1800
        assert config["streaming"] is False
        if overrides[role] == SONNET:
            assert "temperature" not in config
            assert config["additional_request_fields"] == {"thinking": {"type": "disabled"}}
        else:
            assert config["temperature"] == 0
            assert "additional_request_fields" not in config
    for role in ("extractor", "reader"):
        prompt = agents[role].system_prompt
        assert '"evidence":[{' in prompt
        assert "no markdown fences" in prompt
    assert "no markdown fences" in agents["verifier"].system_prompt


def test_legacy_constructors_and_missing_role_fallback(
    offline_bedrock: list[dict[str, Any]],
) -> None:
    provider = MultiAgentProvider(HAIKU, "us-east-1", role_model_ids={"writer": SONNET})
    assert provider._agent().model.config["model_id"] == HAIKU
    assert provider._team_agent("reader", []).model.config["model_id"] == HAIKU
    assert provider._team_agent("writer", []).model.config["model_id"] == SONNET
    legacy = BedrockProvider(HAIKU, "us-east-1")
    assert legacy._agent().model.config["model_id"] == HAIKU
    assert legacy._plan_agent([]).model.config["model_id"] == HAIKU
    assert len(offline_bedrock) == 5


def test_role_config_rejects_unknown_blank_or_incomplete_models() -> None:
    with pytest.raises(ValueError, match="Unknown Bedrock model role"):
        MultiAgentProvider(HAIKU, "us-east-1", role_model_ids={"spellchecker": SONNET})
    with pytest.raises(ValueError, match="nonempty strings"):
        MultiAgentProvider(HAIKU, "us-east-1", role_model_ids={"writer": ""})
    with pytest.raises(ValueError, match="required for"):
        MultiAgentProvider("", "us-east-1", role_model_ids={"extractor": HAIKU})
    complete = MultiAgentProvider("", "us-east-1",
                                  role_model_ids={role: HAIKU for role in ROLES})
    assert complete.model_id_for("verifier") == HAIKU


def test_workflow_app_configures_roles_and_stays_offline_without_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key in ("BEDROCK_MODEL_OR_PROFILE_ID", "BEDROCK_EXTRACTOR_MODEL_ID",
                "BEDROCK_ORCHESTRATOR_MODEL_ID", "BEDROCK_READER_MODEL_ID",
                "BEDROCK_WRITER_MODEL_ID", "BEDROCK_VERIFIER_MODEL_ID"):
        monkeypatch.delenv(key, raising=False)
    unconfigured = create_workflow_app(database_path=str(tmp_path / "offline.sqlite3"))
    assert unconfigured.state.workflow_service.provider is None

    monkeypatch.setenv("BEDROCK_MODEL_OR_PROFILE_ID", HAIKU)
    configured_ids = {role: f"test-model-{role}" for role in ROLES}
    for role, model_id in configured_ids.items():
        monkeypatch.setenv(f"BEDROCK_{role.upper()}_MODEL_ID", model_id)
    configured = create_workflow_app(database_path=str(tmp_path / "configured.sqlite3"))
    provider = configured.state.workflow_service.provider
    assert isinstance(provider, MultiAgentProvider)
    assert {role: provider.model_id_for(role) for role in ROLES} == configured_ids

    monkeypatch.delenv("BEDROCK_MODEL_OR_PROFILE_ID")
    monkeypatch.delenv("BEDROCK_READER_MODEL_ID")
    with pytest.raises(ValueError, match="required"):
        create_workflow_app(database_path=str(tmp_path / "incomplete.sqlite3"))


def test_one_complete_json_fence_keeps_grounding_checks() -> None:
    excerpt = {"source_id": "source-1", "source_hash": "hash-1", "page": 1,
               "text": "Company: Northstar"}
    raw = ('```json\n{"proposals":[{"field":"company_name","value":"Northstar",'
           '"evidence":[{"source_id":"source-1","source_hash":"hash-1",'
           '"page":1,"quote":"Company: Northstar"}]}]}\n```')
    result = ModelResult.model_validate(parse_model_json(raw))
    assert len(validated_proposals(result, [excerpt])) == 1


@pytest.mark.parametrize("raw", [
    'Here is JSON: ```json\n{"proposals":[]}\n```',
    '```json\n{"proposals":[]}\n```\n```json\n{"proposals":[]}\n```',
    '```json\n{"proposals":[]}',
    '```python\n{"proposals":[]}\n```',
    '```json\n{"proposals":[]}\n``` trailing text',
])
def test_json_transport_rejects_prose_multiple_or_malformed_fences(raw: str) -> None:
    with pytest.raises(ValueError):
        parse_model_json(raw)
