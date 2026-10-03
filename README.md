# Relay

Relay is a fictional founder/advisor workspace for preparing source-backed planning packets and reviewing exact document versions.

## Current interface

- **Founder:** Home / AI Chat / Documents. Normal mode lists session-owned server cases, original sources and immutable packet PDFs. Packet stages and task progress come from the workflow backend.
- **Advisor:** Home / Clients / Call. Packet views are read-only local previews. The role selector does not authenticate an advisor or authorize approval.
- Search and Settings remain utilities. Existing legacy chat/call services and the separate advisor AI workspace retain their documented boundaries.

The current UI remains the design baseline. See [specs](specs.md), [implementation](implementation.md), and [document packets](docs/document-packets.md).

## Run locally

With dependencies installed, run `npm run dev` at the root (or in `frontend-shared/`). For fresh setup, install the locked dependencies with `npm ci` after obtaining any required package-install approval.

Normal mode reads real case, source and packet records from the workflow API on port 8000. A new owner session starts empty; unavailable services never fall back to hardcoded packets. Use explicit example creation for fictional PDF packages at different persisted stages, or import your own PDFs. See [document packets](docs/document-packets.md).

Use `VITE_PACKET_DATA_MODE=fixture npm run dev` only for an intentional offline fixture demo or tests. Fixture reviews remain simulations. Configured cloud synchronization verifies S3 bytes and registers the same case and document IDs in PostgreSQL; cloud status is separate from local persistence. Legacy chat and calls use the selected registered case. The role selector and caller-supplied identity are not production authorization.

See [backend setup](backend/README.md) for the legacy FastAPI service, S3/Postgres uploads, case checklist/activity, Strands chat and Chime. Live AWS or media operations require existing configuration and authorization. A demo label or configured provider is not proof of a successful live request.

## Project layout

| Directory | Responsibility |
| --- | --- |
| `frontend-shared/` | Runnable Vite app, shared UI/state, routing and assets |
| `client-frontend/` | Founder screens and optional backend workspace |
| `advsior-frontend/` | Advisor screens (existing folder spelling) |
| `backend/` | Unified API entry point with legacy integration and isolated SQLite packet/advisor modules |
| `tests/` | Browser scenarios and frontend test setup |
| `docs/` | Current setup, transport and architecture references |

## Verification

```bash
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run test:browser -- --workers=1
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
```

Browser suites start isolated loopback services. Production identity, an integrated server-backed founder/advisor handoff, real device behavior and cloud availability require separate validation.

## Technical references

- [Implemented transport boundaries](docs/api-contract.md)
- [Backend packet workflow](docs/bedrock-workflow.md)
- [Agent architecture and limits](docs/multiagent-workflow.md)
- [Advisor chat boundaries](docs/advisor-bedrock.md)
- [Bedrock role configuration](docs/bedrock-role-setup.md)

Persisted legacy conversations require migration `backend/db/migrations/002_conversations.sql`. The migration is separate from the advisor SQLite import; neither system grants access in the other.

## Single backend entry point

Run `cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000` to serve legacy, workflow and advisor APIs in one process. Start Vite separately with `npm run dev`. All `/api` requests (including workflow WebSockets) proxy to port 8000; `RELAY_BACKEND_PORT` overrides that target. `RELAY_WORKFLOW_PORT` remains a compatibility alias. Legacy clients default to the same origin; `VITE_API_URL` is an optional explicit override. A production frontend host must likewise forward `/api` to the backend. SQLite and PostgreSQL state and authorization remain separate. Run from `backend/` to reuse its existing `.relay/workflow.sqlite3`, or set `RELAY_WORKFLOW_DB` to an explicit database path. The Bedrock launcher also starts this unified entry point.
