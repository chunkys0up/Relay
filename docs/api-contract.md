# Relay frontend / FastAPI API contract

Status: **PROPOSED — awaiting Fabricator confirmation**. 2 October 2026.

Owners: Tim (frontend), Fabricator (backend), Andrew (AWS infrastructure).
Based on `specs.md` and `implementation.md` version 0.3. This proposal does not
change backend code, provision infrastructure, or claim an implemented endpoint.
Tim will share this document with Fabricator in Discord. Until confirmed, the
frontend uses a typed, synthetic, explicitly simulated adapter.

## Transport and consistency

- REST base `/api`; UTF-8 JSON except constrained direct file transfer. ISO-8601 UTC timestamps; UUID identifiers; SHA-256 lowercase hex hashes. Money is integer minor units plus ISO currency and explicit period, never binary floating point.
- Server session derives actor, role, tenant and permissions. Never trust a client-supplied role/actor to authorize anything. Prefer same-origin HttpOnly session cookies and CSRF protection for unsafe requests; exact session bootstrap is a confirmation item below.
- Every case, source, packet, message, call and event is authorized independently. Unauthorized IDs return 404 where disclosure would reveal another case. UI route guards are usability controls, not security boundaries.
- `Idempotency-Key: <UUID>` is required on every POST. Same actor, endpoint, key and canonical body returns the original result; changed body with the same key returns 409 `IDEMPOTENCY_CONFLICT`. Retries after uncertain delivery reuse the original key.
- Mutations include `expected_revision` for the object being changed. Version-bound actions also include `packet_version_id` and `packet_hash`. A stale request never silently targets the newest document.
- Successful responses use `{ data: T, meta: { request_id, mode: 'live' | 'simulated' } }`. Collection data is `{ items: T[], next_cursor: string | null }`. Error responses use the schema below. A 202 is accepted/persisted work, never completed processing.
- `AbortSignal` cancels a client wait; it does not prove server cancellation. After an ambiguous send, refresh/replay or retry with the same idempotency key. Do not report cancellation of persisted work without a server receipt.
- The production adapter must validate unknown JSON at the boundary. Do not cast arbitrary responses into trusted DTOs. No credentials, raw storage keys, raw Chime service responses, private AI turns, or specialist reasoning in browser DTOs/logs.

## Shared schemas

The following TypeScript notation describes JSON wire schemas. All fields are
required unless marked `?`; `null` means explicitly absent, not an empty value.

```ts
type ID = string; // UUID
type ISODate = string;
type Hash = string; // SHA-256
type UiState = 'Idle' | 'Thinking / Working' | 'Needs input';
type TaskState = 'Pending' | 'In progress' | 'Blocked' | 'Done';
type CallState = 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
type CaseStatus = 'Information needed' | 'Draft ready' | 'Advisor review'
  | 'Questions returned' | 'Advisor approved';
type Actor = { id: ID; name: string; role: 'founder' | 'advisor' };
type Session = { actor: Actor; demo: boolean; capabilities: string[] };
type Citation = {
  source_id: ID; source_hash: Hash; label: string;
  locator: { page?: number; sheet?: string; row?: number; field?: string };
}; // At least one locator member required, page/row >= 1.
type Source = {
  id: ID; revision: number; name: string; mime_type: string; bytes: number;
  hash: Hash; created_at: ISODate;
  extraction: 'queued' | 'processing' | 'ready' | 'failed';
  citations: Citation[]; error: ApiError['error'] | null;
};
type PacketVersion = {
  id: ID; document_id: ID; version: number; hash: Hash; created_at: ISODate;
  title: string; status: 'draft' | 'in_review' | 'questions_returned' | 'approved';
  previous_version_id: ID | null; changes: string[]; citations: Citation[];
}; // Content immutable; review state/revisions are separate records.
type Flag = {
  id: ID; kind: 'missing' | 'conflict' | 'uncertain'; text: string;
  packet_version_id: ID; citations: Citation[]; resolved: boolean;
};
type Task = { id: ID; order: number; title: string; state: TaskState;
  depends_on: ID[]; detail: string | null; citations: Citation[] };
type Audience = { kind: 'private_ai' } | { kind: 'human'; recipient_id: ID };
type Message = {
  id: ID; author: { kind: 'human' | 'ai'; id: ID; name: string };
  created_at: ISODate; audience: Audience; text: string;
  attachments: ID[]; citations: Citation[]; status: 'stored' | 'delivered' | 'failed';
}; // AI author is always the single visible Relay orchestrator.
type Review = { id: ID; revision: number; reviewer: Actor;
  packet_version_id: ID; packet_hash: Hash;
  decision: 'approved' | 'questions_returned'; clarification_id: ID | null;
  created_at: ISODate };
type Clarification = {
  id: ID; revision: number; packet_version_id: ID; packet_hash: Hash;
  recipient: Actor; text: string; citations: Citation[];
  status: 'preview' | 'sent' | 'answered'; message_id: ID | null;
};
type ShareGrant = { id: ID; revision: number; advisor_id: ID;
  packet_version_id: ID; packet_hash: Hash; source_ids: ID[]; message_ids: ID[] };
type CaptureState = 'off' | 'awaiting_consent' | 'starting' | 'capturing'
  | 'stopping' | 'stopped' | 'failed';
type ProcessingState = 'not_started' | 'queued' | 'transcribing'
  | 'summarizing' | 'needs_confirmation' | 'complete' | 'failed';
type CallSession = {
  id: ID; revision: number; state: CallState; packet_version_id: ID;
  participants: { actor: Actor; accepted: boolean; muted: boolean;
    capture_consent: 'not_given' | 'granted' | 'withdrawn'; consent_revision: number }[];
  capture: CaptureState; processing: ProcessingState;
  cleanup: 'not_required' | 'pending' | 'complete' | 'failed';
};
type CaseSnapshot = {
  id: ID; revision: number; company: string; founder: Actor; advisors: Actor[];
  status: CaseStatus; ui_state: UiState; activity: string | null;
  current_packet_version_id: ID | null; sources: Source[];
  packets: PacketVersion[]; tasks: Task[]; messages: Message[]; flags: Flag[];
  clarifications: Clarification[]; reviews: Review[]; grants: ShareGrant[];
  call: CallSession | null; event_cursor: string;
}; // All nested collections are filtered to this session's audience/grants.
type RevisionInput = { expected_revision: number };
type VersionInput = RevisionInput & { packet_version_id: ID; packet_hash: Hash };
type Preview = { url: string; expires_at: ISODate; mime_type: string;
  hash: Hash; filename: string };
```

