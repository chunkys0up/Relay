# Multi-agent document workflow loop

Worktree: codex/bedrock-documents; preserve all existing local changes.
Accepted units (fixed): (1) real Strands orchestrator delegates to separate reader
and writer agents with case-scoped tool sets; (2) independent verifier agent plus
actual PDF byte/field checks blocks failed previews; (3) safe persistence, human
confirmation and single Relay UI integrated; (4) tests, browser screenshots and
independent review pass. Max eight correction cycles, stop repeated same failure
without new evidence. No installs, secrets, live AWS, push or deployment.

Existing tests and their behavior remain locked. New tests must cover actual
installed Strands execution with scripted models, scope, read-before-write,
verification failure, turn budgets, immutable preview confirmation, HTTP and UI.
Commands: PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q;
npm run lint; npm run typecheck; npm test; npm run build; Playwright workflow config.
Regression browser evidence from previous unchanged flows may be reused when applicable.

One writer per subsystem: team worker owns team.py/new team tests; PDF verifier
worker owns pdf_verification.py/new tests; root owns schemas, service, routes,
actions, UI, fixtures, docs and integration. Independent reviewer read-only.
Start: 2026-10-03 03:41:40 UTC; account weekly use observed 30%, not task attribution.
