# Relay product and technical specification

Version 0.6 · 3 October 2026 · Current UI and service boundaries

Relay is a fictional founder/advisor demo for preparing source-backed planning packets and reviewing exact document versions. It is not financial advice, an LPL integration, a production financial system, or an institutional submission workflow. People, source records and company information are synthetic.

The current routed UI and its screens define product behavior. Read [README](README.md), [implementation map](implementation.md), [transport boundaries](docs/api-contract.md), and the relevant backend guides for service details. Historical plans and reports are not feature requirements.

## Product outcome and boundaries

The intended product flow is: a founder adds source material, resolves missing or conflicting details, and prepares a draft; the founder shares a specific packet version; the advisor reviews that version and can approve it or return questions; an answer creates a new version. Human review remains required. “Approved” means that the named advisor reviewed one exact version, not that an institution accepted or filed it.

This repository currently contains four separate systems: the browser-backed synthetic workspace; the legacy FastAPI chat/document/case/Chime service; the owner-scoped packet workflow; and the server synthetic advisor workspace. Starting one does not make the others share state or authorization.

The demo must not provide financial advice, sign or submit forms, file documents, move money, connect real accounts, or claim regulatory compliance. Do not use real customer data. Do not create cloud resources, expand permissions, or deploy publicly without separate authorization.

## Current UI contract

| Role | Primary destinations | Behavior |
| --- | --- | --- |
| Founder | Home / AI Chat / Documents | Home displays originals uploaded through the legacy backend, local synthetic packet versions, and the live case checklist/activity. AI Chat combines PostgreSQL-backed saved conversations with live FastAPI/Strands replies; attachments upload to the case and are passed to the agent’s read tools. Human messages persist through the legacy conversation API after preview and confirmation. Documents shows the selected shared PDF or packet summary. Shared sidebar controls connect Amazon Chime live media. |
| Advisor | Home / Clients / Call | Home, Clients and ordinary review screens use browser-backed synthetic grants and exact-version state. Home offers a direct Message client shortcut. Clients has Messages and Private AI views alongside the selected document, and an explicit server synthetic advisor mode with its own granted packet/source context, saved history, citations and editable private follow-up drafts. Call offers Amazon Chime live media and a shared packet summary. |

Search and Settings are utilities. Search reads the role-visible synthetic sources and packets. Settings contains a synthetic profile, call privacy information and demo details.

The following are routed contextual tools, not primary destinations: Founder Sources and Documents; the Founder clarification route; Advisor Reviews and Documents. Founder Sources/packet previews and ordinary advisor reviews use local synthetic records and grants. Advisor Documents opens the connected advisor workspace by default, with exact-grant packet/source text, search, version selection and private grounded AI review. Explicit browser demo mode and legacy version/source/audience links preserve browser reviews. Backend errors never fall back to browser evidence. Keep these routes and their links where current screens use them, without promoting them to primary navigation by default.

The **server synthetic advisor workspace** appears within Advisor Clients when selected and is the default Advisor Documents view. Its assigned versions and sources, session, chat history and citation previews are owned by the separate advisor API. They are not imported from browser grants, founder uploads or the owner-scoped founder workflow. Its chat is read-only: it cannot approve, save packets, change grants, share documents or deliver questions to a person.

## Calls and privacy

Both roles have pre-call and active layouts with a selected shared packet, call controls and human-message history; the advisor also has review actions. Amazon Chime live media uses the FastAPI/SDK path when configured and connected. The simulated call interface has been removed. Documents, packet review and conversations alongside that live call remain their separate demo/server workflows.

The UI has no recording, capture-consent, transcript or live call-AI controls. Call Settings state that recording and transcription are unavailable/off. Do not add capture or imply that a call is recorded or transcribed.

## Data and service boundaries

- The browser adapter owns ordinary demo packet versions, role-visible grant snapshots, reviews and local clarification history. Human message threads use the legacy PostgreSQL service. Its role selector and grants are not authentication.
- Legacy FastAPI case documents are stored in S3 with rows in PostgreSQL. Founder Home upload/list/open and Chat attachments use those endpoints. Founder AI requests may pass uploaded document IDs and a caller-supplied case ID to the agent’s scoped case tools. Checklist and activity are persisted in PostgreSQL and displayed in Home and AI Chat.
- The legacy agent has six case-scoped tools: list/add/update checklist items, log activity, list case documents, and read an uploaded document. It can manage checklist/activity and answer from files. These tools are scoped to the request’s case ID, but the legacy service has no production actor authentication or authorization; the case ID alone is not an access-control boundary.
- The owner-scoped packet workflow stores its sessions, sources, facts, tasks and immutable PDF versions in SQLite. It provides extraction, bounded agent analysis, explicit fact confirmation, and confirmed PDF operations. It is separate from browser packet versions and legacy S3/PostgreSQL records.
- The server synthetic advisor API uses a separate SQLite-backed synthetic assignment, exact packet/source grants, conversations and idempotency records. It issues its own HttpOnly session cookie and CSRF token, checks grants and source reads before returning citations, and does not expose the legacy generic document URL. It is a local demo, not production identity or an integrated founder-to-advisor handoff.
- Chime can provide live media when explicitly selected and connected. The current service takes caller-supplied actor details and keeps call records in memory; production authorization and persistent call lifecycle management are absent.
- Synthetic local source previews and extraction states must not be described as Textract or generic binary extraction. Only the separate backend workflow’s explicit extraction behavior applies to its own case data.

## Product behavior to preserve

Within the browser demo, only the selected packet version and selected original sources are included in a handoff. Private AI and newly added browser sources remain private until shared. Human messages identify the recipient and require confirmation; the shared conversation is saved through the legacy server. Advisor Home opens the named client composer in one click. Switching between Messages and Private AI in Clients preserves the selected document and audience-scoped drafts without moving private content into a client message. Review decisions bind to the exact version and hash; a later version needs a new decision. Founder clarifications remain attributed, and source conflicts stay visible.

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

Normal app startup now seeds packet/source content from imported advisor API extraction, using a hash-specific browser namespace. Missing imported evidence shows an error rather than static packet fallback. The explicit `VITE_PACKET_DATA_MODE=fixture` mode retains offline fixtures for tests. Packet edits and reviews remain local simulations and do not change server authorization. Human conversations use the separate legacy PostgreSQL service.
