# Bedrock role setup and verification

Scope: existing AI Chat Strands workflow, with its source citations and human PDF confirmation gates. No new cloud resources, IAM grants, subscriptions, databases, or dependencies.

## Model selection

| Role | Model | Reason |
| --- | --- | --- |
| Extractor | Claude Haiku 4.5 | Bounded extraction of six cited fields |
| Reader | Claude Haiku 4.5 | Read-only source retrieval and grounded proposals |
| Orchestrator | Claude Sonnet 5 | Multi-step delegation and handling missing/conflicting evidence |
| Writer | Claude Sonnet 5 | Tool-based edits that must preserve existing packet fields |
| Verifier | Claude Haiku 4.5 | Narrow comparison against deterministic PDF inspection |

These are workload-based choices validated with a small synthetic workflow, not an exhaustive quality or cost benchmark. The verifier supplements deterministic field/hash checks; no model may approve, save, share, or send on its own. Specs' planned advisor routing and after-call summary are not implemented by adding model settings.

AWS identity and catalog were checked with CLI profile `relay-hackathon` in `us-east-1`. Exact IDs are `us.anthropic.claude-sonnet-5` and `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Both returned AUTHORIZED with available entitlement and region. The US inference profiles permit cross-region routing within the US geography.

Sonnet 5 rejects the old `temperature=0` argument. Its bounded Relay requests omit temperature and explicitly disable adaptive thinking. Haiku retains temperature zero. No automatic model substitution occurs after errors.

Sources: [AWS Sonnet 5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html), [AWS Haiku 4.5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html), [AWS model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

## Run

From `backend`, using the existing project virtual environment:

```bash
python scripts/run_bedrock.py serve
python scripts/run_bedrock.py check  # billable, synthetic live AWS calls
```

Both commands read `.relay/bedrock.json`, a local nonsecret settings file. `bedrock.example.json` documents the complete five-role configuration; copy it to that path and select an existing AWS CLI profile. No `.env` file is loaded. `--config PATH` selects another settings file; `serve --port PORT` changes the loopback port.

For Windows-login/WSL-development setups, add `windows_aws_cli` with the WSL path to the existing Windows `aws.exe`. The launcher creates a temporary, private AWS config containing a `credential_process` command to export that profile's short-lived credentials directly to Boto. Tokens are not printed or written to the repo. The Windows CLI owns login/refresh; if the session expires, run `aws login --profile relay-hackathon` in Windows and retry. No credentials are copied into WSL credential stores. Native Linux profiles work by omitting `windows_aws_cli`.

Direct uvicorn startup can instead use `BEDROCK_MODEL_OR_PROFILE_ID` plus optional `BEDROCK_EXTRACTOR_MODEL_ID`, `BEDROCK_ORCHESTRATOR_MODEL_ID`, `BEDROCK_READER_MODEL_ID`, `BEDROCK_WRITER_MODEL_ID`, and `BEDROCK_VERIFIER_MODEL_ID`, with `AWS_PROFILE` and `AWS_REGION`. Missing role overrides inherit the shared ID. No configuration leaves the app unconfigured; it never silently enables paid calls.

## Verification contract

The live evaluator's acceptance assertions are fixed: all six extracted facts must pass existing citation validation; actual orchestrator, reader, writer, and verifier steps must complete; the preview must pass deterministic plus model inspection; no packet may exist before explicit confirmation; the downloaded saved PDF must exactly match the inspected preview bytes/hash. It uses a temporary local database and synthetic data only. Normal pytest never invokes AWS.

Iterate only on this branch's Bedrock routing, model prompts, and startup tooling. Preserve existing regression tests and live evaluator assertions. Stop on passing offline regression and live workflow checks, an external authorization blocker, or two identical failures without a changed diagnosis. Limit implementation correction rounds to three before reassessing. Record outcomes below; never label simulated evidence as live.

## Results

Verified on 2026-10-03 UTC:

- AWS CLI identity, model catalog and availability checks succeeded. Short Converse requests succeeded for both selected models.
- Live evaluator: `PASS live extractor: six grounded fields`; `PASS live orchestrator -> reader -> writer -> verifier -> preview -> explicit confirmation -> identical PDF`. Full evaluator elapsed 108.73 seconds, including separate extraction and the multi-agent workflow.
- Local server startup and `/api/workflow/session` reported `mode: live`, provider `Amazon Bedrock (multi-agent PDF team)`.
- Three live evaluator iterations: initial ambiguous evidence schema/fenced JSON failure; exact-schema prompt corrected evidence shape but fences remained; strict single-fence normalization passed. Schema validation, citation checks and confirmation gates remain enforced. No repeated blind retries.
- Offline backend suite: 113 passed; final focused routing/team/workflow check: 34 passed. Independent integration review found no actionable issues; its final focused team/routing/launcher check passed 25 tests. `git diff --check` passed.

The code accepts raw JSON or one complete JSON markdown fence only; surrounding prose, multiple fences, malformed JSON and invalid citations remain rejected. The prompts explicitly request the exact evidence-array schema.

Delegation acceptance units: five-role routing and backward compatibility; regression coverage. Two focused correction rounds addressed the live JSON-format findings. Observed account-wide Codex weekly usage moved from 41% to 42% during the implementation interval; other activity is unknown, so this is not a task cost. AWS charges were not measured. No comparative performance claim is made.
