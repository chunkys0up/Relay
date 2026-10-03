# Verification log (append-only)

| Scenario | Expected | Actual / evidence | Fix / diagnosis | Rerun |
|---|---|---|---|---|
| Baseline backend | Existing assertions pass | 113 passed, backend-baseline.txt | None | Round 0 pass |
| Frontend dependency reuse | Existing SDK imports resolve | Missing Chime in main node_modules; typecheck.txt and browser-demo.txt | Reuse approved-redesign installed dependencies; no install | typecheck-rerun passed |
| Browser port isolation | Test only this worktree | 8001 occupied by preexisting server | Added verification configs using8019; corrected config merge to replace server array | 6 workflow tests passed, browser-workflow-isolated.txt |
| Frontend unit baseline | Project tests only | Backup symlink under non-node_modules name accidentally included dependency tests; contention timed out six project tests | Relocated backup under node_modules directory and maxWorkers2; assertions unchanged | 79 passed, frontend-tests-rerun.txt |
| AWS identity | Authorized profile resolves using configured region | Missing profile-default region on initial identity command | Explicit configured us-east-1 | STS WSParticipantRole/Participant succeeded |
| AWS availability | Exact selected models active/authorized | Both profiles ACTIVE; both foundation models AUTHORIZED, region/agreement/entitlement AVAILABLE | None | Live read-only pass |
| Synthetic live smoke1 | Grounded extractor, full team, verified preview, human confirmation, exact bytes | PASS,104.6s; live-smoke-1.txt | None | Baseline live pass |
| False action claims | No success without staged action | Independent real-Strands repro returned delivered/emailed/complete with no edit | Correction1: state-derived replies, trusted literal clarification templates; legacy path shares sanitizer | Pending final |
| Valid five/six-source edit | Grounded edits fit bounded tool budget | Five-source edit needs14 calls but cap12 | Correction1: cap18=two delegations+existing8 per specialist | Pending final |
| Local budget exhaustion | Terminal failure despite model catching tool errors | Reviewer reproduced final response after ninth specialist call | Correction1: sticky terminal budget flag | Pending final |
| Safe preview wording regression | Preserve baseline PDF reply assertion | Round1:112 passed,1 failed test_pdf_actions | Correction2 for reply scenario: preserve exact safe staged template only | Pending final |
| Demo browser | All66 pass |65 pass; reload-during-draft test missed Working state | Isolated rerun to distinguish transient timing from behavior | Pending |
| Computer use | Actual rendered behavior | In-app browser founder Home/Chat; missing/conflict citations; advisor assigned case/private AI; exact-version confirmation preview; call explicitly simulated/no devices or capture | Browser focus timeout recovered via fresh state and retry | Direct interaction pass so far |

No real .env or credentials read. Config inspected only backend/.relay/bedrock.json. No packages installed or live calls/messages/resources created. Existing app on8001 left untouched.
| Final regression suite | Existing and new assertions pass | 133 passed in28.98s, backend-final-after-launcher.txt | No existing tests changed | PASS |
| Final demo browser suite | All66 assertions pass |66 passed in3.8m, browser-demo-final.txt | workers1; no code or assertion changes for timing miss | PASS |
| Live smoke2 | Complete final workflow | Extractor passed, job safely blocked BEDROCK_UNAVAILABLE | Later refresh failure gives likely cause; exact smoke2 cause not observable | FAIL |
| Live smoke3 | Complete final workflow | Extractor failed CredentialRetrievalError / NoRegion in Windows credential_process | Launcher fix round1: pass configured region explicitly | Full smoke NOT rerun:3-attempt cap reached |
| Fixed credential bridge | Live read-only identity through generated bridge | PASS STS WSParticipantRole/Participant, bridge-identity.txt | No credential storage or permission change | PASS |
| Independent final review | No unresolved material fix findings |22 affected tests pass; original launcher fails both new region tests;15/16 first new defect regressions fail original code | Reviewer authored only new tests; app fixes coordinator-owned | PASS |
| Computer-use PDF flow | Explicit review; actual PDF; saved bytes/reload | Downloaded preview rendered as1page with all6correct fields; checkbox required; save created v1; reload retained Download v1; console errors=[] | Embedded PDF blank in Codex IAB, fallback download succeeds | PASS download; embedded rendering LIMITATION |
| Computer-use integrity | Saved/downloaded bytes equal preview | Both SHA256=15d0e0875e4949f4826191eddbb0d2d01af2ff33802210ec7f346fe1ddb04234 | Synthetic data, simulated model, real Strands/backend/UI | PASS |

Correction counts: action-status scenario2 (first fix then preserve existing safe staged literal), tool-budget scenarios1 each, launcher region1. Three complete-smoke attempts initiated:1pass,2fail (third before extraction completed). No fourth invocation. Environment harness corrections are recorded separately, not disguised as app fixes. No scenario exceeded3 corrections or repeated the same blocker twice without diagnosis.
| PDF visual branding | Generated PDF must not name another company | Actual downloaded PDF heading was hardcoded Northstar above Computer Check Studio | Heading correction1: product title Relay; confirmed company field retained |134backend testsPASS;21focused independent review testsPASS; corrected PDF render inspected |
| Final affected browser rerun | All6workflow tests pass after PDF heading fix |6 passed in43.6s, browser-workflow-final-pdf.txt | No assertion changes | PASS |
| Download byte comparison | Actual saved file equals reviewed preview |True;22991bytes for both computer-use downloads (before heading fix) | Later corrected template render and all6browser PDF checks passed | PASS |

Final: five defects fixed; application scenarios used at most two correction rounds. Offline acceptance passed. Full live acceptance on final code remains incomplete at authorized three-smoke cap. Temporary computer-use tab/server closed; preexisting main server untouched.

Shipping integration: preserved upstream 9ce2a3e. Combined backend134PASS, lint/typecheck/buildPASS, frontend82PASS/2FAIL. Both advisor Documents failures reproduce on untouched upstream. No assertion edits; no new AWS smoke. Browser suite evidence predates upstream UI integration.
