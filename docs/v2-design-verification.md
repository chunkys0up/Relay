# V2 design verification

Implemented client Home/documents/uploads/progress, dedicated AI Chat, advisor
Home/Clients with inline exact-version review, and both roles' pre-call and
active simulated call layouts. Role-specific code remains under
`client-frontend/` and `advsior-frontend/`; shared UI and state stay in
`frontend-shared/`. Backend files were not changed by this redesign.

Validation on the V2 branch before integration with subsequent main changes:

- Lint, TypeScript strict checks, and production build passed.
- 58 unit tests and 62 browser tests passed.
- 24 screenshots across eight views at 1440/1024/390px showed no horizontal
  overflow or console/runtime errors. Run `node capture-v2.mjs` with the local
  development server on port 5186 to regenerate the screenshot evidence.
- Independent review findings about attachment access and keyboard tab semantics
  were fixed and independently verified. Existing privacy, explicit confirmation,
  stale-version approval, and adapter consent checks remain intact.

The redesign was verified against the local synthetic adapter: one assigned
client, browser persistence, no connected live AI/storage/media. Packet handoff
controls access; human messages attach only sources already shared with their
recipient. Text/CSV extraction runs locally; PDF/binary extraction is unsupported.
Accepted simulated calls remain Connecting rather than claiming live media.

## Chime integration verification

Integrated main's Chime and S3 changes into V2 without moving subsystem ownership.
Both roles now choose Demo preview or Amazon Chime in the same call layout.
Live calls pin the selected shared packet, preserve review actions and local
messages, and report Connected only after the SDK confirms the connection.
Camera activation is opt-in; device discovery requests audio only. Leaving and
ending for everyone are distinct; cancellations and unmounts release media.

Checks on the integrated code:
- Lint, strict TypeScript, production build and Python backend syntax compilation passed.
- 68 unit tests passed, including 10 Chime lifecycle regressions.
- 62 existing browser regressions plus 4 Chime browser cases passed (66 unique
  cases across the full regression and focused final runs).
- 12 Chime screenshots cover both roles, pre-call and mocked active-call states
  at 1440/1024/390px. The Chime browser cases reported no console/page errors or
  horizontal overflow. Representative desktop and narrow screenshots were inspected.
- Independent review identified and verified fixes for the SDK's implicit camera
  permission request and serial media cleanup. Its 17 targeted tests passed;
  no material integration blocker remained. One review correction cycle.

The active Chime browser screenshots use intercepted API/SDK fixtures, not a
real AWS meeting. Real two-person audio/video, device permissions and cross-device
behavior remain unverified. No secrets were read or live cloud resources created.
The inherited backend uses caller-supplied demo identity and in-memory call
records; production authorization/persistence remain outstanding. Build succeeds
with a size warning for the lazily loaded Chime SDK chunk.
