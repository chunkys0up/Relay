# Relay Backend

Relay has separate browser, legacy integration, founder packet-workflow and advisor synthetic-workspace paths. They do not share one authorization or persistence layer.

## Service map

| Service | Client / state | Current scope |
| --- | --- | --- |
| Browser demo | `MockRelayAdapter`, browser persistence | Synthetic packet versions, role-filtered grants, reviews, human-message history and simulated calls |
| Legacy FastAPI | `app.main`, port 8000; PostgreSQL/S3, Bedrock, Chime | Founder chat with case tools, original uploads, case checklist/activity and optional live calls |
| Founder packet workflow | `app.workflow_app`, port 8001; SQLite | Loopback owner sessions, source extraction, tasks/facts, bounded PDF agents and confirmed PDF versions |
| Advisor synthetic workspace | `/api/advisor` on `app.workflow_app`; separate SQLite tables | Server-issued advisor sessions, seeded exact grants, private read-only chat and authorized previews |

Starting a service does not make it share browser case state with the others.

## Legacy FastAPI service

The legacy frontend uses the configured FastAPI origin (default `http://127.0.0.1:8000`). Start it from `backend/` with the existing project environment:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

See [`.env.example`](.env.example) and [configuration](app/core/config.py) for setting names. Do not put credentials in browser code. Startup can continue without a database connection, but database-backed actions fail when they are used.

### Chat and case progress

Founder AI Chat streams responses from `POST /api/chat/stream`. The request may contain `message`, `session_id`, `case_id` and `document_ids`. File attachment bytes are loaded by the backend before model execution. The agent has six registered tools:

- list/add/update the case checklist;
- log meaningful case activity;
- list case documents and read one uploaded file.

The tool receives the request's `case_id` through Strands invocation state. Checklist and activity updates are written to PostgreSQL; Home and AI Chat refresh them through the routes below. Chat sessions use Strands session storage separate from case messages in the browser adapter.

This legacy service does not authenticate the caller or authorize the supplied case ID. Its case scoping prevents accidental cross-case tool selection but is not production access control. Do not describe this chat as grant-scoped advisor AI.

### Documents

`POST /api/documents/upload` accepts multipart `case_id` and `file`, uploads the original to S3 and inserts a `documents` row in PostgreSQL. Founder Home and the AI Chat attachment control use this upload path. A chat attachment ID is then passed to the live agent so it can read the stored file. `GET /api/documents?case_id=` lists originals and `GET /api/documents/{document_id}/url` returns a short-lived S3 URL.

The API uses case IDs supplied by the caller and has no actor/grant authorization. It is suitable only for a trusted development environment. The browser adapter’s explicit sharing grants do not secure the legacy document endpoints. Uploading a document does not add it to browser packet sources, extract it into the owner workflow, or create an advisor handoff.

PostgreSQL currently persists the `documents`, `case_checklist` and `case_activity` records used by these legacy features. Other schema tables do not yet represent a complete server-backed founder/advisor workflow. The schema is not applied automatically.

### Legacy routes

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/chat` | Generic Strands chat; accepts optional case and file IDs |
| POST | `/api/chat/stream` | Streams plain-text chat response |
| DELETE | `/api/chat/{session_id}` | Evicts cached agent; does not delete stored session files |
| POST | `/api/documents/upload` | Store original in S3 and metadata in PostgreSQL |
| GET | `/api/documents?case_id=` | List uploaded originals for case |
| GET | `/api/documents/{document_id}/url` | Return short-lived S3 download URL |
| GET | `/api/cases/{case_id}/checklist` | List checklist items |
| PATCH | `/api/cases/{case_id}/checklist/{item_id}` | Change checklist state |
| GET | `/api/cases/{case_id}/activity` | List recent activity |
| POST/GET | `/api/cases/{case_id}/calls...` | Chime meeting lifecycle and join config |
| POST | `/api/client-log` | Browser diagnostic event |

The Chime UI defaults to a simulated preview. Selecting Amazon Chime explicitly invokes the live media path. Call identity is caller-supplied and meeting metadata is held in memory. There is no recording, capture-consent, transcription or after-call service.

## Founder packet workflow

The separate `app.workflow_app` service runs on loopback port 8001 and is started as described in [workflow setup](../docs/bedrock-workflow.md). Vite proxies `/api/workflow` to it by default. Its SQLite repository owns workflow sessions, sources, tasks/jobs, facts and immutable PDF bytes. It supports source extraction, confirmed fact entry, bounded Strands analysis, PDF preview/edit proposals and explicit confirmation.

The owner workflow uses an HttpOnly session, CSRF tokens, revision checks and idempotency keys. Those protections are local-demo boundaries, not production identity. The service is separate from legacy Postgres/S3 documents and browser packet versions; no automatic import or advisor handoff connects them.

See [multi-agent runtime limits](../docs/multiagent-workflow.md) for tool scopes and budgets. The workflow uses separate extractor, orchestrator, reader, writer and verifier roles when configured. The verifier and deterministic PDF checks run before changes can be confirmed.

## Server synthetic advisor workspace

The same loopback `app.workflow_app` mounts `/api/advisor`. It uses its own server cookie/CSRF session, synthetic assignment and exact-version/source grants, private conversations and idempotency records. The seeded synthetic records live in separate SQLite tables and are independent of founder browser state, the legacy document catalog and owner workflow cases.

Advisor chat uses one read-only Strands agent. The server checks assignments and grants on every version/source read and citation preview; it validates that cited evidence was actually read and matches the source/version hash. The assistant can answer, identify unknown/conflicting evidence, compare selected versions, or prepare an editable private follow-up draft. It cannot save, approve, share, or send to a client. See [advisor boundaries](../docs/advisor-bedrock.md).

This is not production authentication or a real founder handoff. Do not substitute the advisor server's synthetic grants for authorization in the legacy API.

## Configuration and verification

See [`.env.example`](.env.example), [Bedrock role setup](../docs/bedrock-role-setup.md), [API boundaries](../docs/api-contract.md), and [specs](../specs.md). Configuration or fixture-based test success does not prove AWS access, live model quality, a real Chime session, or production authorization. No endpoint creates AWS resources.
