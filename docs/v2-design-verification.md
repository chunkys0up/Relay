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

Main subsequently gained S3 and Chime integration work. Its `LiveCall` addition
conflicts with the redesigned shared call component. Preserve both capabilities
and reverify the combined result before merging. No combined integration or
live two-person call has been verified by this PR.
