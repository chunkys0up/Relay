# Bedrock workflow verification handoff

Implemented on `codex/bedrock-documents` in the isolated WSL worktree
`/home/tim/Relay-worktrees/bedrock-documents`. Changes remain local and uncommitted.
The previous V2/Chime work remains intact; no push, deployment or cloud call ran.

## Result

The founder can explicitly open a separate backend workspace from Home/AI Chat.
Server-owned development sessions scope cases and protect HTTP mutations and
WebSocket snapshots. User input and extracted evidence feed the installed Strands
SDK through a configured Bedrock profile. Saved task/message state reaches the UI
over WebSocket, with bounded reconnect and active-job polling fallback.

Native PDF/text/CSV extraction, evidence-bound candidate fields, missing/conflict
prompts, explicit confirmation, immutable generated PDFs and optional fillable
AcroForm templates work locally. Model output never approves/shares/sends or
confirms a field. A changed source or edited value requires renewed review.

## Checks actually run

- Backend pytest: **31 passed**.
- Frontend Vitest: **70 passed**.
- Existing browser regression suite: **66 passed**.
- New actual-backend browser workflows: **2 passed**, including source conflict,
  user-entered reserve, WebSocket updates, reload, PDF generation/form fill,
  immutable v1 after v2 and independent-session isolation.
- Frontend lint, strict TypeScript and production build passed.
- `git diff --check` passed. Build retains the existing lazy Chime chunk-size warning.
- Desktop/mobile screenshots: no horizontal overflow or console/page errors in
  the new workflow flow. Generated and filled PDF samples were visually inspected.
- Independent read-only review separately ran all 31 backend tests, 2 transport
  tests and additional WebSocket authorization probes; no material findings remain.

Four focused correction passes addressed PDF field fit, backend evidence/budget
checks, socket handshake readiness, and frontend confirmation/session races.
The initial browser run failed because an already-current cursor received no
ready frame; the handshake fix preserved the assertion and final runs passed.
Existing assertions were not weakened. ESLint excludes third-party `.venv` files,
just as it already excluded node_modules; application rules remain unchanged.

## Boundaries and next verification

No real AWS invocation, Textract call or credential read was performed. Supply an
approved account-specific Sonnet 5 model/profile and run a live smoke test before
claiming model access or output quality. The documented AWS profile is an example.
SQLite is a development adapter; RDS/S3 storage, production authentication,
full event replay, advisor handoff and multi-worker queues remain future work.
The existing legacy chat harness remains available; the new packet assistant
uses Strands directly with no arbitrary agent tools.

Analysis accepts at most 49 source excerpts plus the current message, each at
most 1,200 characters. Over-budget context fails visibly. Create a smaller new
case to recover; deletion/chunk selection is not implemented. Scanned PDFs are
rejected; an injected image Textract adapter is tested, not cloud-connected.

See [setup and API details](bedrock-workflow.md) and [fixed loop criteria](../BEDROCK-LOOP.md).
