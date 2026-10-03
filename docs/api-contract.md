# Relay transport boundaries

This documents implemented interfaces; it is not a proposal to add product features. UI scope is in [specs.md](../specs.md); request and response definitions in source are authoritative.

## Separate paths

| Path | Client | State/service | Boundary |
| --- | --- | --- | --- |
| Browser demo | `MockRelayAdapter` via `context.tsx` | Browser persistence | Synthetic packet, grant-filtered views, human messages, reviews and simulated calls |
| Legacy integration | `relayApi.ts`, `callsApi.ts`, `conversation.tsx` | `app.main`, port 8000; S3/PostgreSQL and Chime | Live founder Strands chat and case tools, document upload/list/open, checklist/activity and calls. Caller-supplied case IDs; not production actor authorization. |
| Owner-scoped founder workspace | `client-frontend/src/workflow/api.ts` | `app.workflow_app`, port 8001; SQLite | Loopback-only case sessions, tasks/facts and PDFs; session/CSRF/revision/idempotency checks |
| Server synthetic advisor workspace | `advisorApi.ts`, `advisorChat.tsx` | `app.workflow_app`, port 8001; separate SQLite tables | Own HttpOnly session/CSRF, synthetic assignment, exact grants, private chat and citation previews; read-only, no client actions |

These paths do not automatically share persistence or authorization. The local browser role selector is not authentication. The generic legacy chat is not the grant-scoped advisor assistant.

## Legacy service

See [backend README](../backend/README.md) and [route code](../backend/app/api/routes):

- `POST /api/chat`, `POST /api/chat/stream`, `DELETE /api/chat/{session_id}`: generic session chat/reset. Chat accepts optional `case_id` and `document_ids`; its six tools read files and maintain checklist/activity for that case.
- `POST /api/documents/upload`, `GET /api/documents?case_id=`, `GET /api/documents/{document_id}/url`: multipart upload, case list and short-lived S3 URL.
- `GET /api/cases/{case_id}/checklist`, `PATCH /api/cases/{case_id}/checklist/{item_id}`, `GET /api/cases/{case_id}/activity`: persisted case progress/activity.
- `POST /api/cases/{case_id}/calls` plus per-call read/join/end routes: Chime lifecycle.
- `POST /api/client-log`: browser diagnostic ingestion.

The legacy service does not authenticate a user or authorize a supplied case ID. Do not treat these routes as production-private or grant-scoped.

## Founder packet workflow

All paths begin with `/api/workflow`. See [workflow routes](../backend/app/api/routes/workflow.py) and [setup/limits](bedrock-workflow.md).

| Method/path | Operation |
| --- | --- |
| `GET /session` | Establish local owner session; return CSRF token, provider mode and upload limits |
| `GET /cases`, `POST /cases`, `GET /cases/{id}` | List/create/read owned cases |
| `WS /cases/{id}/events` | Authorized snapshot/status stream |
| `POST /cases/{id}/sources`, `POST /templates` | Upload supported sources/templates |
| `POST /cases/{id}/run`, `GET /jobs/{id}` | Start and inspect bounded analysis |
| `POST /facts/confirm`, `POST /packets` | Confirm facts and generate a version |
| `GET /packets/{id}/download` | Download exact saved PDF |
| `GET /pdf-actions/{id}/preview`, `POST .../confirm`, `POST .../dismiss` | Review and explicitly confirm/dismiss verified PDF changes |

Mutations use session cookie, CSRF token, idempotency key, and expected revision where applicable. Accepted work is not the same as completed work.

## Advisor workspace

The server advisor API is mounted at `/api/advisor` on the loopback workflow service. `GET /session` bootstraps the server actor and granted versions; conversation list/create/read/send routes bind history to one or two exact versions. Packet/source preview endpoints validate session, case assignment, grant and hashes. Conversation writes require CSRF and idempotency keys. No route sends a question to a founder, changes a grant or approves a packet. The store contains seeded synthetic records and is separate from workflow case records even though both use the local SQLite database file.

No unified case handoff, general production identity, legacy upload grant checks, call recording or transcription service is implemented. Preserve explicit confirmation and exact-version checks in future integration work.
