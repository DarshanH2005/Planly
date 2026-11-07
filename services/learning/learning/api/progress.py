"""
Sprint B21: Evidence-based Debrief and Quiet Progress Views API Router.
Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from learning.api.auth import AuthenticatedOwner, get_current_owner
from learning.learner.progress import (
    ProgressProjection,
    QuietSessionDebrief,
    QuietWeeklyReview,
    UserApplicationRecord,
    compute_canonical_progress_projection,
    build_quiet_session_debrief,
    build_quiet_weekly_review,
    save_user_application,
    list_user_applications,
)
from learning.repositories import evidence

router = APIRouter(prefix="/api/progress", tags=["Progress & Debrief"])


class ApplicationInput(BaseModel):
    company_name: str
    role_title: str
    status: str = "saved"
    user_notes: str = ""
    speculative_hiring_probability: Optional[float] = None


@router.get("/projection", response_model=ProgressProjection)
async def get_progress_projection_endpoint(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ProgressProjection:
    """
    Computes canonical capability dimensions strictly from verified observations (B21-AC1, B21-AC2).
    """
    observations = evidence.get_owner_observations(owner.owner_id)
    return compute_canonical_progress_projection(owner.owner_id, observations)


@router.get("/sessions/{session_id}/debrief", response_model=QuietSessionDebrief)
async def get_session_debrief_endpoint(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> QuietSessionDebrief:
    """
    Returns a quiet, focused session debrief with what improved, what remains uncertain,
    and a single direct call-to-action for the next lesson (B21-AC3).
    """
    sess = evidence.get_session(owner.owner_id, session_id)
    if not sess:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found.",
        )

    observations = evidence.get_session_observations(owner.owner_id, session_id)
    cls = evidence.get_classroom(owner.owner_id, sess.classroom_id)
    track = cls.track if cls else "dsa"

    return build_quiet_session_debrief(
        owner_id=owner.owner_id,
        session_id=session_id,
        classroom_id=sess.classroom_id,
        session_observations=observations,
        track=track,
    )


@router.get("/weekly", response_model=QuietWeeklyReview)
async def get_weekly_review_endpoint(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> QuietWeeklyReview:
    """
    Returns a clutter-free weekly progress review (B21-AC3).
    """
    observations = evidence.get_owner_observations(owner.owner_id)
    return build_quiet_weekly_review(owner.owner_id, observations)


@router.post("/applications", response_model=UserApplicationRecord)
async def post_user_application_endpoint(
    payload: ApplicationInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> UserApplicationRecord:
    """
    Saves user-entered application record. Rejects speculative hiring odds (B21-AC1, Implement 4).
    """
    if payload.speculative_hiring_probability is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Speculative hiring probabilities are strictly prohibited (B21-AC1).",
        )

    record = UserApplicationRecord(
        owner_id=owner.owner_id,
        company_name=payload.company_name,
        role_title=payload.role_title,
        status=payload.status,
        user_notes=payload.user_notes,
    )
    return save_user_application(record)


@router.get("/applications", response_model=List[UserApplicationRecord])
async def list_user_applications_endpoint(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[UserApplicationRecord]:
    """
    Lists user-entered application records.
    """
    return list_user_applications(owner.owner_id)
