# Workflow regression handoff

## Intended result and scope

Fix the three reported local frontend failures: source intake, initial founder answer progression, and durable same-origin browser tab continuity. This does not implement cross-device collaboration, backend AI, cloud extraction, authentication, or real delivery.

## Implementation

- `frontend-shared/src/intake.ts`: validates actual base64 bytes, size and filename, computes SHA-256, retains originals, extracts UTF-8 TXT/CSV, explicitly marks other formats unsupported.
- `frontend-shared/src/founder-answer.ts`: requires explicit revenue and reserve values from founder private messages, supports split replies, rejects ambiguity and withdrawn facts.
- `frontend-shared/src/mock.ts`: intake task, attributed private draft creation, durable checkpoints and recoverable draft jobs, retained receipt keys.
- `frontend-shared/src/persistence.ts`: IndexedDB storage, Web Locks serialization plus transactional generation checks, tab notifications, checkpoint reads and reload recovery.
- `frontend-shared/src/types.ts`, `context.tsx`, `conversation.tsx`, `ui.tsx`, `settings.tsx`, and founder Home/Sources: adapter wiring, actual file reading/download, accurate local capability labels.
- Regression tests cover intake validation, initial progression/partial input/privacy, concurrent writes, real tab exchange, handoff, reload and interrupted draft recovery. Existing obsolete upload/copy expectations migrated. Component tests isolate the mock; browser tests exercise real IndexedDB.
- Playwright uses dedicated port 5178 with no reused server. Screenshots go to per-test output to avoid changing documentation fixtures.

## Limits and review decisions

Only the same browser profile and origin share state. Different ports are different origins. Clearing browser data removes this demo state. Unsent composer drafts remain session memory. PDFs/binary originals are downloadable but not extracted. General AI replies and a real multi-user backend remain unimplemented. Conflicting source evidence remains in drafts for human review. Demo roles are not authentication or security isolation against someone controlling the browser.

No packages installed, credentials accessed, cloud calls made, commits created, or deployment performed. All work occurred in the isolated `codex/workflow-regression-loop` worktree before integration.

## Verification

See LOOP-RESULTS.md for baseline, locked tests, correction cycles and actual final output. Completed in three iterations: 46/46 unit tests, lint, TypeScript and build passed. All 60 distinct browser checks have passing evidence: full run 58 passes plus corrected Settings assertions and all six new browser regressions passed in the final 8-test run. Verified files copied to /home/tim/Relay with unrelated README edits preserved. No commits.
