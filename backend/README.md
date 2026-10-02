# Relay Backend

FastAPI service with three parts: a [Strands](https://strandsagents.com) harness agent (Bedrock-backed chat), S3 document upload, and an RDS Postgres database tracking advisory cases through intake → fact extraction → draft → review. No agent tools are wired up yet, and nothing in the app talks to Postgres yet — both are baseline/config-only, ready to build on.

## Architecture

```
FastAPI (app/main.py)
├── /api/chat*        strands_harness agent, one cached instance per session_id, runs on Bedrock
├── /api/documents/*   uploads files to S3 (private bucket)
└── (not wired up yet) RDS Postgres — schema in db/schema.sql, settings.database_url ready, no client/ORM added
```

All three (Bedrock, S3, RDS) live in **one AWS account** and read credentials through the same mechanism: an AWS profile named in `.env`.

## AWS credentials setup

The app needs one set of AWS credentials with:
- `bedrock:InvokeModel` / `InvokeModelWithResponseStream` on the model in `STRANDS_MODEL`, in `AWS_REGION`
- `s3:PutObject` on the bucket in `S3_BUCKET`
- Network access + the master password to the RDS instance in `DB_HOST` (separate from IAM — see Data store below)

Steps:

1. **Get credentials into a named profile.** If you were issued temporary credentials as already-exported shell variables (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` — typical for an AWS Workshop Studio/event account), persist them to a profile so anything outside that one shell (this app, another terminal) can use them too:
   ```bash
   aws configure set aws_access_key_id "$AWS_ACCESS_KEY_ID" --profile participant
   aws configure set aws_secret_access_key "$AWS_SECRET_ACCESS_KEY" --profile participant
   aws configure set aws_session_token "$AWS_SESSION_TOKEN" --profile participant
   aws configure set region us-east-1 --profile participant
   ```
   For a regular IAM user instead, run `aws configure --profile participant` and enter the access key/secret when prompted (no session token). Pick any profile name — just make it match `AWS_PROFILE` in `.env` (step 3).

2. **Verify identity:**
   ```bash
   AWS_PROFILE=participant aws sts get-caller-identity
   ```

3. **Set `backend/.env`** (copy from `.env.example` if you don't have one):
   ```
   AWS_PROFILE=participant
   AWS_REGION=us-east-1
   ```

4. **Verify Bedrock access** (the model ID must come back; if it's missing or access-denied, the account/region doesn't have it enabled):
   ```bash
   AWS_PROFILE=participant aws bedrock list-foundation-models --region us-east-1 \
     --query "modelSummaries[?contains(modelId, 'claude')].modelId" --output text
   ```

5. **Verify S3 access:**
   ```bash
   AWS_PROFILE=participant aws s3 ls s3://relay-documents-576248046713/
   ```

6. **Verify RDS connectivity** (needs `DB_HOST`/`DB_PASSWORD` in `.env`, and your IP allowed in the instance's security group — see Data store below):
   ```bash
   PGPASSWORD=... psql -h <DB_HOST> -U relay_admin -d relay -c "select 1"
   ```

### Gotchas hit while setting this up

- **Pydantic-settings parsing `.env` does NOT export those vars to `os.environ`.** boto3 (inside Strands' Bedrock provider) and other SDKs read `os.environ` directly, so `app/core/config.py` explicitly calls `load_dotenv()` — without it, `AWS_PROFILE` in `.env` is invisible to anything except our own `Settings` object.
- **A profile's `region` in `~/.aws/config` overrides the `AWS_REGION` env var** for code that builds a bare `boto3.Session()` with no explicit region (which is what Strands' Bedrock provider does). Keep the profile's configured region consistent with `AWS_REGION` in `.env`, or Bedrock calls silently go to the wrong region. (This is literally what broke it the first time — the profile had leftover `region = us-west-1` from being copied off `default`, and the workshop account's service control policy denies Bedrock in that region.)
- Some Bedrock models require an **inference profile ID**, not the bare model ID (`aws bedrock get-foundation-model --model-identifier <id> --query modelDetails.inferenceTypesSupported` returns `INFERENCE_PROFILE` if so). `STRANDS_MODEL=bedrock/us.anthropic.claude-sonnet-5` uses the `us.` cross-region profile, not `anthropic.claude-sonnet-5` directly.

## Setup & running

Requires [uv](https://docs.astral.sh/uv/) and Python 3.10+.

```bash
cd backend
uv sync
cp .env.example .env   # then follow AWS credentials setup above
uv run uvicorn app.main:app
```

Server listens on `http://127.0.0.1:8000` (`HOST`/`PORT` in `.env`). No `--reload` by default — restart manually after edits, or add `--reload` yourself if you want it.

## Configuration

`.env.example` is the source of truth, fully commented — copy it to `.env` and fill in values. `app/core/config.py` is the typed read of it (`Settings`).

## Endpoints

| Method | Path                      | Description                                                  |
|--------|---------------------------|----------------------------------------------------------------|
| GET    | `/`                       | Service info                                                   |
| GET    | `/health`                 | Health check                                                    |
| POST   | `/api/chat`               | `{"message": str, "session_id": str}` → full reply              |
| POST   | `/api/chat/stream`         | Same body, streams reply as plain text                          |
| DELETE | `/api/chat/{session_id}`  | Drop a cached session's agent (fresh start, memory reset)        |
| POST   | `/api/documents/upload`   | Multipart `file` field → uploads to S3, returns bucket/key/size  |

## Data store

**S3** — bucket `relay-documents-576248046713` (`us-east-1`), all public access blocked. `app/storage/s3.py` uploads under `documents/{uuid}/{original filename}`.

**RDS Postgres** — instance `relay-db` (PostgreSQL 18.6, `db.t4g.micro`, `us-east-1`), publicly accessible but restricted by security group `sg-07024a822c3a9ffe6` to one IP at a time (the IP it was created from) — **add your IP to that security group's inbound rule on port 5432 if connecting from a new machine/network**, or connections will just time out. Schema is in `db/schema.sql` (apply with `psql ... -f db/schema.sql`); sample rows in `db/seed.sql`. No ORM or DB client is wired into the app yet — `Settings.database_url` (in `app/core/config.py`) builds the connection string from `.env`, ready for whatever reads from it next.

Tables: `cases` (the core entity — a founder's engagement, has a `status`), `documents` (uploaded files, references `cases`, stores the S3 key), `facts` (extracted structured data per case, optionally sourced from a `document`, has a `confidence`/`status`), `drafts` (versioned generated output per case, stored in S3), `messages` (chat history per case), `advisor_actions` (human decisions on a `draft`). Full column definitions in `db/schema.sql`.

## Project layout

```
app/
  main.py                FastAPI app, CORS, router wiring
  core/config.py           Settings — reads .env, loads AWS/Bedrock/S3/DB config
  agents/factory.py        create_harness() wrapper, one cached agent per session_id
  storage/s3.py            boto3 S3 client, upload helper
  schemas/                 Pydantic request/response models
  api/routes/
    health.py              GET /health
    chat.py                 Chat endpoints
    documents.py             Document upload endpoint
db/
  schema.sql              Table definitions (applied to relay-db)
  seed.sql                 Sample rows
```

## Known gaps (next steps)

- Agent has no tools yet (`builtin_tools=[]`, `tools=[]` in `app/agents/factory.py`) — it can only chat, not read/write files, hit the web, or touch the DB/S3 itself.
- No code reads from or writes to Postgres yet — `facts`/`drafts`/`messages`/etc. aren't connected to any endpoint.
- `/api/documents/upload` doesn't create a `documents` row — it only puts the file in S3, nothing links it to a `case_id` yet.
