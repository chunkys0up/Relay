from __future__ import annotations

from hashlib import sha256
from io import BytesIO

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, TextStringObject
from reportlab.pdfgen import canvas

from app.workflow.documents import fill_pdf_form, generate_packet_pdf
from app.workflow.pdf_verification import MAX_PDF_BYTES, inspect_pdf


def _packet_text_pdf(lines: list[str]) -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output)
    for index, line in enumerate(lines):
        document.drawString(60, 730 - 20 * index, line)
    document.save()
    return output.getvalue()


def _form_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output)
    document.acroForm.textfield(name="company_name", x=72, y=690, width=250, height=24)
    document.acroForm.textfield(name="period", x=72, y=650, width=250, height=24)
    document.showPage()
    document.save()
    return output.getvalue()


def _rewrite(pdf: bytes, edit: str) -> bytes:
    writer = PdfWriter()
    writer.clone_document_from_reader(PdfReader(BytesIO(pdf)))
    widget = writer.pages[0]["/Annots"][0].get_object()
    if edit == "value":
        widget[NameObject("/V")] = TextStringObject("Wrong")
    elif edit == "appearance":
        del widget[NameObject("/AP")]
    elif edit == "appearance_text":
        appearance = widget["/AP"]
        original = appearance["/N"].get_object()
        replacement = DecodedStreamObject()
        for key, value in original.items():
            if key not in {"/Filter", "/Length"}:
                replacement[key] = value
        data = original.get_data()
        assert b"(Northstar) Tj" in data
        replacement.set_data(data.replace(b"(Northstar) Tj", b"(Oldname) Tj"))
        appearance[NameObject("/N")] = writer._add_object(replacement)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_generated_packet_verifies_actual_labelled_values() -> None:
    fields = {
        "company_name": "Northstar Café",
        "founder_name": "Ada Lovelace",
        "business_summary": "Plans to grow steadily.",
        "annual_revenue": "500",
        "cash_reserve": "50.00",
        "period": "Q2 2026",
    }
    pdf = generate_packet_pdf(fields, 3)
    result = inspect_pdf(pdf, fields)
    assert result["passed"] is True
    assert result["hash"] == sha256(pdf).hexdigest()
    assert result["fields"]["annual_revenue"] == "$500.00"
    assert result["fields"]["cash_reserve"] == "$50.00"
    assert "labelled_packet_fields" in result["checks"]


def test_packet_long_summary_crosses_pages() -> None:
    summary = "Café owners plan growth. " * 250
    pdf = generate_packet_pdf({"business_summary": summary, "annual_revenue": "12500"}, 2)
    assert inspect_pdf(pdf, {"business_summary": summary, "annual_revenue": "12,500.00"})["passed"]


@pytest.mark.parametrize(
    ("lines", "fields"),
    [
        (["Company", "Northstar", "Founder", "Ada"], {"company_name": "Other"}),
        (["Annual revenue", "$50.00", "Cash reserve", "$500.00"], {"annual_revenue": "500", "cash_reserve": "50"}),
        (["Annual revenue", "$500.00"], {"annual_revenue": "50"}),
        (["Annual revenue", "$500.00"], {"annual_revenue": "500", "cash_reserve": "500"}),
        (["Company", "Northstar", "Company", "Northstar"], {"company_name": "Northstar"}),
    ],
)
def test_packet_rejects_missing_wrong_or_ambiguous_fields(lines: list[str], fields: dict[str, str]) -> None:
    with pytest.raises(ValueError, match="PDF_FIELD_"):
        inspect_pdf(_packet_text_pdf(lines), fields)


def test_filled_form_verifies_canonical_values_and_appearances() -> None:
    pdf = fill_pdf_form(_form_pdf(), {"company_name": "Northstar", "period": "Q2 2026"})
    result = inspect_pdf(pdf, {"company_name": "Northstar", "period": "Q2 2026"}, ["company_name", "period"])
    assert result["passed"] is True
    assert result["fields"] == {"company_name": "Northstar", "period": "Q2 2026"}
    assert "widget_appearance_text" in result["checks"]
    with pytest.raises(ValueError, match="PDF_FIELD_MISMATCH"):
        inspect_pdf(pdf, {"company_name": "Wrong"}, ["company_name"])
    with pytest.raises(ValueError, match="PDF_FIELD_MISSING"):
        inspect_pdf(pdf, {"missing": "x"}, ["missing"])


@pytest.mark.parametrize("edit", ["value", "appearance"])
def test_form_rejects_tampered_widget(edit: str) -> None:
    pdf = fill_pdf_form(_form_pdf(), {"company_name": "Northstar"})
    with pytest.raises(ValueError, match="PDF_"):
        inspect_pdf(_rewrite(pdf, edit), {"company_name": "Northstar"}, ["company_name"])


def test_form_rejects_stale_but_nonempty_appearance_text() -> None:
    pdf = fill_pdf_form(_form_pdf(), {"company_name": "Northstar"})
    tampered = _rewrite(pdf, "appearance_text")
    reader = PdfReader(BytesIO(tampered))
    assert reader.get_fields()["company_name"].get("/V") == "Northstar"
    widget = reader.pages[0]["/Annots"][0].get_object()
    normal = widget["/AP"]["/N"].get_object()
    assert reader.pages[0].extract_xform_text(normal) == "Oldname"
    with pytest.raises(ValueError, match="PDF_FORM_APPEARANCE_MISMATCH"):
        inspect_pdf(tampered, {"company_name": "Northstar"}, ["company_name"])


@pytest.mark.parametrize("value", ["Northstar Café", r"A (B)\C", "Ada & Zoë"])
def test_appearance_text_preserves_unicode_and_escaped_characters(value: str) -> None:
    pdf = fill_pdf_form(_form_pdf(), {"company_name": value})
    assert inspect_pdf(pdf, {"company_name": value}, ["company_name"])["passed"]


@pytest.mark.parametrize("pdf", [b"garbage", b"%PDF-broken", b"%PDF-" + b"x" * MAX_PDF_BYTES])
def test_rejects_invalid_pdf(pdf: bytes) -> None:
    with pytest.raises(ValueError, match="PDF_INVALID"):
        inspect_pdf(pdf, {"company_name": "Northstar"})
