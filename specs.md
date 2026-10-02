# Relay hackathon product and technical specification

Version 0.2 · 2 October 2026 · Integrated messaging and calls proposal

**Relay is the current working name**, suggested by the user; name and trademark availability have not been checked. This specification and [implementation.md](implementation.md) are intended to be given together to a coding AI. They define a narrow, demonstrable prototype rather than a production financial system.

## 1 Purpose and decisions

Help a founder turn a business idea and financial documents into a source-linked, versioned packet that a human advisor can review. One user-facing orchestrator organizes the work, asks focused questions, creates a visible task list, coordinates hidden specialists, and brings advisor questions back into the founder’s existing chat.

The product workflow below reflects the current concept. The technology choices, operating limits, implementation sequence, and placeholder service are recommendations. They have not all been agreed by the team.

- **Proposed first service:** founder financial planning intake, using a synthetic checklist and packet template. The real receiving service and first official document remain undecided. Do not represent this as an official LPL form or supported LPL integration.
- **Target:** a reliable recorded demonstration ready for the stated October 3, 2026, 9:00 AM PDT upload deadline, equivalent to 16:00 UTC. Confirm submission details separately.
- **Required AWS evidence:** demonstrate at least one real AWS integration. The default design uses S3, DynamoDB, and Bedrock; a diagram or logo alone does not demonstrate integration.
- **Demo data:** fictional founders, advisors, companies, financial figures, and documents only.

## 2 Product workflow

1. The founder selects the demo service, describes the business and goal, and uploads supported documents. Before delegated work starts, the orchestrator publishes an initial ordered task list.
2. Intake extracts candidate facts with source references. Missing fields, conflicts, and uncertain interpretation remain explicit. Extraction is not confirmation.
3. The orchestrator asks focused clarification questions in the founder’s chat. A founder answer becomes a new attributed source; it does not silently erase conflicting evidence.
4. The agent publishes or updates the visible task list before subsequent planning, drafting, or execution. Show dependencies, the active task, completed work, blockers, and who needs to act.
5. Backend specialists are selected dynamically from the service’s allowed capabilities. Only the orchestrator speaks as AI; founder/customer and advisor messages retain their actual human authors. Never expose specialist names, tiles, or separate conversations.
6. Confirmed facts populate a versioned draft packet. Unconfirmed fields stay blank or visibly flagged. The founder previews the packet and confirms the intended advisor and materials before handoff.
7. The authorized advisor opens the founder’s folder, previews the packet and sources, and inspects cited flags in a small AI sidebar.
8. The advisor approves the exact reviewed version or drafts questions/returns it for clarification. UI actions and natural-language instructions both produce an outgoing question draft. Sending always requires a separate explicit confirmation showing recipient and contents.
9. Questions return to the same founder chat. Answers update facts and tasks; a new immutable packet version highlights changes. The advisor reviews that version again.
10. The founder sees the reviewed version and outcome. “Advisor approved” is a review milestone, not institution acceptance, account opening, filing, or final processing.

## 3 UI contract

### Founder workspace

Use a document checklist and source list, compact company profile, one case conversation workspace containing AI and human messaging, visible ordered tasks, current-activity line, packet preview, and review timeline. Keep the next action obvious on a laptop and usable on a phone.

There are **exactly three orchestrator UI states**:

| State | Meaning |
| --- | --- |
| Idle | No work is actively running; may be awaiting advisor review |
| Thinking / Working | The orchestrator is planning or executing authorized tasks |
| Needs input | The founder must answer or approve; show an in-app notification |

These are separate from task states: **Pending, In progress, Blocked, Done**. Case status is a third, separate field: Information needed, Draft ready, Advisor review, Questions returned, or Advisor approved. An infrastructure error is a task blocker with a clear reason and retry option, not a fourth orchestrator state. If only an operator can fix it, show Idle with the blocked task and operator owner.

Current activity must come from structured events such as “Checking uploaded sources,” “Drafting packet v2,” or “Preparing advisor handoff.” Do not display private chain of thought, fabricated progress, or raw model traces.

### Advisor workspace

