# Relay verification and fix handoff

> Shipping integration update: remote main advanced to 9ce2a3e during shipping. Its document-upload and layout changes were preserved in merge 903871d. On the combined code, backend 134 passed; lint, typecheck and build passed; frontend 82 passed / 2 failed. Both advisor Documents failures reproduce identically on untouched upstream 9ce2a3e: missing shared-source button and missing no-results state. No tests were weakened. Browser results below describe the earlier verification baseline, not a new browser run against the integrated upstream UI. New upstream code includes Postgres/S3 document queries and a generic live chat component; older planned/implemented notes below must be read as baseline observations. Advisor Clients still uses the local Conversation adapter. No further live Bedrock smoke was run.


Date: October 2,2026 (America/Los_Angeles; logs cross October 3 UTC).
Worktree: /home/tim/Relay-worktrees/verification-20261002
Branch: codex/verification-20261002
Baseline: e3036ff

## Result
All final offline checks passed. Five concrete defects were corrected and independently reviewed. Live Bedrock completed one entire synthetic workflow before fixes, but post-fix live acceptance is **incomplete**: the three-smoke cap was reached while diagnosing a credential refresh region bug. The corrected bridge subsequently passed live read-only STS. No fourth billable smoke was run. Therefore **not all acceptance criteria passed**.

The main checkout is unchanged. Nothing was committed, merged, deployed or published. No package installation, real .env/credential inspection, IAM change, resource creation, subscription or real human call/message occurred.

## Implemented feature inventory and status
| Feature | Status and evidence |
|---|---|
| Founder/advisor Home, AI Chat, Clients, contextual documents/review navigation | PASS local demo: unit +66browser tests; direct computer-use founder/advisor navigation |
| Assigned case/private AI/exact shared packet-version boundaries | PASS local demo tests; owner/session/case REST/WebSocket isolation PASS backend +second-browser-session test |
| Backend AI Chat, missing/conflicting values, errors/recovery | PASS offline real-Strands/simulated-model tests; LIVE baseline workflow PASS; final live rerun limited below |
| Native PDF/text/CSV sources, duplicates, revisions, original retention, citations | PASS backend source/extraction suites +source-aware browser |
| Persistent tasks/dependencies/progress/completion/reload/interrupted jobs | PASS SQLite backend and IndexedDB local demo; reconnect/durability/browser checks |
| Fact proposals/human confirmation/authorship/history | PASS backend/unit/browser; direct computer-use confirmation attributed to Founder |
| PDF creation/edit/fill, deterministic+agent verification, stale rejection, exact confirmation | PASS backend/PDF/browser. Direct UI: save disabled before checkbox, reviewed/downloaded1-page PDF, saved v1 survives reload |
| PDF integrity | PASS live baseline plus browser tests and direct downloads: preview=savedSHA256 15d0e0875e4949f4826191eddbb0d2d01af2ff33802210ec7f346fe1ddb04234 |
| Repeated submission/idempotency/reconnect/concurrent stale writes | PASS backend and browser |
| Agent role routing/order/read-before-cite/argument and case validation | PASS actual real-Strands tool execution under deterministic models, role-model construction tests, independent review; baseline LIVE full team |
| Fabricated citations/unsupported values/unauthorized tools/malformed output/budgets | PASS fail-closed regressions; new budget tests retain terminal failure after Strands catches tool exceptions |
| No false success / human-only save/share/send/approval | PASS after state-derived reply fix; no model side-effect tools registered; explicit application confirmation gates |
| Call controls and consent | PASS local/mocked-Chime tests; direct UI clearly labels simulated state, unavailable devices, no capture controls. Real Chime/media/capture NOT RUN |
| Desktop/narrow layout and console | PASS browser suites atdesktop / 390 px +computer use at 1440x1000 and 390x844; direct console empty |
| Embedded PDF viewer in Codex in-app browser | LIMITED: blank viewer; download fallback worked and downloaded actual PDF rendered correctly with installed pypdfium2 |

Planned/excluded: RDS integration, production authentication, full backend founder/advisor sharing/review handoff, capture/Transcribe after-call processing. These were not implemented during verification. The existing backend workspace remains founder-only; advisor work is the local synthetic adapter. Actual S3/Textract/Chime cloud operations were not authorized by this Bedrock-only task and were not called.

## AWS and live evidence
Profile: relay-hackathon. Region: us-east-1 from nonsecret backend/.relay/bedrock.json. Existing profile has no default region.
Identity: existing assumed role WSParticipantRole/Participant (account omitted here; safe exact identity retained in bridge-identity.txt).

