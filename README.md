# Relay

Relay is a synthetic founder/advisor demo for turning source documents and founder clarifications into a versioned packet for human review.

## Project layout

- `client-frontend/` — founder Home, Sources, Documents and Call.
- `advsior-frontend/` — advisor Clients, Reviews, Documents and Call (existing folder spelling).
- `frontend-shared/` — runnable Vite app: package, HTML entrypoint, build config, public assets, routing and shared UI/state.
- `backend/` — FastAPI chat and S3 uploads, plus a Postgres schema awaiting application integration.

## Run locally

For the frontend, run `npm ci` once, then `npm run dev` from this directory. Root scripts delegate to the `frontend-shared` npm workspace; `cd frontend-shared && npm run dev` also works. Both roles share this app. Frontend actions use a synthetic local adapter; starting the backend does not connect it automatically.

See the [backend README](backend/README.md) for architecture, endpoints, configuration and backend startup.

## Design and integration

The intended flow is upload → extract facts and resolve missing/conflicting values → draft → advisor questions → revised version → exact-version approval. This end-to-end backend flow is not implemented yet.

- [API contract](docs/api-contract.md) — proposed frontend/backend boundary, pending confirmation.
- [Product specification](specs.md) and [implementation plan](implementation.md) — intended behavior. PostgreSQL on Amazon RDS is the selected record store; see the backend README for current implementation status.
- Frontend checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser`.
