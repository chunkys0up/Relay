# Relay

Relay is a fictional founder/advisor workspace for preparing source-backed planning packets and reviewing exact document versions.

## Current interface

- **Founder:** Home / AI Chat / Call. Home combines uploaded originals from the legacy backend with local synthetic packet versions; checklist and activity come from the legacy backend. AI Chat uses the legacy Strands chat service for private AI replies and keeps human messages in the browser demo. Call shows the shared PDF or packet summary and offers a simulated preview or an explicitly selected Amazon Chime connection.
- **Advisor:** Home / Clients / Call. The ordinary screens show browser demo grants and exact-version review. Clients also offers an explicit server synthetic advisor workspace with its own session, granted versions, grounded private chat and citations.
- Search and Settings are utilities. Sources, Documents, Reviews and clarification URLs remain contextual tools. Calls have pre-call and active review layouts; recording and transcription controls are absent.

The current repo UI is the design baseline. [specs.md](specs.md) records product behavior and [implementation.md](implementation.md) maps it to code and current service boundaries. Historical reports and old mockups are not feature requirements.

## Run locally

With dependencies installed, run `npm run dev` at the root (or in `frontend-shared/`). For fresh setup, install the locked dependencies with `npm ci` after obtaining any required package-install approval.

The default workspace uses a synthetic browser adapter for packet versions, grants, review state and human conversation. Founder AI turns stream from the separate legacy FastAPI/Strands service. Chat attachments upload to S3/Postgres and are read by its case-scoped tools; checklist and activity also use legacy case endpoints. The legacy service has no production actor authorization, so a caller-selected case ID is not an access-control boundary.

A separate packet-workflow service (no longer linked from Home or AI Chat) backs the call screen's PDF viewer and the advisor AI chat. It uses owner-scoped SQLite state, source extraction, bounded Strands agents, task updates and confirmed PDF generation/editing. See [workflow setup](docs/bedrock-workflow.md). Vite proxies `/api/workflow` to loopback port 8001 by default; `RELAY_WORKFLOW_PORT` overrides that port for isolated local testing.

Advisor Clients also offers an explicit **server synthetic advisor workspace**. It uses separate server-issued sessions, version/source grants, read-only evidence tools, persisted private conversations and authorized citation previews. Its seeded synthetic records are independent of browser grants, legacy uploads and founder workflow cases. It cannot send to a client or approve/share a packet. See [advisor boundaries](docs/advisor-bedrock.md).

See [backend setup](backend/README.md) for the legacy FastAPI service, S3/Postgres uploads, case checklist/activity, Strands chat and Chime. Live AWS or media operations require existing configuration and authorization. A demo label or configured provider is not proof of a successful live request.

## Project layout

| Directory | Responsibility |
| --- | --- |
| `frontend-shared/` | Runnable Vite app, shared UI/state, routing and assets |
| `client-frontend/` | Founder screens and optional backend workspace |
| `advsior-frontend/` | Advisor screens (existing folder spelling) |
| `backend/` | Legacy integration service and separate SQLite packet/advisor services |
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
