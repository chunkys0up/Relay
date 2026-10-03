"""One bounded synthetic smoke: unchanged founder evaluator plus advisor acceptance."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def advisor_check() -> None:
    with tempfile.TemporaryDirectory(prefix="relay-advisor-live-") as directory:
        os.chdir(directory)
        from fastapi.testclient import TestClient
        from app.workflow_app import create_workflow_app
        app = create_workflow_app(database_path=str(Path(directory) / "check.sqlite3"))
        with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50001)) as client:
            session_response = client.get("/api/advisor/session")
            assert session_response.status_code == 200, session_response.text
            session = session_response.json()
            workspace = session["workspace"]
            versions = workspace["versions"]
            assert len(versions) == 2, "Exactly two seeded authorized versions expected"
            base = f"/api/advisor/cases/{workspace['case_id']}"
            headers = {"X-CSRF-Token": session["csrf_token"]}

            def post(path: str, body: dict[str, Any], key: str | None = None) -> Any:
                return client.post(path, json=body, headers={**headers, "Idempotency-Key": key or str(uuid.uuid4())})

            def conversation(selected: list[dict[str, Any]]) -> str:
                response = post(base + "/conversations", {"versions": [{"id": v["id"], "hash": v["hash"]} for v in selected]})
                assert response.status_code in (200, 201), response.text
                return base + f"/conversations/{response.json()['conversation_id']}"

            single = conversation([versions[0]])
            key = str(uuid.uuid4())
            question = "What annual revenue values need review in this packet, and what reserve-target evidence is missing? Cite the selected version and relevant sources; do not resolve the conflict."
            response = post(single + "/messages", {"text": question}, key)
            assert response.status_code == 200, response.text
            trace = app.state.advisor_provider.last_trace
            assert trace["role"] == "orchestrator" and trace["tool_calls"], trace
            assert trace["model_id"] == os.environ["BEDROCK_ORCHESTRATOR_MODEL_ID"], trace
            print(json.dumps({"advisor_tool_trace": trace}), flush=True)
            state = response.json()
            answer = state["messages"][-1]
            assert answer["role"] == "assistant" and answer["citations"], answer
            content = answer["text"].lower()
            assert "240,000" in content and "280,000" in content, answer
            assert "reserve" in content and any(word in content for word in ("missing", "not provided", "awaiting", "unknown")), answer
            assert answer["kind"] == "conflict", answer
            for citation in answer["citations"]:
                assert citation["version_id"] == versions[0]["id"], citation
                preview = client.get(citation["url"])
                assert preview.status_code == 200, preview.text
                assert citation["quote"] in preview.text, citation
            replay = post(single + "/messages", {"text": question}, key)
            assert replay.status_code == 200 and replay.json()["messages"] == state["messages"]
            assert client.get(single).json()["messages"] == state["messages"]
            print("PASS live advisor: relevant cited revenue conflict + missing reserve, authorized previews, persisted idempotent replay", flush=True)
            print(json.dumps({"advisor_answer": answer}), flush=True)

            comparison = conversation(versions)
            response = post(comparison + "/messages", {"text": "Compare the annual revenue evidence in these two explicitly shared packet versions. Keep the old source conflict visible and cite each packet version."})
            assert response.status_code == 200, response.text
            print(json.dumps({"comparison_tool_trace": app.state.advisor_provider.last_trace}), flush=True)
            compared = response.json()["messages"][-1]
            assert compared["kind"] == "comparison", compared
            assert {c["version_id"] for c in compared["citations"]} == {v["id"] for v in versions}, compared
            assert "260,000" in compared["text"], compared
            for citation in compared["citations"]:
                assert client.get(citation["url"]).status_code == 200
            print("PASS live advisor: comparison cites both authorized versions", flush=True)
            print(json.dumps({"comparison_answer": compared}), flush=True)


def main() -> None:
    started = time.monotonic()
    import check_bedrock
    if "--advisor-only" not in sys.argv:
        check_bedrock.main()  # Original evaluator and every assertion remain unchanged.
    advisor_check()
    print(json.dumps({"result": "ADVISOR_PASS" if "--advisor-only" in sys.argv else "COMBINED_PASS", "elapsed_seconds": round(time.monotonic() - started, 2),
                      "advisor_model": os.environ["BEDROCK_ORCHESTRATOR_MODEL_ID"],
                      "region": os.environ["AWS_REGION"]}), flush=True)


if __name__ == "__main__":
    main()
