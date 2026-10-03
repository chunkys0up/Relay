# Project: Relay

## Purpose
Relay is a fictional founder/advisor planning-packet app. Normal document and packet views use the owner-session backend; browser fixtures are explicit test/demo mode only.

## UI and documentation authority
- The current routed UI in `frontend-shared/src/main.tsx` and its screens is the baseline. Preserve its layout and navigation during maintenance unless the user explicitly requests a product change.
- `specs.md` describes current product behavior; `implementation.md` describes the current implementation and gaps. Update both when behavior changes. Do not create a competing `spec.md`.
- Founder primary navigation is Home / AI Chat / Documents (the document/call screen retains `/founder/call`). Advisor primary navigation is Home / Clients / Call. Search and Settings are utilities. Sources, Documents, Reviews and clarification routes are contextual tools, not additional primary destinations.
- Do not restore recording/transcription controls, specialist-agent tiles, old navigation, or historical planned features from Git history, screenshots, old reports, or a backend schema. Existing contextual routes are not dead code simply because they are absent from primary navigation.
- Keep durable setup and architecture in README/docs. Put one-off test logs and screenshots in ignored `test-results/` or outside the repo; Git history retains retired reports.

## Build and verification
Run from the repository root using existing dependencies:
- `npm run lint`
- `npm run typecheck`
- `npm test -- --maxWorkers=2`
- `npm run build`
- `npm run test:browser -- --workers=1`
- `node_modules/.bin/playwright test --config advisor.integration.playwright.config.ts` (real local advisor backend with simulated models; no AWS; the removed standalone founder-workspace UI has no browser suite)
- `PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q`
Package installation needs explicit authorization. Offline tests are not evidence of live AWS/media behavior. Do not read real `.env` files or credentials or run billable smoke checks without authorization.

## Structure and invariants
- `frontend-shared/`: Vite entry point, routing, shared adapter and components. `client-frontend/` and `advsior-frontend/`: role screens; the advisor directory spelling is existing public project structure.
- `app.main` serves legacy integration, owner-scoped founder packets and the server synthetic advisor workspace on port 8000. Vite proxies all `/api` traffic to `RELAY_BACKEND_PORT` (default 8000), including WebSockets. Browser state, PostgreSQL/S3 legacy data and SQLite packet/advisor data retain separate authorization and persistence boundaries.
- Preserve exact-version/hash review and sharing, source-read-before-cite checks, private role/audience history, explicit human save/share/send/approval, bounded terminal tool failures, and idempotent retries.
- The server advisor AI workspace remains synthetic and isolated. Normal advisor packet views require a separate session that redeems a persisted exact-version invitation. Keep selected-source grants, per-advisor review privacy, revoke enforcement and current-packet checks. These are local capability sessions, not production personal identity. Never turn role selection into approval authority.
- Workflow packet stages, originals and hashes come from stored server records. Cloud synchronization must verify S3 bytes before registering matching PostgreSQL case/document IDs, and expose pending/failed/unconfigured states. Mirrored workflow IDs require the owner session on legacy endpoints.
