# Advisor Bedrock chat

This is a loopback-only synthetic advisor workspace in `app.workflow_app`, alongside the separate founder packet workflow. It is not production authentication and does not import browser grants, founder uploads, private founder messages, or the legacy Postgres/S3 catalog.

In Advisor → Clients, open the server synthetic advisor workspace. The packet shown in the central preview and the chat version selector come from the server's exact-version grants. Browser demo review controls remain available in browser demo mode. Server chat cannot approve, save, share, submit, or send. Follow-up questions are editable private drafts; external delivery is not implemented.

## Run with existing dependencies

Use the existing nonsecret Bedrock configuration and Windows credential bridge:

```bash
cd /home/tim/Relay-worktrees/advisor-bedrock-loop/backend
.venv/bin/python scripts/run_bedrock.py serve --config /home/tim/Relay/backend/.relay/bedrock.json --port 8029
```

In another terminal:

```bash
cd /home/tim/Relay-worktrees/advisor-bedrock-loop
npm run dev -- --config ../advisor.vite.config.ts --port 5200
```

Open `http://127.0.0.1:5200/advisor/clients`. These ports and Vite cache are separate from the existing demo server. The advisor API uses a same-origin `/api/advisor` proxy. No package installation is part of this task.

## Boundaries

- The server issues a separate HttpOnly advisor cookie and CSRF token. New browser sessions receive distinct synthetic actors and their own private histories. Local-storage role selection grants no API access.
- The local SQLite store owns assignments, immutable packet/source bytes and hashes, exact-version grants, conversations and idempotency records. The first synthetic seed includes two granted versions, a later unshared version and a private source for negative tests.
- Every conversation read, tool retrieval, final response and citation preview checks the server-owned scope. Source links resolve through advisor-authorized preview routes, never the generic document presign API.
- The advisor uses one Sonnet orchestrator with read-only tools. Reader/writer/verifier model roles are unnecessary for this read-only chat. The existing founder PDF workflow retains its extractor/orchestrator/reader/writer/verifier roles and explicit confirmation gates.
- Advisor request limits: two active model jobs maximum, one per conversation; four model turns, eight tool calls, 4096 output tokens, sixty seconds. No automatic open-ended retry and no model-side action tools.
- Responses are released only after structured evidence validation, including actual reads and exact source/version hashes. Unknowns and conflicts must remain explicit. No hidden model reasoning is exposed.

## Verification

`LOOP.md` contains the fixed acceptance contract and stop rules. `ADVISOR-VERIFICATION-LOG.md` records attempts. `ADVISOR-RESULTS.md` records actual final verification and limitations.

The original live founder evaluator remains unchanged. The combined `backend/scripts/check_advisor_bedrock.py` runs it, then checks a cited advisor answer covering missing/conflicting evidence and a comparison of two authorized versions. `run_advisor_check.py` reuses the unchanged launcher credential bridge. Running its `check` command is billable and consumes one of the explicitly authorized smoke attempts; do not run it beyond the loop allowance. Its `preflight` command performs only identity/catalog reads.

Current loop status: advisor live checks passed; founder live PDF check failed WRITER_REQUIRED twice. All three authorized smoke attempts are consumed. The explicit advisor-only harness mode was used for the final independent check; it does not claim combined acceptance. Further billable checks require a new allowance. See ADVISOR-RESULTS.md.


Follow-up resolution: the subsequent explicitly authorized Sol writer loop passed the unchanged live founder evaluator. Final writer details and bounds (nine writer turns, existing tool/token/time limits) are in ../WRITER-RESULTS.md. Two of three fresh attempts were used and testing stopped on success. The earlier incomplete status above is historical.
