# Source-aware workflow loop

Scope: codex/source-aware-tasks, isolated /home/tim/Relay-source-aware from origin/main d54fa55. Preserve legacy local demo, Postgres/S3, navigation, originals and saved packet versions. No installs, secrets, AWS calls, pushes or deployment.

## Fixed acceptance units
1. Upload produces honest source metadata/status, cited interpretation and relevant persistent tasks; byte duplicates do not duplicate sources or work.
2. Possible revisions require explicit inline confirmation; original sources and conflicting evidence remain retained.
3. Missing/conflicting packet fields yield focused chat questions and stable tasks with dependencies, responsible party, blocking reason and backend completion predicates. Human answers are attributed evidence and require confirmation.
4. Validated fact/source changes invalidate dependent pending previews, reopen only affected checks and preserve immutable packets/version reviews.
5. Server enforces case isolation, valid citations, revision checks, idempotency, concurrent mutation safety and completion transitions. Commit precedes snapshots; reload/reconnect recovers state.
6. Actual PDF verification and explicit preview confirmation gate AI-proposed immutable new versions; existing manual draft creation retains explicit field confirmation and the human Create action; failures stay visible without false completion. Real Strands SDK executes with simulated models for offline tests.
7. Existing navigation/regressions, desktop/mobile, keyboard controls and browser console checks pass; screenshots inspected.

## Method and fixed verifier
Read this file each correction cycle. Implement -> run existing backend and frontend suites plus new acceptance regressions -> inspect browser screenshots -> independent review -> fix. Existing test assertions and acceptance criteria are locked: do not weaken/remove them. New acceptance tests may be added, then retained; outdated assertions require coordinator assessment against this fixed contract, never silent weakening.
Commands: PYTHONPATH=backend <existing-python> -m pytest backend/tests -q; npm run lint; npm run typecheck; npm test; npm run build; npm run test:browser; node_modules/.bin/playwright test --config playwright.workflow.config.ts.
No packages may be installed. Reuse compatible installed runtimes/dependencies; report unavailable verification honestly. Browser test model is explicitly simulated; no live AWS access.

## Stop and failure protocol
At most eight correction cycles after submitted work fails acceptance. Same failure twice: diagnose and stop blind retries; proceed only with new evidence and targeted correction. Success requires all fixed criteria plus independent review with no unresolved material findings. If blocked, retain implementation and report exact gaps; never label unverified work complete.
Append cycle evidence to docs/source-aware-loop-results.md. Final handoff lists outcome, files/architecture, actual checks, screenshots, limitations, unimplemented work, correction count and decisions needing review.
Measurement: start 2026-10-03T04:08Z approximately; pre-dispatch codex window 10080 minutes used 34%, reset 1791580471. Account-wide observation only, no exact task attribution. Seven attempted acceptance units.

## Reviewed contract migrations
The coordinator and independent reviewer identified obsolete baseline expectations that directly conflict with this request. The fixed-three/all-Done assertion is replaced with stricter persisted unique task identities, machine predicates, active analysis, blocked missing/conflict facts and blocked packet checks. Verification-failure tests retain the founder message and now additionally require a Relay failure message with the exact error code; all no-preview/no-packet assertions remain. The browser packet flow additionally waits for the upload control to become enabled after automatic interpretation. No assertions were dropped to conceal implementation failures. These specific migrations are reviewed against the fixed acceptance criteria; unrelated existing assertions remain locked.
