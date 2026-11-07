"""
Sprint B18: Strict Assessment & OA API Endpoints
Authority: PLANLY_BUILD_SPEC.md §16-17; B18_strict_oa.md

Provides:
- POST /api/assessments/oa/start: Start timed strict OA session
- GET /api/assessments/oa/{session_id}: Authoritative candidate view with zero private leak
- POST /api/assessments/oa/{session_id}/draft: Concurrency-checked draft saves under deadline
- POST /api/assessments/oa/{session_id}/clarify: Constrained authored clarification queries
- POST /api/assessments/oa/{session_id}/finalize: Idempotent finish freezing pre-deadline attempts
- POST /api/assessments/oa/{session_id}/convert-practice: Honest practice conversion with assistance flag
- POST /api/assessments/oa/{session_id}/interruption: Honest interruption recording
"""

from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.domain.modes import (
    start_oa_session,
    get_oa_session,
    save_oa_draft,
    get_candidate_safe_payload,
    request_oa_clarification,
    finalize_oa_session,
    convert_oa_to_practice,
    record_oa_interruption,
    ImmutableExerciseVersion,
    ResourcePolicy,
    OASessionRecord,
)

router = APIRouter(prefix="/api/assessments/oa", tags=["Assessments"])


# ==============================================================================
# Default Bundled OA Exercises
# ==============================================================================

DEFAULT_OA_EXERCISES = [
    ImmutableExerciseVersion(
        prompt_id="FX-HASH-A",
        prompt_version=1,
        rubric_id="rubric-oa-v1",
        rubric_version=1,
        bundle_hash="bundle-hash-oa-01",
        title="First Repeating Element",
        statement=(
            "Given an array of integers `nums`, find the first element that repeats in the array. "
            "If no element repeats, return `None`. An element is considered repeating if it appears "
            "more than once and its second occurrence has the smallest index."
        ),
        starter_code="def first_repeat(nums: list[int]):\n    # Your solution here\n    pass\n",
        public_tests=[
            {"input": {"nums": [10, 5, 3, 4, 3, 5, 6]}, "expected": 5},
            {"input": {"nums": [1, 2, 3, 4]}, "expected": None},
        ],
        hidden_tests=[
            {"input": {"nums": [6, 10, 5, 4, 9, 120, 4, 6, 10]}, "expected": 4},
            {"input": {"nums": []}, "expected": None},
        ],
        private_solution=(
            "def first_repeat(nums):\n"
            "    seen = set()\n"
            "    min_idx = -1\n"
            "    for i in range(len(nums) - 1, -1, -1):\n"
            "        if nums[i] in seen:\n"
            "            min_idx = i\n"
            "        else:\n"
            "            seen.add(nums[i])\n"
            "    return nums[min_idx] if min_idx != -1 else None\n"
        ),
        clarification_branches={
            "clarify-types": {
                "question": "Can values contain negative integers or zeros?",
                "answer": "Yes, values may contain positive, negative, and zero integers.",
            },
            "clarify-empty": {
                "question": "How should an empty list be handled?",
                "answer": "An empty list should return None.",
            },
        },
    ),
    ImmutableExerciseVersion(
        prompt_id="FX-PREFIX-A",
        prompt_version=1,
        rubric_id="rubric-oa-v1",
        rubric_version=1,
        bundle_hash="bundle-hash-oa-01",
        title="Subarray Sum Divisible by K",
        statement=(
            "Given an integer array `nums` and an integer `k`, return the number of non-empty "
            "subarrays that have a sum divisible by `k`."
        ),
        starter_code="def subarrays_div_by_k(nums: list[int], k: int) -> int:\n    # Your solution here\n    return 0\n",
        public_tests=[
            {"input": {"nums": [4, 5, 0, -2, -3, 1], "k": 5}, "expected": 7},
            {"input": {"nums": [5], "k": 9}, "expected": 0},
        ],
        hidden_tests=[
            {"input": {"nums": [-1, 2, 9], "k": 2}, "expected": 2},
        ],
        private_solution=(
            "def subarrays_div_by_k(nums, k):\n"
            "    remainder_map = {0: 1}\n"
            "    current_sum = 0\n"
            "    count = 0\n"
            "    for num in nums:\n"
            "        current_sum += num\n"
            "        remainder = current_sum % k\n"
            "        count += remainder_map.get(remainder, 0)\n"
            "        remainder_map[remainder] = remainder_map.get(remainder, 0) + 1\n"
            "    return count\n"
        ),
        clarification_branches={
            "clarify-negative-k": {
                "question": "Can k be negative or zero?",
                "answer": "No, k is guaranteed to be a strictly positive integer >= 2.",
            },
        },
    ),
]


# ==============================================================================
# Request/Response Models
# ==============================================================================

class StartOARequest(BaseModel):
    classroom_id: str
    pack_id: str = "PACK-OA-01"
    pack_version: int = 1
    duration_minutes: int = Field(default=45, ge=1, le=180)
    prompt_ids: Optional[List[str]] = None


