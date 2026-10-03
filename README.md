# Relay

Relay is a fictional founder/advisor workspace for preparing source-backed planning packets and reviewing exact document versions.

## Current interface

- **Founder:** Home (profile, backend originals/uploads, local packet versions and progress), AI Chat, Call.
- **Advisor:** Home, Clients (documents, version-bound review and private AI), Call.
- Search and Settings are utilities. Source, document, review and clarification URLs remain contextual tools.
- Calls have pre-call and active review layouts with an explicit Demo / Amazon Chime selector. There are no recording or transcription controls.

The current repo UI is the design baseline. [specs.md](specs.md) records its behavior and [implementation.md](implementation.md) maps it to code and remaining gaps. Historical reports and old mockups are not feature requirements.

## Run locally

With dependencies installed, run `npm run dev` at the root (or in `frontend-shared/`). For a fresh setup, install the locked dependencies with `npm ci` after obtaining any required package-install approval.

The default workspace uses a synthetic browser adapter with private role/audience conversations, exact-version sharing and simulated review/call state. Founder AI Chat also exposes a separate live chat harness, and Home/document views expose separate backend upload controls. These require the legacy backend; they do not turn the demo adapter into a live system.

The founder Home and AI Chat screens also offer **Open backend packet workspace**. This separate service uses owner-scoped SQLite state, source extraction, Strands agents, task updates and confirmed PDF generation/editing. See [workflow setup](docs/bedrock-workflow.md). Vite proxies `/api/workflow` to loopback port 8001 by default; `RELAY_WORKFLOW_PORT` overrides that port for isolated local testing.

See [backend setup](backend/README.md) for the legacy FastAPI service, S3/Postgres documents and Chime. Live service operations require existing configuration and explicit authorization. A demo label or configured provider is not proof of a successful live request.

## Project layout

| Directory | Responsibility |
| --- | --- |
| `frontend-shared/` | Runnable Vite app, shared UI/state, routing and assets |
| `client-frontend/` | Founder screens and optional backend workspace |
| `advsior-frontend/` | Advisor screens (existing folder spelling) |
| `backend/` | Legacy integration service and separate packet workflow |
| `tests/` | Browser scenarios and frontend test setup |
| `docs/` | Current setup, transport and architecture references |

## Verification

```bash
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run test:browser -- --workers=1
npm run test:workflow
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
```

Browser suites start isolated loopback services. The workflow suite uses deterministic model fixtures, not AWS. Production authentication, a complete server-backed advisor handoff, real media/device behavior and cloud availability need separate validation.

## Technical references

- [Implemented transport boundaries](docs/api-contract.md)
- [Backend packet workflow](docs/bedrock-workflow.md)
- [Agent architecture and limits](docs/multiagent-workflow.md)
- [Bedrock role configuration](docs/bedrock-role-setup.md)

Store new run-specific evidence in ignored `test-results/` or outside the repo. Retired implementation reports, screenshots and loop instructions remain recoverable through Git history.
