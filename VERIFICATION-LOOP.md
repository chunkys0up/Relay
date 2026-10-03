# Bounded verification contract — 2026-10-02

Baseline e3036ff; branch codex/verification-20261002; WSL worktree /home/tim/Relay-worktrees/verification-20261002. This file is fixed before application edits.

## Acceptance and scope
- Inventory implemented versus planned functionality; test only implemented behavior.
- Existing regression test files and backend/scripts/check_bedrock.py are locked: no edits or weakened assertions. Additional isolated tests may be added and then retained.
- All required backend pytest, frontend lint/typecheck/unit/build, demo Playwright and backend workflow Playwright checks pass, or specific external blockers are recorded.
- Browser evidence covers affected flows, console/network errors, desktop and narrow screens.
- Live AWS identity, region, exact profile/model availability and launcher check must succeed to call Bedrock verified. At most THREE complete synthetic smoke attempts. No mock substitution.
- Live smoke requires six grounded extracted facts, orchestrator/reader/writer/verifier, deterministic+agent preview, no save before human confirmation, hash match and byte-identical confirmed download.
- Inspect role model routing, actual tool execution, read-before-cite, order, scoping, rejected malformed/unsupported outputs, budgets, no false success and human-only save/share/send/approval.
- Material fixes receive independent review and affected checks plus required project checks.
- No credentials/.env reads, installs, IAM/resource/subscription changes, real calls/messages, merge/deploy/publish.

## Feature → meaningful verifier
| Implemented feature | Verifier |
|---|---|
| Local founder/advisor routes, private/shared versions, review boundaries | frontend mock/workflow tests; browser screens/control-transitions/workflow-regressions |
| Backend owner/session/case and WebSocket boundaries | test_workflow; packet browser second-session case isolation |
| AI replies, missing/conflicting evidence, errors and retry | test_team, test_workflow, test_source_acceptance; source-aware browser |
| Uploads, native PDF/text extraction, duplicates/revisions/citations | test_documents, test_source_aware, test_source_acceptance; source-aware browser |
| Persistent tasks/dependencies/reload/interruption/idempotency | test_workflow, test_source_acceptance, test_source_aware; durability/reconnect browsers |
| Fact proposals, confirmation, authorship/history | test_workflow, test_source_aware; packet/source-aware browsers |
| PDF create/edit/fill, verification/preview/staleness/confirmation/download | test_pdf_actions, test_pdf_verification, test_verification_gate, test_team_api; agent-actions/team/packet browsers |
| Tool arguments/order/scoping/grounding/budget/model roles | test_agent_tools, test_team, test_model_routing; independent review |
| Call consent and controls | frontend call/liveCall tests and chime-design browser with mocked external operations only |
| Live Bedrock extraction and complete Strands PDF flow | AWS CLI read-only checks; run_bedrock.py check, max 3 runs |

Planned and excluded: RDS persistence integration, complete backend founder/advisor handoff, capture/Transcribe processing. Real Chime operations/two-person media are unauthorized and untested.

## Loop and stop rules
Baseline round 0. Maximum three corrections per failing scenario. Same blocker twice without new diagnosis stops that path; independent checks continue. Read this contract before corrections. Append scenario, expected, actual, evidence, diagnosis/fix and rerun to verification log. Success requires acceptance above; otherwise report exact unresolved blockers. No recurring automation.