Limit proposal: text 1–8,000 characters, 20 attachments per message, list page
size 1–100 (default 50). Upload type/size limits must be returned by capabilities,
not guessed by the client. Confirm these values before live integration.

## Endpoints from the implementation plan

In this table `{id}` is a case ID. All POST requests additionally require the
idempotency header. Reads never change review, sharing or consent state.

| Method/path | Request | Success data / HTTP status |
| --- | --- | --- |
| `GET /api/cases` | Query `cursor?`, `limit?` | Page of `{id, company, founder, status, revision, current_packet_version_id}` / 200; only authorized folders |
| `POST /api/cases` | `{service_id, template_revision, company, goal}` | `CaseSnapshot` / 201; own fictional case |
| `GET /api/cases/{id}` | None | `CaseSnapshot` / 200; atomic snapshot and replay cursor |
| `POST /api/cases/{id}/uploads` | `RevisionInput & {name, mime_type, bytes, sha256}` | `{upload_id, source_id, method:'PUT', url, headers:Record<string,string>, expires_at, max_bytes}` / 201; staging authorization only |
| `POST /api/cases/{id}/uploads/{source_id}/complete` | `RevisionInput & {upload_id, sha256}` | `{source:Source, case_revision:number, tasks:Task[]}` / 202; source canonicalized and hashed, extraction still queued |
| `GET /api/cases/{id}/sources/{source_id}/preview` | None | `Preview` / 200; reauthorize grant and hash |
| `POST /api/cases/{id}/messages` | `RevisionInput & {audience:Audience, text, attachments:ID[], confirmed_human_send:boolean}` | `{message:Message, case_revision:number}` / 201; human audience requires explicit confirmed send, never implied by AI text |
| `POST /api/cases/{id}/run` | `RevisionInput & {goal, source_ids:ID[]}` | `{job_id, tasks:Task[], case_revision:number}` / 202; tasks committed before execution |
| `POST /api/cases/{id}/handoff` | `VersionInput & {advisor_id, source_ids:ID[], message_ids:ID[], confirmed:true}` | `{grant:ShareGrant, case_revision:number}` / 201; selected manifest only |
| `POST /api/cases/{id}/clarifications` | `VersionInput & {recipient_id, text, citations:Citation[]}` | `{clarification:Clarification}` / 201; preview only, no delivery |
| `POST /api/cases/{id}/clarifications/{qid}/send` | `{expected_revision, packet_version_id, packet_hash, recipient_id, text, confirmed:true}` | `{clarification:Clarification, message:Message, case_revision:number}` / 200; compare revision/content/recipient/version against preview, send once |
| `POST /api/cases/{id}/calls` | `VersionInput & {recipient_id}` | `{call:CallSession}` / 201; invitation only, not connected media |
| `POST /api/cases/{id}/calls/{call_id}/actions` | `RevisionInput & {action:'accept'|'decline'|'mute'|'unmute'|'end'}` | `{call:CallSession}` / 200; accept may mean connecting, not connected |
| `POST /api/cases/{id}/calls/{call_id}/capture-consent` | `RevisionInput & {consent:'granted'|'withdrawn'}` | `{call:CallSession}` / 200; affects only session actor |
| `POST /api/cases/{id}/reviews` | `VersionInput & ({decision:'approved'} | {decision:'questions_returned', clarification_id:ID, clarification_revision:number, confirmed:true})` | `{review:Review, case_revision:number, clarification:Clarification|null}` / 201; return-and-send is atomic and idempotent |