| Role | Exact inference-profile ID |
|---|---|
| Extractor | us.anthropic.claude-haiku-4-5-20251001-v1:0 |
| Orchestrator | us.anthropic.claude-sonnet-5 |
| Reader | us.anthropic.claude-haiku-4-5-20251001-v1:0 |
| Writer | us.anthropic.claude-sonnet-5 |
| Verifier | us.anthropic.claude-haiku-4-5-20251001-v1:0 |

CLI get-inference-profile: both ACTIVE. Foundation-model availability: both AUTHORIZED; entitlement/agreement/region AVAILABLE. These are actual AWS results, not status badges.

Smoke1: PASS in104.6 seconds; six grounded extracted fields; orchestrator/reader/writer/verifier; deterministic+agent PDF verification; no packet before explicit confirmation; exact preview hash and byte-identical saved download.
Smoke2: extractor PASS then safely blocked BEDROCK_UNAVAILABLE. Original error wrapping did not retain exact cause; subsequent refresh failure is a likely explanation, not proven attribution.
Smoke3: CredentialRetrievalError / NoRegion during extractor. Windows credential_process lacked --region; WSL environment variables were insufficient for refresh. Fixed launcher explicitly passes configuration region.
After fix: read-only STS through the exact launcher-generated credential_process PASSED. No credentials were printed or persisted by the verification harness. Complete post-fix Bedrock smoke remains unverified because all3 attempts were consumed.

## Fixes and files
- backend/app/workflow/documents.py: replace hardcoded Northstar template heading with Relay; actual company remains in its confirmed field. Visually rendered corrected PDF and added test_packet_heading_regression.py.
- backend/app/workflow/team.py: action-status responses derive from actual staged state; only trusted exact clarification/preview templates survive. Global tool budget 18 accommodates two delegations plus8 per specialist. Local budget failure remains terminal even when Strands converts exceptions to tool results. Diagnostics log exception type and sanitized AWS error code, never raw exception text.
- backend/app/workflow/model.py: legacy tool planner uses the same status gate.
- backend/scripts/run_bedrock.py: Windows credential_process receives explicit configured --region.
- backend/tests/test_verification_regressions.py:18new offline regressions (including logging); actual Strands tool execution, batched5/6source edits, global/local budgets, false claims, legacy path.
- backend/tests/test_launcher_verification_regressions.py:2 new explicit-region/quoting regressions.
- VERIFICATION-LOOP.md:fixed acceptance criteria and feature-test map established before edits.
- verification.playwright.config.ts and verification.vite.config.ts:isolated workflow test port8019 without touching existing8001server or changing test assertions.
- verification-evidence/:append-only scenario log, command outputs and browser artifacts.

## Commands actually run
- PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q:baseline 113 PASS; final 134 PASS.
- npm run lint:PASS. npm run typecheck:PASS.
- npm test -- --maxWorkers=2:79 PASS across 19 files. Initial accidental dependency-test discovery and contention were diagnosed; assertions untouched.
- npm run build:PASS; existing large-Chime-bundle warning remains.
- node_modules/.bin/playwright test --workers=1 --output=verification-evidence/demo-final:66 PASS. Prior workers2run had65PASS/1transient Working-state miss; isolated unchanged2-test durability rerunPASS.
- node_modules/.bin/playwright test --config verification.playwright.config.ts:6 PASS; repeated after final PDF fix with identical assertions.
- git diff --check:PASS. Existing regression files and live evaluator have no diff.
- Independent review:original code failed15 of 16 new behavioral regressions; original launcher failed2 new region tests;22 affected current testsPASS. No unresolved substantive review finding.
- Computer use:actual UI clicks/typing/review checkbox/save/download/reload, desktop/narrow screenshots and console inspection; models explicitly simulated for this UI run. Live model evidence comes from the separate smoke above.

## Loop accounting and remaining step
Two correction rounds for action-status behavior (preserve existing safe-preview wording in round2); one each for tool budgets and launcher. PDF heading: one correction round. No scenario exceeded3 rounds. Exactly 3 live smoke attempts, one full PASS. Final full live acceptance remains BLOCKED BY RUN CAP, not by current identity access.

If a further billable run is authorized in a new loop, execute in WSL:

    cd /home/tim/Relay-worktrees/verification-20261002/backend
    .venv/bin/python scripts/run_bedrock.py check --config /home/tim/Relay/backend/.relay/bedrock.json

If AWS credentials actually expire, the safe Windows recovery is:

    aws login --profile relay-hackathon --region us-east-1

No login was needed after the explicit-region fix. Do not modify IAM or subscribe to models as a recovery step.
