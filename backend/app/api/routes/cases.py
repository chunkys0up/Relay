from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import case_records
from app.db.case_records import ChecklistState

router = APIRouter(prefix="/cases/{case_id}", tags=["cases"])


class ChecklistItem(BaseModel):
    id: UUID
    case_id: UUID
    title: str
    detail: str | None
    state: ChecklistState
    position: int
    created_by: str
    created_at: datetime
    updated_at: datetime


class ChecklistUpdate(BaseModel):
    state: ChecklistState


class ActivityEntry(BaseModel):
    id: UUID
    case_id: UUID
    actor: str
    text: str
    created_at: datetime


@router.get("/checklist", response_model=list[ChecklistItem])
async def get_checklist(case_id: UUID) -> list[dict]:
    return await case_records.list_checklist(case_id)


@router.patch("/checklist/{item_id}", response_model=ChecklistItem)
async def set_checklist_state(case_id: UUID, item_id: UUID, body: ChecklistUpdate) -> dict:
    item = await case_records.update_checklist_item(case_id, item_id, "founder", state=body.state)
    if item is None:
        raise HTTPException(status_code=404, detail="checklist item not found")
    return item


@router.get("/activity", response_model=list[ActivityEntry])
async def get_activity(case_id: UUID, limit: int = Query(default=20, ge=1, le=100)) -> list[dict]:
    return await case_records.list_activity(case_id, limit)
