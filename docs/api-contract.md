# Relay transport boundaries

This is a reference to implemented interfaces, not a proposal to add product features. UI scope is defined in [specs.md](../specs.md). Request/response definitions in the linked source files are authoritative.

## Three separate paths

| Path | Client | Server/state | Boundary |
| --- | --- | --- | --- |
| Default demo | `MockRelayAdapter` via `context.tsx` | Browser persistence | Synthetic roles, grants, chat, review and call state |
| Legacy integration | `relayApi.ts`, `callsApi.ts` | `app.main` on port 8000; S3/Postgres and Chime | Development prototype; not production-authenticated or case-authorized |
| Backend packet workspace | `client-frontend/src/workflow/api.ts` | `app.workflow_app` on port 8001; SQLite | Loopback-only founder demo with session ownership, CSRF, revision and idempotency checks |

The demo does not become server-backed when either service starts. A selected case or role in the browser does not authorize legacy endpoints. The generic chat harness is not a grounded, grant-scoped advisor assistant.

## Packet workflow

Routes: [workflow.py](../backend/app/api/routes/workflow.py). Payloads: [schemas.py](../backend/app/workflow/schemas.py). Client DTOs and transport: [api.ts](../client-frontend/src/workflow/api.ts).

All paths below start with `/api/workflow`. Case routes start with `/cases/{case_id}`.

| Method/path | Current operation |
| --- | --- |
| `GET /session` | Establish/reuse HttpOnly local session; return CSRF token, provider mode and upload limits |
| `GET /cases`, `POST /cases` | List owned cases; create with company and goal |
| `GET /cases/{case_id}` | Read owned snapshot |
| `WS /cases/{case_id}/events` | Authorized ready/snapshot stream; first client message contains CSRF token and after_revision |
| `POST .../sources` | Multipart source plus expected_revision and optional analyze; PDF/text/CSV, up to 10 MiB |
| `POST .../sources/{source_id}/relationship` | Confirm revision versus separate source |
| `GET .../sources/{source_id}/preview` | Read authorized original bytes |
| `POST .../templates` | Upload constrained PDF template |
| `POST .../run`, `GET .../jobs/{job_id}` | Persist a job, then read its actual status |
| `POST .../facts/confirm` | Human-confirm values with source acknowledgements |
| `POST .../packets` | Explicitly generate a packet from confirmed fields |
| `GET .../packets/{packet_id}/download` | Download exact saved PDF; optional inline display |
| `GET .../pdf-actions/{action_id}/preview` | Inspect proposed PDF bytes |
| `POST .../pdf-actions/{action_id}/confirm` | Save verified preview using expected revision and exact preview hash |
| `POST .../pdf-actions/{action_id}/dismiss` | Dismiss the selected preview using expected revision/hash |

Mutations require the session cookie, `X-CSRF-Token` and `Idempotency-Key`. Existing-case writes use `expected_revision`; replaying the same key/body returns the stored result, while changing the body or using stale state is rejected. HTTP 202 means accepted work, not completion. A cancelled client wait does not prove server cancellation.

Workflow errors use `{error: {code, message, retryable}}`; framework validation/authentication errors may use `detail`. Responses are operation-specific, not a universal `{data, meta}` envelope. Preview/download routes recheck ownership and return sandboxed content. Only verified exact bytes can become a saved packet through the explicit confirmation path.

## Legacy service

See [backend README](../backend/README.md) and [route implementations](../backend/app/api/routes) for current payloads:

- `/api/chat`, `/api/chat/stream`, `/api/chat/{session_id}`: generic session chat/reset.
- `/api/documents/upload`, `/api/documents`, `/api/documents/{document_id}/url`: multipart upload, list and short-lived document URL.
- `/api/cases/{case_id}/calls` and per-call read/join/end routes: Chime meeting lifecycle.
- `/api/client-log`: browser diagnostic ingestion.

These are not the previously proposed unified case API. There is no implemented presigned two-phase upload contract, general REST share/review/clarification service, recording/transcription service or production session system. Future integration requires a separate approved design and must preserve current UI and exact-version privacy/confirmation boundaries.
