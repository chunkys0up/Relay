# Relay implementation map

Version 0.6 · 3 October 2026 · Current routes, behavior and limits

Read [specs.md](specs.md) before changing product behavior. This file maps the current UI to its service boundaries. Keep the separate browser, legacy, founder workflow and advisor workspace data paths clear.

## Current application map

Normal RelayProvider reads owner-session case snapshots through serverPacketApi.ts. It does not seed packet records into IndexedDB. ServerCaseHome, ServerPacketLibrary and ServerAdvisorViews display server originals, packet PDF bytes, task progress, stage history and cloud synchronization in the existing navigation. Explicit fixture/test mode retains MockRelayAdapter and historical regression scenarios.

The workflow backend owns case revisions, immutable PDF bytes and exact-hash stage events. Import validates actual PDF structure. Mutations use session/CSRF, revision and idempotency checks. Explicit example creation persists fictional packages and labels synthetic review events.

Returned questions are recorded as an advisor review tied to the current PDF ID/hash. `answers.py` creates a founder-only preview from the saved PDF plus an attributed answer appendix; it verifies resulting PDF structure, page bounds, digest and extracted appendix text. Confirmation atomically persists the answer and immutable vN+1 PDF as a private draft under revision and idempotency checks. Existing facts/conflicts and the original returned review/PDF stay intact. The old advisor grant no longer authorizes the new current packet; the founder must submit and invite again. This appendix verification is deterministic PDF checking, not a new Bedrock fact verification or an assertion that the answer resolves source conflicts. A synthetic returned stage without a real review has no answer form and points back to source-backed fact confirmation.

Configured cloud synchronization downloads and hashes S3 bytes before registering the same case UUID, original sources and packet metadata in legacy PostgreSQL. Cloud failures remain visible separately from local persistence. Legacy chat and call clients use the selected registered case.
Founder Home and Documents also expose manual Retry storage sync for pending, failed and applicable unconfigured states; a pending export can be restarted after interruption. Advisor Home marks its redacted checklist private rather than presenting zero progress.

The separate advisor API retains its synthetic assignments, exact grants, private history and read-only model tools. Workflow advisor views use persistent exact-packet capability grants redeemed in a separate session. `sharing.py` enforces owner/advisor separation, source selection, current hash/version, review idempotency and revocation. Session capabilities do not verify a person or organization.
`ServerInvitationAcceptance.tsx` appears in the empty advisor workspace and on advisor Home after a grant exists. It submits a code through the same session-backed redemption endpoint and keeps failed codes editable. Successful redemption selects the newly granted case while the previously granted cases remain available in the case switcher. Browser role selection still does not create a grant.

Primary navigation remains Founder Home / AI Chat / Documents and Advisor Home / Clients / Call. Recording, transcription and call AI controls remain absent.

## Behavior and security constraints

Preserve the current route map, contextual links, keyboard access and responsive layouts. Keep Demo, backend upload, live AI, workflow and Chime actions labeled according to their actual state.

The legacy case tools use the supplied case ID and are not actor-authenticated. The owner workflow is loopback/session scoped. The advisor API has its own server session, CSRF protection and exact grants, but operates on seeded synthetic data. None of these limitations should be hidden behind the browser role selector.

Within browser state, exact-version/hash grants control ordinary advisor visibility and review. Human messages require a visible preview and confirmation before the legacy server send. The advisor backend chat may only read assigned shared versions; cite only sources actually read. Model-generated follow-ups are editable private drafts, not messages.

Do not add Chime capture or Transcribe. Preserve server-side file validation, source hash checks, idempotency and bounded work in the flows that already implement them; do not imply the separate services share these protections or data.

## Service-derived display state

- `live.tsx` applies canonical checklist PATCH responses, keeps action errors separate from load errors, and suppresses stale checklist/activity results when case context changes. Home preserves the last confirmed checklist on mutation failure and distinguishes unavailable totals from zero.
- `Conversation` calls the legacy chat/upload API only for founders. Advisor browser notes stay in the browser adapter and link to the server advisor workspace for evidence questions. Founder request lifecycle drives the connection label. The legacy server may persist a partial reply after cancellation; the UI reconciles saved history and labels stopped or failed requests.
- Founder Chat displays AI request state beside its saved thread selector. Activity actor labels include server-originated system entries.
- `identity.ts` derives shell identity and packet preview branding from the current browser snapshot. Settings distinguishes browser data, legacy backend storage, separate server workspaces and optional Chime media.

