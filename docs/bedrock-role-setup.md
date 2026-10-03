# Bedrock role setup and verification

Scope: the founder packet workflow's five Strands roles, source citations and human PDF confirmation gates. This configuration does not configure the legacy founder AI Chat agent or the separate server synthetic advisor assistant. No new cloud resources, IAM grants, subscriptions, databases, or dependencies.

## Model selection

| Role | Model | Reason |
| --- | --- | --- |
| Extractor | Claude Haiku 4.5 | Bounded extraction of six cited fields |
| Reader | Claude Haiku 4.5 | Read-only source retrieval and grounded proposals |
| Orchestrator | Claude Sonnet 5 | Multi-step delegation and handling missing/conflicting evidence |
| Writer | Claude Sonnet 5 | Tool-based edits that must preserve existing packet fields |
| Verifier | Claude Haiku 4.5 | Narrow comparison against deterministic PDF inspection |

These are the role choices encoded in the example configuration, not a current account-access or performance guarantee. The verifier supplements deterministic field/hash checks; no model may approve, save, share, or send on its own. Model settings do not add advisor routing or after-call processing to the current product.

The example configuration uses profile `relay-hackathon` in `us-east-1`, with IDs `us.anthropic.claude-sonnet-5` and `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Configuration and old successful runs do not establish current access. Verify only when live account checks are authorized.

Sonnet 5 rejects the old `temperature=0` argument. Its bounded Relay requests omit temperature and explicitly disable adaptive thinking. Haiku retains temperature zero. No automatic model substitution occurs after errors.

Sources: [AWS Sonnet 5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html), [AWS Haiku 4.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html), [AWS model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

## Run

From `backend`, using the existing project virtual environment:

```bash
python scripts/run_bedrock.py serve
python scripts/run_bedrock.py check  # billable, synthetic live AWS calls
```

Both commands read `.relay/bedrock.json`, a local nonsecret settings file. `bedrock.example.json` documents the complete five-role configuration; copy it to that path and select an existing AWS CLI profile. No `.env` file is loaded. `--config PATH` selects another settings file; `serve --port PORT` changes the loopback port.

For Windows-login/WSL-development setups, add `windows_aws_cli` with the WSL path to the existing Windows `aws.exe`. The launcher creates a temporary, private AWS config containing a `credential_process` command to export that profile's short-lived credentials directly to Boto. Tokens are not printed or written to the repo. The credential-process command explicitly includes the configured region, including during refresh. The Windows CLI owns login/refresh; if the session expires, run `aws login --profile relay-hackathon --region us-east-1` in Windows and retry. No credentials are copied into WSL credential stores. Native Linux profiles work by omitting `windows_aws_cli`.

Direct uvicorn startup can instead use `BEDROCK_MODEL_OR_PROFILE_ID` plus optional `BEDROCK_EXTRACTOR_MODEL_ID`, `BEDROCK_ORCHESTRATOR_MODEL_ID`, `BEDROCK_READER_MODEL_ID`, `BEDROCK_WRITER_MODEL_ID`, and `BEDROCK_VERIFIER_MODEL_ID`, with `AWS_PROFILE` and `AWS_REGION`. Missing role overrides inherit the shared ID. No configuration leaves the app unconfigured; it never silently enables paid calls.

## Verification contract

The live evaluator's acceptance assertions are fixed: all six extracted facts must pass existing citation validation; actual orchestrator, reader, writer, and verifier steps must complete; the preview must pass deterministic plus model inspection; no packet may exist before explicit confirmation; the downloaded saved PDF must exactly match the inspected preview bytes/hash. It uses a temporary local database and synthetic data only. Normal pytest never invokes AWS.

Live checks are billable and require separate authorization. Preserve the evaluator assertions and report simulated and live evidence separately. Historical run results are retained in Git history, not treated as current acceptance evidence.
