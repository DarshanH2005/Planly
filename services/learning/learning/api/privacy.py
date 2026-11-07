"""
Sprint B22: Privacy, Memory Corrections, and Data Deletion API Router.
Authority: PLANLY_BUILD_SPEC.md §5-6, 11-12; B22_memory_lifecycle.md
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from learning.api.auth import AuthenticatedOwner, get_current_owner
from learning.repositories.corrections import (
    MemoryClaim,
    TombstoneRecord,
    CorrectionRecord,
    get_memory_claims,
    apply_learner_correction,
    delete_source_data_with_tombstone,
    list_tombstones,
    invalidate_misconception,
)

router = APIRouter(prefix="/api/privacy", tags=["Privacy & Memory Lifecycle"])


class LearnerCorrectionInput(BaseModel):
    target_observation_id: str
    new_competency_key: str
    correction_note: str
    is_self_report: bool = True


class InvalidateMisconceptionInput(BaseModel):
    competency_key: str
    reason: str = "Learner demonstrated understanding or retracted misconception."


class DeletionResponse(BaseModel):
    success: bool
    tombstone_id: str
    target_id: str
    target_type: str
    restore_token: str


@router.get("/claims", response_model=List[MemoryClaim])
async def get_claims_endpoint(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[MemoryClaim]:
    """
    Returns active memory claims for the learner, including provenance and verification status (Implement 4).
    """
    return get_memory_claims(owner.owner_id)


@router.post("/corrections", response_model=CorrectionRecord)
async def post_correction_endpoint(
    payload: LearnerCorrectionInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> CorrectionRecord:
    """
    Applies a learner correction.
    - Submitting a self-report remains qualified/pending verification without direct mastery overrides (B22-AC3).
    """
    correction, _ = apply_learner_correction(
        owner_id=owner.owner_id,
        target_observation_id=payload.target_observation_id,
        new_competency_key=payload.new_competency_key,
        correction_note=payload.correction_note,
        is_self_report=payload.is_self_report,
    )
    return correction


@router.post("/invalidate-misconception")
async def post_invalidate_misconception_endpoint(
    payload: InvalidateMisconceptionInput,
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """
    Invalidates a misconception claim and any cached summary referencing it (B22-AC1).
    """
    return invalidate_misconception(
        owner_id=owner.owner_id,
        competency_key=payload.competency_key,
        reason=payload.reason,
    )


@router.delete("/entities/{target_type}/{target_id}", response_model=DeletionResponse)
async def delete_entity_endpoint(
    target_type: str,
    target_id: str,
    reason: str = "User explicit privacy deletion request.",
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> DeletionResponse:
    """
    Explicit user privacy deletion: records restore-aware tombstone and purges caches
    so deleted records cannot return via cache or adapters (B22-AC2).
    """
    tomb = delete_source_data_with_tombstone(
        owner_id=owner.owner_id,
        target_id=target_id,
        target_type=target_type,
        reason=reason,
    )
    return DeletionResponse(
        success=True,
        tombstone_id=tomb.id,
        target_id=target_id,
        target_type=target_type,
        restore_token=tomb.restore_token,
    )


@router.get("/tombstones", response_model=List[TombstoneRecord])
async def get_tombstones_endpoint(
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> List[TombstoneRecord]:
    """
    Returns active tombstones for the authenticated owner (B22-AC2).
    """
    return list_tombstones(owner.owner_id)
