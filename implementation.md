# Relay implementation map

Version 0.6 · 3 October 2026 · Current routes, behavior and limits

Read [specs.md](specs.md) before changing product behavior. This file maps the current UI to its service boundaries. Keep the separate browser, legacy, founder workflow and advisor workspace data paths clear.

## Current application map

The Vite/React app is in `frontend-shared/`. Routes are registered in `frontend-shared/src/main.tsx`. Role screens remain in `client-frontend/` and `advsior-frontend/` (existing spelling).

| Surface | Route | Current behavior |
| --- | --- | --- |
| Founder Home | `/founder/home` | Lists/uploads/opens original files through legacy FastAPI → S3/PostgreSQL. Packet versions and recent human conversation come from the browser adapter. Checklist and activity load from legacy case endpoints. A separate link opens the owner-scoped packet workspace. |
| Founder AI Chat | `/founder/chat` | Browser adapter saves demo messages and simulated human delivery. Private AI replies stream from legacy `/api/chat/stream`; optional file attachments upload to the case and the live agent can read them. Agent checklist/activity changes persist through case tools. The separate owner-scoped packet workspace is linked here too. |
| Founder Call | `/founder/call` | Pre-call/active layouts show a selected shared version with PDF and Packet summary tabs, plus human-message controls. Choose simulated Demo or live Amazon Chime; ordinary packet state and human conversation stay separate. |
| Advisor Home | `/advisor/home` | Browser snapshot only: summary and counts for its grant-visible synthetic sources and packet versions. It has no raw backend-uploaded-file list. |
| Advisor Clients | `/advisor/clients` | Browser mode shows grant-visible synthetic sources/packets, inline exact-version reviews and demo conversation. The explicit server synthetic mode uses the separate advisor API for granted packet context, private persisted chat and citations. |
| Advisor Call | `/advisor/call` | Shared browser-demo packet, review actions and human-message controls with simulated Demo or explicit live Chime. |
| Settings, Search | `/{role}/settings`, `/{role}/search` | Utilities. Search uses the role-visible browser snapshot. Settings shows synthetic identity and call privacy; it does not expose capture/transcription controls. |
| Contextual tools | Founder `/founder/sources`, `/founder/documents`, `/founder/home/clarification`; advisor `/advisor/reviews`, `/advisor/documents` | Direct routes linked from relevant screens; not primary navigation. Advisor Documents previews only grant-visible browser packet versions and sources. |
| Owner-scoped packet workspace | Founder Home/AI Chat link with `?workspace=backend` | Separate session-owned case flow for source/template upload, extraction, confirmed facts, bounded agent analysis and verified PDF proposals. SQLite development state; requires its own configured service. |
| Server advisor workspace | Advisor Clients link/selector | Separate `/api/advisor` session and SQLite seed/grants. Read-only chat can cite authorized, actually read packet/source evidence and compare selected versions. No client send, approval or share action. |

Primary navigation is Founder Home / AI Chat / Call and Advisor Home / Clients / Call. Settings and Search remain utilities. Sources, Documents, Reviews and clarification remain routed contextual tools. There is no call recording, capture-consent, transcript or call-AI-support interface.

## Runtime and service boundaries

- `RelayProvider` and `MockRelayAdapter` in `frontend-shared/src/context.tsx` and `mock.ts` own browser packet snapshots, grant-filtered role views, local message history, reviews and simulated calls.
- `Conversation` in `frontend-shared/src/conversation.tsx` stores visible messages/delivery state in the browser adapter. Private AI requests stream through `relayApi.ts` to the legacy FastAPI chat endpoint; attachments upload through the document endpoint and their IDs are passed with the case ID. Human delivery is simulated.
- The legacy agent in `backend/app/agents/factory.py` has six registered tools for checklist/activity and case-document listing/reading. Checklist/activity endpoints are served from PostgreSQL and refreshed in Home/Chat. Tool data is scoped to the request’s case ID, not a production authenticated user. Do not describe the generic chat as grant-scoped advisor AI.
- `useCaseDocuments` uses `/api/documents` routes. Original files go to S3 and metadata to PostgreSQL. This is not the source catalog, packet store or sharing logic of the browser adapter or SQLite workflow.
- `BackendWorkspace` uses `/api/workflow` on `app.workflow_app`, normally port 8001. The SQLite service owns case sessions, sources, tasks/facts and immutable PDF bytes. Updates require loopback session/CSRF/revision/idempotency checks and explicit confirmations.
- `AdvisorChat` calls `/api/advisor` on that same local workflow service but uses its own synthetic SQLite tables, cookie/CSRF session, assignment/version/source grants, conversations and request idempotency. Its model tools are read-only and source-read validated. It does not import founder records or browser grants.
- `callsApi.ts` and `liveCall.tsx` connect the explicit Chime mode to legacy FastAPI and SDK. The legacy service accepts caller-supplied identity and keeps call records in memory. Demo calls remain simulated browser state.

Do not describe these four paths as an end-to-end integrated founder-to-advisor system: browser adapter; legacy case/chat/document/Chime API; owner-scoped founder workflow; and server synthetic advisor API.

## Behavior and security constraints

Preserve the current route map, contextual links, keyboard access and responsive layouts. Keep Demo, backend upload, live AI, workflow and Chime actions labeled according to their actual state.

The legacy case tools use the supplied case ID and are not actor-authenticated. The owner workflow is loopback/session scoped. The advisor API has its own server session, CSRF protection and exact grants, but operates on seeded synthetic data. None of these limitations should be hidden behind the browser role selector.

Within browser state, exact-version/hash grants control ordinary advisor visibility and review. Human messages require a visible confirmation and remain simulated. The advisor backend chat may only read assigned shared versions; cite only sources actually read. Model-generated follow-ups are editable private drafts, not messages.

Do not add Chime capture or Transcribe. Preserve server-side file validation, source hash checks, idempotency and bounded work in the flows that already implement them; do not imply the separate services share these protections or data.

## References

- [App routes](frontend-shared/src/main.tsx)
- [Conversation and live adapter](frontend-shared/src/conversation.tsx), [API transport](frontend-shared/src/relayApi.ts)
- [Advisor Clients](advsior-frontend/src/clients/Screen.tsx), [advisor API](frontend-shared/src/advisorApi.ts)
- [Backend endpoint status](backend/README.md), [workflow transport](docs/api-contract.md)
