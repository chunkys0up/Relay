# Append-only advisor verification log

## Setup
Expected: isolate current main and preserve source checkout.
Actual: fetched origin/main, b2c7e27 unchanged; clean main; created codex/advisor-bedrock-loop worktree.
Diagnosis: WSL rg unavailable; use git ls-files/grep without install. No repository AGENTS files found. Windows global guidance and supplied task apply.
Fix/rerun: not applicable. Corrections 0/6; live attempts 0/3.

## Baseline/backend and AWS preflight
Expected: unchanged backend regressions and authorized configured model identities.
Actual: 134 backend tests passed in 14.26s (advisor-evidence/backend-baseline.txt). Windows AWS CLI sts get-caller-identity succeeded for WSParticipantRole/Participant; both exact configured inference profiles returned ACTIVE in us-east-1.
Diagnosis/fix: none. Nonbillable identity/catalog checks; live attempts remain 0/3.

## Founder browser verification (during implementation)
Expected: unchanged original founder flow assertions on isolated ports/caches.
Actual: 6/6 workflow browser tests passed in 47.3s, including exact PDF preview/confirmation, separate-session isolation, source revisions and reconnect, actual Strands deterministic team. Log advisor-evidence/workflow-browser.txt.
Diagnosis/fix: no failures. This is local simulated-model evidence, not AWS. Rerun if integration touches affected backend/UI behavior.

## Frontend regression check (during implementation)
Expected: retain original assertions and repair both Documents regressions.
Actual: 84/84 frontend unit tests passed; Documents fix landed during this run, so frontend-baseline.txt is an interim current-tree result, not an untouched baseline.
Diagnosis/fix: restored shared-original navigation and empty search state. No assertions changed.

## Live evaluator bounds established before invocation
Each combined attempt runs the unchanged founder check_bedrock.py evaluator, then at most two advisor requests (missing/conflicting evidence; two-version comparison), each under LOOP runtime budgets. No extra billable repair outside those limits. Idempotent replay must make no model call. Exactly three combined attempts maximum. Current live count 0/3.

## Correction round 1/6: independent boundary review
Scenario: partial source revocation/history replay, timeout occupancy, conversational follow-ups, advisor generic catalog access.
Expected: revoked material never reappears; elapsed time prevents additional model/tool calls; one active request per conversation; history assists follow-up questions without becoming evidence authority; advisor screens never fetch unscoped founder catalog.
Actual: reviewer identified stored citations not revalidated after partial revocation, model continuing after API timeout, omitted conversational history, and legacy advisor Home/Documents generic catalog callers.
Diagnosis: scope existence checks were insufficient for every stored citation; timeout wrapper needed cancellation propagated into Strands; inherited UI paths were not authorization-safe.
Fix: assigned to backend/frontend writers; regression tests and independent rerun pending. This is the first material review correction round; scenario counts 1/3. Live attempts 0/3.

## Correction round 2/6: browser integration
Scenario: unchanged local-demo Clients controls, private draft reload, founder Home source/navigation regression, explicit test-provider label.
Expected: preserve locked original browser assertions and retain browser/server separation; edited private drafts survive reload; source selection/upload entry remains reachable; simulated models visibly labeled.
Actual: first full demo browser run exposed removed local Clients composer, edited advisor draft reset after reload, missing founder Home fixture source links/local attachment entry after upstream live upload integration. Direct CUA confirmed working actual-Strands simulated conflict/missing response, authorized citation preview and two-version comparison, but provider mode initially absent.
Diagnosis: compatibility was removed along with static AI, browser draft helper is memory-only, upstream Home replaced local source entry, session provider not rendered.
Fix: writers restoring explicitly labeled browser-only composer (never fallback inside server mode), adding durable private draft storage, narrow founder local entry restoration, explicit simulated/live configuration label. Original assertions remain locked. Reruns pending. Correction count 2/6, these scenario counts 1/3. Live attempts 0/3.

## Live smoke attempt 1/3 started
Expected: original founder extractor/team/PDF evaluator and two advisor scenarios pass through configured Bedrock models with actual tool traces. Read-only identity/model checks already passed.
Bound: unchanged founder evaluator plus maximum two advisor calls, each four turns/eight tools/60s, with idempotent replay making no new call. No background model server or polling.
Actual/result: pending in advisor-evidence/live-attempt-1.txt. Count is consumed even if failure.

