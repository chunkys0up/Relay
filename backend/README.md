# Relay Backend

FastAPI provides Strands-backed chat and S3 document uploads. The repository also includes an RDS Postgres schema and connection settings; no database client or application queries are wired up yet.

## Current architecture

```text
React founder/advisor UI → local mock for documents/chat/reviews
Call page (Amazon Chime mode) → FastAPI call endpoints → Chime SDK media

FastAPI
├── /api/chat          → cached Strands harness per session_id → configured model
├── /api/chat/stream   → same agent, plain-text streaming response
└── /api/documents/upload → boto3 → S3 object + upload metadata

RDS Postgres: schema/config only; no connection from the routes above
```

- **Chat:** [agents/factory.py](app/agents/factory.py) creates one agent per session ID, with both tool lists empty. The harness receives `SESSION_DIR` for session storage; this is separate from case/message records in Postgres. Bedrock is the default provider; `STRANDS_MODEL` selects the model.
- **Upload:** [documents.py](app/api/routes/documents.py) reads the file and [storage/s3.py](app/storage/s3.py) uploads it to `S3_BUCKET` under `tenants/{DEMO_TENANT_ID}/cases/{case_id}/sources/{source_id}/versions/1/original.{ext}` (opaque IDs; only a validated extension is kept from the filename). `storage/s3.py` also provides presigned upload/download URLs, `head_object`, `download_bytes` and `delete_object`. It returns metadata without creating a case/document record or starting extraction.
- **Records:** [db/schema.sql](db/schema.sql) defines cases, documents with S3 keys, source-linked facts, versioned drafts with S3 keys, messages and advisor decisions tied to a draft. [db/seed.sql](db/seed.sql) contains sample cases. The schema is intended for a fresh database and is not idempotent; the app does not apply it at startup.

## Local setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv sync
cp .env.example .env  # first setup only; keep an existing .env
# Fill in .env before starting the service.
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Add `--reload` for local development. Uvicorn's host/port come from its CLI flags; the `HOST`/`PORT` application settings are not wired into this command. Open `http://127.0.0.1:8000/docs` for the API schema.

## Configuration

See [.env.example](.env.example) for all variables and [core/config.py](app/core/config.py) for typed settings.

| Variables | Purpose |
| --- | --- |
| `AWS_PROFILE`, `AWS_REGION` | Existing AWS credentials/profile and S3 region. Keep the profile's region consistent for Bedrock. |
| `STRANDS_MODEL`, `STRANDS_EFFORT` | Harness model and effort. Use a model/inference profile verified for your account; an example value does not prove access. |
| `S3_BUCKET` | Upload destination; credentials need permission to write objects. |
| `SESSION_DIR` | Harness session storage directory. |
| `CORS_ORIGINS` | Allowed browser origins, comma-separated; use the local frontend origin when connecting it. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Postgres connection settings. `Settings.database_url` is prepared but unused; database access requires separate network access and database credentials. |

`load_dotenv()` also exposes `.env` values to provider SDKs that read the process environment. Bedrock needs model invocation/streaming permissions. Credentials and service availability are not checked by `/health`.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Service name/status |
| GET | `/health` | Static process health response |
| POST | `/api/chat` | `{ "message": "...", "session_id": "..." }` → session ID and reply; session ID defaults to `default` |
| POST | `/api/chat/stream` | Same request, plain-text response stream |
| DELETE | `/api/chat/{session_id}` | Evicts the cached agent; does not delete stored session files |
| POST | `/api/documents/upload` | Multipart `file` plus `case_id` (UUID form field) → bucket, key, case/source IDs, filename, content type and size |

## Frontend integration and remaining work

The frontend currently creates a [MockRelayAdapter](../frontend-shared/src/context.tsx), so uploads, messages and reviews do not reach these endpoints. The redesigned Call page separately connects to the Chime routes below when Amazon Chime mode is selected. Replace it with a transport adapter once the [proposed API contract](../docs/api-contract.md) is agreed. Current chat/upload responses differ from that proposal; there are no case-scoped routes or WebSockets yet.

The intended backend flow is upload → extract/source-link facts → clarify missing/conflicting values → generate a versioned draft → advisor review → founder revision. Database persistence, extraction/retrieval tools, task orchestration, sharing/version-bound reviews and server-side role/case authorization remain unimplemented. Chime media is connected through a separate frontend transport; consented after-call processing is not implemented.

See [specs.md](../specs.md) and [implementation.md](../implementation.md) for the full intended workflow. PostgreSQL on Amazon RDS is the selected record store. The schema and settings are present, but application persistence remains unimplemented.

## Chime in the V2 call design

The Call connection selector defaults to the local demo. Select **Amazon Chime ·
live media** to use `frontend-shared/src/liveCall.tsx` and `callsApi.ts`. Set
`VITE_API_URL` in the frontend process environment to the backend origin (default
`http://127.0.0.1:8000`); permit that frontend origin through `CORS_ORIGINS`.
Chime uses `CHIME_REGION` (default `us-east-1`) and the backend AWS credential
chain/profile. No credentials belong in the frontend.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/cases/{case_id}/calls` | Create or reuse this case's meeting |
| GET | `/api/cases/{case_id}/calls/{call_id}` | Read safe call metadata |
| POST | `/api/cases/{case_id}/calls/{call_id}/join` | Obtain ephemeral SDK join configuration |
| POST | `/api/cases/{case_id}/calls/{call_id}/end` | End the meeting for all participants |

Both participants must independently choose Start or join for the same case;
there is no remote invitation delivery. SDK connection events establish client
readiness. Leaving closes this browser's media; ending for everyone invokes the
backend. Recording and transcription remain off. Shared document selection is
pinned locally while joining/active; it is not synchronized through Chime.
Messages, documents and review actions alongside the call remain local simulations.

This inherited backend is a development prototype: actor identity is supplied by
the caller and call records are in memory. Production authentication, server-side
case authorization and persistent meeting lifecycle management remain required.
The frontend shared-document gate is not server authorization. Use only a trusted
development environment until those backend requirements are implemented.

## Strands / Bedrock workflow baseline

The separate `app.workflow_app:app` service on loopback port 8001 now connects the
founder backend workspace to the installed Strands SDK and a configured Bedrock
model/profile. It adds owner-scoped WebSocket snapshots, source extraction,
confirmed fields and immutable PDF output. The legacy `/api/chat` harness above
is preserved. See [workflow setup](../docs/bedrock-workflow.md) for current support
and the SQLite development/RDS boundary.
