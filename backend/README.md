# Relay Backend

FastAPI provides Strands-backed chat and S3 document uploads. The repository also includes an RDS Postgres schema and connection settings; no database client or application queries are wired up yet.

## Current architecture

```text
React founder/advisor UI → in-memory mock (not connected to FastAPI)

FastAPI
├── /api/chat          → cached Strands harness per session_id → configured model
├── /api/chat/stream   → same agent, plain-text streaming response
└── /api/documents/upload → boto3 → S3 object + upload metadata

RDS Postgres: schema/config only; no connection from the routes above
```

- **Chat:** [agents/factory.py](app/agents/factory.py) creates one agent per session ID, with both tool lists empty. The harness receives `SESSION_DIR` for session storage; this is separate from case/message records in Postgres. Bedrock is the default provider; `STRANDS_MODEL` selects the model.
- **Upload:** [documents.py](app/api/routes/documents.py) reads the file and [storage/s3.py](app/storage/s3.py) uploads it to `S3_BUCKET` under `documents/{uuid}/{original filename}`. It returns metadata without creating a case/document record or starting extraction.
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
| POST | `/api/documents/upload` | Multipart `file` → bucket, key, filename, content type and size |

## Frontend integration and remaining work

The frontend currently creates a [MockRelayAdapter](../frontend-shared/src/context.tsx), so uploads, messages, reviews and calls do not reach these endpoints. Replace it with a transport adapter once the [proposed API contract](../docs/api-contract.md) is agreed. Current chat/upload responses differ from that proposal; there are no case-scoped routes or WebSockets yet.

The intended backend flow is upload → extract/source-link facts → clarify missing/conflicting values → generate a versioned draft → advisor review → founder revision. Database persistence, extraction/retrieval tools, task orchestration, sharing/version-bound reviews and server-side role/case authorization remain unimplemented. Chime calls and consented after-call processing are also not connected.

See [specs.md](../specs.md) and [implementation.md](../implementation.md) for the full intended workflow. PostgreSQL on Amazon RDS is the selected record store. The schema and settings are present, but application persistence remains unimplemented.