## Correction round 3/6: exact pending-request correlation
Expected: a stopped/failed request in one tab must not be cleared by another tab's unrelated reply.
Actual: reviewer found frontend compared only new assistant IDs, so a different completed request could be mistaken for this pending request.
Diagnosis: committed messages lacked client-visible request identity.
Fix: backend adding immutable request_key to each committed message pair; frontend reload/retry reconciliation will match exact key. Added regression coverage required; final review/rerun pending. Scenario count 1/3, total rounds3/6.

## Actual-server browser integration
Expected: no mocked HTTP; actual API plus actual Strands deterministic tools across visible flows.
Actual: 2/2 passed in14.5s: cold active-URL bootstrap, conflict/missing answer, source popup, edited-draft reload, version comparison/history separation, desktop/narrow layout, independent browser privacy; unassigned case/unshared version/missing-CSRF rejection. No page errors or failed advisor network responses in valid flow. Screenshots in advisor-evidence/integrated-browser/.
Mode: simulated model, actual Strands/tools/API/SQLite. Not live AWS.

## Live attempt1 result and correction round4/6
Actual: extractor passed six grounded fields, then unchanged founder evaluator blocked with WRITER_REQUIRED; advisor calls were not reached. Log live-attempt-1.txt. Count1/3 consumed.
Diagnosis: validated reader proposals existed but no writer edit was staged. Current writer prompt did not state the mandatory read_packet(null) precondition for new packets or exact complete changes array; error can cover omitted writer delegation or failed staging, and original evaluator does not retain those safe diagnostics.
Fix: explicit orchestrator writer requirement for proposals; writer prompt now mandates read_packet even for new packet, all cited source reads, and exact reader proposal structure. Existing tool validation, failure gate, budgets, templates and evaluator unchanged. Added safe boolean/count diagnostic on this failure for precise next-attempt diagnosis. Offline regression rerun pending. Founder staging scenario1/3, total4/6.

## Correction round5/6: founder local upload confirmation compatibility
Actual: first broad browser run ended60 passed/9 failed. Several failures predate completed fixes or occurred during Vite config rewrite; however current Home local file input still immediately saves and lacks original selected-file preview/Add source locally/Cancel attachment controls.
Expected: original explicit local-file confirmation/cancellation assertions pass unchanged; no direct addition on file selection.
Diagnosis: narrow restoration added input but did not restore complete original interaction.
Fix: frontend writer assigned complete confirmation flow and focused browser rerun. This scenario second correction (2/3), total5/6. Final full browser run will use a stable tree.

## Live smoke attempt2/3 started
Prerequisite: founder staging regression suite45 passed after round4 prompt change; backend full150 passed. Independent reviewer found no unresolved material advisor boundary findings.
Expected: unchanged original founder evaluator and two advisor scenarios. Same bounded allowance as attempt1, no silent model substitution.
Actual/result: pending advisor-evidence/live-attempt-2.txt. Count2/3 consumed even on failure.

## Live attempt 2 / stop founder path
Extractor passed; writer was invoked (10 total tool calls), but no valid edit staged: WRITER_REQUIRED again. Founder live acceptance remains failed. Stop this path after repeated blocker; no additional founder retry. Attempt 3 is reserved for independent advisor acceptance using the same unchanged credential bridge. Added an explicitly labeled advisor-only harness mode; original evaluator and assertions remain unchanged. This is harness routing, not an application correction round.


## Final results and stop
Attempt3 advisor-only PASS: 3 turns/5 successful tools for cited conflict and missing evidence, 4 turns/7 successful tools for comparison; persisted idempotent replay and citation previews passed. Live allowance3/3 consumed; founder live remains failed. Final backend152, frontend92, demo browser69, founder workflow6, actual-server integration2 all passed; lint/typecheck/build and unchanged-test/evaluator diff checks passed. Direct final advisor console clean; founder generic8000 backend unavailable explicitly shown. Initial direct pytest executable collection failed import path; corrected python -m pytest passed152. Five correction rounds total, no further application changes. Independent review clear. Full evidence, limitations and recovery in ADVISOR-RESULTS.md.
