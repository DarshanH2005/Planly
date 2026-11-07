"""
Sprint B21: Evidence-based Debrief and Quiet Progress Views.
Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md

Key Invariants:
- B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.
- B21-AC2: Changing/superseding evidence updates the read projection consistently.
- B21-AC3: User can reach the next lesson without navigating a dashboard wall.
- Failure to prevent: Do not spend this sprint recreating the clutter the user rejected.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from pydantic import BaseModel, Field, model_validator

from learning.domain.contracts import (
    AssistanceLevel,
    LearningObservation,
    SourceKind,
)


class CapabilityDimension(BaseModel):
    dimension_key: str  # "dsa" | "cs" | "ml_sql" | "project" | "behavioral"
    title: str
    verified_competencies: List[str] = Field(default_factory=list)
    uncertain_competencies: List[str] = Field(default_factory=list)
    evidence_count: int = 0
    assistance_breakdown: Dict[str, int] = Field(
        default_factory=lambda: {
            "independent": 0,
            "guided": 0,
            "tutor_supplied": 0,
        }
    )
    unsupported_claims_rejected: List[str] = Field(default_factory=list)


class ProgressProjection(BaseModel):
    owner_id: str
    dimensions: Dict[str, CapabilityDimension]
    total_verified_competencies: int
    total_uncertain_competencies: int
    disclaimed_percentages: List[str] = Field(default_factory=list)
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class NextLessonRecommendation(BaseModel):
    activity_id: str
    title: str
    track: str
    reason: str
    route: str
    action_label: str = "Start Next Lesson"


class QuietSessionDebrief(BaseModel):
    session_id: str
    owner_id: str
    classroom_id: str
    what_improved: List[Dict[str, Any]] = Field(default_factory=list)
    what_remains_uncertain: List[Dict[str, Any]] = Field(default_factory=list)
    next_step: NextLessonRecommendation
    is_assisted: bool = False
    unsupported_percentages_excluded: bool = True
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class QuietWeeklyReview(BaseModel):
    owner_id: str
    verified_this_week: List[str] = Field(default_factory=list)
    uncertain_this_week: List[str] = Field(default_factory=list)
    next_recommended_activities: List[NextLessonRecommendation] = Field(
        default_factory=list
    )
    clutter_free: bool = True
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class UserApplicationRecord(BaseModel):
    id: str = Field(default_factory=lambda: f"app_{uuid.uuid4().hex[:8]}")
    owner_id: str
    company_name: str
    role_title: str
    status: str = "saved"  # "saved" | "applied" | "interviewing" | "archived"
    user_notes: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @model_validator(mode="before")
    @classmethod
    def reject_speculative_hiring_probability(cls, data: Any) -> Any:
        """
        Implement 4 & B21-AC1:
        Include actual application/project notes only as optional user-entered supporting records;
        NO speculative hiring probability or simulated conversion odds.
        """
        if isinstance(data, dict):
            if "speculative_hiring_probability" in data and data["speculative_hiring_probability"] is not None:
                raise ValueError(
                    "Speculative hiring probabilities are strictly prohibited (B21-AC1)."
                )
            if "hiring_odds" in data and data["hiring_odds"] is not None:
                raise ValueError(
                    "Simulated hiring odds are strictly prohibited (B21-AC1)."
                )
        return data


# In-memory store for application records
_APPLICATION_STORE: Dict[str, List[UserApplicationRecord]] = {}


def save_user_application(record: UserApplicationRecord) -> UserApplicationRecord:
    records = _APPLICATION_STORE.setdefault(record.owner_id, [])
    # Replace if exists, else append
    records = [r for r in records if r.id != record.id]
    records.append(record)
    _APPLICATION_STORE[record.owner_id] = records
    return record


def list_user_applications(owner_id: str) -> List[UserApplicationRecord]:
    return _APPLICATION_STORE.get(owner_id, [])


def reset_application_store() -> None:
    _APPLICATION_STORE.clear()


# -----------------------------------------------------------------------------
# Canonical Progress Projection (B21-AC1, B21-AC2)
# -----------------------------------------------------------------------------

DIMENSION_MAP = {
    "dsa": ("Algorithms & Data Structures", lambda k: k.startswith("dsa.") or k in (
        "two_sum_hash_map", "two_pointers_converge", "prefix_sums", "while_loop_invariant"
    )),
    "cs": ("CS Fundamentals & Operating Systems", lambda k: k.startswith("cs.")),
    "ml_sql": ("Applied AI/ML & SQL", lambda k: k.startswith("ml.") or k.startswith("sql.")),
    "project": ("System Architecture & Defense", lambda k: k.startswith("project.")),
    "behavioral": ("Behavioral & STAR Impact", lambda k: k.startswith("behavioral.")),
}


def _detect_unsupported_percentage_claims(text: str) -> List[str]:
    """Finds conversationally claimed percentages (e.g. 85% ready, 5-7% progress)."""
    matches = re.findall(r"\b\d{1,3}(?:[–-]\d{1,3})?%\s*(?:ready|readiness|progress|chance)?\b", text, re.IGNORECASE)
    return [m.strip() for m in matches if m.strip()]


def compute_canonical_progress_projection(
    owner_id: str,
    observations: List[LearningObservation],
) -> ProgressProjection:
    """
    B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.

    Constructs capability dimensions STRICTLY from canonical observations.
    - Only independent learner work with demonstrated=True is credited as verified.
    - Guided, tutor-supplied, unassessed, or retracted demonstrations are classified as uncertain.
    - Any conversational progress percentages or simulated mock scores are explicitly rejected.
    """
    dimensions: Dict[str, CapabilityDimension] = {
        dim_key: CapabilityDimension(dimension_key=dim_key, title=title)
        for dim_key, (title, _) in DIMENSION_MAP.items()
    }

    disclaimed_percentages: List[str] = []

    # Map each competency to its latest effective status
    competency_status: Dict[str, Dict[str, Any]] = {}

    for obs in observations:
        if obs.owner_id != owner_id:
            continue

        # Check for unsupported percentage claims in evidence text (B21-AC1)
        claims = _detect_unsupported_percentage_claims(obs.evidence_text)
        if claims:
            disclaimed_percentages.extend(claims)

        # Record or supersede status
        key = obs.competency_key
        is_independent_demonstration = (
            obs.demonstrated is True
            and obs.assistance_level == AssistanceLevel.INDEPENDENT
            and obs.source_kind == SourceKind.LEARNER_WORK
        )

        existing = competency_status.get(key)
        if existing is None:
            competency_status[key] = {
                "demonstrated": is_independent_demonstration,
                "assistance_level": obs.assistance_level,
                "source_kind": obs.source_kind,
                "evidence_count": 1,
                "unsupported_claims": claims,
                "last_obs_id": obs.id,
            }
        else:
            existing["evidence_count"] += 1
            if claims:
                existing["unsupported_claims"].extend(claims)

            # B21-AC2: Superseding evidence update:
            # If the new observation is an independent success, it elevates the competency to verified.
            # If the new observation explicitly retracts/fails (demonstrated=False), it revokes verified status.
            if obs.demonstrated is False:
                existing["demonstrated"] = False
            elif is_independent_demonstration:
                existing["demonstrated"] = True
            existing["assistance_level"] = obs.assistance_level
            existing["last_obs_id"] = obs.id

    # Bucket into capability dimensions
    total_verified = 0
    total_uncertain = 0

    for comp_key, status in competency_status.items():
        # Identify dimension
        target_dim = "dsa"  # fallback
        for dim_key, (_, matcher) in DIMENSION_MAP.items():
            if matcher(comp_key):
                target_dim = dim_key
                break

        dim_obj = dimensions[target_dim]
        dim_obj.evidence_count += status["evidence_count"]

        # Assistance breakdown
        lvl_str = status["assistance_level"].value if hasattr(status["assistance_level"], "value") else str(status["assistance_level"])
        if lvl_str in dim_obj.assistance_breakdown:
            dim_obj.assistance_breakdown[lvl_str] += status["evidence_count"]

        if status["demonstrated"]:
            dim_obj.verified_competencies.append(comp_key)
            total_verified += 1
        else:
            dim_obj.uncertain_competencies.append(comp_key)
            total_uncertain += 1

        if status["unsupported_claims"]:
            dim_obj.unsupported_claims_rejected.extend(status["unsupported_claims"])

    # Deduplicate arrays
    for dim_obj in dimensions.values():
        dim_obj.verified_competencies = sorted(list(set(dim_obj.verified_competencies)))
        dim_obj.uncertain_competencies = sorted(list(set(dim_obj.uncertain_competencies)))
        dim_obj.unsupported_claims_rejected = sorted(list(set(dim_obj.unsupported_claims_rejected)))

    return ProgressProjection(
        owner_id=owner_id,
        dimensions=dimensions,
        total_verified_competencies=total_verified,
        total_uncertain_competencies=total_uncertain,
        disclaimed_percentages=sorted(list(set(disclaimed_percentages))),
    )


def recalculate_projection_on_evidence_change(
    owner_id: str,
    all_current_observations: List[LearningObservation],
) -> ProgressProjection:
    """
    B21-AC2: Changing/superseding evidence updates the read projection consistently.

    When observations change (e.g. observation retracted, delayed retest passed,
    or earlier attempt superseded), this calculates the fresh read-model projection
    without maintaining stale counters or cached totals.
    """
    return compute_canonical_progress_projection(owner_id, all_current_observations)


# -----------------------------------------------------------------------------
# Quiet Debrief & Weekly Review (B21-AC3)
# -----------------------------------------------------------------------------


def build_quiet_session_debrief(
    owner_id: str,
    session_id: str,
    classroom_id: str,
    session_observations: List[LearningObservation],
    track: str = "dsa",
    specific_gaps: Optional[List[Dict[str, Any]]] = None,
) -> QuietSessionDebrief:
    """
    B21-AC3: User can reach the next lesson without navigating a dashboard wall.

    Produces a quiet, focused debrief:
    1. What improved (verified skills with concrete evidence text).
    2. What remains uncertain (skills requiring delayed transfer or specific gaps).
    3. Single next step linking directly to the next lesson or transfer activity.
    """
    what_improved: List[Dict[str, Any]] = []
    what_remains_uncertain: List[Dict[str, Any]] = []
    has_assisted = False

    for obs in session_observations:
        if obs.assistance_level in (AssistanceLevel.GUIDED, AssistanceLevel.TUTOR_SUPPLIED):
            has_assisted = True

        if obs.demonstrated and obs.assistance_level == AssistanceLevel.INDEPENDENT:
            what_improved.append({
                "competency_key": obs.competency_key,
                "status": "verified",
                "evidence_text": obs.evidence_text,
            })
        else:
            what_remains_uncertain.append({
                "competency_key": obs.competency_key,
                "status": "requires_unassisted_transfer",
                "assistance_level": obs.assistance_level.value,
                "evidence_text": obs.evidence_text,
            })

    if specific_gaps:
        for gap in specific_gaps:
            what_remains_uncertain.append({
                "competency_key": gap.get("gap_key", "unresolved_gap"),
                "status": "specific_gap",
                "evidence_text": gap.get("description", "Needs focused practice."),
            })

    # Direct Next Action (B21-AC3: No dashboard wall!)
    if what_remains_uncertain:
        first_uncertain = what_remains_uncertain[0]["competency_key"]
        next_step = NextLessonRecommendation(
            activity_id=f"act_transfer_{first_uncertain.replace('.', '_')}",
            title=f"Practice Unassisted Transfer: {first_uncertain}",
            track=track,
            reason=f"Solidify {first_uncertain} with an independent, blank-editor transfer problem.",
            route=f"/classrooms/{classroom_id}",
            action_label="Start Independent Transfer",
        )
    else:
        next_step = NextLessonRecommendation(
            activity_id="act_next_sequential_lesson",
            title="Continue Curriculum: Next Lesson",
            track=track,
            reason="All targets in this session verified independently; advance to the next micro-skill.",
            route=f"/classrooms/{classroom_id}",
            action_label="Start Next Lesson",
        )

    return QuietSessionDebrief(
        session_id=session_id,
        owner_id=owner_id,
        classroom_id=classroom_id,
        what_improved=what_improved,
        what_remains_uncertain=what_remains_uncertain,
        next_step=next_step,
        is_assisted=has_assisted,
        unsupported_percentages_excluded=True,
    )


def build_quiet_weekly_review(
    owner_id: str,
    observations: List[LearningObservation],
) -> QuietWeeklyReview:
    """
    Builds a calm, concise weekly review of verified achievements vs active gaps,
    strictly without clutter, fake streaks, or gamified leaderboards.
    """
    projection = compute_canonical_progress_projection(owner_id, observations)

    verified: List[str] = []
    uncertain: List[str] = []

    for dim in projection.dimensions.values():
        verified.extend(dim.verified_competencies)
        uncertain.extend(dim.uncertain_competencies)

    # Next recommended activities
    recommendations: List[NextLessonRecommendation] = []
    for u in uncertain[:3]:
        recommendations.append(
            NextLessonRecommendation(
                activity_id=f"act_review_{u.replace('.', '_')}",
                title=f"Reinforce {u}",
                track="general",
                reason=f"Target identified gap '{u}' with a 20-minute focused transfer exercise.",
                route="/prep",
                action_label="Begin Practice",
            )
        )

    return QuietWeeklyReview(
        owner_id=owner_id,
        verified_this_week=sorted(list(set(verified))),
        uncertain_this_week=sorted(list(set(uncertain))),
        next_recommended_activities=recommendations,
        clutter_free=True,
    )
