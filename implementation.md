# Relay implementation map

Version 0.5 · 3 October 2026 · Current implementation map and integration constraints

Read [specs.md](specs.md) before changing product behavior. This file describes the UI that exists and the actual boundaries between its synthetic adapter and backend-backed features. Keep those paths distinct unless an integration change is in scope.

## 1. Current application map

The runnable app is the Vite/React application in `frontend-shared/`. Its entry point and route table are in `frontend-shared/src/main.tsx`; shared state and components are in `frontend-shared/src/`. Role screens remain in `client-frontend/` and `advsior-frontend/` (preserve the latter’s existing spelling).

| Surface | Route / entry | Current behavior and boundary |
| --- | --- | --- |
| Founder Home | `/founder/home` | Shows founder/company context, uploaded originals and synthetic packet versions, Home document upload, and progress/activity. Document list/upload/open uses the real FastAPI/S3/PostgreSQL document API. Packet, task and activity data is local synthetic adapter state. A contextual link opens the separate backend packet workspace. |
| Founder AI Chat | `/founder/chat` | Shows local simulated conversation, flags, tasks and case status. Includes a separate live Strands/Bedrock assistant, which does not alter the synthetic packet. A contextual link opens the backend packet workspace. Upload entry is on Home. |
| Founder Call | `/founder/call` | Pre-call and active layouts show a shared packet, connection selector, controls and human messages. Demo preview is simulated; Amazon Chime mode uses the live backend/SDK when configured. |
| Advisor Home | `/advisor/home` | Summary for the one synthetic assigned client, progress, status and attention, plus a separate backend uploaded-original list. |
| Advisor Clients | `/advisor/clients` | Shared client rail, expandable packet/source previews, inline exact-version review actions, and private-to-advisor synthetic AI chat. This Clients surface uses synthetic snapshot/grant data; it does not call the backend document API. |
| Advisor Call | `/advisor/call` | Pre-call and active layouts with shared packet, connection selector, review actions and human messages; Demo preview or explicit live Chime. |
| Settings, Search | `/{role}/settings`, `/{role}/search` | Routed utility pages. Settings documents synthetic identity and unavailable capture controls; Search covers synthetic sources and drafts. |
| Contextual tools | Founder `/sources`, `/documents`, `/home/clarification`; advisor `/reviews`, `/documents` | Routed and linked from relevant screens. These are not primary navigation items. Preserve their existing links and exact-version behavior; do not promote them back into the main navigation by default. |
| Backend packet workspace | Home/AI Chat link with `?workspace=backend` | Separate service flow for sources/templates, analysis, fact confirmation, and immutable PDF drafts. Requires the workflow backend and its configuration; it does not share ordinary local packet state. |

Primary navigation is Founder Home / AI Chat / Call and Advisor Home / Clients / Call. Settings and global search remain reachable outside that list. There is no primary Founder Sources/Documents or Advisor Reviews/Documents destination. Neither role has a recording, capture-consent, transcript, or call-AI-support interface.

## 2. Runtime and service boundaries

- `RelayProvider` in `frontend-shared/src/context.tsx` reads and mutates the browser-backed synthetic adapter. This adapter owns ordinary case snapshots, local messages, handoffs, reviews, clarification simulations and demo call state.
- `useCaseDocuments` in `frontend-shared/src/live.tsx` calls the legacy FastAPI document routes through `frontend-shared/src/relayApi.ts`. Uploads are sent as multipart requests; the backend writes originals to S3 and a row to PostgreSQL. List/open requires the same service and case configuration. This does not extract a file into the local adapter or attach it to a local packet automatically.
- `LiveAssistant` calls the legacy FastAPI/Strands chat endpoint through the same API module. Its session is independent of local case messages and packet state.
- `BackendWorkspace` uses the workflow API under `/api/workflow`. The source-aware workflow service runs separately (typically port 8001) and currently uses SQLite development persistence. It supports source/template intake, analysis and fact confirmation, plus confirmed PDF creation/actions. Consult [workflow setup](docs/bedrock-workflow.md) for current endpoints and checks.
- Chime mode uses `frontend-shared/src/callsApi.ts` and `liveCall.tsx` against the FastAPI call routes and Amazon Chime SDK. It is a real media path when configured and connected. Current API identity is caller supplied, call metadata is in memory, and the packet/source previews, messages and review state alongside calls remain synthetic/local. Separately listed backend originals use the legacy document API.
- Demo call mode updates only browser-backed synthetic state. Accepting a demo invitation reaches Connecting; it does not establish media or claim a live connection.
- No route currently records or transcribes calls. Keep capture/transcription off and absent from UI.

