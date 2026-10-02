# Relay control transition audit

Audit scope: local synthetic frontend, both roles, all nine original screens plus Search and Settings. Reviewer operated Chromium and read rendered control implementations. Application changes belong to the coordinator; reviewer changes are limited to `tests/browser/control-transitions.spec.ts` and this document. No backend, credentials, installs, external messages, deployment or real account mutations were used.

Every family of actionable controls was checked for a specific route, selected item, panel, thread message, confirmation, cancellation or disabled state. Repeated shared controls were exercised on each screen where they appear. Static identities, status badges, task rows, column headings and breadcrumbs without links are informational, not actions.

## Missing flows found and corrected

| Finding | Before | Implemented outcome |
| --- | --- | --- |
| Founder Documents tabs | Preview/Version history were styled inert spans | Real accessible tabs select packet preview or a version timeline; View version selects that version and returns to Preview |
| Global search | Label promised sources and drafts; founder search only searched originals | Separate role-scoped Search screen, query field, All/Sources/Documents filters, empty reset, and links to exact original/version |
| Settings | Static placeholder panel | Profile, Call privacy and About this demo tabs with distinct truthful content and workspace/call/document destinations |
| Home chat entry | Link changed hash without focusing composer | Answer/Discuss in Home chat navigates, scrolls and focuses the composer |
| Mobile search entry | Desktop search hidden without an alternative | Accessible mobile search link; desktop has a visible submit button |

Coordinator application commit: `339ce5e`. Tests run against frozen production preview at `http://127.0.0.1:5173`; paths within tests remain relative to Playwright baseURL.

## Coverage matrix

| Screen/area | Controls and reachable states | Asserted result |
| --- | --- | --- |
| Shell, both roles | Every Home/Sources/Documents/Call or Clients/Reviews/Documents/Call navigation item; Settings; Relay brand; Demo role; Skip to main content | Correct heading/route and active nav; brand opens role workspace; role changes view; skip link focuses main |
| Shell search, both roles | Desktop Search submit and Enter submission; mobile search link | Role Search route receives query; mobile exposes Search without horizontal overflow |
| Search, both roles | Query; All/Sources/Documents; Clear search; Show all sources and documents; every fixture original and generated-document result | Filtered visible result links, empty state/reset, correct selected original or exact packet version; unshared v2 absent from advisor results |
| Settings, both roles | Profile/Call privacy/About this demo; arrow keys, Home/End; Open Call; Explore documents; Return to workspace | Correct selected tab/focused tab/panel and destination; identity/consent/simulation content changes with section |
| Founder Home | Answer in Home chat; View sources; three recent original links; recent draft link; source citations | Composer focus; correct original preview or v1 document |
| Shared conversation, all nine screen placements | Audience choice (private AI/human where available), blank send, text input, private send, human Preview message, Keep editing, Confirm simulated send | Blank submit disabled; private message appears once and clears composer; preview is unsent; editing preserves text; confirmed human message appears once and clears composer; switching audience hides other thread |
| Home attachment | Attach a source; Check upload availability; Cancel attachment | Local selection shown; explicit Upload not performed error; cancel removes selected file without claiming storage |
| Founder Sources | Three file-row buttons; their source citations; Search original sources; Clear search; Add sources in Home chat; Return to Home conversation; empty Go to Home chat | Exact file heading/excerpt and pressed row; no-match state clears; Home routes expose composer/attachment |
| Founder Documents | Packet rows; version-history selection; Preview/Version history and keyboard tabs; View version; Compare versions/Close comparison; Earlier version; View sources; Open Call; Discuss/Answer in Home chat; packet/source/message citations; Clear search; empty Browse sources | Exact selected version; timeline/preview swap; v1 comparison disabled; v2 comparison text/selector; historical handoff absent; citations open original or exact human answer; correct destinations |
| Founder handoff | Preview handoff; every original checkbox check/uncheck; Cancel handoff; Confirm simulated handoff | Named version/recipient and selections displayed; cancellation hides confirmation; selected originals available to advisor for that version; unselected originals excluded from that version |
| Clarification | Home breadcrumb; blank answer; Preview answer; Keep editing; Create simulated draft v2; Review packet v2; Return to Home; empty Return to Home; human-only conversation | Blank preview disabled; preview/edit round trip; proposed unapproved v2; exact answer provenance returns to human thread; success/empty destinations work |
| Advisor Clients | Workspace card; packet row; all three shared-original rows; local query/Clear search; citations; Open Call | Card restores packet; rows select exact preview; query clearing restores assigned content; correct source/call |
| Advisor Reviews | Review row; query/Clear search; Open document review; Open Call; question and approval controls | Selected version detail; search reset; exact document/call routes; all shared review control transitions below |
| Advisor Documents | Packet row; every shared original row; Return to packet; Packet version selector; Back to clients; Open Call; review controls | Original preview suppresses approval; return restores packet; version selection binds review; historical actions absent; correct destinations |
| Shared review controls, Reviews/Documents/Advisor Call | Draft question blank/nonblank; Preview questions; Cancel preview; Confirm simulated send; Return review with sent question; Return review with these questions; Review approval; Cancel approval; Confirm approval | Blank preview disabled; named recipient/version preview; cancel is unsent; sent question reused; returned review transitions without duplicate send; cancel approval hides confirmation; confirm approves exactly that version and disables approval |
| Calls, both initiators | Invite; recipient Decline/Accept; Unmute/Mute; participant consent grant/withdraw; Everyone must consent separately disclosure; End; empty View Documents/View Reviews | Invitation changes available actions; decline/end restores invite; acceptance enters simulated connecting; mute label toggles; separate acknowledged consent state; disclosure opens text; no live media; ended/no-call consent disabled |
| Test states/recovery | Test states disclosure; normal/empty/error/slow/disconnected; Cancel request; Retry loading; Reconnect / refresh | Slow work exposes cancel; cancelled message absent; forced error retry remains truthful; normal restores workspace; disconnected refresh restores route |

