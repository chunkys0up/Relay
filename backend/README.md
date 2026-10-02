# Relay Backend

FastAPI service wrapping a [Strands](https://strandsagents.com) harness agent. No tools are enabled yet — this is a baseline to build features on top of.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python 3.10+.

```bash
cd backend
uv sync
cp .env.example .env   # fill in a model provider key (see below)
```

## Running

```bash
uv run uvicorn app.main:app
```

Add `--reload` if you want the server to auto-restart on file changes:

```bash
uv run uvicorn app.main:app --reload
```

Server listens on `http://127.0.0.1:8000` by default. Set `HOST`/`PORT` in `.env` to change it.

If you'd rather not type `uv run` every time, activate the venv once per terminal session and call `uvicorn` directly:

```bash
source .venv/bin/activate
uvicorn app.main:app
```

## Configuring a model

The harness defaults to Amazon Bedrock. To use a different provider, set `STRANDS_MODEL` in `.env` and export the matching API key:

| Provider  | `STRANDS_MODEL` example        | Env var               |
|-----------|---------------------------------|------------------------|
| Anthropic | `anthropic/claude-opus-5`       | `ANTHROPIC_API_KEY`    |
| OpenAI    | `openai/gpt-5`                  | `OPENAI_API_KEY`       |
| Google    | `google/gemini-2.5-pro`         | `GEMINI_API_KEY`       |
| Bedrock (default) | leave `STRANDS_MODEL` unset | `AWS_BEARER_TOKEN_BEDROCK` or AWS CLI config |

## Endpoints

| Method | Path               | Description                                   |
|--------|--------------------|------------------------------------------------|
| GET    | `/`                | Service info                                   |
| GET    | `/health`          | Health check                                   |
| POST   | `/api/chat`        | Send a message, get the full reply             |
| POST   | `/api/chat/stream`  | Send a message, stream the reply as plain text |
| DELETE | `/api/chat/{session_id}` | Drop a cached session's agent (fresh start) |
| POST   | `/api/documents/upload` | Upload a document to S3 (multipart form, field name `file`) |

`POST /api/chat` body:

```json
{ "message": "hello", "session_id": "default" }
```

`session_id` is optional (defaults to `"default"`) and scopes conversation memory — each session gets its own cached agent and on-disk transcript under `.agent/sessions/`.

### Try it

```bash
curl localhost:8000/health

curl -X POST localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "say hi in 3 words"}'

curl -X POST localhost:8000/api/documents/upload \
  -F "file=@/path/to/some-document.pdf"
```

## Document storage (S3)

Uploaded files go to the bucket in `S3_BUCKET` (`.env`), private by default (all public access blocked). Set `AWS_PROFILE` in `.env` to the name of a profile in `~/.aws/credentials` if you're not using the default AWS credential chain (e.g. `AWS_PROFILE=participant` for the workshop account). Objects are stored under a random key: `documents/{uuid}/{original filename}`.

## Project layout

```
app/
  main.py              FastAPI app, CORS, router wiring
  core/config.py        Settings loaded from .env
  agents/factory.py     create_harness() wrapper, one cached agent per session_id
  storage/s3.py          boto3 S3 client, upload helper
  schemas/                Request/response models
  api/routes/
    health.py           GET /health
    chat.py              Chat endpoints
    documents.py          Document upload endpoint
```

Add real tools in `app/agents/factory.py` (`builtin_tools=[...]` for Strands' built-ins like `shell`/`read`/`write`/`web_fetch`, or `tools=[...]` for custom ones) once there's a feature that needs them.
