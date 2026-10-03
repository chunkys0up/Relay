# Relay product and technical specification

Version 0.6 · 3 October 2026 · Current UI and service boundaries

Relay is a fictional founder/advisor demo for preparing source-backed planning packets and reviewing exact document versions. It is not financial advice, an LPL integration, a production financial system, or an institutional submission workflow. People, source records and company information are synthetic.

The current routed UI and its screens define product behavior. Read [README](README.md), [implementation map](implementation.md), [transport boundaries](docs/api-contract.md), and the relevant backend guides for service details. Historical plans and reports are not feature requirements.

## Product outcome and boundaries

The intended product flow is: a founder adds source material, resolves missing or conflicting details, and prepares a draft; the founder shares a specific packet version; the advisor reviews that version and can approve it or return questions; an answer creates a new version. Human review remains required. “Approved” means that the named advisor reviewed one exact version, not that an institution accepted or filed it.

This repository currently contains four separate systems: the browser-backed synthetic workspace; the legacy FastAPI chat/document/case/Chime service; the owner-scoped packet workflow; and the server synthetic advisor workspace. Starting one does not make the others share state or authorization.

The demo must not provide financial advice, sign or submit forms, file documents, move money, connect real accounts, or claim regulatory compliance. Do not use real customer data. Do not create cloud resources, expand permissions, or deploy publicly without separate authorization.

## Current UI contract

Normal mode uses owner-session workflow cases for Home, Clients, Documents and Sources. These views show genuine stored PDFs, original sources, server task progress, packet stages and synchronization status. Founder navigation remains Home / AI Chat / Documents; advisor navigation remains Home / Clients / Call. Search and Settings remain utilities.

New sessions start empty. Example packages are created by an explicit action and contain real PDF bytes, hashes and persisted records. Example companies and review events are labeled synthetic. Missing backend or cloud services produce visible failures, never fabricated completion.

Packet stages are draft, in review, questions returned and approved. Transitions bind to an exact PDF hash and case revision. Owner sessions can submit or resubmit a review stage; they cannot make real advisor approvals. Founders create an invitation for the current packet hash and selected originals. A separate browser session redeems that invitation into a persisted advisor grant; role selection grants no authority. The granted advisor can approve or return questions for that exact current version. Revocation removes access, and a new version requires a new grant and review. A new version starts as a draft.

Explicit fixture mode preserves historical browser demo flows for regression tests. The separate advisor AI workspace retains its own synthetic grants and read-only chat; it does not grant access to workflow cases.

## Calls and privacy

Both roles have pre-call and active layouts with a selected shared packet, call controls and human-message history; the advisor also has review actions. Amazon Chime live media uses the FastAPI/SDK path when configured and connected. The simulated call interface has been removed. Documents, packet review and conversations alongside that live call remain their separate demo/server workflows.

The UI has no recording, capture-consent, transcript or live call-AI controls. Call Settings state that recording and transcription are unavailable/off. Do not add capture or imply that a call is recorded or transcribed.

## Data and service boundaries

- The browser adapter owns only explicit fixture-mode packet versions, grant snapshots, reviews and local clarification history; normal mode reads server workflow records. Human message threads use the legacy PostgreSQL service. Its role selector and grants are not authentication.
- Legacy FastAPI case documents are stored in S3 with rows in PostgreSQL. Legacy document clients use those endpoints. Normal Home uploads sources through the workflow API, and cloud synchronization registers them with the same case/source IDs before Chat can use them. Founder AI requests may pass uploaded document IDs and a caller-supplied case ID to the agent’s scoped case tools. Checklist and activity are persisted in PostgreSQL and displayed in Home and AI Chat.
- The legacy agent has six case-scoped tools: list/add/update checklist items, log activity, list case documents, and read an uploaded document. It can manage checklist/activity and answer from files. These tools are scoped to the request’s case ID, but the legacy service has no production actor authentication or authorization; the case ID alone is not an access-control boundary.
- The owner-scoped packet workflow stores its sessions, sources, facts, tasks and immutable PDF versions in SQLite. It provides extraction, bounded agent analysis, explicit fact confirmation, and confirmed PDF operations. Configured synchronization mirrors workflow sources and packet metadata to S3/PostgreSQL with the same IDs; local persistence and cloud status remain distinct.
- The server synthetic advisor API uses a separate SQLite-backed synthetic assignment, exact packet/source grants, conversations and idempotency records. It issues its own HttpOnly session cookie and CSRF token, checks grants and source reads before returning citations, and does not expose the legacy generic document URL. It is a local demo, not production identity or an integrated founder-to-advisor handoff.
- Chime can provide live media when explicitly selected and connected. Calls derive actor identity from the workflow session and current exact-version grant, ignoring caller-supplied actor identity. Join attempts have independent attendee IDs; leave removes the attendee, reconnect creates a fresh attendee, and end or graceful shutdown deletes the meeting. Revocation or replacing the shared packet invalidates active access. Meeting references remain process-local; abnormal process termination relies on AWS meeting expiry. Browser-session capabilities are not verified personal identities.
- Synthetic local source previews and extraction states must not be described as Textract or generic binary extraction. Only the separate backend workflow’s explicit extraction behavior applies to its own case data.

