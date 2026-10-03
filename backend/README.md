# Relay Backend

FastAPI service: Strands-backed chat, S3 document upload (now recording a `documents` row per upload), and Amazon Chime live-call endpoints. An RDS Postgres schema and connection are wired up for documents; `cases`/`facts`/`drafts`/`messages`/`advisor_actions` have no endpoints yet.

## Current architecture

```text
React founder/advisor UI → local mock for chat/reviews (documents now hits the real backend)
Call page (Amazon Chime mode) → FastAPI call endpoints → Chime SDK media

FastAPI
├── /api/chat              → cached Strands harness per session_id → configured model
├── /api/chat/stream       → same agent, plain-text streaming response
├── /api/documents/upload  → boto3 → S3 object, then INSERT into Postgres `documents` (rolled back on bad case_id)
├── /api/documents         → GET, lists a case's documents from Postgres
└── /api/cases/{id}/calls  → Chime SDK meeting lifecycle
```

- **Chat:** [agents/factory.py](app/agents/factory.py) creates one agent per session ID, with both tool lists empty. The harness receives `SESSION_DIR` for session storage; this is separate from case/message records in Postgres. Bedrock is the default provider; `STRANDS_MODEL` selects the model.
- **Upload:** [documents.py](app/api/routes/documents.py) reads the file, [storage/s3.py](app/storage/s3.py) uploads it to `S3_BUCKET` under `tenants/{DEMO_TENANT_ID}/cases/{case_id}/sources/{source_id}/versions/1/original.{ext}` (opaque IDs; only a validated extension is kept from the filename), then inserts a row into Postgres `documents` using that same `source_id` as the row's `id`. If the insert fails (e.g. `case_id` doesn't exist), the S3 object is deleted so nothing orphaned is left behind. `storage/s3.py` also provides presigned upload/download URLs, `head_object`, and `download_bytes` — not yet called from any route, ready for a future fetch/preview endpoint.
- **List:** `GET /api/documents?case_id=` reads a case's `documents` rows back out of Postgres (`id`, `filename`, `s3_key`, `uploaded_at`).
- **Records:** [db/schema.sql](db/schema.sql) defines `cases`, `documents` (now the only table the app writes to), source-linked `facts`, versioned `drafts`, `messages`, and advisor decisions tied to a draft. [db/seed.sql](db/seed.sql) has sample cases. Schema isn't idempotent and isn't applied automatically — apply it once per fresh database.
- **Postgres connection:** one `asyncpg` pool (`app/db/pool.py`), created on startup and closed on shutdown via `lifespan` in `app/main.py`. If `DB_HOST`/`DB_PASSWORD` aren't set, or RDS isn't reachable, startup logs a warning and continues — `/api/chat`/`/health` keep working, but any DB-backed route raises a clear `RuntimeError` at the point of use.

All of Bedrock, S3, and RDS live in **one AWS account**, read through the same mechanism: an AWS profile named by `AWS_PROFILE` in `.env`.

## Local setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv sync
cp .env.example .env  # first setup only; keep an existing .env
# Fill in .env before starting the service — see AWS credentials setup below.
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Add `--reload` for local development. Uvicorn's host/port come from its CLI flags; the `HOST`/`PORT` application settings aren't wired into this command. Open `http://127.0.0.1:8000/docs` for the API schema.

## AWS credentials setup

The app needs one set of AWS credentials with:
- `bedrock:InvokeModel` / `InvokeModelWithResponseStream` on the model in `STRANDS_MODEL`, in `AWS_REGION`
- `s3:PutObject`/`GetObject`/`DeleteObject` on the bucket in `S3_BUCKET`
- `chime:*` meeting permissions, in `CHIME_REGION`
- Network access + the master password to the RDS instance in `DB_HOST` (separate from IAM — see Data store below)

Steps:

