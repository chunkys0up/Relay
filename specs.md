# Relay product and technical specification

Version 0.5 · 3 October 2026 · Current UI and implementation boundaries

Relay is a fictional founder/advisor demo for turning source documents and founder clarifications into a versioned planning packet for human review. It is not financial advice, an LPL integration, a production financial system, or an institutional submission workflow. The app uses synthetic people and company data.

This document is the canonical product and architecture specification. The current repo interface takes precedence over historical plans and reports. The current interface is implemented in `frontend-shared/src/main.tsx` and the role screens under `client-frontend/src/` and `advsior-frontend/src/`. Read [README](README.md) and [backend status](backend/README.md) for implementation evidence and limits. Do not restore superseded navigation or call-capture UI described in older notes.

## Product outcome and boundaries

The intended product flow is: a founder adds source material and resolves missing or conflicting details; Relay prepares a draft; the founder shares a specific packet version; an advisor reviews that version and can approve it or return questions; a founder answer creates a new version. Human review is always required. “Approved” means that the named advisor reviewed one exact version, not that an institution accepted or filed it.

The repository has a usable local synthetic workspace, a separately selectable backend packet workspace, real document upload/list/open endpoints, and an optional Amazon Chime live-call path. These paths are not one integrated workflow. In particular, current local packet state, chat, sharing, review, and simulated calls do not persist through the real backend document API or Chime service.

The demo must not provide financial advice, sign or submit forms, file documents, move money, connect real accounts, or claim regulatory compliance. Do not use real customer data. Do not create cloud resources, expand permissions, or deploy publicly without separate authorization.

## Current UI contract

The primary navigation and destinations are:

| Role | Primary destinations | What they do |
| --- | --- | --- |
| Founder | Home / AI Chat / Call | Home shows backend originals alongside synthetic packet versions, accepts uploads to the configured document backend, and shows planning progress/activity from the local adapter. AI Chat hosts the local simulated conversation and links to a separate live Strands chat and packet workspace. Call reviews a shared packet and offers a simulated call or an explicit Amazon Chime live-media connection. |
| Advisor | Home / Clients / Call | Home summarizes the one synthetic assigned client and separately lists backend uploaded originals. Clients shows shared originals and exact packet versions, expandable previews and review actions, and a private-to-advisor simulated AI conversation. Call reviews a shared packet and offers the same two connection modes. |

Settings is available to both roles outside the primary destination list. It contains a synthetic profile, a Call privacy page, and demo information. Global Search is also reachable from the top bar; it searches synthetic fixture sources and packet drafts.

Additional routes are contextual tools, not primary navigation:

- Founder Sources browses synthetic/local source metadata and previews, with a link to upload on Home. Founder Documents browses, compares, and previews local synthetic packet versions and their citations. The clarification route presents a question and answer flow associated with the Home conversation.
- Advisor Reviews is a directly routed review list. Advisor Documents is a contextual packet/source preview and review surface. Normal client review is also available inline from Clients and does not require adding Reviews or Documents to primary navigation.
- A link labelled “Open backend packet workspace” on founder Home and AI Chat opens a separate backend workspace. It supports source/template upload, analysis and fact confirmation, and confirmed PDF draft creation. It is an additional development surface, not the state backing the ordinary local case screens.

Do not add separate founder Sources, Documents, Clarifications, or advisor Reviews/Documents items to the primary navigation unless the product direction is explicitly revised. Preserve the current routed contextual tools and links where they support existing flows.

### Calls and privacy

Both roles have a pre-call preparation view and an active call layout. The view keeps the selected shared packet, call controls, and human-message history together; the advisor also has review actions. The connection selector distinguishes “Demo preview · simulated” from “Amazon Chime · live media.” Demo controls are visibly simulated and have no device media. Live Chime media is real only when the backend and SDK connect successfully. Documents, messages, and reviews alongside that live call remain local demo data.

There are no recording, capture-consent, transcript, or live AI call-support controls in the current design. Call privacy Settings states that capture and transcription are unavailable and off. Do not add a consent workflow or imply call recording/transcription. Joining or messaging never enables capture.

### Current data and service boundaries