Do not describe the app as an end-to-end integrated founder → advisor workflow. The mock adapter, S3/PostgreSQL document routes, backend packet workflow, Bedrock assistant, and live Chime calls are separate flows.

## 3. Product and implementation constraints

Preserve the current navigation and route map above. Home remains the founder’s main document/upload and progress surface; AI Chat remains a separate primary screen. Advisor Clients remains the normal location for shared-document browsing and inline review. Call remains a dedicated destination. Keep contextual screens linked from the surfaces that use them.

Maintain synthetic-data labeling and demo boundaries. Do not imply local simulated messages were delivered to a person or local packet changes were saved in the backend. Keep upload, live Bedrock chat, backend packet work, and live Chime clearly identified as backend-backed paths requiring service access.

For synthetic sharing and review:

- Only an explicitly handed-off packet version and selected originals become advisor-visible.
- Keep advisor AI chat private to the advisor.
- Bind review decisions to the current exact version and hash; a new version requires a new decision.
- Keep send/answer confirmation steps and author attribution visible. Never treat a proposed or simulated action as a real financial or institutional approval.
- AI states, task states, case status, and call state remain distinct.

For future backend integration:

- Keep AWS calls and credentials in the backend. Do not copy secrets into browser code.
- Keep server authorization as the source of truth. The current role selector and local adapter checks are not authentication.
- Validate files, canonical hashes, schemas, cited source locators, recipient, version and revision on the server.
- Persist state and idempotency keys before work or event publication; reject duplicate sends and stale-version approvals.
- Restrict source retrieval to case and explicit sharing scope. Do not expose raw model reasoning or arbitrary tool/network/shell access.
- Keep documents and sensitive content out of logs.
- Do not add Chime capture, Transcribe, or transcript display to this UI. These are outside the current approved design.

## 4. Backend status that must remain explicit

The legacy FastAPI service currently exposes chat, direct multipart document upload/list/open, health, and Chime meeting lifecycle routes. Uploads use S3 and write document metadata to Postgres. The existing Postgres schema is not the full case workflow store. The legacy Strands chat agent has no tools and does not operate on case packets.

The separate workflow service exposes source-aware case analysis, fact confirmation, packet PDF generation/actions, and event updates. It is a separate workflow and uses SQLite development persistence. Do not describe it as RDS-backed or connected to ordinary local adapter state.

The ordinary synthetic workspace continues to use browser persistence for case messages, sharing, packet versions, reviews, and simulated calls. The live Chime path is independently connected to backend call routes. Current caller-supplied identity, in-memory call metadata, and lack of production authorization/persistence are limitations, not future promises.

For run commands, endpoint details, configuration and latest service limitations, defer to [backend README](backend/README.md) and [Bedrock workflow documentation](docs/bedrock-workflow.md). Do not duplicate credentials, secrets, or volatile environment values here.

## 5. When making UI changes

Before changing navigation or screen responsibilities, inspect the route table and relevant screens. Keep the route list and contextual-vs-primary distinction accurate. Check user-visible links and labels so no dead or misleading route is introduced. Preserve responsive layouts and keyboard-accessible controls.

The repo already has frontend lint, strict TypeScript, unit, build and browser commands documented in [README](README.md). Run checks only when requested or when the active task requires them; report only checks actually run. For changes to the real Chime connection, distinguish mocked browser evidence from a real two-person media test. For backend-dependent flows, clearly state whether the service and real AWS resources were exercised.

## References

- [App entry and routes](frontend-shared/src/main.tsx)
- [Founder Home and chat](client-frontend/src/home/Screen.tsx), [AI Chat](client-frontend/src/chat/Screen.tsx)
- [Advisor Clients](advsior-frontend/src/clients/Screen.tsx)
- [Call connection selection](frontend-shared/src/call.tsx), [live Chime path](frontend-shared/src/liveCall.tsx)
- [README](README.md), [backend status](backend/README.md)
