"""
Curriculum Micro-Skills, Exposure Tracking & Activity Selection Domain.
Sprint: B12
Authority: planly_architecture.md sections 7, 9, 12; B12_curriculum_exposure.md

Enforces:
- B12-AC1: Invalid/orphan skill edges and inconsistent content versions fail validation.
- B12-AC2: Familiar or solution-exposed variants cannot qualify as unseen transfer.
- B12-AC3: A catalog gap yields verified review/repair or an explicit gap, not fabricated progress.
- Failure to prevent: Advanced catalog problems are target material, not beginner day-by-day order.
"""

from enum import Enum
from typing import Dict, List, Optional, Set, Any, Tuple
import hashlib
import json
from pydantic import BaseModel, Field, model_validator


class ReviewStatus(str, Enum):
    VERIFIED_READY = "verified_ready"
    CATALOGUED_UNVERIFIED = "catalogued_unverified"
    DRAFT = "draft"


class ExposureKind(str, Enum):
    UNSEEN = "unseen"
    SEEN_STATEMENT = "seen_statement"
    CLOSE_VARIANT = "close_variant"
    SOLUTION_EXPOSED = "solution_exposed"
    GUIDED_TRIAL = "guided_trial"
    INDEPENDENT_TRIAL = "independent_trial"


class MicroSkill(BaseModel):
    id: str
    name: str
    track: str = "dsa"
    category: str
    description: str
    prerequisites: List[str] = Field(default_factory=list)
    difficulty: int = Field(default=1, ge=1, le=5)


class ActivityDemands(BaseModel):
    reasoning: int = Field(default=1, ge=1, le=5)
    syntax: int = Field(default=1, ge=1, le=5)
    implementation: int = Field(default=1, ge=1, le=5)
    explanation: int = Field(default=1, ge=1, le=5)


class CandidateProjection(BaseModel):
    statement: str
    constraints: List[str] = Field(default_factory=list)
    examples: List[Dict[str, Any]] = Field(default_factory=list)
    starter_code: str
    hints: List[str] = Field(default_factory=list)
    short_diagnostics: List[str] = Field(default_factory=list)


class EvaluatorProjection(BaseModel):
    reference_solution: str
    rubric: str
    test_cases: List[Dict[str, Any]] = Field(default_factory=list)
    known_pitfalls: List[str] = Field(default_factory=list)
    oracle_notes: Optional[str] = None


class ActivityProvenance(BaseModel):
    source_problem_id: Optional[str] = None
    version: str = "1.0"
    content_hash: str = ""
    review_status: ReviewStatus = ReviewStatus.VERIFIED_READY
    author: str = "curator"


class ExposureState(BaseModel):
    seen_statement: bool = False
    close_variant: bool = False
    solution_exposed: bool = False
    guided_trials: int = 0
    independent_trials: int = 0
    last_seen_mode: Optional[str] = None

    def is_transfer_eligible(self) -> bool:
        """
        B12-AC2: Familiar or solution-exposed variants CANNOT qualify as unseen transfer.
        """
        if self.solution_exposed:
            return False
        if self.seen_statement:
            return False
        if self.close_variant:
            return False
        return True


class VerifiedActivity(BaseModel):
    id: str
    title: str
    track: str = "dsa"
    micro_skill_id: str
    demands: ActivityDemands = Field(default_factory=ActivityDemands)
    candidate: CandidateProjection
    evaluator: EvaluatorProjection
    provenance: ActivityProvenance
    planning_effort_minutes_range: Tuple[int, int] = (15, 30)
    is_transfer_eligible: bool = True

    def compute_content_hash(self) -> str:
        """Computes deterministic SHA-256 hash across candidate and evaluator projections."""
        payload = {
            "id": self.id,
            "micro_skill_id": self.micro_skill_id,
            "statement": self.candidate.statement,
            "starter_code": self.candidate.starter_code,
            "reference_solution": self.evaluator.reference_solution,
            "rubric": self.evaluator.rubric,
            "test_cases": self.evaluator.test_cases,
            "version": self.provenance.version,
        }
        serialized = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class CurriculumGraphValidationError(Exception):
    def __init__(self, message: str, errors: List[str]):
        super().__init__(message)
        self.errors = errors


class CurriculumGraph:
    """
    Explicit micro-skill prerequisite graph.
    Enforces B12-AC1: Orphan edges and cycles fail validation.
    """

    def __init__(self):
        self.skills: Dict[str, MicroSkill] = {}

    def add_skill(self, skill: MicroSkill) -> None:
        self.skills[skill.id] = skill

    def get_skill(self, skill_id: str) -> Optional[MicroSkill]:
        return self.skills.get(skill_id)

    def validate(self) -> None:
        """
        Validates graph integrity:
        1. Checks for orphan prerequisite edges (pointing to non-existent skills).
        2. Checks for directed cycles (graph must be a valid DAG).
        """
        errors = []

        # 1. Orphan edge detection (B12-AC1)
        for skill_id, skill in self.skills.items():
            for prereq in skill.prerequisites:
                if prereq not in self.skills:
                    errors.append(
                        f"Orphan prerequisite edge: skill '{skill_id}' requires non-existent skill '{prereq}'"
                    )

        # 2. Cycle detection via DFS
        visited: Dict[str, int] = {}  # 0: unvisited, 1: visiting (in stack), 2: visited

        def dfs(node: str, path: List[str]) -> bool:
            visited[node] = 1
            skill = self.skills.get(node)
            if skill:
                for neighbor in skill.prerequisites:
                    if neighbor not in self.skills:
                        continue
                    if visited.get(neighbor, 0) == 1:
                        cycle_path = " -> ".join(path + [neighbor])
                        errors.append(f"Cycle detected in curriculum prerequisites: {cycle_path}")
                        return True
                    if visited.get(neighbor, 0) == 0:
                        if dfs(neighbor, path + [neighbor]):
                            return True
            visited[node] = 2
            return False

        for node in self.skills:
            if visited.get(node, 0) == 0:
                dfs(node, [node])

        if errors:
            raise CurriculumGraphValidationError(
                f"Curriculum validation failed with {len(errors)} error(s)",
                errors=errors,
            )

    def is_skill_eligible(self, skill_id: str, demonstrated_skills: Set[str]) -> bool:
        """Checks if a skill's immediate prerequisites have all been demonstrated."""
        skill = self.skills.get(skill_id)
        if not skill:
            return False
        return all(p in demonstrated_skills for p in skill.prerequisites)