class DraftSaveRequest(BaseModel):
    prompt_id: str
    code: str
    language: str = "python"
    notes: str = ""
    expected_revision: int = Field(ge=1)


class ClarificationRequest(BaseModel):
    prompt_id: str
    branch_id: str


class FinalizeRequest(BaseModel):
    finish_reason: str = "submitted"
    final_drafts: Optional[List[Dict[str, Any]]] = None


class ConvertPracticeRequest(BaseModel):
    reason: str = "Learner requested coaching/hints"


class InterruptionRequest(BaseModel):
    reason: str = "Client disconnection or browser refresh interruption"


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("/start", status_code=status.HTTP_201_CREATED)
def api_start_oa(
    req: StartOARequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC1: Start a strict OA assessment session with server-persisted deadline.
    """
    exercises = DEFAULT_OA_EXERCISES
    if req.prompt_ids:
        exercises = [ex for ex in DEFAULT_OA_EXERCISES if ex.prompt_id in req.prompt_ids]
        if not exercises:
            exercises = DEFAULT_OA_EXERCISES

    session = start_oa_session(
        owner_id=owner.owner_id,
        classroom_id=req.classroom_id,
        pack_id=req.pack_id,
        pack_version=req.pack_version,
        duration_minutes=req.duration_minutes,
        exercises=exercises,
    )
    return get_candidate_safe_payload(session)


@router.get("/{session_id}")
def api_get_oa(
    session_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC2: Fetch authoritative candidate-safe view. Zero private answer keys leaked.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to other owner's assessment forbidden")

    return get_candidate_safe_payload(session)


@router.post("/{session_id}/draft")
def api_save_draft(
    session_id: str,
    req: DraftSaveRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC1: Save draft validating against server deadline and optimistic concurrency.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    success, err_code, draft = save_oa_draft(
        session=session,
        prompt_id=req.prompt_id,
        code=req.code,
        language=req.language,
        notes=req.notes,
        expected_revision=req.expected_revision,
    )

    if not success:
        if err_code == "DEADLINE_PASSED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "DEADLINE_PASSED", "message": "Server deadline has expired. Draft rejected."},
            )
        elif err_code == "VERSION_CONFLICT":
            current_rev = draft.revision if draft else req.expected_revision
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "VERSION_CONFLICT", "message": "Stale revision conflict", "current_revision": current_rev},
            )
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_code)

    return {
        "status": "saved",
        "prompt_id": draft.prompt_id,
        "revision": draft.revision,
        "saved_at": draft.saved_at.isoformat(),
    }


@router.post("/{session_id}/clarify")
def api_request_clarification(
    session_id: str,
    req: ClarificationRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC2: Constrained clarification query. Answers returned only for authored branches.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    success, err, data = request_oa_clarification(
        session=session,
        prompt_id=req.prompt_id,
        branch_id=req.branch_id,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    return data


@router.post("/{session_id}/finalize")
def api_finalize_oa(
    session_id: str,
    req: FinalizeRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC3: Finalize session and freeze attempts. Idempotent and deadline-enforced.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    success, updated_session, attempts = finalize_oa_session(
        session=session,
        finish_reason=req.finish_reason,
        final_drafts=req.final_drafts,
    )

    return {
        "status": "finalized",
        "session_id": updated_session.id,
        "finish_reason": updated_session.finish_reason,
        "finalized_at": updated_session.finalized_at.isoformat() if updated_session.finalized_at else None,
        "attempts_count": len(attempts),
        "attempts": [
            {
                "id": a.id,
                "prompt_id": a.exposure_state.get("prompt_id"),
                "source_revision": a.source_revision,
                "assistance_level": a.assistance_level.value,
                "mode": a.mode.value,
                "elapsed_seconds": a.elapsed_seconds,
            }
            for a in attempts
        ],
    }


@router.post("/{session_id}/convert-practice")
def api_convert_practice(
    session_id: str,
    req: ConvertPracticeRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18-AC3 & Failure to Prevent:
    Converts OA session to coached practice with honest assistance flags.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    success, err, updated_session = convert_oa_to_practice(
        session=session,
        reason=req.reason,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    return {
        "status": "converted",
        "session_id": updated_session.id,
        "mode": updated_session.mode.value,
        "is_assisted": updated_session.is_assisted,
    }


@router.post("/{session_id}/interruption")
def api_record_interruption(
    session_id: str,
    req: InterruptionRequest,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> Dict[str, Any]:
    """
    B18: Records honest interruption / outage flag.
    """
    session = get_oa_session(session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment session not found")
    if session.owner_id != owner.owner_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden")

    updated = record_oa_interruption(session, reason=req.reason)
    return {
        "status": "interruption_recorded",
        "session_id": updated.id,
        "is_interrupted": updated.is_interrupted,
    }