## Product behavior to preserve

Within explicit fixture mode, only the selected packet version and selected original sources are included in a handoff. Private AI and newly added browser sources remain private until shared. Human messages identify the recipient and require confirmation; the shared conversation is saved through the legacy server. Advisor Home opens the named client composer in one click. Switching between Messages and Private AI in Clients preserves the selected document and audience-scoped drafts without moving private content into a client message. Review decisions bind to the exact version and hash; a later version needs a new decision. Founder clarifications remain attributed, and source conflicts stay visible.

The founder case checklist uses To do, In progress, Blocked and Done. Founder Chat also shows the AI’s Idle, Thinking / Working and Needs input states; these are separate from checklist, case and call status. Keep server checklist state and browser packet task state distinct.

Service-derived values must reflect completed requests. Founder checklist changes use the returned server item; a failed update leaves the last confirmed value visible and can be retried. Unavailable checklist or document counts are not displayed as zero. Founder AI request status is separate from browser packet draft status: idle does not assert a connection, and failed or stopped requests are labeled explicitly. The legacy server can save a partial reply after cancellation; the UI refreshes persisted history. Advisor browser private notes never call the legacy founder chat or upload endpoints; grounded advisor questions use the separate server advisor workspace. Workspace names and packet preview identity come from the current browser snapshot, not duplicated display constants.

## Target architecture and security constraints

These remain constraints for future integration, not claims about the current combined system:

- Preserve `client-frontend/`, `advsior-frontend/` (existing spelling), `frontend-shared/` and `backend/` unless an approved migration changes them.
- Keep owner-case access server-controlled; do not use the browser role selector or caller-supplied legacy case ID as production identity.
- Treat uploads and model output as untrusted. Validate type, size, canonical bytes/hash and cited locators. A factual claim must cite material the relevant server scope authorized and the model actually read.
- Keep packet versions immutable. Persist before publishing status; use revision checks and idempotency keys for mutations. Approval and any future share/send action require explicit human confirmation.
- Keep document bodies, financial values, chat contents, credentials, tokens and presigned URLs out of logs.
- Do not add Bedrock Knowledge Bases by default. Retrieval must be case- and grant-scoped and return verified citations.
- PostgreSQL/RDS and S3 are the current legacy document stores; SQLite is the development store for the isolated founder packet and advisor synthetic workspaces. Do not imply one unified repository.
- Call capture, Transcribe and after-call processing are outside the current UI and implementation.

## References

- [README and local run instructions](README.md)
- [Backend status and endpoints](backend/README.md)
- [Implemented transport boundaries](docs/api-contract.md)
- [Founder packet workflow](docs/bedrock-workflow.md)
- [Advisor workspace](docs/advisor-bedrock.md)
- [Agent architecture and limits](docs/multiagent-workflow.md)

Sidebar layout keeps headings and controls inside the shell at desktop and mobile sizes. Desktop Clients uses independently scrollable client, document and AI panes; smaller windows stack the panels.

## S3-backed synthetic advisor packet details

The server advisor Documents view supports real synthetic PDFs in S3 and Amazon Textract text, fields, tables, page/confidence data and scoped original-PDF links. The explicit importer atomically updates the separate advisor SQLite workspace after verifying every S3 original and extracting the full batch. Private packet/source grants stay private; offline seed text is labeled separately. Original routes serve hash-checked copies downloaded from S3 at import time. See [import, refresh and access boundaries](docs/synthetic-packets.md).

Normal startup reads session-authorized workflow records. The advisor-import bridge is historical fixture support. The explicit `VITE_PACKET_DATA_MODE=fixture` mode retains offline fixtures for tests. Normal packet mutations and advisor review decisions persist on the workflow backend; human conversations remain a separate legacy service.


The unified backend entry point is `app.main:app` on port 8000. All frontend `/api` traffic uses this backend through Vite, including WebSockets. PostgreSQL/S3 and SQLite retain their separate persistence and authorization boundaries. See the root README for startup and port overrides.

Founder Home exposes source analysis, citation and conflict review, explicit fact confirmation, and verified PDF preview saving or generation. Native text PDFs are extracted locally; model interpretation and independent packet verification use the configured Bedrock model. Failed analysis or verification never becomes a completed packet. Example stages remain explicitly synthetic.
