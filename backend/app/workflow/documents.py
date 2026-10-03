"""Bounded source extraction and PDFs made only from confirmed fields.

Source text is evidence, never an instruction to this module or its callers.
The caller must authorize the source and confirm packet fields separately.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from html import escape
from io import BytesIO
import re
from typing import Any, Protocol

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, IndirectObject
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer


MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 30
MAX_TEXT_CHARS = 2_000_000
MAX_LINES = 20_000
MAX_FIELD_CHARS = 4_000
_MONEY = re.compile(r"^\$?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$")
_PACKET_FIELDS = {
    "company_name": "Company",
    "founder_name": "Founder",
    "business_summary": "Business summary",
    "annual_revenue": "Annual revenue",
    "cash_reserve": "Cash reserve",
    "period": "Reporting period",
}
_FONT = "Helvetica"
_FONT_FILE = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


@dataclass(frozen=True, slots=True)
class Excerpt:
    source_id: str
    source_hash: str
    page: int
    text: str


class TextractClient(Protocol):
    def detect_document_text(self, *, Document: dict[str, bytes]) -> dict[str, Any]: ...


def _source_context(source_id: str, source_hash: str) -> None:
    if not isinstance(source_id, str) or not source_id or len(source_id) > 128:
        raise ValueError("A valid source ID is required")
    if not re.fullmatch(r"[0-9a-f]{64}", source_hash):
        raise ValueError("A valid source hash is required")


def _check_source(data: bytes, source_id: str) -> str:
    if not isinstance(data, bytes) or not data or len(data) > MAX_SOURCE_BYTES:
        raise ValueError("Source is empty or exceeds the 10 MB limit")
    digest = sha256(data).hexdigest()
    _source_context(source_id, digest)
    return digest


def _bounded_lines(text: str, source_id: str, source_hash: str, page: int) -> list[Excerpt]:
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError("Extracted text exceeds the limit")
    lines = text.splitlines()
    if len(lines) > MAX_LINES:
        raise ValueError("Source contains too many text lines")
    return [Excerpt(source_id, source_hash, page, line.strip()) for line in lines if line.strip()]


def extract_document(data: bytes, filename: str, content_type: str, source_id: str) -> list[Excerpt]:
    """Extract newline-bound, page-linked text; ignore the untrusted filename."""
    del filename
    source_hash = _check_source(data, source_id)
    media_type = content_type.split(";", 1)[0].strip().lower() if isinstance(content_type, str) else ""
    if media_type == "application/pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError("PDF content does not match its type")
        try:
            reader = PdfReader(BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise ValueError("Encrypted PDFs are not supported")
            if not 1 <= len(reader.pages) <= MAX_PAGES:
                raise ValueError("PDF page count exceeds the limit")
            excerpts: list[Excerpt] = []
            total_chars = 0
            for page_number, page in enumerate(reader.pages, 1):
                page_text = page.extract_text() or ""
                total_chars += len(page_text)
                if total_chars > MAX_TEXT_CHARS:
                    raise ValueError("Extracted text exceeds the limit")
                excerpts.extend(_bounded_lines(page_text, source_id, source_hash, page_number))
            if not excerpts:
                raise ValueError("PDF has no native text; image-only PDFs need OCR")
            return excerpts
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("PDF is malformed or cannot be extracted") from exc
    if media_type not in {"text/plain", "text/csv"}:
        raise ValueError("Unsupported document type")
    if b"\x00" in data or data.startswith(b"%PDF-"):
        raise ValueError("Text content does not match its type")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Text must be UTF-8") from exc
    excerpts = _bounded_lines(text, source_id, source_hash, 1)
    if not excerpts:
        raise ValueError("Source has no readable text")
    return excerpts


def normalize_textract(response: dict[str, Any], source_id: str, source_hash: str) -> list[Excerpt]:
    """Accept only high-confidence Textract LINE blocks with explicit PAGE context."""
    _source_context(source_id, source_hash)
    blocks = response.get("Blocks") if isinstance(response, dict) else None
    if not isinstance(blocks, list) or len(blocks) > MAX_LINES + MAX_PAGES:
        raise ValueError("Textract response is malformed or exceeds the limit")
    pages: set[int] = set()
    for block in blocks:
        if not isinstance(block, dict):
            raise ValueError("Textract block is malformed")
        if block.get("BlockType") == "PAGE":
            page = block.get("Page")
            if type(page) is not int or not 1 <= page <= MAX_PAGES or page in pages:
                raise ValueError("Textract page context is ambiguous")
            pages.add(page)
    if not pages:
        raise ValueError("Textract response has no page context")
    excerpts: list[Excerpt] = []
    total_chars = 0
    for block in blocks:
        if block.get("BlockType") != "LINE":
            continue
        page = block.get("Page")
        text = block.get("Text")
        confidence = block.get("Confidence")
        if type(page) is not int or page not in pages or not isinstance(text, str) or not text.strip():
            raise ValueError("Textract line lacks source page or text")
        if type(confidence) not in {int, float} or not 80 <= confidence <= 100:
            raise ValueError("Textract text confidence is insufficient")
        if "\n" in text or "\r" in text:
            raise ValueError("Textract line has ambiguous boundaries")
        total_chars += len(text)
        if total_chars > MAX_TEXT_CHARS:
            raise ValueError("Textract text exceeds the limit")
        excerpts.append(Excerpt(source_id, source_hash, page, text.strip()))
    if not excerpts:
        raise ValueError("Textract response has no readable text")
    return excerpts


def extract_image_with_textract(
    data: bytes, content_type: str, source_id: str, client: TextractClient
) -> list[Excerpt]:
    """Use an injected synchronous client; this function does not create AWS clients."""
    source_hash = _check_source(data, source_id)
    if content_type == "image/png":
        valid_magic = data.startswith(b"\x89PNG\r\n\x1a\n")
    elif content_type == "image/jpeg":
        valid_magic = data.startswith(b"\xff\xd8\xff")
    else:
        raise ValueError("Textract adapter supports PNG or JPEG only")
    if not valid_magic:
        raise ValueError("Image content does not match its type")
    try:
        response = client.detect_document_text(Document={"Bytes": data})
    except Exception as exc:
        raise ValueError("Textract extraction failed") from exc
    return normalize_textract(response, source_id, source_hash)


def _validate_packet_fields(fields: dict[str, str], version: int) -> dict[str, str]:
    if type(version) is not int or version < 1:
        raise ValueError("Packet version must be positive")
    if not isinstance(fields, dict) or not fields or set(fields) - set(_PACKET_FIELDS):
        raise ValueError("Packet fields are missing or unsupported")
    cleaned: dict[str, str] = {}
    for key, value in fields.items():
        limit = 20_000 if key == "business_summary" else MAX_FIELD_CHARS
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f"Packet field {key} is empty or exceeds its length limit")
        value = value.strip()
        if key in {"annual_revenue", "cash_reserve"}:
            if not _MONEY.fullmatch(value):
                raise ValueError(f"Packet field {key} must be a non-negative monetary amount")
            try:
                amount = Decimal(value.replace("$", "").replace(",", ""))
            except InvalidOperation as exc:
                raise ValueError(f"Packet field {key} must be a monetary amount") from exc
            if amount < 0 or not amount.is_finite():
                raise ValueError(f"Packet field {key} must be a non-negative monetary amount")
            value = f"${amount:,.2f}"
        cleaned[key] = value
    return cleaned


def _packet_font() -> str:
    global _FONT
    try:
        if _FONT == "Helvetica":
            pdfmetrics.registerFont(TTFont("RelayDejaVu", _FONT_FILE))
            _FONT = "RelayDejaVu"
    except OSError:
        pass
    return _FONT


def generate_packet_pdf(fields: dict[str, str], version: int) -> bytes:
    """Create a paginated fictional packet from caller-confirmed values only."""
    values = _validate_packet_fields(fields, version)
    font = _packet_font()
    if font == "Helvetica" and any(ord(char) > 255 for value in values.values() for char in value):
        raise ValueError("Unicode packet font is unavailable")
    stream = BytesIO()
    document = BaseDocTemplate(stream, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=72, bottomMargin=54)
    frame = Frame(54, 54, letter[0] - 108, letter[1] - 126, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def chrome(canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#00205B"))
        canvas.rect(0, letter[1] - 12, letter[0], 12, fill=1, stroke=0)
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor("#52627A"))
        canvas.drawString(54, 34, f"Fictional planning packet · Version {version}")
        canvas.drawRightString(letter[0] - 54, 34, f"Page {doc.page}")
        canvas.restoreState()

    document.addPageTemplates(PageTemplate(id="packet", frames=frame, onPage=chrome))
    title_style = ParagraphStyle("title", fontName=font, fontSize=19, leading=25, textColor=colors.HexColor("#00205B"), spaceAfter=10)
    label_style = ParagraphStyle("label", fontName=font, fontSize=9, leading=14, textColor=colors.HexColor("#52627A"), spaceBefore=12, spaceAfter=3)
    value_style = ParagraphStyle("value", fontName=font, fontSize=11, leading=17, textColor=colors.HexColor("#202C3D"), alignment=TA_LEFT)
    story: list[Any] = [Paragraph("Northstar · Planning packet", title_style), Paragraph(f"Version {version} · Fictional demo", value_style), Spacer(1, 12)]
    for key, label in _PACKET_FIELDS.items():
        if key in values:
            story.append(Paragraph(escape(label), label_style))
            story.append(Paragraph(escape(values[key]).replace("\n", "<br/>"), value_style))
    document.build(story)
    result = stream.getvalue()
    if not result.startswith(b"%PDF-"):
        raise ValueError("Packet PDF generation failed")
    return result


def _obj(value: Any) -> Any:
    return value.get_object() if isinstance(value, IndirectObject) else value


def _ref_id(value: Any) -> tuple[int, int] | int:
    if isinstance(value, IndirectObject):
        return (value.idnum, value.generation)
    return id(value)


def _form_structure(reader: PdfReader) -> tuple[dict[str, Any], dict[str, list[DictionaryObject]]]:
    root = reader.trailer["/Root"]
    if "/Perms" in root:
        raise ValueError("Signed or restricted PDF forms are unsupported")
    acroform = _obj(root.get("/AcroForm"))
    if not isinstance(acroform, DictionaryObject):
        raise ValueError("PDF has no interactive form")
    top_fields = acroform.get("/Fields")
    if not isinstance(top_fields, list) or not top_fields:
        raise ValueError("PDF form structure is missing")
    canonical: dict[str, Any] = {}
    canonical_refs: dict[str, Any] = {}
    seen: set[Any] = set()

    def visit(field_ref: Any, prefix: str = "") -> None:
        identity = _ref_id(field_ref)
        if identity in seen:
            raise ValueError("PDF form structure is ambiguous")
        seen.add(identity)
        field = _obj(field_ref)
        if not isinstance(field, DictionaryObject) or "/ByteRange" in field:
            raise ValueError("Signed or malformed PDF form is unsupported")
        part = field.get("/T")
        name = f"{prefix}.{part}" if prefix and part else (str(part) if part else prefix)
        field_type = field.get("/FT")
        if field_type == "/Sig":
            raise ValueError("Signed PDF forms are unsupported")
        kids = field.get("/Kids", [])
        if kids and not isinstance(kids, list):
            raise ValueError("PDF form structure is ambiguous")
        child_fields = [kid for kid in kids if _obj(kid).get("/Subtype") != "/Widget"]
        if child_fields:
            for child in child_fields:
                visit(child, name)
        else:
            if not name or name in canonical or field_type != "/Tx":
                raise ValueError("PDF form contains unsupported or ambiguous fields")
            canonical[name] = field
            canonical_refs[name] = identity

    for field in top_fields:
        visit(field)
    widgets: dict[str, list[DictionaryObject]] = {name: [] for name in canonical}
    for page in reader.pages:
        for annotation_ref in page.get("/Annots", []):
            annotation = _obj(annotation_ref)
            if annotation.get("/Subtype") != "/Widget":
                continue
            if "/ByteRange" in annotation:
                raise ValueError("Signed PDF forms are unsupported")
            chain: list[Any] = [annotation_ref]
            cursor = annotation
            for _ in range(10):
                parent = cursor.get("/Parent")
                if parent is None:
                    break
                chain.append(parent)
                cursor = _obj(parent)
            else:
                raise ValueError("PDF form parent chain is ambiguous")
            matches = [name for name, field_ref in canonical_refs.items() if field_ref in {_ref_id(item) for item in chain}]
            if len(matches) != 1:
                raise ValueError("PDF widget is orphaned or ambiguous")
            widgets[matches[0]].append(annotation)
    if any(not bound for bound in widgets.values()):
        raise ValueError("PDF form field has no page widget")
    return canonical, widgets


def _check_widget_fit(reader: PdfReader, field: DictionaryObject, widget: DictionaryObject, value: str) -> None:
    """Reject values that the existing field geometry cannot safely display."""
    maximum = field.get("/MaxLen", widget.get("/MaxLen"))
    if maximum is not None and (not isinstance(maximum, int) or len(value) > maximum):
        raise ValueError("Form value exceeds the field's visible length limit")
    if any(ord(character) > 255 for character in value):
        raise ValueError("Form font cannot safely display this Unicode value")
    rectangle = widget.get("/Rect")
    if not isinstance(rectangle, list) or len(rectangle) != 4:
        raise ValueError("PDF widget geometry is malformed")
    width = float(rectangle[2]) - float(rectangle[0]) - 10
    height = float(rectangle[3]) - float(rectangle[1]) - 6
    if width <= 0 or height <= 0:
        raise ValueError("PDF widget geometry is malformed")
    acroform = _obj(reader.trailer["/Root"].get("/AcroForm"))
    appearance = str(field.get("/DA", widget.get("/DA", acroform.get("/DA", ""))))
    font_match = re.search(r"(?:^|\s)(\d+(?:\.\d+)?)\s+Tf(?:\s|$)", appearance)
    font_size = float(font_match.group(1)) if font_match else 12.0
    if font_size <= 0:
        font_size = 12.0
    line_height = font_size * 1.35
    flags = int(field.get("/Ff", widget.get("/Ff", 0)))
    multiline = bool(flags & 4096)
    if not multiline and ("\n" in value or "\r" in value):
        raise ValueError("Single-line form field cannot display line breaks")

    def measured_width(text: str) -> float:
        # The safety factor covers non-Helvetica form fonts and appearance padding.
        return max(pdfmetrics.stringWidth(text, "Helvetica", font_size) * 1.15, len(text) * font_size * 0.8)

    line_count = 0
    for paragraph in value.splitlines() or [""]:
        current = ""
        for word in paragraph.split():
            if measured_width(word) > width:
                raise ValueError("Form value exceeds the field's visible width")
            candidate = f"{current} {word}" if current else word
            if measured_width(candidate) > width:
                line_count += 1
                current = word
            else:
                current = candidate
        line_count += 1
    if not multiline and line_count > 1:
        raise ValueError("Form value exceeds the field's visible width")
    if line_count * line_height > height:
        raise ValueError("Form value exceeds the field's visible height")


def fill_pdf_form(template: bytes, values: dict[str, str]) -> bytes:
    """Fill text fields, preserving the canonical tree and widget appearances."""
    if not isinstance(template, bytes) or not template.startswith(b"%PDF-") or len(template) > MAX_SOURCE_BYTES:
        raise ValueError("PDF template is malformed or exceeds the limit")
    if not isinstance(values, dict) or not values:
        raise ValueError("No form values were supplied")
    for name, value in values.items():
        if not isinstance(name, str) or not isinstance(value, str) or len(value) > MAX_FIELD_CHARS:
            raise ValueError("Form value is invalid or exceeds its length limit")
    try:
        reader = PdfReader(BytesIO(template), strict=True)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are unsupported")
        fields, widgets = _form_structure(reader)
        if set(values) - fields.keys():
            raise ValueError("Unknown PDF form field")
        for name, value in values.items():
            for widget in widgets[name]:
                _check_widget_fit(reader, fields[name], widget, value)
        writer = PdfWriter()
        writer.clone_document_from_reader(reader)
        writer.update_page_form_field_values(None, values, auto_regenerate=False)
        stream = BytesIO()
        writer.write(stream)
        result = stream.getvalue()
        reopened = PdfReader(BytesIO(result), strict=True)
        actual, widgets = _form_structure(reopened)
        for name, expected in values.items():
            if str(actual[name].get("/V", "")) != expected:
                raise ValueError("PDF canonical field verification failed")
            for widget in widgets[name]:
                parent = _obj(widget.get("/Parent")) if widget.get("/Parent") else None
                effective = widget.get("/V", parent.get("/V") if parent else "")
                normal = _obj(widget.get("/AP", {})).get("/N")
                if str(effective) != expected or not normal or not _obj(normal):
                    raise ValueError("PDF widget appearance verification failed")
        return result
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("PDF form is malformed or cannot be filled") from exc
