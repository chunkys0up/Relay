# Approved Relay redesign loop

Scope: frontend UI in this isolated worktree only. Preserve adapter authorization,
immutable versions, explicit handoff/send confirmation and unrelated changes.
Latest eight user-attached mockups override older navigation and capture UI.

Acceptance units (fixed):
1. Client Home profile/documents/upload/search/progress and dedicated AI Chat.
2. Advisor Home derived progress/counts; Clients list/inline expandable reviews/private AI.
3. Both roles pre-call and active-call compositions with truthful simulated state.
4. Existing upload, citations, sharing, version reviews and message privacy preserved.
5. Responsive desktop/narrow/mobile, keyboard labels/focus, no runtime errors.

Verifier: npm run lint; npm run typecheck; npm test; npm run build;
npm run test:browser. Existing assertions are locked for implementation workers.
Coordinator may map only intentionally superseded UI selectors/locations to new
behavior; record mappings and submit them to independent review. Never remove
behavioral assertions to make a failure pass. Add regression tests for new views.

Workflow: implement -> run checks -> inspect actual screenshots of eight target
views -> independent read-only review -> focused corrections -> affected checks.
Stop upon acceptance or at 8 substantive correction cycles. Same failure twice
without meaningful progress triggers diagnosis and a blocker report. No installs,
secrets, cloud calls, push, deploy or destructive commands. No new agent subteams.

The adapter currently exposes one assigned case; do not fabricate additional
clients, percentages, documents or real integrations to fill the mockup.

Append evidence/correction counts to REDESIGN-RESULTS.md. Final handoff must name
checks actually run, inspected screenshots, unresolved limits and worktree.
