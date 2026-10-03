# Relay

Relay is a synthetic founder/advisor demo for turning source documents and founder clarifications into a versioned packet for human review.

## Project layout

- `client-frontend/` — client Home (profile, documents, uploads, progress), AI Chat and Call.
- `advsior-frontend/` — advisor Home, Clients with inline review and private AI, and Call (existing folder spelling).
- `frontend-shared/` — runnable Vite app: package, HTML entrypoint, build config, public assets, routing and shared UI/state.
- `backend/` — FastAPI chat, S3 uploads and Chime call endpoints, plus a Postgres schema awaiting application integration.

## Run locally

For the frontend, run `npm ci` once, then `npm run dev` from this directory. Root scripts delegate to the `frontend-shared` npm workspace; `cd frontend-shared && npm run dev` also works. Both roles share this app. Documents, chat, sharing and reviews use a synthetic local adapter. The Call page also offers Amazon Chime live media through FastAPI; select the live connection explicitly. Starting the backend does not connect the other workflows automatically.

See the [backend README](backend/README.md) for architecture, endpoints, configuration and backend startup.

## Design and integration

The intended flow is upload → extract facts and resolve missing/conflicting values → draft → advisor questions → revised version → exact-version approval. This end-to-end backend flow is not implemented yet.

- [API contract](docs/api-contract.md) — proposed frontend/backend boundary, pending confirmation.
- [Product specification](specs.md) and [implementation plan](implementation.md) — intended behavior. PostgreSQL on Amazon RDS is the selected record store; see the backend README for current implementation status.
- Frontend checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`.

## V2 Design

The approved October 2 mockups supersede older navigation requirements in the
planning documents. Sources, Documents, Reviews and clarification URLs remain
available as contextual tools; primary navigation uses the destinations above.
Both roles have pre-call preparation and an active review layout with an explicit Demo / Amazon Chime connection selector. Chime uses the same document and review composition; document access still follows the local exact-version grant.
There are no recording or transcript controls.

This adapter contains one assigned client. Progress and shared document counts
come from that case; additional clients and live AI/storage/audio are not
fabricated. Call acceptance reaches the adapter's **Connecting** state, not a
real media connection. Device controls are explicitly unavailable. Originals
stay private until packet handoff; human chat can attach only originals already
shared with its named recipient. Text/CSV can be previewed locally; PDF and
binary extraction remains unsupported.

Implementation evidence and limitations: [V2 verification](docs/v2-design-verification.md).
The isolated branch is `V2-Design` (Git does not permit spaces in branch names).
## Bedrock packet workflow baseline

The founder Home/AI Chat screens also offer an explicit backend workspace using
Strands, configured Sonnet 5 access, WebSocket task/message updates and confirmed
PDF generation/filling. See [setup, boundaries and tests](docs/bedrock-workflow.md).
This local workflow uses SQLite development persistence; existing local demo and
Chime behavior remain available. Live AWS invocation is not verified by local tests.

The backend packet workspace uses one orchestrator with separate document reader,
writer and PDF verifier agents. See [multi-agent architecture](docs/multiagent-workflow.md).
