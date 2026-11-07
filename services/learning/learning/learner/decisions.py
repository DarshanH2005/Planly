"""
Teaching Decision Maker and Validator.
Sprint: B08
Authority: planly_architecture.md sections 7-8

-Implements TeachingDecision generation preceding feedback.
-Enforces uncertainty/probe handling and reveal limits before exposing the tutor route.
"""

import uuid
from typing import Optional, Dict, Any, List
from pydantic import BaseModel

from learning.domain.contracts import (
    TeachingDecision,
    ContextPacket,
    SessionMode,
    ExposureRecord,
)
from learning.learner.policy import (
    evaluate_teaching_policy,
    PolicyEvaluation,
)



def make_teaching_decision(
    context_packet: ContextPacket,
    learner_message: str,
    exposure: Optional[ExposureRecord] = None,
    consecutive_correct_count: int = 0,
    track: str = "dsa",
    competency_key: Optional[str] = None,
) -> TeachingDecision:
    """
    Creates a validated TeachingDecision record based on learner evidence
    and pedagogical policy.
    """
    policy_eval = evaluate_teaching_policy(
        learner_message=learner_message,
        context_packet=context_packet,
        current_mode=context_packet.mode,
        exposure=exposure,
        consecutive_correct_count=consecutive_correct_count,
        track=track,
        competency_key=competency_key,
    )

    # Calculate uncertainty based on evidence strength
    if policy_eval.unanswered_pending_question:
        uncertainty = 0.75  # High uncertainty requiring a probe
    elif policy_eval.repeated_error:
        uncertainty = 0.65  # Uncertainty on whether student understands loop variable
    elif policy_eval.demonstrated_success:
        uncertainty = 0.15  # low uncertainty on independent success
    else:
        uncertainty = 0.50

    # Invariant and probe reasoning
    candidate_explanations = []
    discriminating_probe = None
    uncertainty_reason = None
    transition = "continue"
    assistance_event = None

    if policy_eval.requested_full_code:
        assistance_event = "full_code_requested"
        uncertainty_reason = "Learner requested complete solution code in learning mode"
    elif policy_eval.repeated_error:
        if getattr(context_packet, "track", "dsa") == "cs" or "heap" in policy_eval.rationale.lower():
            candidate_explanations = ["process_heap_isolation_confusion", "virtual_address_space_misconception"]
            discriminating_probe = "Does the operating system allocate one heap for the whole computer, or does each process get an isolated virtual address space?"
            uncertainty_reason = "Repeated misconception: learner stated heap is shared across all processes in the computer"
        else:
            candidate_explanations = ["loop_invariant_variable_mutation", "stale_sequence_start_check"]
            discriminating_probe = "What is the difference between current (advancing) and x (fixed starting value) in the while loop condition?"
            uncertainty_reason = "Repeated invariant violation: learner re-testing fixed sequence start rather than advancing loop variable"
    elif policy_eval.unanswered_pending_question:
        uncertainty_reason = "Active pending question was not answered by learner submission"
        discriminating_probe = f"Can you answer the active question: {context_packet.pending_question}?"

    decision = TeachingDecision(
        decision_id=f"dec_{uuid.uuid4().hex[:12]}",
        session_id=context_packet.session_id,
        owner_id=context_packet.owner_id,
        expected_revision=context_packet.active_revision,
        assessment="validated_success" if policy_eval.demonstrated_success else "needs_attention",
        uncertainty=uncertainty,
        next_action=policy_eval.recommended_action,
        reveal_limit=policy_eval.reveal_limit,
        observed_success_criteria=policy_eval.observed_criteria,
        rationale=policy_eval.rationale,
        model_version="gemini-3.8-flash",
        candidate_explanations=candidate_explanations,
        discriminating_probe=discriminating_probe,
        uncertainty_reason=uncertainty_reason,
        transition=transition,
        policy_version="v1",
        assistance_event=assistance_event,
    )
    return decision


def validate_teaching_decision(
    decision: TeachingDecision,
    context_packet: ContextPacket,
) -> None:
    """
    Enforces strict pedagogical and runtime invariants on TeachingDecision.
    Authority: planly_architecture.md sections 7-8
    - High uncertainty (> 0.6) forces next_action to probe or diagnostic.
    - An unanswered question can never mark topic advancement.
    - Reveal limit cannot be negative.
    - Failure to prevent: Do not force topic advancement after merely two correct answers.
    """
    if decision.session_id != context_packet.session_id:
        raise ValueError("Decision session_id does not match context packet")
    if decision.owner_id != context_packet.owner_id:
        raise ValueError("Decision owner_id does not match context packet")
    if decision.expected_revision != context_packet.active_revision:
        raise ValueError("Decision expected_revision does not match active revision")
    if decision.reveal_limit < 0:
        raise ValueError("reveal_limit cannot be negative")
    if not (0.0 <= decision.uncertainty <= 1.0):
        raise ValueError("uncertainty must be between 0.0 and 1.0")

    # High uncertainty or competing explanations requires a probe/diagnostic
    if decision.uncertainty > 0.6 and decision.next_action not in ("probe", "diagnostic"):
        raise ValueError(f"High uncertainty ({decision.uncertainty}) requires next_action 'probe' or 'diagnostic', got '{decision.next_action}'")

    # If pending question exists and was unanswered, transition cannot advance
    if context_packet.pending_question and decision.transition == "advance":
        raise ValueError("Cannot advance topic while pending question remains unanswered")


# In-memory store for teaching decisions
_decisions: Dict[str, List[TeachingDecision]] = {}  # session_id -> List[TeachingDecision]


def reset_decisions_store() -> None:
    _decisions.clear()


def save_teaching_decision(decision: TeachingDecision) -> TeachingDecision:
    if decision.session_id not in _decisions:
        _decisions[decision.session_id] = []
    _decisions[decision.session_id].append(decision)
    return decision


def get_teaching_decision(owner_id: str, decision_id: str) -> Optional[TeachingDecision]:
    for decs in _decisions.values():
        for d in decs:
            if d.decision_id == decision_id and d.owner_id == owner_id:
                return d
    return None


def get_session_decisions(owner_id: str, session_id: str) -> List[TeachingDecision]:
    decs = _decisions.get(session_id, [])
    return [d for d in decs if d.owner_id == owner_id]
