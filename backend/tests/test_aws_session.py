from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import boto3
import botocore.session
import pytest

from app.core.aws_session import create_aws_session


def _capture_sessions(monkeypatch: pytest.MonkeyPatch, profiles: set[str]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def session(**kwargs: Any) -> SimpleNamespace:
        calls.append(kwargs)
        return SimpleNamespace()

    monkeypatch.setattr(boto3, "Session", session)
    store = SimpleNamespace(set_config_variable=lambda _key, _value: None)
    monkeypatch.setattr(
        botocore.session, "get_session",
        lambda: SimpleNamespace(
            available_profiles=profiles, get_component=lambda _name: store,
        ),
    )
    return calls


def test_existing_named_profile_wins_over_environment_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _capture_sessions(monkeypatch, {"relay"})
    monkeypatch.setenv("AWS_PROFILE", "relay")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
    create_aws_session("us-east-1", "relay")
    assert calls == [{"profile_name": "relay", "region_name": "us-east-1"}]


def test_missing_named_profile_uses_explicit_environment_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _capture_sessions(monkeypatch, set())
    monkeypatch.setenv("AWS_PROFILE", "other-host")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "test-token")
    create_aws_session("us-east-1", "other-host")
    assert len(calls) == 1
    assert calls[0]["aws_access_key_id"] == "test-access"
    assert calls[0]["aws_secret_access_key"] == "test-secret"
    assert calls[0]["aws_session_token"] == "test-token"
    assert calls[0]["region_name"] == "us-east-1"
    assert calls[0]["botocore_session"].get_component("config_store") is not None


def test_missing_profile_without_environment_credentials_stays_explicit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _capture_sessions(monkeypatch, set())
    monkeypatch.setenv("AWS_PROFILE", "other-host")
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    create_aws_session("us-east-1")
    assert calls == [{"profile_name": "other-host", "region_name": "us-east-1"}]


def test_unconfigured_profile_uses_default_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture_sessions(monkeypatch, set())
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY", raising=False)
    create_aws_session("us-east-1")
    assert calls == [{"region_name": "us-east-1"}]
