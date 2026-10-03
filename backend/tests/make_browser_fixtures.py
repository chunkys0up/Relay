"""Generate deterministic fictional PDFs for the local workflow browser test.

Usage: .venv/bin/python tests/make_browser_fixtures.py [--output-dir /tmp]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


FORM_FIELDS = (
    ("company_name", "Company name", 44, 650, 27),
    ("founder_name", "Founder name", 44, 570, 27),
    ("business_summary", "Business summary", 4000, 415, 92),
    ("annual_revenue", "Annual revenue", 30, 325, 27),
    ("cash_reserve", "Cash reserve", 30, 240, 27),
    ("period", "Reporting period", 44, 155, 27),
)


def make_form(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1)
    pdf.setTitle("Relay fictional planning packet form")
    pdf.setAuthor("Relay fictional demo")
    pdf.setFillColor(colors.HexColor("#00205B"))
    pdf.rect(0, 780, 612, 12, fill=1, stroke=0)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(54, 744, "Northstar planning packet")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(54, 726, "Fictional demo form. Fill with confirmed values only.")
    for name, label, maxlen, y, height in FORM_FIELDS:
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#34445C"))
        pdf.drawString(54, y + height + 7, label)
        pdf.acroForm.textfield(
            name=name,
            tooltip=label,
            x=54,
            y=y,
            width=504,
            height=height,
            maxlen=maxlen,
            fontName="Helvetica",
            fontSize=11,
            fieldFlags="multiline" if name == "business_summary" else "",
            borderColor=colors.HexColor("#99A5BD"),
            fillColor=colors.white,
            textColor=colors.HexColor("#202C3D"),
            forceBorder=True,
        )
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#52627A"))
    pdf.drawString(54, 32, "Synthetic fixture - no real client or institutional form")
    pdf.showPage()
    pdf.save()


def make_source(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1)
    pdf.setTitle("Northstar fictional source evidence")
    pdf.setAuthor("Relay fictional demo")
    pages = (
        (
            "Northstar Cafe - 2026 operating statement",
            "Company: Northstar Cafe",
            "Founder: Zoe Rivera",
            "Business: Fictional neighborhood bakery preparing for seasonal growth.",
            "Reporting period: 2026",
            "Annual revenue: $125,000",
            "Cash reserve: Not stated in this source.",
        ),
        (
            "Northstar Cafe - 2026 founder planning note",
            "Company: Northstar Cafe",
            "Founder: Zoe Rivera",
            "Annual revenue estimate: $135,000",
            "This estimate conflicts with the operating statement on page 1.",
            "Cash reserve: Not stated in this source.",
        ),
    )
    for page_number, lines in enumerate(pages, 1):
        pdf.setFillColor(colors.HexColor("#00205B"))
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(54, 735, lines[0])
        pdf.setFont("Helvetica", 11)
        pdf.setFillColor(colors.black)
        for index, line in enumerate(lines[1:]):
            pdf.drawString(54, 690 - index * 28, line)
        pdf.setFont("Helvetica", 8)
        pdf.drawString(54, 34, f"Fictional evidence fixture - Page {page_number}")
        pdf.showPage()
    pdf.save()


def verify(form_path: Path, source_path: Path) -> None:
    form_reader = PdfReader(str(form_path), strict=True)
    assert set(form_reader.get_fields() or {}) == {name for name, _, _, _, _ in FORM_FIELDS}
    assert len(form_reader.pages) == 1
    source_reader = PdfReader(str(source_path), strict=True)
    assert len(source_reader.pages) == 2
    assert "$125,000" in source_reader.pages[0].extract_text()
    assert "$135,000" in source_reader.pages[1].extract_text()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp"))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    form_path = args.output_dir / "relay-workflow-form.pdf"
    source_path = args.output_dir / "relay-workflow-source.pdf"
    make_form(form_path)
    make_source(source_path)
    verify(form_path, source_path)
    print(form_path)
    print(source_path)


if __name__ == "__main__":
    main()
