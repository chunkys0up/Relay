"""Small durable authorization store for the local synthetic advisor demo."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


CASE = "00000000-0000-4000-8000-000000000010"
ADVISOR = "00000000-0000-4000-8000-000000000002"
OTHER_ADVISOR = "00000000-0000-4000-8000-000000000003"
P1 = "00000000-0000-4000-8000-000000000021"
P2 = "00000000-0000-4000-8000-000000000022"
P3 = "00000000-0000-4000-8000-000000000023"
S1 = "00000000-0000-4000-8000-000000000011"
S2 = "00000000-0000-4000-8000-000000000012"
S3 = "00000000-0000-4000-8000-000000000013"
PRIVATE = "00000000-0000-4000-8000-000000000014"


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AdvisorError(Exception):
    def __init__(self, code: str, status: int = 409, retryable: bool = False) -> None:
        self.code, self.status, self.retryable = code, status, retryable
        super().__init__(code)


class AdvisorStore:
    """No browser role or document body participates in an authorization decision."""

    def __init__(self, path: str) -> None:
        self.path = str(Path(path).resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS advisor_sessions (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, csrf TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS advisor_assignments (
                    actor TEXT NOT NULL, case_id TEXT NOT NULL,
                    PRIMARY KEY(actor,case_id));
                CREATE TABLE IF NOT EXISTS advisor_packets (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, version INTEGER NOT NULL,
                    title TEXT NOT NULL, hash TEXT NOT NULL, body BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS advisor_sources (
                    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, name TEXT NOT NULL,
                    hash TEXT NOT NULL, body BLOB NOT NULL, locator TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS advisor_grants (
                    actor TEXT NOT NULL, case_id TEXT NOT NULL, packet_id TEXT NOT NULL,
                    packet_hash TEXT NOT NULL, source_id TEXT NOT NULL, source_hash TEXT NOT NULL,
                    PRIMARY KEY(actor,case_id,packet_id,source_id));
                CREATE TABLE IF NOT EXISTS advisor_conversations (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, case_id TEXT NOT NULL,
                    versions TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS advisor_messages (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
                    payload TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS advisor_requests (
                    actor TEXT NOT NULL, conversation_id TEXT NOT NULL, key TEXT NOT NULL,
                    request_hash TEXT NOT NULL, status TEXT NOT NULL, response TEXT,
                    error_code TEXT, PRIMARY KEY(actor,conversation_id,key));
                CREATE TABLE IF NOT EXISTS advisor_create_keys (
                    actor TEXT NOT NULL, case_id TEXT NOT NULL, key TEXT NOT NULL,
                    request_hash TEXT NOT NULL, conversation_id TEXT NOT NULL,
                    PRIMARY KEY(actor,case_id,key));
                CREATE TABLE IF NOT EXISTS advisor_meta (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """)
            if db.execute("SELECT 1 FROM advisor_meta WHERE key='seed_v1'").fetchone() is None:
                db.execute("BEGIN IMMEDIATE")
                try:
                    self._seed(db)
                    db.execute("INSERT INTO advisor_meta VALUES ('seed_v1','done')")
                    db.execute("COMMIT")
                except Exception:
                    db.execute("ROLLBACK")
                    raise
            # A restarted process never converts an orphaned request into success.
            db.execute("UPDATE advisor_requests SET status='failed',error_code='INTERRUPTED' "
                       "WHERE status='working'")

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def _seed(self, db: sqlite3.Connection) -> None:
        db.execute("INSERT OR IGNORE INTO advisor_assignments VALUES (?,?)", (ADVISOR, CASE))
        packets = [
            (P1, 1, "Founder planning packet", "1. Planning priorities\nConfirm near-term liquidity needs and keep personal and business planning connected.\n2. Source details to confirm\nReserve target: awaiting founder confirmation.\nAnnual revenue: intake shows $240,000; forecast shows $280,000 for 2026.\nConfirm the conflicting values before a new revision."),
            (P2, 2, "Founder planning packet", "1. Planning priorities\nConfirm near-term liquidity needs.\n2. Source details to confirm\nReserve target: awaiting founder confirmation.\nAnnual revenue: founder clarification reports $260,000 for 2026; intake and forecast still conflict and need review.\n3. Next step\nRequest source-backed confirmation."),
            (P3, 3, "Founder planning packet", "Private unshared later draft. Reserve target: $90,000. Do not expose to advisor."),
        ]
        sources = [
            (S1, "Founder intake.pdf", "Synthetic excerpt · page 2\n2026 annual revenue: $240,000\nReserve target: not provided.", {"page": 2}),
            (S2, "Cap table summary.xlsx", "Synthetic excerpt · Sheet 1, row 7\nAlex Morgan: 70%\nRemaining owners: 30%, attribution pending.", {"field": "Sheet 1, row 7"}),
            (S3, "Forecast assumptions.pdf", "Synthetic excerpt · page 1\n2026 annual revenue forecast: $280,000.", {"page": 1}),
            (PRIVATE, "Founder private notes.txt", "Private reserve target: $90,000. Never shared.", {"field": "private_note"}),
        ]
        for packet_id, version, title, content in packets:
            body = content.encode()
            db.execute("INSERT OR IGNORE INTO advisor_packets VALUES (?,?,?,?,?,?)",
                       (packet_id, CASE, version, title, digest(body), body))
        for source_id, name, content, locator in sources:
            body = content.encode()
            db.execute("INSERT OR IGNORE INTO advisor_sources VALUES (?,?,?,?,?,?)",
                       (source_id, CASE, name, digest(body), body, canonical(locator)))
        for packet_id in (P1, P2):
            packet = db.execute("SELECT hash FROM advisor_packets WHERE id=?", (packet_id,)).fetchone()
            for source_id in (S1, S2, S3):
                source = db.execute("SELECT hash FROM advisor_sources WHERE id=?", (source_id,)).fetchone()
                db.execute("INSERT OR IGNORE INTO advisor_grants VALUES (?,?,?,?,?,?)",
                           (ADVISOR, CASE, packet_id, packet["hash"], source_id, source["hash"]))

    def new_session(self, actor: str | None = None) -> tuple[str, str]:
        if actor is None:
            actor = secrets.token_urlsafe(24)
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.connection() as db:
            if actor != ADVISOR:
                db.execute("INSERT OR IGNORE INTO advisor_assignments VALUES (?,?)", (actor, CASE))
                db.execute("INSERT OR IGNORE INTO advisor_grants "
                           "SELECT ?,case_id,packet_id,packet_hash,source_id,source_hash "
                           "FROM advisor_grants WHERE actor=?", (actor, ADVISOR))
            db.execute("INSERT INTO advisor_sessions VALUES (?,?,?)", (sid, actor, csrf))
        return sid, csrf

    def session(self, sid: str) -> tuple[str, str] | None:
        with self.connection() as db:
            row = db.execute("SELECT actor,csrf FROM advisor_sessions WHERE id=?", (sid,)).fetchone()
            return (row["actor"], row["csrf"]) if row else None

    def assigned(self, actor: str, case_id: str) -> None:
        with self.connection() as db:
            row = db.execute("SELECT 1 FROM advisor_assignments WHERE actor=? AND case_id=?",
                             (actor, case_id)).fetchone()
            if row is None:
                raise AdvisorError("NOT_FOUND", 404)

    def versions(self, actor: str, case_id: str) -> list[dict[str, Any]]:
        self.assigned(actor, case_id)
        with self.connection() as db:
            rows = db.execute("SELECT DISTINCT p.id,p.version,p.title,p.hash FROM advisor_packets p "
                              "JOIN advisor_grants g ON g.packet_id=p.id AND g.packet_hash=p.hash "
                              "AND g.case_id=p.case_id "
                              "WHERE g.actor=? AND g.case_id=? ORDER BY p.version",
                              (actor, case_id)).fetchall()
            return [{**dict(row), "source_ids": [s["source_id"] for s in db.execute(
                "SELECT source_id FROM advisor_grants WHERE actor=? AND case_id=? AND packet_id=?",
                (actor, case_id, row["id"]))]} for row in rows]

    def scope(self, actor: str, case_id: str, versions: list[dict[str, str]]) -> dict[str, Any]:
        if not isinstance(versions, list) or not 1 <= len(versions) <= 2:
            raise AdvisorError("INVALID_VERSIONS", 400)
        if len({v.get("id") for v in versions if isinstance(v, dict)}) != len(versions):
            raise AdvisorError("INVALID_VERSIONS", 400)
        self.assigned(actor, case_id)
        with self.connection() as db:
            packets: list[dict[str, Any]] = []
            sources: dict[tuple[str, str], dict[str, Any]] = {}
            for selected in versions:
                if not isinstance(selected, dict) or set(selected) != {"id", "hash"}:
                    raise AdvisorError("INVALID_VERSIONS", 400)
                row = db.execute("SELECT id,version,title,hash,body FROM advisor_packets "
                                 "WHERE id=? AND case_id=? AND hash=?",
                                 (selected["id"], case_id, selected["hash"])).fetchone()
                if row is None or digest(row["body"]) != row["hash"]:
                    raise AdvisorError("STALE_CONTEXT")
                grants = db.execute("SELECT g.source_id,g.source_hash,s.name,s.body,s.locator,s.hash "
                                    "FROM advisor_grants g JOIN advisor_sources s ON s.id=g.source_id "
                                    "AND s.case_id=g.case_id "
                                    "WHERE g.actor=? AND g.case_id=? AND g.packet_id=? AND g.packet_hash=?",
                                    (actor, case_id, row["id"], row["hash"])).fetchall()
                if not grants:
                    raise AdvisorError("NOT_FOUND", 404)
                packets.append({"id": row["id"], "version": row["version"], "title": row["title"],
                                "hash": row["hash"], "text": row["body"].decode()})
                for source in grants:
                    if source["source_hash"] != source["hash"] or digest(source["body"]) != source["hash"]:
                        raise AdvisorError("STALE_CONTEXT")
                    sources[(row["id"], source["source_id"])] = {
                        "id": source["source_id"], "version_id": row["id"],
                        "hash": source["hash"], "name": source["name"],
                        "text": source["body"].decode(), "locator": json.loads(source["locator"]),
                    }
            return {"case_id": case_id, "versions": packets, "sources": list(sources.values())}

    def create_conversation(self, actor: str, case_id: str, versions: list[dict[str, str]], key: str) -> dict[str, Any]:
        self.scope(actor, case_id, versions)
        fingerprint = digest(canonical(versions).encode())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                prior = db.execute("SELECT request_hash,conversation_id FROM advisor_create_keys "
                                   "WHERE actor=? AND case_id=? AND key=?", (actor, case_id, key)).fetchone()
                if prior:
                    if prior["request_hash"] != fingerprint:
                        raise AdvisorError("IDEMPOTENCY_CONFLICT")
                    conversation_id = prior["conversation_id"]
                else:
                    conversation_id = secrets.token_urlsafe(24)
                    db.execute("INSERT INTO advisor_conversations VALUES (?,?,?,?,?)",
                               (conversation_id, actor, case_id, canonical(versions), now()))
                    db.execute("INSERT INTO advisor_create_keys VALUES (?,?,?,?,?)",
                               (actor, case_id, key, fingerprint, conversation_id))
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        return self.conversation(actor, case_id, conversation_id)

    def conversation(self, actor: str, case_id: str, conversation_id: str) -> dict[str, Any]:
        self.assigned(actor, case_id)
        with self.connection() as db:
            row = db.execute("SELECT versions,created_at FROM advisor_conversations "
                             "WHERE id=? AND actor=? AND case_id=?",
                             (conversation_id, actor, case_id)).fetchone()
            if row is None:
                raise AdvisorError("NOT_FOUND", 404)
            versions = json.loads(row["versions"])
            context = self.scope(actor, case_id, versions)
            messages = [json.loads(item["payload"]) for item in db.execute(
                "SELECT payload FROM advisor_messages WHERE conversation_id=? ORDER BY rowid",
                (conversation_id,))]
            self._authorize_history(context, messages)
            return {"conversation_id": conversation_id, "case_id": case_id,
                    "versions": versions, "created_at": row["created_at"], "messages": messages}

    @staticmethod
    def _authorize_history(context: dict[str, Any], messages: list[dict[str, Any]]) -> None:
        valid_packets = {(p["id"], p["hash"]) for p in context["versions"]}
        valid_sources = {(s["version_id"], s["id"], s["hash"])
                         for s in context["sources"]}
        for message in messages:
            for citation in message.get("citations", []):
                if not isinstance(citation, dict):
                    raise AdvisorError("NOT_FOUND", 404)
                version_id, source_id, source_hash = (citation.get("version_id"),
                                                       citation.get("source_id"),
                                                       citation.get("source_hash"))
                if ((source_id == version_id and (version_id, source_hash) in valid_packets)
                        or (version_id, source_id, source_hash) in valid_sources):
                    continue
                raise AdvisorError("NOT_FOUND", 404)

    def list_conversations(self, actor: str, case_id: str, versions: list[dict[str, str]]) -> list[dict[str, Any]]:
        self.scope(actor, case_id, versions)
        with self.connection() as db:
            ids = [row["id"] for row in db.execute(
                "SELECT id FROM advisor_conversations WHERE actor=? AND case_id=? AND versions=? "
                "ORDER BY created_at DESC", (actor, case_id, canonical(versions)))]
        return [self.conversation(actor, case_id, item) for item in ids]

    def begin_request(self, actor: str, case_id: str, conversation_id: str,
                      key: str, text: str) -> dict[str, Any] | None:
        self.conversation(actor, case_id, conversation_id)
        fingerprint = digest(text.encode())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                prior = db.execute("SELECT request_hash,status,error_code FROM advisor_requests "
                                   "WHERE actor=? AND conversation_id=? AND key=?",
                                   (actor, conversation_id, key)).fetchone()
                if prior:
                    if prior["request_hash"] != fingerprint:
                        raise AdvisorError("IDEMPOTENCY_CONFLICT")
                    if prior["status"] == "working":
                        raise AdvisorError("REQUEST_IN_PROGRESS", 409, True)
                    if prior["status"] == "done":
                        db.execute("COMMIT")
                        return self.conversation(actor, case_id, conversation_id)
                if db.execute("SELECT 1 FROM advisor_requests WHERE conversation_id=? AND status='working'",
                              (conversation_id,)).fetchone():
                    raise AdvisorError("CONVERSATION_BUSY", 409, True)
                if db.execute("SELECT COUNT(*) AS n FROM advisor_requests WHERE status='working'").fetchone()["n"] >= 2:
                    raise AdvisorError("CAPACITY_BUSY", 429, True)
                if prior:
                    db.execute("UPDATE advisor_requests SET status='working',error_code=NULL "
                               "WHERE actor=? AND conversation_id=? AND key=?",
                               (actor, conversation_id, key))
                else:
                    db.execute("INSERT INTO advisor_requests VALUES (?,?,?,?,?,?,?)",
                               (actor, conversation_id, key, fingerprint, "working", None, None))
                db.execute("COMMIT")
                return None
            except Exception:
                db.execute("ROLLBACK")
                raise

    def finish_request(self, actor: str, case_id: str, conversation_id: str,
                       key: str, question: str, answer: dict[str, Any]) -> dict[str, Any]:
        # Reauthorize all material before persistence and attachment of links.
        self.conversation(actor, case_id, conversation_id)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute("SELECT versions FROM advisor_conversations WHERE id=? "
                                 "AND actor=? AND case_id=?",
                                 (conversation_id, actor, case_id)).fetchone()
                if row is None:
                    raise AdvisorError("NOT_FOUND", 404)
                # Write lock excludes grant revocation until answer persistence commits.
                fresh = self.scope(actor, case_id, json.loads(row["versions"]))
                self._authorize_history(fresh, [answer])
                row = db.execute("SELECT status FROM advisor_requests WHERE actor=? AND conversation_id=? AND key=?",
                                 (actor, conversation_id, key)).fetchone()
                if row is None or row["status"] != "working":
                    raise AdvisorError("INTERRUPTED", 503, True)
                timestamp = now()
                user = {"id": secrets.token_urlsafe(16), "role": "user", "text": question,
                        "created_at": timestamp, "citations": [], "request_key": key}
                assistant = {"id": secrets.token_urlsafe(16), "role": "assistant",
                             "created_at": now(), "request_key": key, **answer}
                for message in (user, assistant):
                    db.execute("INSERT INTO advisor_messages VALUES (?,?,?,?,?)",
                               (message["id"], conversation_id, message["role"], canonical(message),
                                message["created_at"]))
                db.execute("UPDATE advisor_requests SET status='done',response=? "
                           "WHERE actor=? AND conversation_id=? AND key=?",
                           (canonical(assistant), actor, conversation_id, key))
                db.execute("COMMIT")
            except Exception:
                db.execute("ROLLBACK")
                raise
        return self.conversation(actor, case_id, conversation_id)

    def fail_request(self, actor: str, conversation_id: str, key: str, code: str) -> None:
        with self.connection() as db:
            db.execute("UPDATE advisor_requests SET status='failed',error_code=? "
                       "WHERE actor=? AND conversation_id=? AND key=? AND status='working'",
                       (code, actor, conversation_id, key))

    def revoke(self, actor: str, case_id: str, packet_id: str) -> None:
        with self.connection() as db:
            db.execute("DELETE FROM advisor_grants WHERE actor=? AND case_id=? AND packet_id=?",
                       (actor, case_id, packet_id))
