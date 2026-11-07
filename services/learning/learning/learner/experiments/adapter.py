"""
Sprint B25: BKT Shadow Adapter and Experiment Harness
Authority: PLANLY_BUILD_SPEC.md §7, §14; B25_shadow_skill_model.md

Enforces:
- B25-AC1: Shadow estimates cannot write canonical skill state (read-only shadow boundary).
- B25-AC2: Chronological split prevents future observation leakage.
- B25-AC3: Missing or insufficient data yields an honest insufficient-data result (no synthetic data).
- Failure to Prevent: Must never block core tutoring release or train on fake progress.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    LearningObservation,
)
from learning.repositories import evidence
from learning.learner.experiments.bkt import (
    BKTParameters,
    fit_bkt_sequence,
    predict_correctness,
    update_bkt_posterior,
)


class BKTShadowResult(BaseModel):
    competency_key: str
    owner_id: str
    status: str  # "evaluated" | "insufficient_data"
    sample_count: int
    p_known_final: Optional[float] = None
    predicted_next_correctness: Optional[float] = None
    bkt_brier_score: Optional[float] = None
    baseline_recent_accuracy: Optional[float] = None
    message: str = ""
    is_shadow_only: bool = True  # Strict B25-AC1 flag


class BKTShadowAdapter:
    """
    Shadow-mode knowledge tracing adapter.
    Evaluates historical predictions in shadow mode without touching canonical state.
    """

    def __init__(
        self,
        min_attempts_threshold: int = 5,
        parameters: Optional[BKTParameters] = None,
        recent_window: int = 3,
    ):
        self.min_attempts_threshold = min_attempts_threshold
        self.params = parameters or BKTParameters()
        self.recent_window = recent_window

    def write_canonical_state(self, *args, **kwargs):
        """
        B25-AC1 Guard: Shadow estimates are strictly forbidden from writing
        to canonical observations, projections, or learning state.
        """
        raise PermissionError(
            "Shadow estimates cannot write canonical skill state (B25-AC1)."
        )

    def extract_qualified_chronological_attempts(
        self,
        owner_id: str,
        competency_key: str,
        cutoff_timestamp: Optional[str] = None,
    ) -> List[LearningObservation]:
        """
        Extracts verified, chronological observations for a competency.
        - B25-AC2: Excludes any observation created after cutoff_timestamp.
        - Failure to Prevent: Excludes tutor-supplied, unassessed, or pure conversational claims.
        """
        all_obs = evidence.get_owner_observations(owner_id)

        qualified: List[LearningObservation] = []
        for o in all_obs:
            if o.competency_key != competency_key:
                continue

            # B25-AC2: Time cutoff check
            if cutoff_timestamp and o.created_at:
                if o.created_at > cutoff_timestamp:
                    continue

            # Failure to Prevent: Do not train on fake progress / tutor-supplied answers
            if o.source_kind == SourceKind.TUTOR_EXPLANATION:
                continue
            if o.assistance_level == AssistanceLevel.TUTOR_SUPPLIED:
                continue
            if o.assistance_level == AssistanceLevel.UNASSESSED:
                continue

            qualified.append(o)

        # Sort chronologically by created_at (B25-AC2)
        qualified.sort(key=lambda x: x.created_at or "")
        return qualified

    def evaluate_shadow_competency(
        self,
        owner_id: str,
        competency_key: str,
        cutoff_timestamp: Optional[str] = None,
    ) -> BKTShadowResult:
        """
        Evaluates BKT prediction in shadow mode.
        - B25-AC3: Returns status='insufficient_data' if qualified attempts < threshold.
        """
        attempts = self.extract_qualified_chronological_attempts(
            owner_id=owner_id,
            competency_key=competency_key,
            cutoff_timestamp=cutoff_timestamp,
        )

        # B25-AC3: Honest insufficient data result
        if len(attempts) < self.min_attempts_threshold:
            return BKTShadowResult(
                competency_key=competency_key,
                owner_id=owner_id,
                status="insufficient_data",
                sample_count=len(attempts),
                p_known_final=None,
                predicted_next_correctness=None,
                bkt_brier_score=None,
                baseline_recent_accuracy=None,
                message=(
                    f"Insufficient verified learner evidence: {len(attempts)} qualified attempts found, "
                    f"minimum {self.min_attempts_threshold} required (B25-AC3)."
                ),
                is_shadow_only=True,
            )

        # Build chronological boolean outcome vector
        outcomes = [bool(a.demonstrated) for a in attempts]

        # Fit BKT trajectory
        trajectory = fit_bkt_sequence(outcomes, self.params)
        final_p_known = trajectory[-1][0]
        predicted_next = trajectory[-1][1]

        # Evaluate predictive calibration (Brier score on one-step-ahead predictions)
        # Brier score = (1/N) * sum((prediction - actual)^2)
        squared_errors = []
        for i in range(len(outcomes)):
            pred_p = trajectory[i][1]
            actual = 1.0 if outcomes[i] else 0.0
            squared_errors.append((pred_p - actual) ** 2)
        brier_score = sum(squared_errors) / len(squared_errors)

        # Baseline recent-performance moving average
        recent_window_outcomes = outcomes[-self.recent_window :]
        baseline_acc = sum(1.0 for x in recent_window_outcomes if x) / len(recent_window_outcomes)

        return BKTShadowResult(
            competency_key=competency_key,
            owner_id=owner_id,
            status="evaluated",
            sample_count=len(attempts),
            p_known_final=final_p_known,
            predicted_next_correctness=predicted_next,
            bkt_brier_score=brier_score,
            baseline_recent_accuracy=baseline_acc,
            message="Shadow BKT prediction computed successfully without writing canonical state.",
            is_shadow_only=True,
        )
