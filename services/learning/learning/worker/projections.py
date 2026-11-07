"""
Sprint B22: Memory Projections and Source Reliability Hierarchy
Authority: PLANLY_BUILD_SPEC.md §5-6, 11-12; B22_memory_lifecycle.md

Enforces:
- B22-AC1: Old summaries cannot resurrect invalidated misconceptions.
- Failure to Prevent: Do not silently treat the newest assistant-generated summary as the most reliable source.
  Real execution evidence and verified learner work always outrank assistant summaries.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    LearningObservation,
)
from learning.repositories import evidence, corrections


class ProjectedCompetency(BaseModel):
    competency_key: str
    demonstrated: bool
    source_kind: SourceKind
    assistance_level: AssistanceLevel
    confidence: float
    evidence_text: str
    is_misconception: bool = False


class MemoryProjectionResult(BaseModel):
    owner_id: str
    active_competencies: Dict[str, ProjectedCompetency] = Field(default_factory=dict)
    invalidated_misconceptions: List[str] = Field(default_factory=list)
    tombstoned_targets: List[str] = Field(default_factory=list)


# Reliability weight hierarchy (Failure to Prevent)
SOURCE_RELIABILITY_WEIGHTS = {
    SourceKind.EXECUTION_EVIDENCE: 1.0,
    SourceKind.LEARNER_WORK: 0.9,
    SourceKind.SELF_REPORT: 0.3,
    SourceKind.DERIVED_INFERENCE: 0.2,
    SourceKind.TUTOR_EXPLANATION: 0.1,
}


def compute_evidence_weight(obs: LearningObservation) -> float:
    base = SOURCE_RELIABILITY_WEIGHTS.get(obs.source_kind, 0.2)
    if obs.assistance_level == AssistanceLevel.INDEPENDENT and obs.demonstrated:
        return base
    elif obs.assistance_level == AssistanceLevel.GUIDED:
        return base * 0.5
    else:
        return base * 0.2


def reproject_memory_state(owner_id: str) -> MemoryProjectionResult:
    """
    Reprojects memory state for owner_id:
    1. Filters out tombstoned observations.
    2. Filters out invalidated misconceptions (B22-AC1).
    3. Resolves conflicting evidence using source reliability hierarchy:
       execution evidence / learner work outranks assistant summaries (Failure to Prevent).
    """
    all_obs = evidence.get_observations(owner_id)
    active_tombstones = corrections.list_tombstones(owner_id)
    tombstoned_ids = {t.target_id for t in active_tombstones}

    # Filter out tombstoned observations
    valid_obs = [o for o in all_obs if o.id not in tombstoned_ids]

    active_competencies: Dict[str, ProjectedCompetency] = {}
    invalidated_keys: List[str] = []

    # Check for invalidated claims and misconceptions
    all_claims = corrections._memory_claims.values()
    invalidated_claim_keys = {
        c.competency_key for c in all_claims
        if c.owner_id == owner_id and c.status == "invalidated"
    }
    invalidated_claim_keys.update(corrections.get_invalidated_misconceptions(owner_id))

    # Group observations by competency key
    by_key: Dict[str, List[LearningObservation]] = {}
    for o in valid_obs:
        by_key.setdefault(o.competency_key, []).append(o)

    for key, obs_group in by_key.items():
        if key in invalidated_claim_keys:
            invalidated_keys.append(key)
            # Do NOT resurrect an invalidated misconception!
            continue

        # Sort observations by reliability weight descending, then by creation
        sorted_obs = sorted(obs_group, key=compute_evidence_weight, reverse=True)
        top_obs = sorted_obs[0]
        weight = compute_evidence_weight(top_obs)

        active_competencies[key] = ProjectedCompetency(
            competency_key=key,
            demonstrated=top_obs.demonstrated and (top_obs.assistance_level == AssistanceLevel.INDEPENDENT),
            source_kind=top_obs.source_kind,
            assistance_level=top_obs.assistance_level,
            confidence=weight,
            evidence_text=top_obs.evidence_text,
        )

    return MemoryProjectionResult(
        owner_id=owner_id,
        active_competencies=active_competencies,
        invalidated_misconceptions=list(invalidated_claim_keys),
        tombstoned_targets=list(tombstoned_ids),
    )


def resolve_authoritative_claim_source(
    learner_execution_claim: Optional[Dict[str, Any]],
    assistant_generated_summary: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Failure to Prevent:
    Do not silently treat the newest assistant-generated summary as the most reliable source.
    """
    if learner_execution_claim:
        return {
            "selected_source": "learner_execution",
            "source_kind": SourceKind.EXECUTION_EVIDENCE.value,
            "claim": learner_execution_claim,
            "authority_rank": 1,
            "weight": SOURCE_RELIABILITY_WEIGHTS[SourceKind.EXECUTION_EVIDENCE],
            "note": "Authoritative learner execution outranks assistant summary (Failure to Prevent).",
        }
    if assistant_generated_summary:
        return {
            "selected_source": "assistant_summary",
            "source_kind": SourceKind.TUTOR_EXPLANATION.value,
            "claim": assistant_generated_summary,
            "authority_rank": 2,
            "weight": SOURCE_RELIABILITY_WEIGHTS[SourceKind.TUTOR_EXPLANATION],
            "note": "Fallback assistant summary (lower authority rank).",
        }
    return {
        "selected_source": "none",
        "source_kind": "unknown",
        "claim": None,
        "authority_rank": 99,
        "note": "No source available.",
    }
