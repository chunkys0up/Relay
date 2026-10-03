"""Use the unchanged credential bridge for bounded advisor checks; no secret inspection."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import run_bedrock


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["preflight", "check", "advisor-only"])
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    original_call = subprocess.call
    scripts = Path(__file__).resolve().parent

    def launch(command: list[str], **kwargs: object) -> int:
        target = scripts / ("advisor_preflight.py" if args.command == "preflight" else "check_advisor_bedrock.py")
        return original_call([sys.executable, str(target)] + (["--advisor-only"] if args.command == "advisor-only" else []), **kwargs)

    with patch.object(sys, "argv", ["run_bedrock.py", "check", "--config", str(args.config)]):
        with patch.object(subprocess, "call", launch):
            return run_bedrock.main()


if __name__ == "__main__":
    raise SystemExit(main())
