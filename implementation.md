# Relay implementation plan

Version 0.3 · React/FastAPI local demo

Read [specs.md](specs.md) and this file before changing the application. This plan is documentation only; it does not create AWS resources, enable permissions, record calls, delete data, deploy, or prove an integration.

## 1. Setup gate

Preserve the existing repository layout: `client-frontend/`, `advsior-frontend/` (existing spelling), and `backend/`. Do not rename unrelated directories. Use React + TypeScript frontends and a local Python FastAPI backend; do not retain Next.js Route Handler or Node worker assumptions.

Create a Python virtual environment and pin compatible dependencies only once implementation is authorized. Expected categories: `fastapi`, an ASGI server, WebSocket support, AWS SDK for Python, Pydantic, Strands Agents SDK, and focused test tooling. Frontend dependencies remain React/TypeScript and the existing chosen styling/component approach. Use the repository’s existing package manager when it exists; otherwise document the selected frontend toolchain.

Configuration names are placeholders, not values to invent:

```dotenv
AWS_REGION=us-east-1
S3_BUCKET=<permitted-private-bucket>
DYNAMODB_TABLE=<permitted-table>
BEDROCK_MODEL_OR_PROFILE_ID=<copy exact ID from successful request>
DEMO_MODE=true
DEMO_TENANT_ID=relay-demo
APP_ORIGIN=http://localhost:<frontend-port>
CHIME_REGION=<verified-region>
```

The user reports a working Bedrock call called “Claude Sonnet 5”; its exact Bedrock model/inference-profile ID is **UNVERIFIED**. Copy it from the successful request or verified account configuration, then run a small permitted invocation. Never fabricate an ID.

Preflight gates: AWS identity/region; S3 canonical write/read; DynamoDB conditional write/read; Textract extraction permission; Bedrock invoke permission and exact configured ID; Strands SDK compatibility; Chime SDK permissions; Chime media-capture and Transcribe prerequisites; and a two-person Chime audio test. New cloud resources, permission changes, credentials, or real data require team authorization.

## 2. Proposed structure

```text
client-frontend/
  src/{home,sources,documents,call,settings,assistant,chat,tasks}/
advsior-frontend/
  src/{clients,reviews,documents,call,settings,preview,assistant,chat}/
backend/
  app/
    main.py
    api/{cases,documents,messages,calls,reviews,events}.py
    ws/{case_hub,protocol}.py
    domain/{schemas,transitions,permissions}.py
    services/{repository,storage,textract,retrieval,chime,transcribe}.py
    ai/{bedrock,strands_orchestrator,specialists,prompts}.py
    jobs/{dispatch,leases}.py
  tests/{unit,integration,e2e}/
  scripts/{seed,aws_smoke}.py
fixtures/{founder,advisor,sources,expected}/
specs.md
implementation.md
```

Keep browser code away from credentials. Share generated or manually maintained safe DTOs; never serialize complete server case objects or AWS credentials into a client.

## 3. Domain contracts

Use UUIDs, ISO timestamps, explicit currency/period, and integer minor units or decimal strings for money.

```python
UiState = Literal["Idle", "Thinking / Working", "Needs input"]
TaskState = Literal["Pending", "In progress", "Blocked", "Done"]
CallState = Literal["ringing", "connecting", "connected", "ended", "failed"]
FactState = Literal["proposed", "confirmed", "conflicting", "unknown"]
```

Pydantic schemas cover:

- `Case`: service/template revision, founder, authorized advisors, current packet, case/UI status.
- `Document`: canonical S3 key, hash, original name/MIME/bytes, version, Textract extraction status, permitted excerpts.
- `Excerpt`: document ID/hash, page/row/field locator, text, case/type metadata.
- `Fact` and `Conflict`: value/state/revision plus valid evidence.
- `Task` and `Job`: ordered task, dependencies, actor, idempotency key, checkpoint/lease, bounded failure.
- `Message`: actual human/AI author, explicit audience, text, selected attachments, status, idempotency key.
- `CallSession`: invited/accepted participants, Chime meeting/attendee references kept server-side, call state, mute events, consent and capture/process/delete state.
- `PacketVersion`, `Review`, `ShareGrant`, `Consent`, and replayable `Event`.

