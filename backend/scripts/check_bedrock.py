"""Explicitly billable synthetic end-to-end Bedrock check; never part of pytest."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    # The global app is imported in an isolated directory so no user's DB is opened.
    with tempfile.TemporaryDirectory(prefix="relay-live-check-") as directory:
        os.chdir(directory)
        from fastapi.testclient import TestClient
        from app.workflow_app import create_workflow_app
        from app.workflow.model import validated_proposals
        app = create_workflow_app(database_path=str(Path(directory) / "check.sqlite3"))
        provider = app.state.workflow_service.provider
        assert provider is not None, "Bedrock is not configured"
        started = time.monotonic()
        text = "Company: Synthetic Studio\nFounder: Ava\nSummary: Makes widgets\nAnnual revenue: $100,000\nCash reserve: $50,000\nPeriod: 2026"
        excerpt = {"source_id": "synthetic", "source_hash": hashlib.sha256(text.encode()).hexdigest(),
                   "page": 1, "text": text}
        extracted = provider.propose("Extract the six stated facts.", [excerpt])
        grounded = validated_proposals(extracted, [excerpt])
        assert {p["field"] for p in grounded} == {"company_name", "founder_name", "business_summary",
                                             "annual_revenue", "cash_reserve", "period"}
        print("PASS live extractor: six grounded fields", flush=True)
        with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000)) as client:
            session = client.get("/api/workflow/session").json()
            assert session["mode"] == "live", session
            headers = {"X-CSRF-Token": session["csrf_token"]}

            def post(path: str, body: dict[str, Any]) -> Any:
                return client.post(path, json=body, headers={**headers, "Idempotency-Key": str(uuid.uuid4())})

            response = post("/api/workflow/cases", {"company": "Synthetic Studio", "goal": "Prepare a packet"})
            assert response.status_code == 201, response.text
            state = response.json()
            base = f"/api/workflow/cases/{state['id']}"
            response = post(base + "/run", {"expected_revision": state["revision"],
                "goal": "Prepare a PDF preview using exactly these supplied facts:\n" + text})
            assert response.status_code == 202, response.text
            state = client.get(base).json()
            assert state["jobs"][-1]["error"] is None, state["jobs"][-1]
            assert {step["role"] for step in state["jobs"][-1]["agent_steps"]} == {
                "orchestrator", "reader", "writer", "verifier"}, state["jobs"][-1]
            action = state["pdf_actions"][-1]
            assert action["verification"]["passed"] is True
            assert action["verification"]["mode"] == "deterministic+agent"
            assert state["packets"] == [], "Must not save without confirmation"
            preview = client.get(base + f"/pdf-actions/{action['id']}/preview").content
            assert hashlib.sha256(preview).hexdigest() == action["hash"]
            response = post(base + f"/pdf-actions/{action['id']}/confirm", {
                "expected_revision": state["revision"], "preview_hash": action["hash"]})
            assert response.status_code == 200, response.text
            saved = client.get(base + f"/packets/{response.json()['packet_id']}/download").content
            assert saved == preview
            print("PASS live orchestrator -> reader -> writer -> verifier -> preview -> explicit confirmation -> identical PDF", flush=True)
        print(json.dumps({"result": "PASS", "elapsed_seconds": round(time.monotonic() - started, 2),
                          "models": {role: os.environ[f"BEDROCK_{role.upper()}_MODEL_ID"] for role in
                                     ["extractor", "orchestrator", "reader", "writer", "verifier"]}}))


if __name__ == "__main__":
    main()

