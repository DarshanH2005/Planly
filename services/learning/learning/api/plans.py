"""
Sprint B13: Planning API Endpoints.
Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md
"""

from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.repositories.plans import (
    DailyCapacityMode,
    CommitmentKind,
    CommitmentStatus,
    PlanCommitmentRecord,
    PlanRecord,
    DailyDeclaredCapacity,
    RevisionConflictError,
    get_current_plan,
    get_declared_capacity,
    set_declared_capacity,
    commit_plan_revision,
    record_commitment_completed,
    record_skipped_day,
)
from learning.learner.planner import (
    PlanPreview,
    build_plan_preview,
    compute_daily_budget,
)

router = APIRouter(prefix="/api/plans", tags=["Planning"])


class CapacityUpdateRequest(BaseModel):
    date: str
    declared_minutes: int = Field(ge=0, le=480)
    mode: Optional[DailyCapacityMode] = DailyCapacityMode.NORMAL


class PlanPreviewRequest(BaseModel):
    today_date: Optional[str] = None
    date: Optional[str] = None
    declared_mode: Optional[DailyCapacityMode] = None
    mode: Optional[DailyCapacityMode] = None
    declared_minutes_override: Optional[int] = None
    declared_minutes: Optional[int] = None
    session_id: Optional[str] = None
    has_loop_gap_override: Optional[bool] = None
    has_loop_gap: Optional[bool] = None


class PlanCommitRequest(BaseModel):
    plan_id: str
    expected_revision: int = Field(ge=1)
    commitments: List[PlanCommitmentRecord] = Field(default_factory=list)
    request_key: Optional[str] = None


class SkippedDayRequest(BaseModel):
    date: Optional[str] = None


@router.get("/today")
async def get_today_plan_endpoint(
    date: Optional[str] = Query(None, description="ISO date YYYY-MM-DD"),
    session_id: Optional[str] = Query(None, description="Session ID for diagnostic gap evaluation"),
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    preview = build_plan_preview(
        owner_id=owner.owner_id,
        today_date=target_date,
        session_id=session_id,
    )
    data = preview.model_dump()
    data["today_date"] = target_date
    return data


@router.post("/preview")
async def post_preview_endpoint(
    body: PlanPreviewRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    target_date = body.today_date or body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mode = body.declared_mode or body.mode
    mins = body.declared_minutes_override if body.declared_minutes_override is not None else body.declared_minutes
    loop_gap = body.has_loop_gap_override if body.has_loop_gap_override is not None else body.has_loop_gap

    preview = build_plan_preview(
        owner_id=owner.owner_id,
        today_date=target_date,
        declared_mode=mode,
        declared_minutes_override=mins,
        session_id=body.session_id,
        has_loop_gap_override=loop_gap,
    )
    return preview.model_dump()


@router.post(
    "/commit",
    responses={
        status.HTTP_409_CONFLICT: {"description": "Plan revision conflict"},
    },
)
async def post_commit_endpoint(
    body: PlanCommitRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    try:
        plan = commit_plan_revision(
            owner_id=owner.owner_id,
            plan_id=body.plan_id,
            expected_revision=body.expected_revision,
            commitments=body.commitments,
            request_key=body.request_key,
        )
        return plan.model_dump()
    except RevisionConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.put("/capacity")
async def put_capacity_endpoint(
    body: CapacityUpdateRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    cap = set_declared_capacity(
        owner_id=owner.owner_id,
        date=body.date,
        declared_minutes=body.declared_minutes,
        mode=body.mode or DailyCapacityMode.NORMAL,
    )
    return cap.model_dump()


@router.post("/commitments/{commitment_id}/complete")
async def post_complete_commitment_endpoint(
    commitment_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    comm = record_commitment_completed(owner.owner_id, commitment_id)
    if not comm:
        raise HTTPException(status_code=404, detail=f"Commitment '{commitment_id}' not found")
    return {"commitment_id": comm.id, "status": "completed"}


@router.post("/skipped-day")
async def post_skipped_day_endpoint(
    body: Optional[SkippedDayRequest] = None,
    date: Optional[str] = Query(None),
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    target_date = (body and body.date) or date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    plan = record_skipped_day(owner.owner_id, target_date)
    return plan.model_dump()
