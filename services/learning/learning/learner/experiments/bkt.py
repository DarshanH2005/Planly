"""
Sprint B25: Bayesian Knowledge Tracing (BKT) Core Engine
Authority: PLANLY_BUILD_SPEC.md §7, §14; B25_shadow_skill_model.md

Mathematical BKT implementation:
- P(L0): prior probability of knowing skill
- P(T): probability of transition (learning) from unlearned to learned
- P(G): probability of guess
- P(S): probability of slip
"""

from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field


class BKTParameters(BaseModel):
    p_init: float = Field(default=0.10, ge=0.0, le=1.0)
    p_transit: float = Field(default=0.15, ge=0.0, le=1.0)
    p_slip: float = Field(default=0.10, ge=0.0, le=1.0)
    p_guess: float = Field(default=0.20, ge=0.0, le=1.0)


class BKTState(BaseModel):
    competency_key: str
    p_known: float = Field(default=0.10, ge=0.0, le=1.0)
    observation_count: int = 0
    predicted_correctness_next: float = 0.0


def update_bkt_posterior(
    p_known: float,
    observed_correct: bool,
    params: BKTParameters,
) -> float:
    """
    Computes updated posterior probability of knowing the skill P(L_t | O_t)
    and then applies transition P(L_{t+1}) = P(L_t | O_t) + (1 - P(L_t | O_t)) * P(T).
    """
    p_slip = params.p_slip
    p_guess = params.p_guess
    p_transit = params.p_transit

    if observed_correct:
        numerator = p_known * (1.0 - p_slip)
        denominator = numerator + (1.0 - p_known) * p_guess
    else:
        numerator = p_known * p_slip
        denominator = numerator + (1.0 - p_known) * (1.0 - p_guess)

    if denominator <= 0.0:
        posterior = p_known
    else:
        posterior = numerator / denominator

    # Project to next step including learning transition
    p_next = posterior + (1.0 - posterior) * p_transit
    return max(0.0, min(1.0, p_next))


def predict_correctness(p_known: float, params: BKTParameters) -> float:
    """
    Predicts probability of correct response on next item:
    P(Correct) = P(Known) * (1 - P(Slip)) + (1 - P(Known)) * P(Guess)
    """
    p_slip = params.p_slip
    p_guess = params.p_guess
    prob = p_known * (1.0 - p_slip) + (1.0 - p_known) * p_guess
    return max(0.0, min(1.0, prob))


def fit_bkt_sequence(
    observations: List[bool],
    params: Optional[BKTParameters] = None,
) -> List[Tuple[float, float]]:
    """
    Runs forward BKT over a chronological boolean sequence of correctness.
    Returns list of (p_known, p_predicted_correct) at each turn.
    """
    p = params or BKTParameters()
    curr_p_known = p.p_init
    trajectory: List[Tuple[float, float]] = []

    for obs in observations:
        pred_corr = predict_correctness(curr_p_known, p)
        trajectory.append((curr_p_known, pred_corr))
        curr_p_known = update_bkt_posterior(curr_p_known, obs, p)

    return trajectory
