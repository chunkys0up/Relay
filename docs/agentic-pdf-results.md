# Agentic PDF follow-up verification

Implemented in `/home/tim/Relay-worktrees/bedrock-documents` on local branch
`codex/bedrock-documents`. This follow-up is not committed, pushed or deployed.

## Behavior

Chat requests can select four scoped Strands tools to inspect extracted source
passages and packet fields and propose a PDF edit. The frontend shows the actual
model reply, proposed fields, evidence and a PDF preview. Explicit founder review
promotes the exact preview bytes to an immutable new version. An AI proposal
cannot confirm, share, approve or send a document.

The same confirmation supports generated planning packets and uploaded compatible
AcroForm templates. Chat-only facts are cited to the saved user message. Existing
manual confirmation, V2 demo and Chime behavior remain available.

## Checks

- Backend: 46 tests passed, including actual Strands execution using a scripted,
  no-network model; grounding, tool allowlist, turn budget, fake action rejection,
  conflict preservation, stale facts, preview hash/revision, dismissal, idempotency,
  ownership, chat-only input, form filling and immutable PDF bytes.
- Frontend: 73 tests passed. Lint, TypeScript and production build passed.
  Existing Chime bundle-size warning remains.
- Existing V2/Chime browser regression suite: 66 passed, covering navigation, documents, sharing, version reviews, calls and keyboard controls.
- Backend browser flows: 3 passed. Chat-only AI edit -> preview -> explicit save
  -> second edit -> unchanged first PDF -> reload; source/conflict/manual/template
  flow and session isolation. Browser console/page error arrays empty.
- Desktop 1440px and mobile 390px screenshots inspected; no horizontal overflow.
  Headless PDF iframe renders blank, so embedded preview is optional and an actual
  PDF link is always available. PDF bytes independently parsed and a sample rendered
  with bundled pypdfium2 and visually inspected.
- Independent review found stale baseline and unresolved conflict overwrite risks.
  Both fixed, with regression cases. Reviewer reproduced rejection after fixes and
  reported no remaining material findings in reviewed scope.

## Files and decisions

Backend implementation: app/workflow/model.py, tools.py, schemas.py, actions.py,
service.py, repository.py; app/api/routes/workflow.py. UI implementation:
client-frontend/src/workflow/BackendWorkspace.tsx, api.ts, styles.css. Tests:
backend/tests/test_agent_tools.py, test_pdf_actions.py, browser_app.py;
client-frontend/src/workflow/BackendWorkspace.test.tsx;
tests/workflow-browser/agent-actions.spec.ts. Setup docs updated.

Four bounded correction groups: initial test error-envelope assertion correction;
preview layout / realistic asynchronous UI interaction; stale confirmed baseline;
unresolved conflict evidence. No existing behavioral assertion weakened.

Limitations: simulated model for verification; live AWS/Sonnet quality and access,
Textract calls, production identity/storage, and new backend-case advisor sharing
remain unverified/unimplemented. Six supported planning fields, not arbitrary PDF
layout editing. No new dependency installs, secret access or AWS calls this turn.
Outcome measurement: behavior units accepted; allowance attribution unavailable.
