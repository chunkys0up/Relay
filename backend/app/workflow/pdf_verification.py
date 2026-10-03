"""Independent, bounded verification of rendered packet PDFs and filled forms."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import BytesIO
import re
from typing import Any

from pypdf import PdfReader
from pypdf.generic import DictionaryObject, IndirectObject

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PAGES = 30
MAX_EXTRACTED_CHARS = 2_000_000
MAX_REPORT_CHARS = 100_000
_LABELS = {
    "company_name": "Company", "founder_name": "Founder",
    "business_summary": "Business summary", "annual_revenue": "Annual revenue",
    "cash_reserve": "Cash reserve", "period": "Reporting period",
}
_MONEY_FIELDS = {"annual_revenue", "cash_reserve"}
_MONEY = re.compile(r"\$?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?\Z")
_CHROME = re.compile(r"(?:Fictional planning packet · Version \d+|Page \d+|Northstar · Planning packet|Version \d+ · Fictional demo)\Z")


def _object(value: Any) -> Any:
    return value.get_object() if isinstance(value, IndirectObject) else value


def _space(value: str) -> str:
    return " ".join(value.split())


def _amount(value: str) -> Decimal:
    normalized = _space(value)
    if not _MONEY.fullmatch(normalized):
        raise ValueError("PDF_FIELD_MISMATCH")
    try:
        return Decimal(normalized.replace("$", "").replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError("PDF_FIELD_MISMATCH") from exc


def _packet_sections(text: str) -> dict[str, str]:
    reverse = {label: key for key, label in _LABELS.items()}
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _CHROME.fullmatch(line):
            continue
        if line in reverse:
            current = reverse[line]
            if current in sections:
                raise ValueError("PDF_FIELD_AMBIGUOUS")
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    return {key: _space(" ".join(value)) for key, value in sections.items()}


def _verify_packet(text: str, expected: dict[str, str]) -> dict[str, str]:
    if set(expected) - _LABELS.keys():
        raise ValueError("PDF_FIELD_UNSUPPORTED")
    sections = _packet_sections(text)
    actual: dict[str, str] = {}
    for key, value in expected.items():
        extracted = sections.get(key)
        if not extracted:
            raise ValueError("PDF_FIELD_MISSING")
        if key in _MONEY_FIELDS:
            if _amount(value) != _amount(extracted):
                raise ValueError("PDF_FIELD_MISMATCH")
        elif _space(value) != extracted:
            raise ValueError("PDF_FIELD_MISMATCH")
        actual[key] = extracted
    return actual


def _widget_name(widget: DictionaryObject) -> str:
    names: list[str] = []
    cursor: Any = widget
    visited: set[int] = set()
    for _ in range(16):
        cursor = _object(cursor)
        if not isinstance(cursor, DictionaryObject) or id(cursor) in visited:
            raise ValueError("PDF_FORM_AMBIGUOUS")
        visited.add(id(cursor))
        part = cursor.get("/T")
        if part is not None:
            names.append(str(part))
        parent = cursor.get("/Parent")
        if parent is None:
            break
        cursor = parent
    else:
        raise ValueError("PDF_FORM_AMBIGUOUS")
    if not names:
        raise ValueError("PDF_FORM_AMBIGUOUS")
    return ".".join(reversed(names))


def _verify_form(reader: PdfReader, expected: dict[str, str], template_fields: list[str] | None) -> dict[str, str]:
    root = reader.trailer["/Root"]
    if "/Perms" in root:
        raise ValueError("PDF_FORM_RESTRICTED")
    form = _object(root.get("/AcroForm"))
    if not isinstance(form, DictionaryObject):
        raise ValueError("PDF_FORM_MISSING")
    names = list(expected) if template_fields is None else template_fields
    if not names or any(not isinstance(name, str) or name not in expected for name in names):
        raise ValueError("PDF_FORM_FIELDS_INVALID")
    if len(names) != len(set(names)):
        raise ValueError("PDF_FORM_FIELDS_INVALID")
    available = reader.get_fields() or {}
    actual: dict[str, str] = {}
    for name in names:
        field = available.get(name)
        if not isinstance(field, DictionaryObject) or field.get("/FT") != "/Tx":
            raise ValueError("PDF_FIELD_MISSING")
        value = str(field.get("/V", ""))
        if value != expected[name]:
            raise ValueError("PDF_FIELD_MISMATCH")
        actual[name] = value
    widgets: dict[str, int] = {name: 0 for name in names}
    for page in reader.pages:
        for annotation_ref in page.get("/Annots", []):
            annotation = _object(annotation_ref)
            if not isinstance(annotation, DictionaryObject) or annotation.get("/Subtype") != "/Widget":
                continue
            name = _widget_name(annotation)
            if name not in widgets:
                continue
            widgets[name] += 1
            parent = _object(annotation.get("/Parent"))
            effective = annotation.get("/V", parent.get("/V", "") if isinstance(parent, DictionaryObject) else "")
            appearance = _object(annotation.get("/AP"))
            normal = _object(appearance.get("/N")) if isinstance(appearance, DictionaryObject) else None
            if str(effective) != expected[name] or not normal or not hasattr(normal, "get_data"):
                raise ValueError("PDF_FORM_APPEARANCE_MISMATCH")
            if not 0 < len(normal.get_data()) <= MAX_EXTRACTED_CHARS:
                raise ValueError("PDF_FORM_APPEARANCE_MISMATCH")
            if page.extract_xform_text(normal) != expected[name]:
                raise ValueError("PDF_FORM_APPEARANCE_MISMATCH")
    if any(count == 0 for count in widgets.values()):
        raise ValueError("PDF_FORM_WIDGET_MISSING")
    return actual


def inspect_pdf(pdf: bytes, fields: dict[str, str], template_fields: list[str] | None = None) -> dict[str, Any]:
    """Verify expected values against PDF text or AcroForm objects."""
    if not isinstance(pdf, bytes) or not pdf.startswith(b"%PDF-") or not 0 < len(pdf) <= MAX_PDF_BYTES:
        raise ValueError("PDF_INVALID")
    if not isinstance(fields, dict) or not fields or any(
        not isinstance(key, str) or not key or not isinstance(value, str) or not value.strip()
        for key, value in fields.items()
    ):
        raise ValueError("PDF_FIELDS_INVALID")
    if template_fields is not None and not isinstance(template_fields, list):
        raise ValueError("PDF_FORM_FIELDS_INVALID")
    try:
        reader = PdfReader(BytesIO(pdf), strict=True)
        if reader.is_encrypted:
            raise ValueError("PDF_ENCRYPTED")
        if not 1 <= len(reader.pages) <= MAX_PAGES:
            raise ValueError("PDF_PAGE_LIMIT")
        page_text: list[str] = []
        text_size = 0
        for page in reader.pages:
            extracted = page.extract_text() or ""
            text_size += len(extracted)
            if text_size > MAX_EXTRACTED_CHARS:
                raise ValueError("PDF_TEXT_LIMIT")
            page_text.append(extracted)
        text = "\n".join(page_text)
        has_form = isinstance(_object(reader.trailer["/Root"].get("/AcroForm")), DictionaryObject)
        if template_fields is not None or has_form:
            actual = _verify_form(reader, fields, template_fields)
            checks = ["pdf_structure", "form_fields", "widget_appearance_text"]
        else:
            if not text.strip():
                raise ValueError("PDF_TEXT_MISSING")
            actual = _verify_packet(text, fields)
            checks = ["pdf_structure", "labelled_packet_fields"]
        return {
            "passed": True,
            "hash": sha256(pdf).hexdigest(),
            "checks": checks,
            "extracted_text": text[:MAX_REPORT_CHARS],
            "fields": actual,
        }
    except ValueError as exc:
        if re.fullmatch(r"PDF_[A-Z_]+", str(exc)):
            raise
        raise ValueError("PDF_INVALID") from exc
    except Exception as exc:
        raise ValueError("PDF_INVALID") from exc
