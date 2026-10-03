# Writer staging: resolved and live-verified

The unchanged founder Bedrock evaluator passed after the reviewed fix. All three follow-up acceptance units are complete: deterministic diagnosis, verified local fix, and live founder PDF acceptance. No further billable calls were made after success.

## Final checks

| Check | Result | Evidence |
|---|---|---|
| Full backend | 166 passed in 15.03s | advisor-evidence/writer-backend-final.txt |
| Original founder browser suite | 6 passed in 35.7s | advisor-evidence/writer-correction1-browser.txt |
| Independent Sol review | No material findings; 55 targeted tests plus final writer regressions passed | reviewer inspected final diff and live log |
| Original live evaluator | PASS in 40.31s | advisor-evidence/writer-live-attempt-2.txt |
| Existing tests/evaluator and whitespace | Original assertions/evaluator unchanged; git diff --check passed | current diff |

Live PASS output:

```text
PASS live extractor: six grounded fields
PASS live orchestrator -> reader -> writer -> verifier -> preview -> explicit confirmation -> identical PDF
```

Profile relay-hackathon; region us-east-1. Orchestrator/writer: us.anthropic.claude-sonnet-5. Extractor/reader/verifier: us.anthropic.claude-haiku-4-5-20251001-v1:0. Existing credential bridge retains explicit region. No credentials inspected or printed.

## What was wrong and what changed

Installed Strands reproduced a valid proposal being staged on the fourth writer model turn, followed by a limit_turns stop before final text. A decorated nested tool swallowed the failure, so the outer provider reported WRITER_REQUIRED. Output-token limits and provider exceptions could also be obscured.

The fix adds an explicit no-argument staging tool bound to an immutable copy of validated reader proposals. It still requires writer packet/source reads and all citation/PDF validation. Writer receives nine bounded turns, covering the existing maximum eight scoped tool calls plus final response. The cumulative 1800 output tokens, eight local calls, eighteen shared calls, ninety-second timeout, and terminal-failure semantics remain. Exact field/value/evidence equality prevents a legacy staging call from changing the reader-approved evidence.

Fresh live attempt 1 then exposed PDF_EDIT_NOT_STAGED. Offline diagnosis found two further contract problems: the prompt requested packet_id=null despite a string-only tool schema, and propose_pdf_edit({}) failed argument validation before the tool body could record its error. The fresh-packet prompt now requests read_packet({}). Only the reader-bound writer version of propose_pdf_edit accepts omitted changes and uses the exact server-held proposals; it still requires an explicit tool call and all reads. Unbound calls still require changes, empty arrays fail, and omitted-change calls cannot switch packet/template context.

Failed writer runs now log only allowlisted tool names/statuses, model-turn count and stop reason. No source contents, arguments, IDs, credentials or hidden reasoning are logged. Old live logs did not expose the exact writer sequence, so the reproduced failure mechanisms should not be confused with proof of the precise old AWS path. The final original evaluator establishes that the resulting live path now works.

## Files

- backend/app/workflow/team.py: writer contract and bounded turns; exact proposal/evidence scope; terminal error propagation and sanitized diagnostics.
- backend/app/workflow/tools.py: immutable reader-bound explicit staging; safe omitted-changes compatibility; existing validation remains authoritative.
- backend/tests/test_writer_staging_regression.py: fourteen new actual-Strands regressions covering fresh packets, sequential turns, schema contracts, reads/citations, legacy compatibility, safe diagnostics, and terminal failures.
- WRITER-LOOP.md and WRITER-VERIFICATION-LOG.md: fixed criteria and append-only evidence.

All preexisting advisor work was preserved. No frontend changes in this follow-up. Existing tests and backend/scripts/check_bedrock.py were not weakened or edited. No install, commit, push, deployment, IAM change or external message.

## Bounded loop accounting

Two Sol high agents performed implementation and independent diagnosis/review. Initial local implementation plus one correction round after failed live acceptance. All three fixed acceptance units accepted. Fresh authorized allowance: two of three smoke attempts used, stopping on first pass. Attempt 1 failed PDF_EDIT_NOT_STAGED; attempt 2 passed. The previous advisor loop used three attempts separately, so five synthetic attempts were made across both allowances. One newly authorized attempt remains unused; no reason to spend it after success.

The final result is verified for the unchanged synthetic live scenario. This is not a guarantee that arbitrary future model responses will always succeed; failures remain bounded and explicit. Human confirmation remains required, and the live evaluator verified preview bytes equal the confirmed download. The earlier advisor live pass and unchanged frontend verification remain applicable.

Measurement interval: recorded loopstart23:19:43 to finalverification23:37:40 on2026-10-02 America/Los_Angeles, approximately18minutes including approval wait. Account-wide codex usage54% to58% in the same10080minute/reset1791580471 window: observed4percentage-point change; attribution to this task/agents is uncertain. No workflow speed/cost superiority claim.
