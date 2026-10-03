# Source-aware task management handoff

## Intended result
Extend Relay's existing backend AI Chat, upload controls, task panel and PDF review cards with source-aware work. Keep one visible Relay assistant and the existing navigation. Work is isolated in `/home/tim/Relay-source-aware` on `codex/source-aware-tasks`, based on freshly fetched `origin/main` (`d54fa55`). The original checkout is not the implementation location.

## Architecture decisions
- Extend the existing `backend/app/workflow` service and SQLite development repository. Existing Postgres/S3 routes, Chime, local demo state and navigation stay separate.
- Application code derives persisted task states and validates transitions; models only propose bounded, cited facts/PDF changes. Existing Strands orchestrator/reader/writer/verifier tool restrictions remain.
- Source originals and conflicting evidence stay retained. Byte hashes identify exact duplicate intake. Filename similarity is only a proposed relationship and requires an explicit human decision.
- The six existing packet fields define missing-information work. Stable task IDs, dependency IDs, responsible party, blocking reason and completion predicates replace per-turn canned lists.
- Human chat answers and confirmations remain attributable evidence. PDF preview verification is bound to exact bytes; AI-proposed versions require explicit human review and confirmation. Existing manual PDF creation retains explicit field confirmation plus the human Create action.
- All new browser/agent integration tests use explicitly simulated models, including real installed Strands execution with scripted model responses. No AWS calls or cloud storage migration.

## Files
- `backend/app/workflow/service.py`, `tasking.py`, `repository.py`, `schemas.py`, `actions.py`: source/task state, revision/idempotency/evidence and PDF integration.
- `backend/app/api/routes/workflow.py`: upload interpretation scheduling and inline relationship endpoint.
- `client-frontend/src/workflow/BackendWorkspace.tsx`, `api.ts` and component tests: current chat/upload/task/review controls and retry recovery.
- `backend/tests/`: focused source-aware backend regressions alongside existing verification/Strands suites.
- `tests/workflow-browser/source-aware.spec.ts`: upload, duplicate, answer, relationship, immutable packet, keyboard/layout and reconnect acceptance.
- `LOOP.md`, `docs/source-aware-loop-results.md`: fixed acceptance and verification evidence.

## Checks and correction cycles
Final checks: 100 backend tests, 79 frontend tests, 66 existing browser tests and 6 packet-workflow browser tests passed. Lint, TypeScript, build and diff checks passed. Independent review found no unresolved material issues. Three correction rounds; detailed commands, results and earlier failures are in [the loop evidence](source-aware-loop-results.md).

## Remaining limitations and decisions
- Local development owner sessions and SQLite are not production authentication or multi-service persistence.
- Native text/CSV/text-PDF extraction only; unreadable/scanned/unsupported files are reported honestly. OCR/live Textract is not added.
- Filename-based revision suggestions are heuristic, require human confirmation, and never decide which financial value is correct.
- Live Bedrock model quality and AWS access are unverified and were not invoked. No packages installed, credentials read, push, merge or deployment.
- Existing version-specific advisor review remains in the separate local demo; this task does not introduce backend advisor sharing or approval.
- Browser evidence covers Chromium desktop and emulated mobile; physical touch devices and screen-reader audio are untested.

No known unimplemented acceptance item or local-verification blocker remains in the requested scope. Live integrations, OCR, production identity/storage and physical-device accessibility checks remain outside the authorized local test coverage. A readable source without any supported cited field remains explicitly blocked for further interpretation; the system does not invent a fact to complete it.

## Screenshots
- [Desktop viewport](screenshots/source-aware/source-aware-viewport-1440.png)
- [Mobile viewport](screenshots/source-aware/source-aware-viewport-390.png)
- [Desktop full source/conflict/task flow](screenshots/source-aware/source-aware-1440.png)
- [Mobile full source/conflict/task flow](screenshots/source-aware/source-aware-390.png)

## Compatibility and operation
Legacy fixed task rows are retained in `legacy_tasks` and replaced with current keyed tasks on the next task-reconciling mutation. Read-only snapshots preserve the previously stored state until then. Existing originals and saved PDF versions are not rewritten. A source relationship records a human decision; it never silently chooses the revised value.

Dependencies were reused through ignored local symlinks to existing Relay installations. For this machine, run checks from `/home/tim/Relay-source-aware` using `backend/.venv/bin/python` and the existing npm scripts. No package or lockfile changed. The implementation was developed on `codex/source-aware-tasks` in an isolated worktree. Subsequent publication and merge status are recorded in Git history and the GitHub pull request. No deployment is part of this change.

For an explicitly simulated local preview, use two WSL terminals:

```bash
cd /home/tim/Relay-source-aware/backend
RELAY_FIXTURE_DB=/tmp/relay-source-aware-demo.sqlite3 PYTHONPATH=. .venv/bin/uvicorn browser_app:app --app-dir tests --host 127.0.0.1 --port 8001
```

```bash
cd /home/tim/Relay-source-aware
npm run dev -- --port 5189
```

Open `http://127.0.0.1:5189/founder/chat?workspace=backend`. This uses the test provider, not live Bedrock. A production-grade deployment or live integration still needs a separate authorized task.