DynamoDB partitions all case records by tenant/case and uses typed sort keys. Keep originals, extracted text, and packet bodies in S3; keep catalog, status, pointers, facts, tasks, messages, reviews, and consent in DynamoDB. Use conditional writes for leases, handoffs, sends, and decisions.

## 4. Backend APIs and WebSockets

All HTTP and WebSocket paths derive actor/role/case server-side, validate data, authorize scope, redact errors, and use expected revision/idempotency keys for mutations.

| Endpoint | Contract |
| --- | --- |
| `GET/POST /api/cases` | List authorized demo folders / create own fictional case |
| `GET /api/cases/{id}` | Safe case snapshot |
| `POST /api/cases/{id}/uploads` | Validate metadata and issue constrained staging upload |
| `POST /api/cases/{id}/uploads/{source_id}/complete` | Canonicalize, hash, catalogue, trigger Textract |
| `GET /api/cases/{id}/sources/{source_id}/preview` | Authorized short-lived preview |
| `POST /api/cases/{id}/messages` | Store human/AI draft according to audience/confirmation rules |
| `POST /api/cases/{id}/run` | Persist visible tasks, then enqueue bounded work |
| `POST /api/cases/{id}/handoff` | Confirm exact advisor/version/source manifest |
| `POST /api/cases/{id}/clarifications` | Create question preview |
| `POST /api/cases/{id}/clarifications/{qid}/send` | Confirm unchanged recipient/content and send once |
| `POST /api/cases/{id}/calls` | Create idempotent Chime invitation for permitted participant |
| `POST /api/cases/{id}/calls/{call_id}/actions` | Accept/decline/mute/unmute/end after authorization |
| `POST /api/cases/{id}/calls/{call_id}/capture-consent` | Record per-participant opt-in; never infer it |
| `POST /api/cases/{id}/reviews` | Approve exact version or return confirmed questions |
| `WS /ws/cases/{id}` | Authenticated, case-scoped events: messages, tasks, draft progress, reviews, call state |

The FastAPI WebSocket hub validates session and case access before accepting, attaches an audience/actor scope, persists events before fan-out, and supports replay after reconnect. Do not stream private reasoning or raw model traces.

## 5. Retrieval and orchestration

Do not add Bedrock Knowledge Bases for the demo. After Textract output is normalized into S3, a backend retrieval tool accepts only authorized `case_id`, allowed document types, and a bounded query. It filters by case and sharing manifest, selects relevant passages, and returns source ID/hash/page/field citations. A document status flag is not retrieval. Indexed passage search is future work.

Use Strands Agents SDK in Python for one orchestrator. Registered specialist agents/functions become scoped tools: extraction, validation/conflict check, clarification draft, packet draft, and advisor routing. The orchestrator alone produces AI chat/current-activity messages; human messages preserve verified authorship. Every specialist gets least-privilege case data and cannot send, approve, grant access, invoke arbitrary network/shell, or change credentials.

Bound work to two specialists concurrently, four model calls per job including repair, a timeout, and one transient retry. Validate model and tool output with Pydantic; verify each citation against authorized excerpts. Missing evidence, invalid output, or exhausted budget blocks a visible task with a safe retry path.

## 6. Real calls, capture, and after-call flow

Use Amazon Chime SDK only after a working two-person audio test. The server creates/authorizes meeting participation; clients use official Chime SDK components. A mock must be visibly marked and cannot count as a real call.

Audio capture is separate from joining a call. Require each participant’s explicit consent before creating the approved Chime media-capture path. On consented capture: record durable processing state → capture media chunks to S3 → concatenate and validate audio format → batch Amazon Transcribe → Bedrock after-call summary/proposed changes → human review/confirmation. Do not show live AI suggestions.

