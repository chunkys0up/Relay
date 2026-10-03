# Bedrock + Strands packet workflow

This is a local, fictional-data baseline built on the installed Strands Agents SDK.
It connects the founder's backend workspace to an explicitly configured Bedrock
model and streams saved case/message/task state over an authorized WebSocket.
The existing teammate chat harness and Chime implementation are preserved.
The backend workspace now defaults to an orchestrator with separate reader, writer
and PDF verifier agents; see [the multi-agent architecture](multiagent-workflow.md).

## Start locally

Dependencies are declared in `backend/pyproject.toml` and `backend/uv.lock`.
From `backend/`, after installing the approved dependencies:

```bash
export BEDROCK_MODEL_OR_PROFILE_ID='us.anthropic.claude-sonnet-5'
export AWS_REGION='us-east-1'
.venv/bin/uvicorn app.workflow_app:app --host 127.0.0.1 --port 8001
```

The profile above is an AWS-documented **example**, not proof of access in your
account. Use the profile from your successful Sonnet 5 request. The service does
not read `.env` automatically. Supply existing approved credentials through the
normal AWS SDK chain when you intentionally enable live calls. Do not put AWS
credentials in browser code. No AWS resources are provisioned by this change.

AWS model reference:
https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html

From the repository root, `npm run dev` starts the frontend. Vite proxies
`/api/workflow` HTTP and WebSocket traffic to port 8001. Choose **Open backend
packet workspace** on founder Home or AI Chat. This creates a separate backend
case instead of importing browser demo state or silently sharing documents.
Production hosting would need the equivalent same-origin proxy.

1. Create a fictional case on Home. Upload text, CSV or text-based PDFs, or supply facts directly in chat.
2. Open AI Chat, enter your request and run analysis. Task records precede model
   execution. Strands uses the configured Bedrock profile; missing configuration
   never produces a fake success.
3. Ask Relay to fill or update the PDF. The agent can read scoped documents and
   packet fields, then propose a cited PDF edit. Its actual reply appears in chat.
   Review the proposed values, evidence and PDF preview, check the review box,
   then save the new version. Proposals alone never change confirmed facts or packets.
   The existing manual fact-confirmation workflow remains available.
4. Optionally upload an unsigned fillable
   PDF template with text fields named `company_name`, `founder_name`,
   `business_summary`, `annual_revenue`, `cash_reserve`, `period`.
5. Preview/download the version. Changing inputs requires renewed confirmation;
   older PDF versions remain unchanged.

## Transport and ownership

- `backend/app/workflow/model.py`: Strands + Bedrock model adapter, bounded
  attempts and schema/evidence validation. No shell, web or arbitrary agent tools.
- `backend/app/workflow/tools.py`: four case-scoped Strands tools: `list_documents`,
  `read_document`, `read_packet`, `propose_pdf_edit`. No model-accessible save,
  confirm, approve, send or share tool. Reads use existing extracted passages.
- `backend/app/workflow/actions.py`: atomic staged preview and explicit confirmation;
  confirmation promotes the exact preview bytes, bound to hash and case revision.
- `backend/app/workflow/documents.py`: text/PDF extraction, injected Textract
  adapter, packet generation and canonical AcroForm filling checks.
- `backend/app/workflow/repository.py`: SQLite **development** persistence for
  sessions, cases, tasks, jobs, sources and immutable packet blobs.
- `backend/app/workflow/service.py`: confirmation, conflict and revision rules.
- `backend/app/api/routes/workflow.py`: scoped HTTP and WebSocket transport.
- `client-frontend/src/workflow/`: founder UI and transport; Home and AI Chat
  retain the approved navigation. Advisor workflows remain in their existing folder.

The HTTP session creates an HttpOnly cookie and a CSRF token. Mutations include
`X-CSRF-Token`, an `Idempotency-Key`, and an expected revision. Case access is
checked against the server-side session. The WebSocket endpoint is
`/api/workflow/cases/{case_id}/events`: send `{csrf_token, after_revision}` as the
first frame. Only after session, origin and case checks does the server send
`ready` and saved `snapshot` messages. It does not send model reasoning/traces.
Reconnect sends the last revision and receives the latest saved snapshot; this
baseline coalesces intermediate revisions, rather than promising a full event log.
Active-job polling remains a fallback if the socket disconnects.

## Limits

This is a loopback-only founder prototype, not production authentication. SQLite
is explicitly a development repository; PostgreSQL/RDS, S3 persistence, durable
multi-worker queues and advisor sharing/review integration are not implemented
for these new backend cases. Legacy demo and Chime routes remain separate.

Analysis is intentionally bounded to 49 source excerpts plus the current user
message, with at most 1,200 characters per excerpt. Over-budget context blocks
the task instead of silently omitting evidence. Create a new case with smaller
files to recover; source deletion/chunk selection is not implemented yet.

Native text PDFs work locally. Scanned-PDF OCR is rejected rather than fabricated.
An injected Textract adapter supports image extraction, but no live Textract
operation was run. Filling rejects signed/encrypted/unsupported or ambiguous
forms. This supports the six named planning fields, not arbitrary PDF layout edits.
The model only proposes edits; confirmed founder input controls the saved PDF.
A stale preview must be proposed again. Older confirmed values and unresolved
conflicts cannot be silently overwritten by an unrelated edit. The original single-agent adapter retains its four-turn budget. The default
multi-agent team has separate bounded handoffs and mandatory verification; see
[multi-agent runtime limits](multiagent-workflow.md#runtime-limits).
Late results after timeout cannot write data.

## Repeatable verification

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/python backend/tests/make_browser_fixtures.py
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run test:browser
npm run test:workflow
```

The workflow browser config starts an explicitly labeled test-provider app and
isolated temporary database. It does not call Bedrock or read AWS credentials.
The agent-action tests use a scripted model through the actual installed Strands
SDK, including tool selection/execution. They do not demonstrate live Sonnet quality
or account access. Live account access, model quality, real Textract and RDS remain
separate tests.
Keep run-specific logs outside the tracked documentation. Current product boundaries are in [specs.md](../specs.md) and [implementation.md](../implementation.md).