## Intentionally unavailable and disabled states

- Source browsing has no upload entry. Only Home supports local file selection; real upload reports unavailable.
- Empty message/question/answer submissions are disabled. In-flight mutations disable dependent controls and expose cancellation.
- Comparison is disabled when no earlier version exists. Historical founder handoff and advisor review actions are absent.
- Approval is disabled after the selected exact version is approved. Original-source preview requires Return to packet before approval.
- Call invitation requires an available packet; no active call disables capture consent. Calls start muted and never open camera/microphone or real media.
- Settings profile is read-only because sign-in/account editing is not connected. Privacy links to explicit consent in the Call screen; no fake preferences or save button were added.

## Verification results

All **41 control-transition cases passed** against the unchanged frozen application, using the broad run and focused reruns of corrected/expanded cases. The broad run passed 33/38; test assumptions were corrected and affected/expanded coverage passed 12/14, followed by a final 3/3 narrow run covering both call directions and Advisor Documents destinations. Overlap is intentional; this is 41 unique passing cases, not a claim that one invocation returned 41/41.

Reviewer checks: TypeScript typecheck passed; ESLint for the new test file passed; `git diff --check` passed. No page errors occurred in passing cases; every case also asserts that the truthful synthetic-demo banner remains visible.

Coordinator independently reported the existing 13 browser tests, 29 unit tests, lint, typecheck and build passing. The new coverage complements that suite and does not overwrite it or regenerate screenshots.

Initial failures were isolated to an in-progress preview rebuild and audit test assumptions: calls start muted; consent is acknowledged asynchronously; mobile Search uses its descriptive accessible name; normal scenario automatically restores the workspace; switching roles before an invitation acknowledgment cancels the pending mutation. These were corrected in tests, with no additional application changes. There are no unresolved actionable UI findings within the synthetic scope.

## Limits

This is a practical exhaustive audit of rendered control families and reachable synthetic states, not an assertion that every possible arbitrary query/file/cross-client interleaving was explored. Existing regression coverage independently covers slow cancellation, repeated clicks, stale packet rejection, role privacy, draft reconnect, consent and layout. Real persistence, authentication, upload, generation, transport, AWS/Chime, media capture/transcription and saved account preferences remain backend-dependent. Physical touch, Safari/Firefox and screen-reader audio were not exercised.