Clarification send and review return must share the same durable delivery identity:
returning an already-sent, unchanged clarification does not send a duplicate.
Returning questions requires a valid addressed preview; freeform rejection never
silently approves, sends unreviewed AI text, or changes the packet body. An answer
is stored as an attributed source and creates a new immutable version after the
task-first drafting job completes. Earlier approval remains attached to its old version.

Upload transfer progress is client-local. Transfer HTTP success is not canonical
completion. Hash mismatch, expiration, unsupported/encrypted/malformed/image-only
files, and oversize files fail visibly. Cancelling selection performs no upload;
cancelling transfer leaves uncommitted staging material for server expiry. Do not
offer uploads outside founder Home's attachment control.

## Proposed additions needing confirmation

These fill client needs not assigned routes in the current implementation plan.
Mock adapters may implement them, but no live backend support is assumed.

| Method/path | Request | Success |
| --- | --- | --- |
| `GET /api/session` | None | `Session` plus `{upload_limits:{max_bytes:number,mime_types:string[]}}` / 200 |
| `POST /api/demo/session` | `{actor_id:ID}` | Same session DTO / 200; server allowlist, loopback-only demo, CSRF protected, disabled otherwise |
| `GET /api/cases/{id}/packets/{version_id}/preview` | None | `Preview` / 200; exact immutable version/hash |
| `POST /api/cases/{id}/clarifications/{qid}/answer` | `VersionInput & {clarification_revision:number,text,citations:Citation[]}` | `{message:Message,job_id,tasks:Task[],case_revision:number}` / 202; does not promise draft completion |
| `POST /api/cases/{id}/calls/{call_id}/join` | `RevisionInput` | Minimal authorized, short-lived official Chime client join configuration / 200; exact SDK schema to be agreed, never stored in fixtures/logs |
| `POST /api/cases/{id}/calls/{call_id}/summary/confirm` | `RevisionInput & {summary_id:ID,summary_revision:number,accepted_change_ids:ID[]}` | `{case_revision:number,call:CallSession}` / 200; only selected confirmed proposals update facts; cleanup completion asynchronous |

Editing a clarification invalidates its prior confirmation. Initial proposal:
create a new preview via POST rather than mutate a sent question. Packet compare
uses two authorized immutable previews and `changes`; editable packet UI must
not mutate the reviewed version in place.

## Error schema and behavior

```ts
type ApiError = {
  error: {
    code: string; message: string; request_id: string; retryable: boolean;
    field_errors?: { field: string; message: string }[];
    current_revision?: number;
  };
};
```

| HTTP | Codes | Client behavior |
| --- | --- | --- |
| 400 | `INVALID_REQUEST`, `INVALID_CURSOR` | Show safe field/general error; no automatic mutation retry |
| 401 | `SESSION_REQUIRED`, `SESSION_EXPIRED` | Clear actor-scoped cache, stop events, request session |
| 403 | `FORBIDDEN`, `DEMO_DISABLED`, `CSRF_FAILED` | Explain unavailable action, never retry with another role |
| 404 | `NOT_FOUND` | Clear inaccessible selection; do not expose owner/case metadata |
| 409 | `STALE_REVISION`, `STALE_PACKET`, `PREVIEW_CHANGED`, `IDEMPOTENCY_CONFLICT`, `INVALID_TRANSITION`, `CONSENT_REQUIRED` | Refresh; preserve local draft; require renewed human confirmation. Never auto-reapprove/re-send |
| 410 | `UPLOAD_EXPIRED`, `PREVIEW_EXPIRED`, `REPLAY_EXPIRED` | Reauthorize preview/staging, or fetch fresh snapshot for replay; do not reuse expired URL |
| 413 | `FILE_TOO_LARGE` | Keep safe filename/error, allow another selection |
| 415 | `UNSUPPORTED_FILE`, `ENCRYPTED_FILE`, `IMAGE_ONLY_FILE` | Explain unsupported source; no fake extraction |
| 422 | `VALIDATION_FAILED`, `HASH_MISMATCH`, `MALFORMED_FILE`, `INVALID_CITATION` | Field/source error; no success state |
| 429 | `RATE_LIMITED` | Honor `Retry-After`; bounded retry; retain original idempotency key |
| 502/503/504 | `DEPENDENCY_FAILED`, `UNAVAILABLE`, `TIMEOUT` | Show retryable failure. Reconcile uncertain mutations before claiming failure/success |

