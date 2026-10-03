# Bedrock document workflow implementation loop

Worktree: codex/bedrock-documents. Preserve existing V2 demo and Chime behavior.
Scope: explicitly enabled founder backend workspace, scoped source extraction,
Bedrock/Strands proposals based on user input, confirmation, versioned PDF output.
No claims of production authentication/RDS persistence or live AWS success.

Fixed acceptance units:
1. Server-owned development sessions isolate cases; tasks are stored before AI work.
2. Configurable Bedrock adapter has bounded calls/time/retry and validates outputs/citations.
3. Extraction rejects unsupported/bad inputs; PDF writing uses explicitly confirmed values.
4. Founder Home uploads and AI Chat show backend messages/tasks/questions/versions with clear modes.
5. Tests exercise missing/conflicting values, confirmation, PDF roundtrip, retries, failure,
   injection/citation rejection, idempotency, stale state, isolation and existing regressions.

Worker ownership: backend workflow agent owns app/workflow except documents.py, workflow routes,
standalone app and workflow/model tests. PDF agent owns documents.py and document tests.
Coordinator owns frontend, dependency declarations, documentation and integration.
No worker may change existing tests, config checks or assertions to make failures pass.
Independent reviewer is read-only and judges actual code/evidence against this checklist.

Verifier: backend/.venv/bin/python -m pytest backend/tests (PYTHONPATH=backend),
frontend npm run lint/typecheck/test/build, existing browser suite and new backend workflow browser flow.
Inspect generated PDFs and browser screenshots. Record failures before corrections.
Success ends loop. Limit 8 correction cycles; repeated identical failure twice without new
information stops for diagnosis/blocker. No cloud operations, secrets, external messages,
pushes or deployment under this feature request. Approved package installation is local only.

Verification completed against fixed criteria; see docs/bedrock-workflow-results.md.
Review corrections included citation/value grounding, explicit context limits,
SDK retry bounds, interrupted-job recovery, field fit checks, and frontend
confirmation/session races. Existing behavioral assertions were not weakened.

## Agentic PDF follow-up

Acceptance adds real Strands scoped read/propose tools, model replies, staged PDF
preview, explicit hash/revision-bound confirmation, exact-byte version promotion,
case isolation and preservation of prior confirmed facts/conflicts. Root owns
service/actions/routes/integration; tool worker owns model/tools/schemas/tests;
UI worker owns frontend workspace and component tests. Independent review is read-only.
No live AWS or publication authorized. Max eight correction cycles remains.
Corrections: preview layout and asynchronous UI test interaction; stale baseline
fact protection; unresolved conflict protection. Existing assertions retained.
