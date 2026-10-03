from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PacketField = Literal[
    "company_name", "founder_name", "business_summary", "annual_revenue",
    "cash_reserve", "period",
]
FIELDS: tuple[str, ...] = (
    "company_name", "founder_name", "business_summary", "annual_revenue",
    "cash_reserve", "period",
)


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str
    source_hash: str
    page: int = Field(ge=1)
    quote: str = Field(min_length=1, max_length=1000)


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: PacketField
    value: str = Field(min_length=1, max_length=1000)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)


class PdfEditProposal(BaseModel):
    """A staged PDF edit. Its fields are re-derived from trusted context on use."""

    model_config = ConfigDict(extra="forbid")
    base_packet_id: str | None = None
    template_id: str | None = None
    fields: dict[PacketField, str] = Field(min_length=1, max_length=6)
    changes: list[Proposal] = Field(min_length=1, max_length=6)


class ModelResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposals: list[Proposal] = Field(max_length=24)
    reply: str | None = Field(default=None, max_length=1000)
    pdf_edit: PdfEditProposal | None = None
    agent_steps: list[dict[str, str]] = Field(default_factory=list, max_length=12)


class CreateCase(BaseModel):
    company: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=1000)


class RunInput(BaseModel):
    expected_revision: int = Field(ge=0)
    goal: str = Field(min_length=1, max_length=1000)


class ConfirmInput(BaseModel):
    expected_revision: int = Field(ge=0)
    values: dict[PacketField, str] = Field(min_length=1, max_length=6)
    source_acknowledgements: dict[PacketField, list[str]] = Field(default_factory=dict)


class PacketInput(BaseModel):
    expected_revision: int = Field(ge=0)
    template_id: str | None = None
