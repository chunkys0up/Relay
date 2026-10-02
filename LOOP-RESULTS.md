# Loop evidence

Started 2026-10-02 22:48:26 UTC. Three acceptance units: intake; initial-answer progression; same-origin durable tab continuity. Implementation delegated to gpt-6.1-sol high; coordinator owns tests and integration. Existing dependencies reused, no install.

Baseline unit run: 10 tests, 3 failed / 7 passed. Reproduced upload rejection, missing initial draft, missing draft under concurrent answers.

Locked regression SHA-256:
- frontend-shared/src/workflow-regressions.test.ts: 63709bcf129157c3c256d43c79df7d66252c23a70ca4e8f8e3ae5c839a9b58fc
- tests/browser/workflow-regressions.spec.ts: 110733fe990421d1b85dd4c6289f0e009481451d4664ef57367d74047d594583

Existing tests asserting unconditional upload rejection or reload data loss are obsolete under the requested behavior. Coordinator will replace these expectations with successful local retention and honest extraction status; cancellation tests retain cancellation coverage by selecting another file before cancel.

Browser verification uses installed Playwright because agent-browser is unavailable. Dedicated worktree server at 127.0.0.1:5178; does not reuse any existing server.

Allowance baseline: codex 10080-minute window, 9% used, reset 1791580471. Account-wide only; task attribution unavailable.

Baseline browser run: all four user-flow regression tests failed, including separate-tab message delivery. Mid-write diagnostic saw actual upload contents now ingested; not counted as a submitted implementation iteration.

Additional locked durability checks: tests/browser/workflow-durability.spec.ts SHA-256 c30a26fa771155ea94553d5f49bf5afb4ecc92f6ce960f1d7378e71af3481f87. Component tests explicitly use isolated MockRelayAdapter since jsdom lacks IndexedDB; browser tests exercise actual durable factory.

Iteration 1: 10/10 original new unit regressions passed; full unit suite 38/39 (obsolete synthetic label assertion migrated); lint found no-control-regex (fixed using char codes). New browsers 3/6 passed (intake persistence, human two-tab, reload-during-draft). Two blank initial pages need stable-code rerun. One test defect: packet preview is a region, not a button; corrected both pre/post-handoff role queries, behavior expectation unchanged. Reviewer found alternatives/ranges/conditionals and withdrawn earlier values; 4 new ambiguity tests pass after correction. This is one worker correction cycle.

Iteration 2: all six targeted browser regressions passed (33.5s). Lint, TypeScript/build passed; 43/43 unit tests passed. Full browser run:58/60 passed (4.2m); two Settings assertions matched the old word 'simulated' rather than the new local-persistence description. Updated them to assert retained-across-reloads capability text. Reviewed generated Home desktop screenshot; existing browser suite verified desktop/mobile layouts, keyboard, assets and page errors. Reviewer found remaining shorthand range '-'; new range-and-binary.test.ts baseline2 failures/1 pass, also includes ' million to  million'. Worker correcting only the range guard for iteration3. No duplicate full-suite run planned: reuse 58 unaffected passes and rerun changed Settings plus all targeted browser regressions.

Iteration 3 final output:
- npm run lint: exit 0.
- npm run build: TypeScript exit 0; Vite 76 modules, build succeeded.
- npm test: Test Files 12 passed (12); Tests 46 passed (46), 18.94s.
- Final focused browser run: 8 passed (58.4s), including both corrected Settings tests and all six new browser regressions. Together with the 58 passes from the full run, all 60 distinct browser cases have passing evidence. Unaffected checks reused; no remaining failures.
- git diff --check: exit 0.
- Original locked unit SHA unchanged. Browser regression selector correction final SHA b77a854b00be001910cd6806c19d6d9895564b1280424af7a5933b999021f475. Ambiguity SHA39d269c8d46280ca1356b44ce00fa305c52f884d78acc5c324519a948ae505e0. Range/binary SHA8a52e69c5135e8d4803a214538cbbceb8fb4bf5c6f0e7c5898d6e18589497adc. Other locked hashes unchanged.

Completed three implementation verification cycles; two worker correction cycles. All three local acceptance units accepted. Seventeen new unit cases plus six browser cases. Delegated interval22:48:26-23:04:31 UTC (16m05s). Account-wide used percentage increased9% to11% in the same10080-minute window (2 percentage points); concurrent activity exists, so exact task allowance attribution is unavailable. No claim of performance improvement.

Final limitations: same browser/profile/origin only; binary/PDF extraction unsupported; real backend/multi-device/AI paths not implemented or tested. Unsent drafts remain session-only. No missing credential or install is needed for the delivered local scope.

Integration: copy verified changed files only to /home/tim/Relay after per-file base-content checks. Preserve concurrent root README.md and backend/README.md edits. Verify identical bytes after copying; no commit or merge.