Use a Google Drive-like layout: one folder per founder, file list, preview area, versions and review badges, and a compact right-hand AI chat. Folder styling does not imply a Google Drive integration. Show only assigned cases and explicitly shared packet versions, sources, and answers. A packet-bound sharing manifest controls document access; later uploads and private AI-chat answers remain private until renewed handoff confirmation. A message deliberately sent to the other human participant shares only that message and its explicitly selected attachments. Sidebar answers link to the relevant file and page/row/field, identify unknowns, and suggest review questions. The human makes the review decision.

### Shared chat and inline call experience

For both the founder/customer and financial advisor, human chat and calls live **inside the same AI chat workspace**, in a Messages-style conversation panel. Do not create a separate communications dashboard or require navigation away from the case. The advisor retains the compact right-hand panel beside files; the founder gets the same interaction in their main chat.

- Clearly label every message author as Relay AI, founder/customer, or advisor, with participant name and timestamp. A visible composer audience control selects private AI chat or the named human recipient. Switching audience preserves unsent text but requires rechecking the visible recipient before sending. Never imply AI-generated text was written by a human.
- Direct human messages use an explicit named-recipient Send action; AI-proposed advisor questions retain the separate draft → review → confirm-send flow. Private AI history, documents, and assistant context are not automatically shared when a human joins the conversation. Shared-message permission does not grant the whole case folder.
- Put a Call control in the chat header/composer. Starting it opens an inline call card and invites the authorized other participant, who can accept or decline. Both roles can start, accept, end, mute/unmute, and expand/collapse the card. Toggling call off ends the session; merely collapsing the card keeps an obvious active-call indicator and End control.
- Preserve message history, scroll position, unsent text, case context, and participant labels when moving between messaging and call mode. Messages remain usable during a call; an ended or failed call returns naturally to messaging.
- Call state is independent of the three modes Idle, Thinking / Working, and Needs input and of task state. Ringing, connecting, connected, ended, or failed are call labels only, never new orchestrator modes. Show unavailable participants and failed connections honestly.
- Call participation does not enable recording, transcription, or AI notes. Those remain off by default and require separate, explicit consent from every participant, visible start/pause/stop controls, and review of proposed facts before merging. AI is not silently a listening participant.

The integrated messaging and call-control UX is required. For the hackathon, the proposed minimum is persisted human messaging plus a clearly labeled simulated call interaction; a working audio transport is stretch work until a permitted provider and setup are chosen. Simulated calls must say “Demo call — no audio connection,” must not request microphone access, and cannot count as working voice integration.

### Visual direction

Use **light mode only**: white/off-white surfaces, quiet gray borders, generous whitespace, and restrained near-black text for readable hierarchy. Avoid large black panels, heavy dark chrome, dark mode, and the earlier teal/lavender direction. Use LPL-inspired blue for primary actions, links and selection; orange is a sparing attention accent, never the only indication of status. Centralize `--lpl-blue` and `--lpl-orange`; exact approved values are `TOKENS_TBD` pending verification. Check contrast and keyboard focus rather than using color alone.

