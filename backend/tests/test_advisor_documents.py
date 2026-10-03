from pathlib import Path

from app.advisor.store import CASE, P1, S1
from test_advisor import client


def test_documents_are_exact_grant_scoped_and_rechecked(tmp_path: Path) -> None:
    browser, store, session = client(tmp_path)
    version = session["workspace"]["versions"][0]
    url = f"/api/advisor/cases/{CASE}/packets/{P1}/documents"
    params = {"packet_hash": version["hash"]}
    response = browser.get(url, params=params)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert data["versions"][0]["id"] == P1
    assert {s["id"] for s in data["sources"]} == set(version["source_ids"])
    assert "$240,000" in data["versions"][0]["text"]
    assert browser.get(url, params={"packet_hash": "f" * 64}).status_code == 409
    assert browser.get(url.replace(CASE, "unassigned"), params=params).status_code == 404
    actor = session["workspace"]["advisor"]["id"]
    with store.connection() as db:
        db.execute("DELETE FROM advisor_grants WHERE actor=? AND packet_id=? AND source_id=?", (actor, P1, S1))
    updated = browser.get(url, params=params)
    assert updated.status_code == 200
    assert S1 not in {s["id"] for s in updated.json()["sources"]}
    with store.connection() as db:
        db.execute("DELETE FROM advisor_grants WHERE actor=? AND packet_id=?", (actor, P1))
    assert browser.get(url, params=params).status_code == 404
    browser.cookies.clear()
    assert browser.get(url, params=params).status_code == 401
