# Source-aware loop evidence

## Preparation
- Worktree: `/home/tim/Relay-source-aware`, branch `codex/source-aware-tasks`, freshly fetched origin/main `d54fa55`.
- Host Windows, PowerShell 7.6; development WSL Ubuntu-22.04, Linux home `/home/tim`.
- Read request, global guidance, README/backend README, specs, implementation plan, workflow architecture and implementation handoffs. No tracked project AGENTS files found. `rg` unavailable in WSL; used tracked file lists and bounded standard-tool reads.
- Fixed seven acceptance units and eight-cycle cap in LOOP.md before implementation.
- Baseline backend: 80 passed in 10.74s.
- Initial frontend typecheck could not resolve pre-existing Chime dependency in main's node_modules. Reused already installed package from approved-redesign worktree; no installs or manifest changes. Typecheck then passed.
- Dependencies reused via ignored symlinks: root node_modules from Relay, backend .venv from bedrock-documents, frontend Chime package from approved-redesign.
- Workers: backend and frontend implementation dispatched to gpt-6-sol/high, bounded ownership. Coordinator owns integration, browser acceptance and independent review gate.
- Pre-dispatch usage: codex 10080-minute window 34% used, reset 1791580471; account-wide, task attribution unknown.

## Verification and corrections
Pending implementation and final verification. Baseline is not verification of changed code.

## Final results (2 October 2026, PDT)

| Check | Actual result |
| --- | --- |
| Full backend pytest suite | 100 passed in 15.55s (backend worker); coordinator independently ran prior 97-test combined state, all passed |
| Final independent review | 27 targeted tests passed; latest source-aware suite 10 passed plus four stale-preview non-revival checks; no unresolved material findings |
| `npm test` | 79 passed across 19 files, coordinator final run |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing Chime bundle exceeds Vite's 500 kB advisory threshold |
| `npm run test:browser -- --workers=2` | 66 passed in 2.2 minutes; existing navigation, keyboard, role boundaries, durable local-demo flows and responsive checks |
| `playwright test --config playwright.workflow.config.ts` | 6 passed in 54.9 seconds; source interpretation, exact duplicates, attributed answers, replacement confirmation, immutable PDF versions, case isolation, real Strands simulated execution and WebSocket recovery |
| Final source browser/screenshot rerun | 2 passed in 14.2 seconds; top-of-page viewport/full screenshots refreshed |
| `git diff --check` | Passed |
| Original `/home/tim/Relay` tracked/untracked status | Clean |

Browser tests monitored page errors and console errors; those assertions passed. One Vite server-side WebSocket ECONNRESET occurred during navigation while the client recovered; it was not a browser console error or failed test. No live AWS, Postgres, S3 or model-quality test was run.

## Three correction rounds
1. Independent correctness review: retained conflict history versus new evidence, source-specific coverage including repeated omissions, duplicate no-op revisions, invalid financial values, missing dependency nodes, unreadable revision obligations and persisted failures. Added independent regressions.
2. Combined workflow validation: migrated obsolete fixed-three/all-Done and last-founder failure assertions to stronger new requirements; retained every original no-packet/no-preview guarantee. Browser intake test now waits for automatic interpretation before the next upload. Corrected verified-preview task availability and success-after-failure state recovery.
3. Final persistence/retry audit: upload analyze flag participates in idempotency; automatic analysis is Relay-authored and never human evidence; legacy fixed task rows are archived on next task reconciliation; unrelated reply-only chat carries a still-valid preview forward without reviving stale ones. Final targeted independent recheck passed.

An earlier baseline browser run overlapped file edits and had a blank second context; final isolated-context checks passed. Initial missing Chime dependency was resolved by reusing its installed copy, not installing. A newly written failure-message assertion used the word "stopped" while the UI says "could not finish"; it was corrected before locking the new assertion, retaining the exact error-code and no-save checks. Initial diff-check CRLF/EOF warnings in coordinator-written files were normalized; final check passed. No repeated identical product failure was blindly retried.

## Acceptance and measurement
All seven fixed acceptance units are accepted for the local development workflow within the documented extraction/model limits. Two bounded Sol/high implementations were reviewed by Astra/high; coordinator owned integration and acceptance tests. Three correction rounds remained within the eight-round cap.

Measurement interval approximately 04:08–04:27 UTC (about 19 minutes; setup start was approximate). Same codex 10080-minute window, reset 1791580471: 34% -> 40%, an observed account-wide increase of 6 percentage points. Concurrent account activity is unknown; this is not exact task/agent cost and establishes no performance advantage over another workflow.

Screenshots were rendered by Chromium and inspected by the coordinator. Desktop viewport 1440×1000; mobile viewport 390×844. Full-page images retain browser fixed chrome, while viewport images show actual screen composition. See source-aware-handoff.md for links and limitations.
