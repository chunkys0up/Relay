# Server-backed document packets

Normal app mode reads the owner-session packet workflow API. It does not seed packet state into IndexedDB. An unavailable backend produces a visible error; the app does not substitute fixture records.

The fictional examples are real PDF files with stored bytes, SHA-256 hashes, source metadata and packet stage history. Example content is explicitly synthetic. A sample review event is not evidence of a real advisor's approval.

## Persistence and service boundaries

The workflow repository owns case/session access, immutable packet bytes and stage events. Configured cloud mirroring stores PDFs in S3 and metadata in PostgreSQL. The UI reports cloud synchronization separately from local workflow persistence, so an unavailable cloud service cannot look like a completed upload.

A browser role switch does not authenticate an advisor. The founder moves the current PDF to **In review**, selects the originals to share, and creates a one-time invitation code tied to that packet ID and SHA-256 hash. The advisor accepts the code in a separate browser session. The server stores the resulting session grant and checks it for every shared case, original, and packet read. A different packet version makes the grant stale; the founder can revoke it. The advisor may approve or return questions on the exact current packet, and the review, note, opaque actor ID, hash, and stage event persist in the workflow database. Review notes are visible to the founder and the advisor who wrote them. The founder session cannot submit an advisor review. Existing separate advisor AI grants do not grant workflow case access.

This is session-based local sharing. Possession of an unredeemed invitation code lets another local session claim that advisor grant. The app does not establish a person's real identity or provide production account authentication. Pass invitation codes through a channel you trust, and revoke a grant when it is no longer needed.

## Verification loop

The bounded verification method is recorded in [PACKETS-LOOP.md](../PACKETS-LOOP.md). Required repository checks are supplemented by real HTTP packet import, exact-byte PDF checks, reload/stage persistence checks, ownership and stale-version rejection, and browser inspection.

Offline tests do not establish live S3/PostgreSQL success. Only verified cloud operations are reported as such.

## Use the packages

Run the unified backend from backend with .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 and the frontend with npm run dev -- --host 127.0.0.1. Open Home and choose **Load example packet cases**. The action stores four owner-scoped cases and eight actual PDF blobs; repeat clicks reuse those records. Select a company in **Packet case** to inspect its documents and progress. The examples are explicitly fictional, including the approved example.

The downloadable originals and manifest are in output/pdf/packet-packages. Regenerate them from the repository root with:

    PYTHONPATH=backend backend/.venv/bin/python -m app.workflow.example_packets --output output/pdf/packet-packages

Use **Upload original source** for evidence and **Import packet PDF** for an existing packet. Stage changes persist in backend history and require confirmation. Sharing requires the separate invitation action after the packet enters review. The advisor opens the advisor view in a different browser session, accepts the invitation, and records a review from Documents. A completed review is visible to the founder after reload.

## Cloud configuration

The unified backend reads its configured AWS profile, region, bucket and PostgreSQL settings. No credential values are stored in the examples or manifest. Each sync uploads immutable hash-addressed originals, downloads them again to verify SHA-256, and registers metadata and the matching case/document/draft IDs in PostgreSQL. Failed or unconfigured storage is displayed separately from locally saved workflow data. Use **Retry storage sync** after authentication is restored.

Workflow data is held in the configured RELAY_WORKFLOW_DB SQLite database (default backend/.relay/workflow.sqlite3 when started from backend). Session cookies scope local cases; switching browser profiles creates a different owner. This remains a loopback workflow, not production multi-user authentication.

## Checks

    cd backend && .venv/bin/python -m pytest -q
    npm run test -- --maxWorkers=2
    npm run typecheck
    npm run lint
    npm run build
    npx playwright test -c packets.integration.playwright.config.ts

The connected browser suite starts the actual unified HTTP app in an isolated offline environment. It checks uploads, exact bytes, stages, reloads, examples, missing-backend errors, and a two-session invitation, review, and revocation flow. It does not claim live AWS or AI execution.
