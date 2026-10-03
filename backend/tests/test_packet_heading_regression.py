from io import BytesIO
from pypdf import PdfReader
from app.workflow.documents import generate_packet_pdf


def test_packet_heading_does_not_claim_an_unrelated_company() -> None:
    pdf = generate_packet_pdf({"company_name": "Computer Check Studio"}, 1)
    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    assert "Relay · Planning packet" in text
    assert "Computer Check Studio" in text
    assert "Northstar" not in text