For fictional demo data, delete audio and transcript after transcription/summary succeeds and the summary is confirmed. If any step fails, preserve only the unprocessed artifact/state needed for a visible retry and cleanup task; never silently lose data or claim a deletion that failed. Verify capture destination, Transcribe output, KMS/permissions as applicable, and cleanup results before claiming this path works.

## 7. UI implementation rules

Founder navigation is Home / Sources / Documents / Call plus Settings. Home centers the main AI chat; its attachment control is the only upload path. Keep the to-do list and current activity prominent on the right. Sources reads/browses uploaded originals and extraction metadata only; Documents shows generated drafts and advisor-reviewed versions. Do not create Work or separate Chat navigation.

Advisor navigation is Clients / Reviews / Documents / Call plus Settings. Retain client folders, source-linked document review, preview, and right AI chat. Call is a dedicated destination combining the document under review, authorized human video controls, human-message history, labeled AI support, and separate per-participant capture consent; it is not merely an inline Home toggle.

Render exactly three AI modes and four task states; call state is separate. Persist task list before planning/execution and publish activity through drafting/routing. Clarifications remain previewable until confirmed. Approval is version-bound; returning questions and sending are idempotent.

Use light surfaces and centralized sampled reference-image colors: navy `#00205B`, orange `#B35000`, muted `#99A5BD`. They are samples from the supplied LPL hackathon background, not verified universal brand standards. Use Midday file storage as visual inspiration only.

## 8. Phases and checks

1. **Foundation:** React navigation shells, FastAPI/Pydantic contracts, server-controlled demo role switch, repository interface, task/event persistence. Gate: Home / Sources / Documents / Call routes work; cross-case access fails; three AI modes/four task states render.
2. **Document flow:** chat attachment upload only, constrained S3 storage, Textract, S3 excerpt retrieval with citations, DynamoDB catalog/status. Gate: Sources reads originals; Documents separates packet versions; unsupported uploads fail safely.
3. **Orchestrator:** Strands tools, configured Bedrock invocation, task-first jobs, WebSocket replay, one cited contradiction plus one missing fact, clarification, and packet v1.
4. **Advisor and call loop:** client folders, source-linked review, returned-question loop, dedicated Call destination with packet context/human-message history, Chime invitation/state, and separate consent/capture path after prerequisites.
5. **Verification:** record pass/fail/not-run separately. Typical commands after scripts exist: frontend lint/type/test/build; `python -m pytest`; FastAPI integration tests; browser founder/advisor two-session navigation/message/call tests; `python backend/scripts/aws_smoke.py`.

Test Home/Sources/Documents/Call route permissions, chat-attachment-only upload, original-versus-generated document separation, unauthorized REST/WebSocket/source/event/call access, private-AI isolation, upload injection, fabricated citations, malformed model output, duplicate send/job/call action, reconnect, stale approval, consent withdrawal, capture/transcription/summary/cleanup failure, the one-missing-fact/one-contradiction demo, rejection-to-questions/v2 flow, and that mocks never imply real integration.

## 9. Coding-agent kickoff

```text
Read specs.md and implementation.md completely, then inspect the existing
client-frontend, advsior-frontend, and backend directories and repository
instructions. Preserve working code and the existing directory names. Build only
the fictional-data Relay demo when implementation is authorized: React clients,
a local Python FastAPI backend, FastAPI WebSockets, Strands-based hidden
specialists, S3/Textract/DynamoDB, and a configured Bedrock model/profile copied
from a successful request. Do not invent a model ID, create AWS resources,
expand permissions, deploy publicly, or use real customer data.

Implement task-first orchestration, exactly three AI UI modes, source-linked
facts, versioned drafts, explicit handoffs/sends, and the advisor
return/revise/approve loop. Founder Home centers AI chat with attachment-only uploads, visible to-do/current activity, and Home / Sources / Documents / Call navigation. Make Call a dedicated destination with the reviewed document, human video/message history, labeled AI support, and separate capture consent. Use Chime only
after real permissions and a two-person test; capture requires every
participant’s explicit consent, Transcribe and Bedrock run after the call, and
humans confirm proposed changes. Label every mock/fallback honestly. Run
applicable checks and report passed, failed, and not-run results.
```