Use [Midday](https://midday.ai/) and especially its [file-storage interface](https://midday.ai/file-storage/) as layout inspiration for file navigation, search, tidy rows/cards and previews. Preserve Relay’s founder folders, source flags and integrated chat/call panel. This is visual inspiration, not copied branding, a new product integration, or adoption of Midday’s feature set.

## 4 Default technical stack

Repository integration: the verified Relay checkout uses `advsior-frontend/` (existing spelling), `backend/`, and `client-frontend/`. Inspect and preserve that structure and working technology; map this proposed stack onto the checkout rather than renaming directories or replacing functioning apps merely to match the example layout.

| Layer | Proposed default | Why |
| --- | --- | --- |
| App | Next.js App Router, React, TypeScript | One repository and language for both workspaces and API |
| UI | Tailwind CSS, selected shadcn/ui components | Fast, accessible forms, sidebar, dialogs, and tables |
| API | Next.js Route Handlers, Node.js runtime, Zod validation | Shared typed contracts; server-only credentials |
| Jobs | One local Node/TypeScript worker, persisted jobs and leases | Background progress without adding cloud deployment work |
| Files | Private Amazon S3 | Real AWS upload, source retrieval, and packet storage |
| Records | Amazon DynamoDB, AWS SDK for JavaScript v3 | Persist case facts, tasks, versions, reviews, and events |
| AI | Amazon Bedrock Converse behind a small ModelAdapter | One server-side boundary for structured specialist calls |
| Extraction | PDF.js text extraction, CSV parser, plain-text input | Text-based documents with reproducible page/row citations |
| Testing | Vitest, Playwright, TypeScript and ESLint | Domain tests and full review-loop browser coverage |
| Identity | Server-issued seeded demo sessions | Two fixed demo identities without an extra auth vendor |
| Communication | Persisted in-app messages and CallAdapter | Shared chat UX; simulated call adapter first, live transport explicitly deferred |

For an empty scaffold, run the Next.js app and worker locally for development and recording; in the existing checkout preserve its working entry points. Public hosting is not a dependency of this plan. Pin compatible package versions and commit the lockfile once scaffolded. Do not introduce Supabase, a vector database, another API service beyond the existing backend, or a general multi-agent framework for this MVP. Lambda and production authentication such as Cognito are later deployment choices, not prerequisites.

The provided workshop account and how-tos are useful starting points; use the shared team account in `us-east-1`. Account availability does not establish bucket, database, IAM, quota, or model permission. Verify these before committing to a demo path. Bedrock Converse uses a supported model or inference profile and requires invocation permission; configure `BEDROCK_MODEL_ID` only after a successful small test. [AWS Converse documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)

## 5 Runtime and data flow

Browser → authenticated Route Handler → case authorization → validated command → DynamoDB job/task records → worker → bounded specialist calls → validated facts or packet → persisted events → UI refresh.

Upload flow: API authorizes the case and issues a short-lived, constrained presigned POST for a server-generated staging key. On completion, the server copies bytes to a new canonical key that the browser cannot overwrite, then validates and hashes that canonical copy before accepting it. Store document hash, MIME type, size, and original filename as metadata. Return short-lived authorized GET links for previews. Presigned access is a bearer capability and inherits the signer’s permissions. [AWS presigned access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

Persist visible tasks on every enqueue path before a worker can claim work. Persist events before publishing them. An authenticated server-sent event endpoint can replay events after a cursor; polling the same event store is the fallback. No model token stream is needed to show task progress. Refreshing or reconnecting must restore the same tasks and version history.

Core records: tenant membership, case, source document, source excerpt, fact, conflict, task, job, message, clarification, packet version, review decision, consent, conversation participant, call session, and activity event. Every case-linked record carries `tenantId` and `caseId`. Packet versions snapshot fact revision, template revision, included source IDs, unresolved issues, and content hash.

## 6 Agent boundary

The orchestrator dispatches only registered specialists: extraction, completeness/conflict checks, clarification drafting, packet drafting, and advisor routing. Dispatch is dynamic according to service requirements and unresolved needs, not a fixed procession of visible agents.

Specialists receive minimal authorized case context and return schema-validated proposals. Advisor AI context is limited to shared packet/source grants and messages addressed to that advisor, excluding the founder’s private AI turns and unshared facts. They cannot directly send messages, approve packets, grant access, select arbitrary recipients, fetch arbitrary URLs, run shell commands, or modify credentials. Deterministic application code applies permitted state transitions. The routing specialist chooses only from a seeded, authorized service-to-advisor directory.

Each call must return source evidence, unknowns, and any recommended next action. Invalid JSON gets one constrained repair attempt. Missing evidence, unsupported fields, or exhausted retries block the relevant task rather than fabricate an answer. Use explicit budgets: at most two concurrent specialists, four model calls per job, one transient retry, and a bounded token/time limit. Resume from a checkpoint with a new job if more work is needed.

## 7 MVP and boundaries

**Must work:** one service/template; one founder and advisor flow; PDF/CSV/text uploads; source-linked facts and conflicts; founder clarification; visible tasks and three UI states; real AI behind the adapter; versioned packet; explicit advisor handoff; folders/preview/sidebar; approve and return/revise/review loop; persisted human messaging and inline call controls for both roles; persisted state; at least one evidenced AWS integration.

Proposed demo limits: five files per case, 5 MB per file, 20 PDF pages per file. Reject unsupported, encrypted, image-only, malformed, or oversized files with a helpful message. Scanned-document OCR is stretch work. Render packets as escaped HTML plus a downloadable Markdown file; polished PDF export is optional.

**Stretch only after core passes:** live audio transport for the integrated call UI, consent-based summaries, OCR, extra services/templates, production login, cloud worker hosting, and external advisor notifications. Live audio must not block submission; the integrated chat/call UX remains in scope. Future call capture needs participant consent, start/pause/stop controls, access and retention choices; summaries and proposed facts require review before merging into the case.

**Outside this prototype:** financial recommendations, autonomous signatures/submissions, IRS filing, money movement, live financial account connections, legal-capacity decisions, official institutional acceptance, and broad claims of regulatory compliance.

## 8 Security and correctness requirements

- Server sessions map to seeded identities and memberships. Never trust client-supplied role, tenant, advisor, or owner fields. A development-only role switch must be server-controlled, loopback-only, and disabled in deployed builds. Demo authentication is not production authentication.
- Authorize every case, message audience, call participant/action, event stream, source, preview, and review request. Filter event replay by audience; private AI messages must never reach another participant’s browser. S3 keys use opaque tenant/case/document IDs, never names or user-provided paths. Keep public access blocked; verify encryption at rest and TLS. Configure CORS for the exact demo origin.
- Treat uploaded text and model output as untrusted. Document instructions cannot override system policy, authorize a tool, change recipients, or cross case boundaries. Escape rendered output and validate both evidence references and tool arguments server-side.
- Log IDs, status, timings, provider request IDs, and safe errors. Exclude document bodies, financial figures, chat contents, tokens, and presigned URLs. Use temporary approved AWS credentials through the normal credential chain, never browser bundles or committed environment files.
- Record explicit packet-sharing confirmation and advisor question-send confirmation. A new recipient, broader source set, or changed question draft invalidates the prior confirmation.
- Use conditional writes and idempotency keys for jobs, handoffs, and decisions. Reject stale approvals with a version-conflict response; an approval of v1 never approves v2. Keep historical evidence and decisions intact.
- Set a proposed seven-day synthetic-demo retention window, with an owner and cleanup checklist. Enforce expiry in access checks; database TTL or storage lifecycle is cleanup, not instant access revocation. Agree a real-data policy before accepting real documents.

## 9 Definition of done and remaining decisions

A new session can complete intake → conflict → founder answer → draft v1 → authorized advisor review → returned questions → founder answer → draft v2 → advisor approval. The visible task list precedes execution, activity continues through drafting and routing, unknowns are not invented, and every review identifies an exact version. Unauthorized cross-case access and stale approval tests pass. A second click does not create a second send, call invite, or draft. Both roles can message and toggle inline call mode without losing chat context; AI/human authorship and private/shared audiences remain clear. Call controls never alter the three orchestrator modes or start capture implicitly.

Before implementation, confirm the placeholder service is acceptable, select the available Bedrock model, verify AWS permissions/resources and budget, and decide the recording/demo access method. If DynamoDB is blocked, a clearly labeled local SQLite adapter may preserve the demo flow; if Bedrock is blocked, use a team-approved server-side model adapter. Do not silently switch providers or transmit real data. Retain a real S3 operation as AWS evidence; if no AWS integration can run, report the requirement as unmet. Fixture mode is useful for tests but must be labeled and is not evidence of live AI.

## References

- [Current product concept](https://chatgpt.com/space/page_f2573978dc5c8191a728370ff7bb09c9), read October 2, 2026
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) and [Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) and [supported models](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html)
- [S3 presigned access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [POST policy conditions](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html), and [bucket encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html)
- [DynamoDB conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) and [transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)

Official technical references checked October 2, 2026. They document APIs, not permissions or availability in the team account.