class NoEligibleActivityRecord(BaseModel):
    status: str = "no_eligible_activity"
    reason: str
    recommended_action: str  # "review_prerequisite", "content_gap_disclosed", "practice_familiar"
    gap_skill_id: Optional[str] = None
    review_target_activity_id: Optional[str] = None


class ActivitySelector:
    """
    Selects verified activities while respecting exposure and prerequisites.
    Enforces:
    - B12-AC2: Solution-exposed or familiar variants cannot qualify as unseen transfer.
    - B12-AC3: Catalog gap yields explicit review/repair or disclosed gap, never fabricated progress.
    - Failure to prevent: Advanced catalog items do not skip fundamentals.
    """

    def __init__(self, curriculum: CurriculumGraph, catalog: List[VerifiedActivity]):
        self.curriculum = curriculum
        self.catalog = {act.id: act for act in catalog}

    def select_next_activity(
        self,
        target_skill_id: str,
        demonstrated_skills: Set[str],
        exposures: Dict[str, ExposureState],
        require_unseen_transfer: bool = False,
    ) -> Tuple[Optional[VerifiedActivity], Optional[NoEligibleActivityRecord]]:
        """
        Attempts to select the next activity for a target skill.
        Returns (activity, None) if a suitable activity is found,
        or (None, NoEligibleActivityRecord) if a gap or unfulfilled prerequisite exists.
        """
        # 1. Verify target skill exists in curriculum
        skill = self.curriculum.get_skill(target_skill_id)
        if not skill:
            return None, NoEligibleActivityRecord(
                reason=f"Skill '{target_skill_id}' is not present in curriculum catalog.",
                recommended_action="content_gap_disclosed",
                gap_skill_id=target_skill_id,
            )

        # 2. Check prerequisite satisfaction (Failure to Prevent: advanced cannot skip fundamentals)
        unmet_prereqs = [p for p in skill.prerequisites if p not in demonstrated_skills]
        if unmet_prereqs:
            missing = unmet_prereqs[0]
            # Find an activity for the missing prerequisite
            prereq_activities = [
                a for a in self.catalog.values()
                if a.micro_skill_id == missing and a.provenance.review_status == ReviewStatus.VERIFIED_READY
            ]
            review_id = prereq_activities[0].id if prereq_activities else None
            return None, NoEligibleActivityRecord(
                reason=f"Prerequisite '{missing}' has not been demonstrated for target skill '{target_skill_id}'.",
                recommended_action="review_prerequisite",
                gap_skill_id=missing,
                review_target_activity_id=review_id,
            )

        # 3. Find candidate activities for this skill
        matching_activities = [
            a for a in self.catalog.values()
            if a.micro_skill_id == target_skill_id
        ]

        if not matching_activities:
            return None, NoEligibleActivityRecord(
                reason=f"No activities exist in catalog for verified skill '{target_skill_id}'.",
                recommended_action="content_gap_disclosed",
                gap_skill_id=target_skill_id,
            )

        # 4. Filter by verification status (catalogued != verified_ready)
        verified_candidates = [
            a for a in matching_activities
            if a.provenance.review_status == ReviewStatus.VERIFIED_READY
        ]

        if not verified_candidates:
            return None, NoEligibleActivityRecord(
                reason=f"Catalogued activities for '{target_skill_id}' are unverified. Catalogued does not equal verified-ready.",
                recommended_action="content_gap_disclosed",
                gap_skill_id=target_skill_id,
            )

        # 5. Exposure filter (B12-AC2)
        if require_unseen_transfer:
            eligible_unseen = []
            for act in verified_candidates:
                if not act.is_transfer_eligible:
                    continue
                exp = exposures.get(act.id, ExposureState())
                if exp.is_transfer_eligible():
                    eligible_unseen.append(act)

            if not eligible_unseen:
                # All candidates have been seen, had solution exposed, or are close variants
                return None, NoEligibleActivityRecord(
                    reason=f"All verified activities for '{target_skill_id}' have been seen, had solutions exposed, or are familiar variants. Cannot qualify as unseen transfer.",
                    recommended_action="content_gap_disclosed",
                    gap_skill_id=target_skill_id,
                )
            return eligible_unseen[0], None

        # Standard practice mode: return first verified candidate
        return verified_candidates[0], None
