# Synthetic advisor packets in S3

The separate server advisor workspace can display real, synthetic PDF files backed by S3 and Amazon Textract. This does not merge the browser adapter, legacy PostgreSQL document catalog, or founder workflow into the advisor workspace.

## Import

From the repository root, first prepare the bounded seed records locally:

```sh
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/ingest_synthetic_packets.py --output /tmp/relay-synthetic-packets
```

With authorization for S3 writes and Textract analysis, use the existing AWS CLI login:

```sh
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/ingest_synthetic_packets.py \
  --output /tmp/relay-synthetic-packets \
  --database /home/tim/Relay/backend/.relay/workflow.sqlite3 \
  --upload-extract \
  --aws-cli /mnt/c/Users/timot/AppData/Local/Programs/Amazon/AWSCLIV2/aws.exe
```

Defaults: bucket `relay-documents-576248046713`, region `us-east-1`, profile `relay-hackathon`. All are explicit CLI options. The script reads no `.env` or credential files, installs nothing, and creates no IAM or infrastructure resources.

The importer generates three packet versions and four supporting synthetic source PDFs from a fresh copy of the advisor seed. S3 keys are content addressed under `synthetic-advisor/v1/<document-id>/<pdf-sha256>/`. Each prefix contains `original.pdf` and `textract.json`. Existing company demo sources and compatibility objects are not modified.

Each original is downloaded back and byte-verified before synchronous Textract `AnalyzeDocument` with `FORMS` and `TABLES`. Text lines, page numbers, confidence scores, detected fields and tables are retained for display; the full AWS response is retained in S3. Cached responses prevent repeated billable analysis for identical originals. The script rejects missing extraction and publishes the entire successful batch in one SQLite transaction. Failed batches may leave reusable S3 files, but do not partially change frontend data.

## Display and access

The existing advisor `/documents` endpoint adds extraction metadata and same-origin original links only after its existing assignment, exact-version/hash and source-grant checks. The UI displays extracted text, detected field/table details, and PDF metadata. Low-confidence text remains visible with confidence; extraction is not human confirmation of financial facts.

Original PDF routes recheck grants and hashes on every request. They serve the byte-verified S3 copy cached in SQLite, with no public S3 URL. They validate the cached PDF's SHA-256 before serving it. Reimport is the explicit S3 refresh path; viewing a document does not rerun extraction or silently synchronize bucket changes.

Version 3 and the private notes are materialized and extracted but remain unshared. Uploading to S3 does not grant advisor access. Version 1 and 2 retain their existing source grants. Imported text gets new hashes; requests/conversations pinned to old text must select the refreshed version rather than being silently reused.

Without an import, the existing offline seed remains available and is labeled as local seed text, not S3/Textract-backed evidence. This feature does not provide production identity or integrated founder-to-advisor sharing.

AWS API reference: https://docs.aws.amazon.com/textract/latest/APIReference/API_AnalyzeDocument.html

## Default sample data source

Normal app startup loads its initial packet/source snapshot from the imported advisor API evidence. It does not seed packet text, financial flags or sample messages from `fixtures.ts`. A missing service or incomplete import produces a load error; there is no silent fallback to hardcoded data. Identity and interaction state remain fictional demo data.

The connected browser adapter uses a separate IndexedDB and lock namespace derived from packet/source hashes. Reloading after a changed import selects the newly extracted dataset; prior local edits are preserved in their previous namespace. Browser-local reviews, drafts and human messaging remain simulated and do not grant access in the server advisor workspace. The fixed browser advisor ID is not the server session actor.

Intentional offline demos and existing browser regression suites set `VITE_PACKET_DATA_MODE=fixture`. Unit-test mode also keeps the isolated fixture adapter. This explicit mode is for simulated tests; it is not evidence of S3/Textract integration.
