"""Read-only identity and exact model availability through the existing credential bridge."""
from __future__ import annotations

import json
import os
import boto3


def main() -> None:
    session = boto3.Session(profile_name=os.environ["AWS_PROFILE"], region_name=os.environ["AWS_REGION"])
    identity = session.client("sts").get_caller_identity()
    print(json.dumps({"bridge_identity": identity["Arn"].split(":assumed-role/")[-1], "region": session.region_name}))
    bedrock = session.client("bedrock")
    for role in ("orchestrator", "reader"):
        model = os.environ[f"BEDROCK_{role.upper()}_MODEL_ID"]
        profile = bedrock.get_inference_profile(inferenceProfileIdentifier=model)
        assert profile["status"] == "ACTIVE"
        print(json.dumps({"role": role, "model": model, "status": profile["status"]}))


if __name__ == "__main__":
    main()
