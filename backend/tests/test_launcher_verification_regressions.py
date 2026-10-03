"""Offline regressions for the configured Windows AWS credential bridge."""
from __future__ import annotations

import configparser
import json
from pathlib import Path
import shlex
from typing import Any

import pytest

from test_bedrock_launcher import SCRIPT, runner


@pytest.mark.parametrize("region", ["us-east-1", "us-west-2"])
def test_windows_credential_process_uses_explicit_config_region(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, region: str,
) -> None:
    executable = tmp_path / "AWS CLI" / "aws.exe"
    executable.parent.mkdir()
    executable.touch()
    settings = {"profile": "existing-login", "region": region,
                "windows_aws_cli": str(executable),
                "models": {role: f"unused-model-{role}" for role in
                           ("extractor", "orchestrator", "reader", "writer", "verifier")}}
    config = tmp_path / "bedrock.json"
    config.write_text(json.dumps(settings), encoding="utf-8")
    monkeypatch.setattr("sys.argv", [str(SCRIPT), "check", "--config", str(config)])
    # Use only a synthetic environment; this test never reads real AWS credentials.
    monkeypatch.setattr(runner.os, "environ", {
        "AWS_REGION": "eu-west-1", "AWS_DEFAULT_REGION": "eu-west-1",
        "AWS_PROFILE": "unrelated-profile",
    })
    seen: list[list[str]] = []

    def child(command: list[str], *, cwd: Path, env: dict[str, str]) -> int:
        assert command[-1].endswith("check_bedrock.py")
        assert env["AWS_REGION"] == env["AWS_DEFAULT_REGION"] == region
        assert env["AWS_PROFILE"] == "relay-windows"
        generated = configparser.RawConfigParser()
        generated.read(Path(env["AWS_CONFIG_FILE"]), encoding="utf-8")
        profile = generated["profile relay-windows"]
        assert profile["region"] == region
        arguments = shlex.split(profile["credential_process"])
        seen.append(arguments)
        assert arguments == [str(executable), "configure", "export-credentials",
                             "--profile", "existing-login", "--region", region,
                             "--format", "process"]
        return 0

    monkeypatch.setattr(runner.subprocess, "call", child)
    assert runner.main() == 0
    assert len(seen) == 1
