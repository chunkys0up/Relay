from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/run_bedrock.py"
spec = importlib.util.spec_from_file_location("run_bedrock", SCRIPT)
assert spec is not None and spec.loader is not None
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def test_windows_bridge_keeps_tokens_out_of_config_and_cleans_up(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    executable = tmp_path / "AWS CLI" / "aws.exe"
    executable.parent.mkdir()
    executable.touch()
    settings = {"profile": "existing-login", "region": "us-east-1", "windows_aws_cli": str(executable),
                "models": {role: "model-" + role for role in ["extractor", "reader", "writer", "orchestrator", "verifier"]}}
    config = tmp_path / "bedrock.json"
    config.write_text(json.dumps(settings))
    monkeypatch.setattr("sys.argv", [str(SCRIPT), "check", "--config", str(config)])
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "stale-key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "stale-secret")
    created: list[Path] = []

    def child(command: list[str], *, cwd: Path, env: dict[str, str]) -> int:
        assert command[-1].endswith("check_bedrock.py")
        assert "AWS_ACCESS_KEY_ID" not in env and "AWS_SECRET_ACCESS_KEY" not in env
        assert env["AWS_PROFILE"] == "relay-windows"
        assert env["BEDROCK_READER_MODEL_ID"] == "model-reader"
        path = Path(env["AWS_CONFIG_FILE"])
        created.append(path)
        text = path.read_text()
        assert "credential_process" in text and "export-credentials" in text
        assert "stale-key" not in text and "stale-secret" not in text
        assert "existing-login" in text
        assert path.stat().st_mode & 0o777 == 0o600
        return 0

    monkeypatch.setattr(runner.subprocess, "call", child)
    assert runner.main() == 0
    assert created and not created[0].exists()


def test_launcher_requires_all_explicit_roles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "bedrock.json"
    config.write_text(json.dumps({"profile": "unused", "region": "us-east-1", "models": {"reader": "x"}}))
    monkeypatch.setattr("sys.argv", [str(SCRIPT), "check", "--config", str(config)])
    with pytest.raises(SystemExit, match="2"):
        runner.main()


@pytest.mark.parametrize("port", [None, "8044"])
def test_serve_uses_unified_backend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, port: str | None) -> None:
    config = tmp_path / "bedrock.json"
    config.write_text(json.dumps({"profile": "unused", "region": "us-east-1",
        "models": {role: "offline" for role in ("extractor", "orchestrator", "reader", "writer", "verifier")}}))
    args = [str(SCRIPT), "serve", "--config", str(config)]
    if port is not None:
        args += ["--port", port]
    monkeypatch.setattr("sys.argv", args)
    calls: list[list[str]] = []

    def child(command: list[str], *, cwd: Path, env: dict[str, str]) -> int:
        calls.append(command)
        assert command[3:] == ["app.main:app", "--host", "127.0.0.1", "--port", port or "8000"]
        return 0

    monkeypatch.setattr(runner.subprocess, "call", child)
    assert runner.main() == 0
    assert len(calls) == 1
