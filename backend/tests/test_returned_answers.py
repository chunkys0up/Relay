from __future__ import annotations

from hashlib import sha256
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.workflow.answers import confirm_answer, discard_answer, preview_answer
from app.workflow.documents import generate_packet_pdf
from app.workflow.packet_stages import import_packet, transition_packet
from app.workflow.repository import Repository, WorkflowError
from app.workflow.service import WorkflowService
from app.workflow.sharing import authorize_case, create_invite, redeem_invite, review_packet


def test_returned_review_requires_answered_new_pdf_before_resubmission(tmp_path: Path) -> None:
    repo = Repository(str(tmp_path / "workflow.sqlite3"))
    service = WorkflowService(repo, None)
    owner, advisor = "founder-session", "advisor-session"
    case = service.create_case(owner, "create", "Example Studio", "Review")
    original = generate_packet_pdf({"company_name": "Example Studio"}, 1)
    imported = import_packet(repo, owner, case["id"], 0, "import", "packet.pdf", original)
    packet_id, packet_hash = imported["packet_id"], imported["hash"]
    stage = transition_packet(repo, owner, case["id"], packet_id,
                              imported["case_revision"], packet_hash, "in_review", "stage")
    invite = create_invite(repo, owner, case["id"], packet_id, packet_hash,
                           [], stage["case_revision"], "invite")
    redeem_invite(repo, advisor, invite["invite_code"])
    returned = review_packet(repo, advisor, case["id"], packet_id, packet_hash,
                             stage["case_revision"], "questions_returned",
                             "Explain the revenue assumption.", "review")
    with pytest.raises(WorkflowError) as same_pdf:
        transition_packet(repo, owner, case["id"], packet_id,
                          returned["case_revision"], packet_hash, "in_review", "resubmit")
    assert same_pdf.value.code == "INVALID_STAGE_TRANSITION"
    with pytest.raises(WorkflowError) as wrong_hash:
        preview_answer(repo, owner, case["id"], packet_id, "0" * 64,
                       returned["review"]["id"], "Revenue reflects signed contracts.",
                       returned["case_revision"], "wrong")
    assert wrong_hash.value.code == "ORIGINAL_INTEGRITY_ERROR"
    preview = preview_answer(repo, owner, case["id"], packet_id, packet_hash,
                             returned["review"]["id"], "Revenue reflects signed contracts.",
                             returned["case_revision"], "preview")
    assert preview_answer(repo, owner, case["id"], packet_id, packet_hash,
                          returned["review"]["id"], "Revenue reflects signed contracts.",
                          returned["case_revision"], "preview") == preview
    proposed = repo.blob(owner, case["id"], preview["preview_id"], "answer_preview")
    assert sha256(proposed).hexdigest() == preview["preview_hash"]
    assert repo.blob(owner, case["id"], packet_id, "packet") == original
    pages = PdfReader(BytesIO(proposed), strict=True).pages
    assert len(pages) > 1
    appendix = "\n".join(page.extract_text() or "" for page in pages[1:])
    assert "Explain the revenue assumption." in appendix
    assert "Revenue reflects signed contracts." in appendix
    with pytest.raises(WorkflowError) as stale:
        confirm_answer(repo, owner, case["id"], preview["preview_id"],
                       preview["preview_hash"], returned["case_revision"], "stale")
    assert stale.value.code == "STALE_REVISION"
    alternate = preview_answer(repo, owner, case["id"], packet_id, packet_hash,
                               returned["review"]["id"], "A different proposed answer.",
                               preview["case_revision"], "alternate")
    discarded = discard_answer(repo, owner, case["id"], alternate["preview_id"],
                               alternate["preview_hash"], alternate["case_revision"], "discard")
    assert discarded["status"] == "discarded"
    assert discard_answer(repo, owner, case["id"], alternate["preview_id"],
                          alternate["preview_hash"], alternate["case_revision"], "discard") == discarded
    with pytest.raises(WorkflowError) as stale_preview:
        confirm_answer(repo, owner, case["id"], alternate["preview_id"],
                       alternate["preview_hash"], discarded["case_revision"], "confirm-discarded")
    assert stale_preview.value.code == "ANSWER_PREVIEW_NOT_CURRENT"
    saved = confirm_answer(repo, owner, case["id"], preview["preview_id"],
                           preview["preview_hash"], discarded["case_revision"], "confirm")
    assert confirm_answer(repo, owner, case["id"], preview["preview_id"],
                          preview["preview_hash"], discarded["case_revision"], "confirm") == saved
    state = service.snapshot(owner, case["id"])
    assert state["current_packet_id"] == saved["packet_id"]
    assert state["packets"][0]["stage"] == "questions_returned"
    assert state["packets"][1]["stage"] == "draft"
    assert state["packets"][1]["previous_packet_id"] == packet_id
    assert state["packets"][1]["returned_review_id"] == returned["review"]["id"]
    assert state["answers"][0]["packet_hash"] == packet_hash
    assert state["answers"][0]["new_packet_hash"] == saved["packet_hash"]
    assert repo.blob(owner, case["id"], saved["packet_id"], "packet") == proposed
    with pytest.raises(WorkflowError):
        authorize_case(repo, advisor, case["id"])
    new_stage = transition_packet(repo, owner, case["id"], saved["packet_id"],
                                  saved["case_revision"], saved["packet_hash"], "in_review", "new-stage")
    new_invite = create_invite(repo, owner, case["id"], saved["packet_id"],
                               saved["packet_hash"], [], new_stage["case_revision"], "new-invite")
    redeem_invite(repo, "new-advisor", new_invite["invite_code"])
    approved = review_packet(repo, "new-advisor", case["id"], saved["packet_id"],
                             saved["packet_hash"], new_stage["case_revision"],
                             "approved", "Response received.", "new-review")
    assert approved["stage"] == "approved"
    assert WorkflowService(Repository(repo.path), None).snapshot(owner, case["id"])["packets"][1]["stage"] == "approved"
