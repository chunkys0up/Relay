"""Create a short, fictional planning packet PDF for a case, upload it to S3 and register it as the next version.

Run from backend/:  uv run python -m scripts.create_demo_packet [case_id]
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from io import BytesIO
from uuid import UUID

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.db.case_records import log_activity
from app.db.packets import create_packet
from app.db.pool import close_pool, init_pool
from app.storage.s3 import build_key, upload_bytes

NORTHSTAR = UUID("22222222-2222-2222-2222-222222222222")
NAVY = colors.HexColor("#00205B")
MUTED = colors.HexColor("#5B6B86")
RULE = colors.HexColor("#DCE4EF")

styles = getSampleStyleSheet()
TITLE = ParagraphStyle("title", parent=styles["Title"], alignment=0, textColor=NAVY, fontSize=24, leading=28, spaceAfter=4)
SUB = ParagraphStyle("sub", parent=styles["Normal"], textColor=MUTED, fontSize=10.5, leading=14, spaceAfter=18)
H2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=NAVY, fontSize=14, leading=18, spaceBefore=14, spaceAfter=6)
BODY = ParagraphStyle("body", parent=styles["Normal"], fontSize=10.5, leading=15, spaceAfter=6)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=9, leading=12, textColor=MUTED)


def _table(rows: list[list[str]], widths: list[float]) -> Table:
    table = Table([[Paragraph(cell, BODY) for cell in row] for row in rows], colWidths=widths, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF3FA")),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def _footer(canvas, doc) -> None:  # noqa: ANN001 - reportlab callback signature
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(inch, 0.6 * inch, "Northstar Labs · Founder planning packet v1 · Fictional demo data, not financial advice")
    canvas.drawRightString(LETTER[0] - inch, 0.6 * inch, f"Page {doc.page} of 3")
    canvas.restoreState()


def build_pdf() -> bytes:
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=LETTER, leftMargin=inch, rightMargin=inch, topMargin=0.9 * inch, bottomMargin=0.9 * inch,
                            title="Northstar Labs · Founder planning packet v1", author="Relay")
    story = [
        Paragraph("Northstar Labs", TITLE),
        Paragraph("Founder planning packet · v1 · Prepared by Relay for Maya Chen, financial advisor", SUB),
        Paragraph("1. Summary", H2),
        Paragraph("Alex Morgan founded Northstar Labs, a Delaware C-corporation building logistics analytics software for "
                  "mid-size freight brokers. The company is seed-stage with paying pilot customers. This packet gathers "
                  "the founder's business and personal financial picture so the advisor can review it in one place.", BODY),
        Paragraph("2. Goals for the advisor review", H2),
        Paragraph("• Set a cash reserve target for the business and a separate personal emergency fund.", BODY),
        Paragraph("• Confirm the founder's equity position and the tax treatment of founder shares.", BODY),
        Paragraph("• Plan founder compensation for 2026 as revenue grows.", BODY),
        Paragraph("3. Company profile", H2),
        _table([
            ["Item", "Detail"],
            ["Legal entity", "Northstar Labs, Inc. (Delaware C-corp), formed March 2024"],
            ["Founder", "Alex Morgan, CEO, about 70% of common stock"],
            ["Team", "4 full-time employees, 2 contractors"],
            ["Customers", "6 paying pilot customers on annual contracts"],
        ], [1.6 * inch, 4.9 * inch]),
        PageBreak(),
        Paragraph("4. Financial snapshot", H2),
        Paragraph("Figures come from the founder's uploaded financial draft and invoices. Forecasts are the founder's estimates.", SMALL),
        _table([
            ["Measure", "Value", "Note"],
            ["2025 revenue", "$240,000", "Annual contract value from pilot customers"],
            ["2026 revenue forecast", "$280,000", "Assumes two pilots convert to full contracts"],
            ["Monthly operating costs", "$18,500", "Payroll is about 70% of spend"],
            ["Business cash on hand", "$310,000", "Includes the remaining seed round"],
            ["Runway", "About 16 months", "At current spend with no new revenue"],
            ["Founder salary", "$85,000 per year", "Below market; deferred raise planned"],
        ], [1.9 * inch, 1.4 * inch, 3.2 * inch]),
        Paragraph("5. Ownership", H2),
        _table([
            ["Holder", "Ownership", "Status"],
            ["Alex Morgan (founder)", "About 70%", "Vesting over 4 years with a 1-year cliff"],
            ["Seed investors", "About 22%", "SAFE converted at the seed round"],
            ["Employee option pool", "About 8%", "Reserved; partly granted"],
        ], [2.1 * inch, 1.3 * inch, 3.1 * inch]),
        Paragraph("A current cap table has not been uploaded yet, so these percentages are the founder's summary.", SMALL),
        PageBreak(),
        Paragraph("6. Planning priorities", H2),
        Paragraph("• <b>Cash reserve.</b> Keep at least 9 months of operating costs (about $166,500) in the business account.", BODY),
        Paragraph("• <b>Personal emergency fund.</b> Build 6 months of personal expenses separate from company funds.", BODY),
        Paragraph("• <b>Founder shares.</b> Confirm the 83(b) election was filed and whether the shares may qualify for QSBS.", BODY),
        Paragraph("• <b>Compensation.</b> Decide the salary step-up once 2026 revenue passes $280,000.", BODY),
        Paragraph("7. Documents on file and still needed", H2),
        _table([
            ["Document", "Status"],
            ["Articles of Incorporation", "Received"],
            ["Founder financial draft and customer invoices", "Received"],
            ["EIN confirmation letter", "Still needed"],
            ["Current cap table", "Still needed"],
            ["Founders' agreement and IP assignment agreements", "Still needed"],
            ["Bylaws", "Still needed"],
        ], [4.3 * inch, 2.2 * inch]),
        Paragraph("8. Questions for the advisor", H2),
        Paragraph("1. Is a 9-month business reserve the right target at this stage?", BODY),
        Paragraph("2. Which records should the founder keep to support a future QSBS claim?", BODY),
        Paragraph("3. How should the founder balance personal savings against reinvesting in the company?", BODY),
    ]
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return out.getvalue()


async def main(case_id: UUID) -> None:
    await init_pool()
    try:
        data = build_pdf()
        key = build_key(case_id, uuid.uuid4(), "Founder planning packet.pdf")
        upload_bytes(data, key, "application/pdf")
        packet = await create_packet(case_id, key)
        await log_activity(case_id, "agent", f"Prepared planning packet v{packet['version']} for advisor review")
        print(f"packet v{packet['version']} {packet['id']} -> s3://{key} ({len(data)} bytes)")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main(UUID(sys.argv[1]) if len(sys.argv) > 1 else NORTHSTAR))