- The ordinary role screens obtain case, packet, conversation, sharing, review, and simulated call state from the browser-backed `MockRelayAdapter`. The role selector switches only the local demo view.
- The uploaded-original panels on founder Home, advisor Home and advisor Documents use the separate FastAPI document endpoints, storing originals in S3 and recording metadata in PostgreSQL. That path requires a configured backend and case ID. A successful file upload does not extract it into the local synthetic packet state.
- The live assistant on AI Chat calls the separate Strands/Bedrock chat endpoint. It does not modify the local synthetic case.
- The backend packet workspace calls the separate workflow service and its own persistence. It is surfaced through explicit links with a service/configuration note; it is not the ordinary packet screen.
- Amazon Chime is selected explicitly on Call. Chime media can be live; case invitations shown in Demo preview are simulated. The backend currently accepts caller-supplied demo identity and stores call records in memory. This is not production authorization or persistent call management.
- Contextual Sources/Reviews and Search render synthetic case records; document screens combine local packet/source previews with separately labeled backend originals where implemented. Local previews and synthetic extraction status must not be presented as Textract or generalized binary extraction.

## Product behavior to preserve

The synthetic local case demonstrates explicit sharing and version-bound review. Only the chosen packet version and selected originals are shared at handoff. Within the local adapter, private AI turns and newly added originals are not implicitly shared. The separate legacy backend original-file lists are case-based and lack actor/grant authorization; local handoff restrictions do not secure those endpoints. Human messages name their recipient and require a separate send confirmation. A review applies to the exact current packet version and hash; later drafts do not inherit approval. Clarification answers are attributed to the founder, and existing source conflicts remain visible.

The intended orchestrator UI has three AI states—Idle, Thinking / Working, Needs input. Task progress uses Pending, In progress, Blocked, Done. These are separate concepts from case status and call state. Current local screens display adapter-provided statuses; the dedicated backend packet workspace has its own task/activity states. Do not invent additional AI modes or merge call state into AI state.

## Visual and accessibility direction

Use light surfaces, white/off-white backgrounds, quiet borders, clear text hierarchy, and restrained colors. The navy, orange, and muted blue-gray samples in the design originate from the user-supplied hackathon reference image; they are not verified universal brand standards. Use orange sparingly and never rely on color alone for meaning. Keep keyboard navigation, visible focus, semantic controls, responsive layouts, and readable contrast. Midday file storage is layout inspiration only, not a product or integration.

## Target architecture and security constraints

These are constraints for future integration work; they do not describe all current capabilities:

- Keep `client-frontend/`, `advsior-frontend/` (existing spelling), `frontend-shared/`, and `backend/` unless an approved migration changes them. React + TypeScript remains the UI stack; FastAPI remains the local service boundary.
- A future integrated workflow should use one visible orchestrator and hidden, narrowly scoped specialists. Specialists propose schema-validated results with evidence; application code owns state transitions and human confirmations.
- Treat uploaded content and model output as untrusted. Validate file type, size, hash, and canonical storage. Every factual claim needs a source locator that resolves to authorized material. Unsupported, encrypted, image-only, malformed, or oversized input must fail visibly and safely.
- Derive actor, role, tenant, case, and advisor authorization on the server. Authorize every API, WebSocket, file preview, event, call action, and review. The current browser role switch and local sharing gate are demo behavior, not authentication or server authorization.
- Keep packet versions immutable. Exact-version decisions, revision checks, idempotency keys, and transactional persistence should prevent duplicate actions and stale approval. Persist state before broadcasting updates.
- Keep document bodies, financial values, chat contents, audio, transcripts, tokens, and presigned URLs out of logs.
- No Bedrock Knowledge Base is selected. The isolated packet service already retrieves case-scoped evidence. Future advisor integration must additionally enforce exact sharing grants before retrieval and return validated citations.
- PostgreSQL on RDS and S3 are the selected target record and object stores. The current backend only persists document metadata/uploads through the legacy documents path and workflow data in the separate packet workspace’s SQLite development store; it does not implement the full unified case model.
- Chime capture, Transcribe, and after-call processing are not part of the current product UI or active workflow. Any future request for these requires a separate product/security design and explicit participant consent before capture.

## References

- [README and local run instructions](README.md)
- [Backend endpoint and persistence status](backend/README.md)
- [Backend workflow setup and limits](docs/bedrock-workflow.md)
- [Implemented transport boundaries](docs/api-contract.md)
