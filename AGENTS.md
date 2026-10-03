# Project: Relay

## Purpose
Relay is a fictional founder/advisor planning-packet demo with an optional local backend packet workflow.

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
- Browser demo state, the legacy service (`app.main`, port 8000), and the two separate services mounted in `app.workflow_app` (owner-scoped founder packets and server synthetic advisor workspace, port 8001) are separate systems. Do not imply shared authorization or persistence between them.
- Preserve exact-version/hash review and sharing, source-read-before-cite checks, private role/audience history, explicit human save/share/send/approval, bounded terminal tool failures, and idempotent retries.
- The server advisor workspace is synthetic and isolated; no integrated server-backed founder-to-advisor handoff or production identity exists. Browser grants and caller-supplied legacy case IDs are not production authorization.