## References

- [App routes](frontend-shared/src/main.tsx)
- [Conversation and live adapter](frontend-shared/src/conversation.tsx), [API transport](frontend-shared/src/relayApi.ts)
- [Advisor Clients](advsior-frontend/src/clients/Screen.tsx), [advisor API](frontend-shared/src/advisorApi.ts)
- [Backend endpoint status](backend/README.md), [workflow transport](docs/api-contract.md)

Workspace screens own their edge padding without negative margins. The shell main row is a size container; desktop Clients panes use its actual available height. The default Vite server proxies all `/api` traffic to `RELAY_BACKEND_PORT` (8000 by default); advisor integration tests exercise that default configuration with a local simulated backend.

The standard Vite development server proxies all `/api` traffic to `RELAY_BACKEND_PORT` (default 8000). Documents loads authorized packet/source text without model calls; AI review runs only on a user prompt. The separate synthetic advisor AI workspace remains read-only. Normal workflow advisor reviews use the exact-version grant and persist approval or returned questions.

## S3-backed synthetic advisor packet details

The server advisor Documents view supports real synthetic PDFs in S3 and Amazon Textract text, fields, tables, page/confidence data and scoped original-PDF links. The explicit importer atomically updates the separate advisor SQLite workspace after verifying every S3 original and extracting the full batch. Private packet/source grants stay private; offline seed text is labeled separately. Original routes serve hash-checked copies downloaded from S3 at import time. See [import, refresh and access boundaries](docs/synthetic-packets.md).

Normal startup uses owner-session workflow records. The prior advisor-import-to-browser bridge is retained only as historical fixture support. Explicit `VITE_PACKET_DATA_MODE=fixture` mode retains offline fixtures for tests. Normal packet mutations persist through the workflow API.

## Merged conversation service requirements

The legacy service requires migration `backend/db/migrations/002_conversations.sql` before using persisted conversations. This merge does not apply a live database migration. Legacy conversation visibility uses caller-supplied role and case identity, and attachment references do not inherit the advisor API’s exact packet grants. Explicit human attachment previews identify the recipient and files; switching audiences clears attachment selection. These demo identity limits are not production authentication.


The unified backend entry point is `app.main:app` on port 8000. All frontend `/api` traffic uses this backend through Vite, including WebSockets. PostgreSQL/S3 and SQLite retain their separate persistence and authorization boundaries. See the root README for startup and port overrides.

## Integrated packet and call flows

`ServerWorkflowPanel.tsx` exposes the existing bounded analysis, citation inspection, explicit confirmation and verified-PDF APIs on Home. Structured reader output still passes schema validation, read-before-cite and exact source-hash checks. Preview saves preserve deterministic and Bedrock verification results and schedule cloud synchronization.

`core/config.py` loads the repository `.env` independently of the launch directory. `core/aws_session.py` uses a configured available profile, or explicit environment credentials when the configured profile is absent on the active host. Packet models, legacy AI Chat, S3 and Chime share that resolution. Temporary AWS credentials still expire and need refresh.

`LegacyWorkflowScope` restricts mirrored workflow records to their owner; only call routes also accept a current advisor grant. Calls ignore body-supplied actor identity. Each join has a cancellation identity; leave and failure cleanup delete that attendee, reconnect uses a new attendee, and end/graceful shutdown delete meetings. Packet replacement invalidates meetings, and grant revocation evicts the advisor with meeting deletion as fallback. Failed AWS cleanup remains an error and retains cleanup references. The meeting registry is process-local; a crash relies on AWS expiry.

Protect the local `.relay` database as session-secret storage. It contains owner session credentials and replayable invitation responses. Invitations are one-use bearer capabilities, not personal identity verification. This loopback application is not publicly deployed or configured for remote physical devices.
