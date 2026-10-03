> **Approved V2 UI override (2 October 2026):** Client navigation is Home / AI Chat / Call; uploads and documents are on Home. Advisor navigation is Home / Clients / Call; Clients includes expandable documents, exact-version review, and private AI chat. Both roles have pre-call and active-call layouts with no capture/transcript controls. These approved mockups supersede conflicting historical navigation/capture-UI requirements below. Backend plans and access safeguards remain unchanged. See README and REDESIGN-RESULTS for implemented scope.
# Relay product and technical specification

Version 0.4 · 2 October 2026 · React/FastAPI, integrated calls, and document-retrieval plan

**Relay is a working name.** This is a focused, fictional-data hackathon plan—not a production financial system, an LPL integration, or an institutional submission workflow. The repository currently contains separate `client-frontend/`, `advsior-frontend/` (existing spelling), and `backend/` directories; preserve those names unless a separately approved migration changes them.

## 1. Purpose and non-negotiable boundaries

Relay helps a founder turn a business idea and financial documents into a source-linked, versioned packet for a human advisor to review. One visible orchestrator organizes work, publishes task progress, asks focused questions, and coordinates hidden specialist agents. Specialists are implementation details: never show their names, tiles, or separate chats.

The demo uses only fictional founders, advisors, companies, figures, and files. It must not provide financial advice, autonomously sign, submit, file, move money, connect live accounts, or claim regulatory compliance. “Advisor approved” means the named human reviewed one exact packet version; it is not institutional acceptance or completion.

The accepted demo is one synthetic business-owner financial-planning packet: a fictional founder uploads documents, one required fact is missing, and one financial value conflicts across sources. The orchestrator asks for clarification, drafts a packet, the advisor reviews it and returns questions, and the founder answer produces a new version. This is a fictional template, not an official LPL form, a proven service integration, or an institutional workflow.

## 2. Product workflow

1. A founder selects the synthetic service, describes the goal, and uploads supported documents. The orchestrator persists and displays an ordered task list **before** planning or execution.
2. Extraction produces candidate facts with source references. Missing values, conflicts, and uncertainty stay explicit.
3. The orchestrator asks focused questions in the founder’s existing chat. Founder answers become attributed sources; they do not silently erase conflicts.
4. Confirmed facts produce an immutable packet draft. The founder previews the exact version and confirms the named advisor and shared material before handoff.
5. The authorized advisor opens the founder folder, reviews files, cited flags, and the exact packet version, then approves it or returns questions.
6. Returned questions arrive in the founder’s same conversation. An answer creates a new packet version with visible changes; an earlier approval never approves the later version.

## 3. UX contract

### Founder Home

Founder navigation is **Home / Sources / Documents / Call**, plus Settings; there is no Work or separate Chat navigation. Home is the primary working surface: a central AI chat with its attachment control as the **only** upload entry point, a prominent right-side to-do list, and current activity. A floating assistant affordance may focus that central chat but does not create another conversation.

Sources is a read/browse-only view of uploaded **originals** and extraction/source metadata; it is not a primary upload page. Documents holds generated drafts and advisor-reviewed versions. Call is a dedicated destination for the human advisor/founder call experience.

The only orchestrator UI states are:

| State | Meaning |
| --- | --- |
| Idle | No active orchestrator work; may be awaiting review |
| Thinking / Working | The orchestrator is planning or executing authorized work |
| Needs input | The founder must answer or explicitly approve; show a notification |

Task states are separate: **Pending, In progress, Blocked, Done**. Case status is also separate: Information needed, Draft ready, Advisor review, Questions returned, or Advisor approved. Call state is never a fourth AI state.

### Advisor workspace

Advisor navigation is **Clients / Reviews / Documents / Call**, plus Settings. Clients retains the Drive-like one-folder-per-founder view with file list and preview; Reviews presents assigned version-bound decisions; Documents presents explicitly shared material. Keep the compact right-side AI chat, source-linked flags, and packet preview. Show only assigned cases and explicitly shared packet versions, sources, and messages. A packet-bound sharing manifest controls document access; new founder uploads and private AI turns stay private until renewed handoff confirmation.

