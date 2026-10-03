"""Launch Relay using explicit nonsecret settings and the existing AWS CLI login."""
from __future__ import annotations

import argparse
import configparser
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["serve", "check"])
    parser.add_argument("--config", type=Path, default=Path(".relay/bedrock.json"))
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    settings = json.loads(args.config.read_text())
    allowed = {"profile", "region", "windows_aws_cli", "models"}
    if set(settings) - allowed:
        parser.error("Unknown Bedrock settings")
    roles = {"extractor", "orchestrator", "reader", "writer", "verifier"}
    models = settings["models"]
    if set(models) != roles or not all(isinstance(v, str) and v.strip() for v in models.values()):
        parser.error("Configure all five role model IDs")
    env = os.environ.copy()
    env["AWS_REGION"] = settings["region"]
    env["AWS_DEFAULT_REGION"] = settings["region"]
    env["AWS_PROFILE"] = settings["profile"]
    env["BEDROCK_MODEL_OR_PROFILE_ID"] = models["orchestrator"]
    for role, model in models.items():
        env[f"BEDROCK_{role.upper()}_MODEL_ID"] = model
    backend = Path(__file__).resolve().parents[1]
    command = ([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
                "--port", str(args.port)] if args.command == "serve" else
               [sys.executable, str(backend / "scripts/check_bedrock.py")])
    with tempfile.TemporaryDirectory(prefix="relay-aws-") as scratch:
        windows_cli = settings.get("windows_aws_cli")
        if windows_cli:
            if not Path(windows_cli).is_file():
                parser.error("Configured Windows AWS CLI does not exist")
            # Boto refreshes through credential_process; tokens are never written here.
            config = configparser.RawConfigParser()
            config["profile relay-windows"] = {
                "region": settings["region"],
                "credential_process": shlex.join([windows_cli, "configure", "export-credentials",
                    "--profile", settings["profile"], "--region", settings["region"],
                    "--format", "process"]),
            }
            config_path = Path(scratch) / "config"
            with config_path.open("w") as handle:
                config.write(handle)
            config_path.chmod(0o600)
            env["AWS_CONFIG_FILE"] = str(config_path)
            env["AWS_SHARED_CREDENTIALS_FILE"] = str(Path(scratch) / "unused-credentials")
            env["AWS_PROFILE"] = "relay-windows"
            for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
                        "AWS_SECURITY_TOKEN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN"):
                env.pop(key, None)
        return subprocess.call(command, cwd=backend, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
