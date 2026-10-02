# Workflow regression loop

Scope: local frontend intake, initial founder answer, durable same-origin multi-tab demo workflow. No remote backend, installs, credentials, deploys, or commits.

Success: locked workflow-regressions unit and browser tests pass; existing tests (obsolete unavailable-upload assertions migrated), lint, typecheck, build, and complete browser suite pass. Privacy and current-version confirmation stay intact.

Verifier owner: coordinator. Implementation worker must never edit tests or this file. Freeze new regression files after baseline red run; record SHA-256. Test changes require documenting a test defect or explicitly changed contract; never weaken behavior to accept an implementation.

Iteration budget: 8 implementation verification cycles. Stop on success or same unchanged failure twice, or external dependency needing user authorization. Continue independent authorized work if only one branch is blocked.

Commands: npm test; npm run lint; npm run typecheck; npm run build; npm run test:browser. Use existing installed dependency symlink. Browser server must serve this worktree, using port 5178 for isolated verification.

Append evidence to LOOP-RESULTS.md each cycle. Handoff names changes, actual checks, unresolved limits, iteration count.
