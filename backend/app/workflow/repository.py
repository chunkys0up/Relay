from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class WorkflowError(Exception):
    def __init__(self, code: str, status: int = 409) -> None:
        self.code = code
        self.status = status
        super().__init__(code)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


class Repository:
    """Local development record store. The deployment record store remains RDS."""

    def __init__(self, path: str) -> None:
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, csrf TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS session_roles (
                    session_id TEXT PRIMARY KEY, role TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL,
                    state TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS cases_owner ON cases(owner);
                CREATE TABLE IF NOT EXISTS blobs (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, kind TEXT NOT NULL,
                    body BLOB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    owner TEXT NOT NULL, case_id TEXT NOT NULL, operation TEXT NOT NULL,
                    key TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL,
                    PRIMARY KEY(owner, case_id, operation, key)
                );
                CREATE TABLE IF NOT EXISTS share_invites (
                    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
                    case_id TEXT NOT NULL, owner TEXT NOT NULL,
                    packet_id TEXT NOT NULL, packet_hash TEXT NOT NULL,
                    source_ids TEXT NOT NULL, created_at TEXT NOT NULL,
                    revoked INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS share_grants (
                    id TEXT PRIMARY KEY, invite_id TEXT NOT NULL UNIQUE,
                    case_id TEXT NOT NULL, advisor_session TEXT NOT NULL,
                    created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS grants_advisor ON share_grants(advisor_session, case_id);
            """)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def session(self, session_id: str) -> str | None:
        with self.connection() as conn:
            row = conn.execute("SELECT csrf FROM sessions WHERE id=?", (session_id,)).fetchone()
            return str(row["csrf"]) if row else None

    def create_session(self, session_id: str, csrf: str) -> None:
        with self.connection() as conn:
            conn.execute("INSERT INTO sessions(id, csrf) VALUES (?, ?)", (session_id, csrf))

    def recover_interrupted_jobs(self) -> int:
        """Mark orphaned in-flight work retryable after process restart."""
        changed = 0
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                rows = conn.execute("SELECT id,revision,state FROM cases").fetchall()
                for row in rows:
                    state = json.loads(row["state"])
                    affected = {job["id"] for job in state["jobs"]
                                if job["status"] in ("queued", "working")}
                    if not affected:
                        continue
                    for job in state["jobs"]:
                        if job["id"] in affected:
                            job["status"] = "blocked"
                            job["error"] = "INTERRUPTED_JOB"
                    for task in state["tasks"]:
                        if task["job_id"] in affected and task["state"] != "Done":
                            task["state"] = "Blocked"
                            task["detail"] = "INTERRUPTED_JOB"
                    state["ui_state"] = "Needs input"
                    state["activity"] = "Analysis was interrupted. Retry the task."
                    state["revision"] = row["revision"] + 1
                    conn.execute("UPDATE cases SET revision=?,state=? WHERE id=?",
                                 (state["revision"], canonical(state), row["id"]))
                    changed += 1
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return changed

    def create_case(self, owner: str, case_id: str, state: dict[str, Any]) -> None:
        with self.connection() as conn:
            conn.execute(
                "INSERT INTO cases(id, owner, revision, state) VALUES (?, ?, 0, ?)",
                (case_id, owner, canonical(state)),
            )

    def create_case_once(
        self, owner: str, key: str, request: dict[str, Any],
        case_id: str, state: dict[str, Any],
    ) -> dict[str, Any]:
        request_hash = hashlib.sha256(canonical(request).encode()).hexdigest()
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                prior = conn.execute(
                    "SELECT request_hash,response FROM idempotency WHERE "
                    "owner=? AND case_id='new' AND operation='create_case' AND key=?",
                    (owner, key),
                ).fetchone()
                if prior is not None:
                    if prior["request_hash"] != request_hash:
                        raise WorkflowError("IDEMPOTENCY_CONFLICT")
                    return json.loads(prior["response"])
                conn.execute("INSERT INTO cases VALUES (?,?,0,?)",
                             (case_id, owner, canonical(state)))
                conn.execute("INSERT INTO idempotency VALUES (?,?,?,?,?,?)",
                             (owner, "new", "create_case", key, request_hash,
                              canonical(state)))
                conn.execute("COMMIT")
                return state
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def list_cases(self, owner: str) -> list[dict[str, Any]]:
        with self.connection() as conn:
            rows = conn.execute("SELECT state FROM cases WHERE owner=? ORDER BY rowid DESC", (owner,))
            return [json.loads(row["state"]) for row in rows]

    def get_case(self, owner: str, case_id: str) -> dict[str, Any]:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT state FROM cases WHERE id=? AND owner=?", (case_id, owner)
            ).fetchone()
            if row is None:
                raise WorkflowError("NOT_FOUND", 404)
            return json.loads(row["state"])

    def blob(self, owner: str, case_id: str, blob_id: str, kind: str) -> bytes:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT b.body FROM blobs b JOIN cases c ON c.id=b.case_id "
                "WHERE b.id=? AND b.case_id=? AND b.kind=? AND c.owner=?",
                (blob_id, case_id, kind, owner),
            ).fetchone()
            if row is None:
                raise WorkflowError("NOT_FOUND", 404)
            return bytes(row["body"])

    def replay(
        self, owner: str, case_id: str, operation: str, key: str,
        request: dict[str, Any],
    ) -> dict[str, Any] | None:
        digest = hashlib.sha256(canonical(request).encode()).hexdigest()
        with self.connection() as conn:
            row = conn.execute(
                "SELECT request_hash,response FROM idempotency WHERE "
                "owner=? AND case_id=? AND operation=? AND key=?",
                (owner, case_id, operation, key),
            ).fetchone()
            if row is None:
                return None
            if row["request_hash"] != digest:
                raise WorkflowError("IDEMPOTENCY_CONFLICT")
            return json.loads(row["response"])

    def mutate(
        self, owner: str, case_id: str, operation: str, key: str,
        request: dict[str, Any], expected_revision: int | None,
        change: Callable[[dict[str, Any]], tuple[dict[str, Any], list[tuple[str, str, bytes]]]],
    ) -> dict[str, Any]:
        request_hash = hashlib.sha256(canonical(request).encode()).hexdigest()
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT revision, state FROM cases WHERE id=? AND owner=?", (case_id, owner)
                ).fetchone()
                if row is None:
                    raise WorkflowError("NOT_FOUND", 404)
                prior = conn.execute(
                    "SELECT request_hash, response FROM idempotency WHERE "
                    "owner=? AND case_id=? AND operation=? AND key=?",
                    (owner, case_id, operation, key),
                ).fetchone()
                if prior is not None:
                    if prior["request_hash"] != request_hash:
                        raise WorkflowError("IDEMPOTENCY_CONFLICT")
                    return json.loads(prior["response"])
                if expected_revision is not None and row["revision"] != expected_revision:
                    raise WorkflowError("STALE_REVISION")
                state = json.loads(row["state"])
                response, blobs = change(state)
                no_change = response.pop("_no_change", False)
                if no_change and blobs:
                    raise WorkflowError("INVALID_NOOP")
                state["revision"] = row["revision"] if no_change else row["revision"] + 1
                response["case_revision"] = state["revision"]
                if not no_change:
                    conn.execute(
                        "UPDATE cases SET state=?, revision=? WHERE id=?",
                        (canonical(state), state["revision"], case_id),
                    )
                for blob_id, kind, body in blobs:
                    conn.execute(
                        "INSERT INTO blobs(id,case_id,kind,body) VALUES (?,?,?,?)",
                        (blob_id, case_id, kind, body),
                    )
                conn.execute(
                    "INSERT INTO idempotency VALUES (?,?,?,?,?,?)",
                    (owner, case_id, operation, key, request_hash, canonical(response)),
                )
                conn.execute("COMMIT")
                return response
            except Exception:
                conn.execute("ROLLBACK")
                raise

    def update_job(
        self, owner: str, case_id: str, job_id: str,
        change: Callable[[dict[str, Any], dict[str, Any]], None],
        blobs: list[tuple[str, str, bytes]] | None = None,
    ) -> dict[str, Any]:
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT revision,state FROM cases WHERE id=? AND owner=?", (case_id, owner)
                ).fetchone()
                if row is None:
                    raise WorkflowError("NOT_FOUND", 404)
                state = json.loads(row["state"])
                job = next((j for j in state["jobs"] if j["id"] == job_id), None)
                if job is None:
                    raise WorkflowError("NOT_FOUND", 404)
                change(state, job)
                state["revision"] = row["revision"] + 1
                conn.execute(
                    "UPDATE cases SET state=?,revision=? WHERE id=?",
                    (canonical(state), state["revision"], case_id),
                )
                for blob_id, kind, body in blobs or []:
                    conn.execute("INSERT INTO blobs(id,case_id,kind,body) VALUES (?,?,?,?)",
                                 (blob_id, case_id, kind, body))
                conn.execute("COMMIT")
                return state
            except Exception:
                conn.execute("ROLLBACK")
                raise