1. **Get credentials into a named profile.** If you were issued temporary credentials as already-exported shell variables (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` — typical for an AWS Workshop Studio/event account), persist them to a profile so anything outside that one shell (this app, another terminal) can use them too:
   ```bash
   aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID" --profile participant
   aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY" --profile participant
   aws configure set aws_session_token "$AWS_SESSION_TOKEN" --profile participant
   aws configure set region us-east-1 --profile participant
   ```
   For a regular IAM user instead, run `aws configure --profile participant` and enter the access key/secret when prompted (no session token). Pick any profile name — just make it match `AWS_PROFILE` in `.env`.

2. **Verify identity:** `AWS_PROFILE=participant aws sts get-caller-identity`

3. **Verify Bedrock access** (the model ID must come back; if missing or access-denied, the account/region doesn't have it enabled):
   ```bash
   AWS_PROFILE=participant aws bedrock list-foundation-models --region us-east-1 \
     --query "modelSummaries[?contains(modelId, 'claude')].modelId" --output text
   ```

4. **Verify S3 access:** `AWS_PROFILE=participant aws s3 ls s3://relay-documents-576248046713/`

5. **Verify RDS connectivity** (needs `DB_HOST`/`DB_PASSWORD` in `.env`, and your IP allowed in the instance's security group — see Data store below):
   ```bash
   PGPASSWORD=... psql -h <DB_HOST> -U relay_admin -d relay -c "select 1"
   ```

### Gotchas hit while setting this up

- **Pydantic-settings parsing `.env` does NOT export those vars to `os.environ`.** boto3 (inside Strands' Bedrock provider) and other SDKs read `os.environ` directly, so `app/core/config.py` explicitly calls `load_dotenv()` — without it, `AWS_PROFILE` in `.env` is invisible to anything except our own `Settings` object.
- **A profile's `region` in `~/.aws/config` overrides the `AWS_REGION` env var** for code that builds a bare `boto3.Session()` with no explicit region (which is what Strands' Bedrock provider does). Keep the profile's configured region consistent with `AWS_REGION` in `.env`, or Bedrock calls silently go to the wrong region.
- Some Bedrock models require an **inference profile ID**, not the bare model ID (`aws bedrock get-foundation-model --model-identifier <id> --query modelDetails.inferenceTypesSupported` returns `INFERENCE_PROFILE` if so). `STRANDS_MODEL=bedrock/us.anthropic.claude-sonnet-5` uses the `us.` cross-region profile, not `anthropic.claude-sonnet-5` directly.

## Configuration

See [.env.example](.env.example) for all variables and [core/config.py](app/core/config.py) for typed settings.

| Variables | Purpose |
| --- | --- |
| `AWS_PROFILE`, `AWS_REGION` | AWS credentials/profile and default region (Bedrock, S3). Keep the profile's own region consistent with this. |
| `STRANDS_MODEL`, `STRANDS_EFFORT` | Harness model and effort. Verify model/inference-profile access for your account before relying on a given value. |
| `S3_BUCKET` | Upload destination; credentials need write/delete permission. |
| `DEMO_TENANT_ID` | Tenant segment in the S3 key layout (`tenants/{DEMO_TENANT_ID}/cases/...`). |
| `CHIME_REGION` | Region for the Chime SDK meetings client. |
| `SESSION_DIR` | Harness session storage directory. |
| `CORS_ORIGINS` | Allowed browser origins, comma-separated; include the frontend's origin when connecting it. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Postgres connection. Backs the `documents` table only so far. |

`load_dotenv()` also exposes `.env` values to provider SDKs that read the process environment directly. Credentials and service availability are not checked by `/health`.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Service name/status |
| GET | `/health` | Static process health response |
| POST | `/api/chat` | `{"message": str, "session_id": str}` → reply; `session_id` defaults to `"default"` |
| POST | `/api/chat/stream` | Same body, streams the reply as plain text |
| DELETE | `/api/chat/{session_id}` | Evicts the cached agent (fresh memory); doesn't delete stored session files |
| POST | `/api/documents/upload` | Multipart `case_id` (UUID form field) + `file` → uploads to S3, inserts a `documents` row, returns it. 404 + S3 rollback if `case_id` doesn't exist |
| GET | `/api/documents?case_id=` | List a case's documents (`id`, `filename`, `s3_key`, `uploaded_at`), oldest first |
| POST | `/api/cases/{case_id}/calls` | Create or reuse this case's Chime meeting |
| GET | `/api/cases/{case_id}/calls/{call_id}` | Read safe call metadata |
| POST | `/api/cases/{case_id}/calls/{call_id}/join` | Obtain ephemeral SDK join configuration |
| POST | `/api/cases/{case_id}/calls/{call_id}/end` | End the meeting for all participants |

## Data store

**S3** — bucket `relay-documents-576248046713` (`us-east-1`), all public access blocked. Canonical key layout: `tenants/{DEMO_TENANT_ID}/cases/{case_id}/sources/{source_id}/versions/{version}/original.{ext}` (see `storage/s3.py::build_key`). A teammate separately seeded a large proposed-layout demo dataset into this same bucket (`bootstrap/`, `reference-library/`, `tenants/relay-demo/cases/...` with real-looking documents) — see `bootstrap/relay-demo/v1/README.md` *inside the bucket itself* for what that is; it's bootstrap/proposal data the app doesn't read from automatically.

**RDS Postgres** — instance `relay-db` (PostgreSQL 18.6, `db.t4g.micro`, `us-east-1`), publicly accessible but restricted by security group `sg-07024a822c3a9ffe6` to one IP at a time (the IP it was created from) — **add your IP to that security group's inbound rule on port 5432 if connecting from a new machine/network**, or connections will just time out. Schema in `db/schema.sql` (apply with `psql ... -f db/schema.sql`); sample rows in `db/seed.sql`. `app/db/pool.py` holds the one `asyncpg` pool the app uses, built from `Settings.database_url` (`app/core/config.py`).

Tables: `cases` (the core entity, has a `status`), `documents` (**the only one the app writes to** — uploaded files, references `cases`, stores the S3 key), `facts` (extracted structured data per case, optionally sourced from a `document`), `drafts` (versioned generated output per case, stored in S3), `messages` (chat history per case), `advisor_actions` (human decisions on a `draft`). Full column definitions in `db/schema.sql`.

## Frontend integration and remaining work

The frontend currently creates a [MockRelayAdapter](../frontend-shared/src/context.tsx), so chat/messages/reviews don't reach these endpoints — document upload is the one path now wired to the real backend. The Call page separately connects to the Chime routes above when Amazon Chime mode is selected. Replace the mock adapter with a transport adapter once the [proposed API contract](../docs/api-contract.md) is agreed — that contract describes a two-phase presigned-upload flow (`POST /api/cases/{id}/uploads` → `POST .../uploads/{source_id}/complete`) that neither this upload endpoint nor anything else here implements yet; today's upload is a single direct multipart `POST`.

The intended backend flow is upload → extract/source-link facts → clarify missing/conflicting values → generate a versioned draft → advisor review → founder revision. Beyond `documents`, database persistence, extraction/retrieval tools, task orchestration, sharing/version-bound reviews, and server-side role/case authorization remain unimplemented. Agent has no tools yet (`builtin_tools=[]`, `tools=[]` in `app/agents/factory.py`) — it can only chat.

See [specs.md](../specs.md) and [implementation.md](../implementation.md) for the full intended workflow.

## Chime in the V2 call design

The Call connection selector defaults to the local demo. Select **Amazon Chime · live media** to use `frontend-shared/src/liveCall.tsx` and `callsApi.ts`. Set `VITE_API_URL` in the frontend process environment to the backend origin (default `http://127.0.0.1:8000`); permit that frontend origin through `CORS_ORIGINS`. Chime uses `CHIME_REGION` (default `us-east-1`) and the backend's AWS credential chain/profile. No credentials belong in the frontend.

Both participants must independently choose Start or join for the same case; there's no remote invitation delivery. SDK connection events establish client readiness. Leaving closes this browser's media; ending for everyone invokes the backend. Recording and transcription remain off. Shared document selection is pinned locally while joining/active; it isn't synchronized through Chime. Messages, documents, and review actions alongside the call remain local simulations except for upload, as above.

This inherited backend is a development prototype: actor identity is supplied by the caller and call records are in memory. Production authentication, server-side case authorization, and persistent meeting lifecycle management remain required. The frontend shared-document gate is not server authorization. Use only a trusted development environment until those backend requirements are implemented.

## Project layout

```
app/
  main.py                FastAPI app, logging middleware, CORS, lifespan (DB pool), router wiring
  core/
    config.py              Settings — reads .env, loads AWS/Bedrock/S3/Chime/DB config
    logging.py              setup_logging()
  agents/factory.py        create_harness() wrapper, one cached agent per session_id
  storage/s3.py            boto3 S3 client — upload/download/delete, head_object, presigned URLs, canonical build_key
  db/pool.py                asyncpg pool, created/closed via app lifespan
  services/chime.py         Chime SDK meetings client
  schemas/                 Pydantic request/response models
  api/routes/
    health.py              GET /health
    chat.py                 Chat endpoints
    documents.py             Document upload + list endpoints
    calls.py                 Chime call lifecycle endpoints
    client_log.py             Frontend log ingestion
db/
  schema.sql              Table definitions (applied to relay-db)
  seed.sql                 Sample rows
```

## Strands / Bedrock workflow baseline

The separate `app.workflow_app:app` service on loopback port 8001 now connects the
founder backend workspace to the installed Strands SDK and a configured Bedrock
model/profile. It adds owner-scoped WebSocket snapshots, source extraction,
confirmed fields and immutable PDF output. The legacy `/api/chat` harness above
is preserved. See [workflow setup](../docs/bedrock-workflow.md) for current support
and the SQLite development/RDS boundary.