### Shared chat and calls

Home and advisor review retain AI/human message controls in their chat panels. Label every message with actual author, name, and timestamp. A visible audience control chooses private AI chat or a named human recipient; human messages share only selected text and explicit attachments. AI-proposed questions keep the draft → review → confirm-send flow.

**Call is a dedicated left-navigation destination, not merely an inline Home toggle.** It combines the document under review, authorized human founder/advisor video controls, human-message history, clearly labeled AI support, and separate per-participant capture consent. Both roles can invite, accept, decline, end, and mute/unmute. Call state remains independent of the three AI modes and backend task state. Joining, muting, or messaging never enables capture.

A real two-person Chime integration is selected, but workshop permissions, client setup, and a two-person audio test remain explicit gates. Mocked/simulated states must be labeled and never presented as live video/audio.

## 4. Visual direction

Use light mode only: white/off-white surfaces, quiet gray borders, generous space, and restrained near-black text. Avoid dark chrome, large black panels, teal/lavender styling, and color-only status.

Use these **reference-image samples from the user-supplied LPL hackathon background**, not independently verified universal LPL brand standards:

- navy / primary: `#00205B`
- orange / sparing attention: `#B35000`
- muted blue-gray: `#99A5BD`

Centralize them as `--lpl-navy`, `--lpl-orange`, and `--lpl-muted`. Navy serves actions, links, and selection; orange is an accent only. Check contrast and keyboard focus. Use [Midday file storage](https://midday.ai/file-storage/) only as layout inspiration for files, search, rows, cards, and previews—do not copy branding or imply a product integration.

## 5. Selected local-demo architecture

| Layer | Selection | Constraint |
| --- | --- | --- |
| Founder/advisor UI | React + TypeScript | Keep existing frontend directories; share safe DTOs/contracts |
| Backend | Python FastAPI running locally | Owns auth-like demo session, authorization, REST, WebSockets, AWS calls |
| Live updates | FastAPI WebSockets | Case-scoped chat, task progress, and case updates; authorize before subscribe |
| Orchestration | Strands Agents SDK for Python | One visible orchestrator calls registered specialist agents as tools; specialists stay hidden |
| AI | Amazon Bedrock via configured model/inference-profile ID | Verified 2026-10-03 via AWS CLI: `us.anthropic.claude-sonnet-5`; Haiku 4.5 handles bounded specialist tasks. See [role configuration and live checks](docs/bedrock-role-setup.md) |
| Files | Private Amazon S3 | Originals, extracted text, packet drafts/versions |
| Extraction | Amazon Textract | Validate supported types, store source/page evidence and extraction status |
| Records | PostgreSQL on Amazon RDS | Cases, facts, document catalog/version/status, tasks, messages, call/consent state, reviews |
| Calls | Amazon Chime SDK | Real founder/advisor calls after permissions and two-person test |
| Speech processing | Chime capture → Amazon Transcribe → Bedrock | Only after explicit participant consent; no live AI suggestions |

Run React clients and FastAPI locally for the demo. Lambda is a future migration requiring a deliberate redesign of hosting, workers, and WebSocket behavior; it is not a drop-in deployment promise. No sign-in is required for an isolated fictional demo, but a server-controlled, clearly labeled role switch must never become real authentication or a public unauthenticated deployment.

Current backend status: `backend/db/schema.sql` defines the initial PostgreSQL tables and `backend/app/core/config.py` provides `DB_*` settings. No database client, migrations runner or persistence queries are connected yet. The workflow below describes the target design.

## 6. Data, retrieval, and agent boundaries

S3 stores original documents, immutable drafts, and extracted text. The planned PostgreSQL repository stores the document catalog, version/hash, source locators, extraction status, facts, conflicts, tasks, messages, explicit sharing/consent, and version-bound reviews.

The demo does **not** use managed Bedrock Knowledge Bases. A backend-owned retrieval tool selects authorized extracted passages by case and document type from S3, applies case/permission filters, and returns exact citations. Document status alone is not RAG. Indexed passage search is a future scaling option only after relevance, isolation, cost, and operations decisions.

The Strands orchestrator exposes only registered specialists (extract, validate/conflict-check, clarify, draft packet, route advisor) as scoped tools. Each receives minimum authorized context and returns schema-validated proposals with evidence, unknowns, and next actions. Specialists cannot send messages, approve, grant access, choose arbitrary recipients, fetch arbitrary URLs, run shell commands, or modify credentials. Application code applies state transitions.

Treat document text and model output as untrusted. Every factual non-null claim needs a real source ID, hash, and page/field/row locator. Invalid structured output receives at most one constrained repair inside a bounded budget; failures block a visible task rather than fabricate results.

## 7. Calls, consent, and retention

Call capture is opt-in by every participant before capture starts; a call itself never enables capture. With consent, the Chime media-capture path writes media chunks to S3; concatenate and validate the resulting audio format before batch Amazon Transcribe, then Bedrock creates an **after-call** summary and proposed case changes. Humans review and explicitly confirm any proposed change before it affects case facts. No live AI suggestions are selected.

For this synthetic demo, delete captured audio and transcript after processing succeeds **and** the summary is confirmed. Track asset IDs, consent, processing state, deletion attempt/result, and expiration. On transcription, summary, confirmation, or deletion failure, retain only what is needed for a visible retry/cleanup task; do not silently discard unprocessed material, falsely claim deletion, or imply production compliance. Confirm actual Chime capture, Transcribe permissions/output, and a two-person call before calling the flow real.

## 8. Security and correctness

- Derive demo actor, role, tenant, case, and advisor authorization server-side. Role switching is loopback-only, clearly labeled, and disabled outside the isolated demo.
- Authorize every REST endpoint, WebSocket connection/message, source, preview, call action, event stream, and review. S3 keys use opaque IDs, not paths/names from users.
- Use short-lived constrained upload/download access; validate/hash canonical stored files. Reject unsupported, encrypted, image-only, malformed, or oversized uploads with useful errors.
- Persist task creation before work becomes claimable. Persist events before broadcasting; reconnects replay from a cursor.
- Keep packet versions immutable. PostgreSQL transactions, revision-checked updates and unique idempotency keys prevent duplicate jobs/sends. Approval is exact-version and rejects stale state.
- Log IDs, timings, statuses, and safe errors; exclude document bodies, financial values, chat contents, audio, transcripts, tokens, and presigned URLs.

## 9. Setup gates and definition of done

Before implementation, verify AWS identity/region, private S3 write/read, PostgreSQL connectivity, schema migrations and transaction/revision-conflict checks, Textract access, the exact successful Bedrock model or inference-profile ID and invocation permissions, Strands SDK compatibility, Chime permissions, Chime capture/Transcribe prerequisites, and two-person call setup. Do not create resources, expand permissions, or use real data without authorization.

The accepted demo session is a fictional business-owner packet: attachment upload in founder Home chat → one cited contradiction and one missing fact → task-first clarification → packet v1 in Documents → advisor source-linked review → returned questions → founder answer → packet v2 → exact-version approval. It must show the three AI states, prominent to-do/current activity, integrated human messaging, the dedicated Call view with separate capture consent, and at least one real AWS operation. No mock may be claimed as live AI, Textract, storage, or audio.

## References

- [Strands Agents Python quickstart](https://strandsagents.com/docs/user-guide/sdk/quickstart/python/)
- [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)
- [Amazon Bedrock inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html)
- [Amazon Chime SDK Media Pipelines](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_Operations_Amazon_Chime_SDK_Media_Pipelines.html)
- [Amazon S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [PostgreSQL concurrency control](https://www.postgresql.org/docs/current/mvcc.html)
