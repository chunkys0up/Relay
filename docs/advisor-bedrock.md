# Server synthetic advisor workspace

The Advisor Clients screen offers a server synthetic workspace alongside the browser demo. It is served by `app.main` on loopback and uses its own SQLite-backed assignments, exact packet/source grants, conversations and idempotency records. It does not import browser grants, founder uploads, legacy Postgres/S3 documents or owner-scoped founder workflow cases.

## Use

Start the local workflow service and Vite app using the existing project setup; see [founder workflow setup](bedrock-workflow.md) for the loopback service command and dependency requirements. The advisor API is mounted on the same port, normally 8000. Open Advisor → Clients and choose **Open server synthetic advisor workspace**. Without `BEDROCK_ORCHESTRATOR_MODEL_ID`, session and packet previews remain available while chat reports that its model is not configured.

The advisor mode comes from the server, not the browser role selector. The server issues an HttpOnly session cookie and CSRF token. Mutations require same-origin/loopback checks and idempotency keys. Each fresh synthetic session receives its own actor and private conversation history.

## Evidence and action limits

- The seed contains two granted packet versions, one later unshared version, and one private source for authorization checks.
- Each conversation is tied to one or two exact packet IDs and hashes. List/read tools and packet/source preview routes re-check the server-owned assignment and grants.
- The read-only model can list shared versions, read an authorized packet, and read an authorized source. The service validates output shape, citation hashes/quotes, and that cited evidence was actually read. Unknowns and conflicts remain explicit; model reasoning is not exposed.
- The chat can answer questions, compare two selected shared versions, or create editable private follow-up drafts. It cannot approve, save packets, change grants, share documents, send questions, or contact a client. Browser demo review controls remain a separate simulated workflow.
- Work is bounded to two active requests (one per conversation), four model turns, eight tool calls, 4096 output tokens and 60 seconds. There is no autonomous revision loop or model-side action tool.
- The model is optional. The environment variable `BEDROCK_ORCHESTRATOR_MODEL_ID` enables the advisor provider. The founder multi-agent workflow has separate role settings. A configured model is not evidence of account access or live quality.

This loopback synthetic service is not production authentication or an integrated handoff. The legacy case/chat/document API continues to use caller-supplied case IDs and does not gain advisor grant enforcement from this service. Live calls and AWS model checks are separate operations; ordinary automated tests do not prove them.

See [implemented transport boundaries](api-contract.md), [multi-agent workflow](multiagent-workflow.md), and [specs](../specs.md).