Errors redact document bodies, financial values, transcript text, tokens, storage
keys and signed URLs. A timeout is an unknown result until reconciled. Simulated
adapter adds `SIMULATED_UNAVAILABLE` where a real side effect cannot occur.

## WebSocket protocol

`WS /ws/cases/{id}` uses the same server session and strict Origin validation.
Authorization occurs before accepting and for every outgoing payload. Never put
session tokens in query strings. Endpoint confirms audience-filtered replay.

Client messages:

```ts
type ClientEvent =
  | { type:'subscribe'; after_cursor:string|null; protocol_version:1 }
  | { type:'ack'; cursor:string }
  | { type:'ping'; nonce:string };
```

Server messages:

```ts
type EventEnvelope<T> = {
  type: string; event_id: ID; cursor: string; case_id: ID;
  case_revision: number; occurred_at: ISODate; data: T;
};
type Control =
  | {type:'ready'; protocol_version:1; cursor:string; mode:'live'|'simulated'}
  | {type:'replay_complete'; cursor:string}
  | {type:'resync_required'; reason:'cursor_expired'|'scope_changed'}
  | {type:'pong'; nonce:string}
  | {type:'error'; error:ApiError['error']};
```

| Persisted event type | `data` schema |
| --- | --- |
| `case.updated` | `{status:CaseStatus,ui_state:UiState,activity:string|null,current_packet_version_id:ID|null}` |
| `tasks.updated` | `{tasks:Task[]}`; ordered authoritative set |
| `source.updated` | `{source:Source}` |
| `message.updated` | `{message:Message}`; authorized audience only |
| `packet.created` | `{packet:PacketVersion,flags:Flag[]}` |
| `clarification.updated` | `{clarification:Clarification}` |
| `review.created` | `{review:Review}` |
| `sharing.updated` | `{grant:ShareGrant}`; resync on narrowed scope |
| `call.updated` | `{call:CallSession}`; includes consent/capture/process/cleanup state |

Persist before broadcast. Replay is at-least-once: deduplicate by `event_id`, keep
the last applied cursor, and ignore older entity revisions. A cursor is opaque;
clients never increment it. Snapshot `event_cursor` must be consistent with its
contents. Subscribe after that cursor, then apply replay before marking current.
Reconnect with capped exponential backoff/jitter; show reconnecting separately
from AI mode. On expired cursor/scope change, clear inaccessible data and reload
the snapshot before resubscribing. Bound the replay buffer; do not let a slow
client consume unbounded server memory.

Proposed close codes: 4401 session expired, 4403 access revoked, 4409 resync
required, 1013 retry later. Do not endlessly reconnect on 4401/4403. Normal socket
closure or reconnection never means the human call ended or capture consent changed.

## Calls, consent and real-result gates

Joining/muting/messaging is independent of capture. Consent UI starts off and
shows every participant's state; only the current human can grant/withdraw their
own consent. Capture may begin only after all currently participating humans
grant consent and the backend reports `capturing`. A new participant or withdrawal
must stop/prevent capture; stop failure remains visible, never reported as off.
No live AI suggestions. After-call transcription/summary/cleanup states advance
only on persisted results, and proposed fact changes require explicit review.
Official Chime client media readiness plus server authorization is needed before
claiming a live call; an invitation/accept receipt alone is insufficient.

## Mock adapter and acceptance

Mocks use fictional people and files only, with a persistent simulation banner
and simulated receipts. They implement the same async typed interface, failure,
latency, cancellation, duplicate-key, stale-version and reconnect scenarios. They
must not contact AWS or make backend mutations. Real upload, live media, persisted
approval and transcription claims stay unavailable. A simulated workflow can
advance fixture state only with explicit simulated labels.

Contract checks cover audience isolation, explicit sharing, duplicate send/review,
stale-version rejection, preview edits, answer-to-new-version, per-participant
consent, withdrawal, replay duplicates, expired cursors and error visibility.

## Fabricator confirmation checklist

- Confirm wire naming/envelopes, session/CSRF bootstrap, and demo role switch.
- Confirm revision ownership and atomic return/send semantics; how answer jobs publish new versions.
- Confirm upload capabilities, preview shape, signed-transfer headers and canonical receipt.
- Confirm replay retention, cursor consistency, close codes and event schemas.
- Confirm proposed extra routes and minimal Chime join DTO with Andrew's setup gates.
- Confirm after-call summary proposal DTO/confirmation and cleanup event ownership.

Until confirmed, these are frontend assumptions, not statements of backend support.
