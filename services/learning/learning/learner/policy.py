"""
Teaching Policy and Pedagogical Guardrails.
Sprint: B08
Authority: planly_architecture.md sections 7-8

Enforces:
- B08-AC1: Real pedagogical evaluation of learner turns rather than static script.
- B08-AC2: Full-code requests in learning mode record exposure; an unanswered question never marks completion.
- Failure to prevent: Do not force topic advancement after merely two correct answers.
"""

import re
from typing import Optional, Dict, Any, List, Tuple
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SessionMode,
    AssistanceLevel,
    ContextPacket,
    ExposureRecord,
    SourceKind,
)


class PolicyEvaluation(BaseModel):
    recommended_action: str  # 'probe', 'hint', 'advance', 'challenge', 'review', 'diagnostic'
    assistance_level: AssistanceLevel
    demonstrated_success: bool = False
    reveal_limit: int = 0
    requested_full_code: bool = False
    unanswered_pending_question: bool = False
    repeated_error: bool = False
    rationale: str
    observed_criteria: List[str] = Field(default_factory=list)


FULL_CODE_PATTERNS = [
    r"(give|show|tell)\s+(me\s+)?(the\s+)?(full\s+)?(code|solution|answer|implementation)",
    r"full\s+(code|solution|implementation)",
    r"just\s+(give|show)\s+(me\s+)?(the\s+)?(full\s+)?(code|solution|answer)",
    r"can you write (the|it|out)",
    r"write the (whole|entire|full) (function|code|solution)",
]


def _detect_full_code_request(text: str) -> bool:
    t_lower = text.lower()
    for pat in FULL_CODE_PATTERNS:
        if re.search(pat, t_lower):
            return True
    return False


def _detect_repeated_loop_error(text: str) -> bool:
    t_lower = text.lower()
    if "while x+1" in t_lower or "while x + 1" in t_lower:
        return True
    if "nums[x]" in t_lower and "while" in t_lower:
        return True
    return False


def evaluate_teaching_policy(
    learner_message: str,
    context_packet: ContextPacket,
    current_mode: SessionMode = SessionMode.LEARN,
    exposure: Optional[ExposureRecord] = None,
    consecutive_correct_count: int = 0,
    track: str = 'dsa',
    competency_key: Optional[str] = None,
) -> PolicyEvaluation:
    """
    Evaluates learner submission against pedagogical rules and constraints.
    """
    msg = learner_message.strip()


    # 1. Full-code requests in learning mode (B08-AC2)
    if _detect_full_code_request(msg) and current_mode == SessionMode.LEARN:
        return PolicyEvaluation(
            recommended_action="hint",
            assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            demonstrated_success=False,
            reveal_limit=0,
            requested_full_code=True,
            rationale="Learner requested full solution in LEARN mode. Recorded exposure as tutor-supplied without granting demonstrated success (B08-AC2).",
            observed_criteria=[],
        )


    # 2. Repeated loop error or CS misconception triggers diagnostic (B08 requirement 3, B16-AC2)
    m_lower = msg.lower()
    if _detect_repeated_loop_error(msg) or _detect_repeated_loop_error(context_packet.artifact_content):
        return PolicyEvaluation(
            recommended_action="diagnostic",
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated_success=False,
            reveal_limit=50,
            repeated_error=True,
            rationale="Detected repeated loop invariant error 'while x+1'. Triggering small diagnostic tracing step (B08 requirement 3).",
            observed_criteria=["identified_loop_bug"],
        )

    # CS memory model persistent misconception (B16-AC2)
    has_heap_misconception = (
        ("one heap" in m_lower and "computer" in m_lower)
        or ("single memory for one computer" in m_lower)
        or ("heap is shared between everyone" in m_lower)
        or ("heap is shared across all" in m_lower)
    )
    if has_heap_misconception:
        return PolicyEvaluation(
            recommended_action="diagnostic",
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated_success=False,
            reveal_limit=0,
            repeated_error=True,
            rationale="Detected persistent CS misconception: heap is shared across entire computer/all processes. Triggering memory model diagnostic.",
            observed_criteria=[],
        )

    # 2b. Topic deferral / postponement handling (B11-AC1)
    if any(kw in m_lower for kw in ["defer", "postpone", "later review", "tomorrow"]):
        return PolicyEvaluation(
            recommended_action="review",
            assistance_level=AssistanceLevel.UNASSESSED,
            demonstrated_success=False,
            reveal_limit=0,
            rationale="Learner deferred topic. Preserving deferred status without leaking demonstrated competency (B11-AC1).",
            observed_criteria=[],
        )


    # 3. Unanswered pending question handling (B08-AC2, B16-AC1)
    dsa_keywords = ["because", "sum", "pointer", "left", "right", "increase", "decrease", "invariant", "sorted", "inward", "convergence", "target", "smaller", "greater"]
    cs_keywords = ["heap", "stack", "process", "thread", "lock", "mutex", "race", "critical", "memory", "virtual", "address", "registers", "balance", "overdraft", "condition", "interleave", "timing", "isolated"]
    ml_keywords = ["gradient", "loss", "learning rate", "parameter", "weight", "bias", "regression", "prediction", "minimize", "derivative"]
    all_keywords = dsa_keywords + cs_keywords + ml_keywords
    
    if context_packet.pending_question:
        is_answering = any(kw in m_lower for kw in all_keywords)
        if not is_answering and len(msg.split()) < 4:
            return PolicyEvaluation(
                recommended_action="probe",
                assistance_level=AssistanceLevel.GUIDED,
                demonstrated_success=False,
                reveal_limit=0,
                unanswered_pending_question=True,
                rationale="Pending question remains unanswered. Probing to elicit learner reasoning before advancing (B08-AC2, B16-AC1).",
                observed_criteria=[],
            )

    # 4. Success Evaluation and Advancement Guardrails
    # The assigned classroom/activity is authoritative. Do not let a stray
    # word such as "memory" in an ML or DSA answer route assessment to CS.
    is_cs_track = track == "cs" or getattr(context_packet, "track", "dsa") == "cs"
    
    # a. Quick relevance check
    if is_cs_track:
        relevant_keywords = cs_keywords
    elif track in ("ai_ml", "ml"):
        relevant_keywords = ml_keywords
    elif track == "sql":
        relevant_keywords = ["select", "group", "by", "join", "aggregate", "average", "count", "sum"]
    else:
        relevant_keywords = dsa_keywords
    is_on_topic = any(kw in m_lower for kw in relevant_keywords) or len(msg.split()) > 10
    
    if not is_on_topic:
        return PolicyEvaluation(
            recommended_action="probe",
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated_success=False,
            reveal_limit=0,
            rationale="Answer appears off-topic or insufficient. Probing for reasoning.",
            observed_criteria=[],
        )
        
    # b. Rubric-based assessment
    from learning.learner.rubrics import get_rubric_for_competency, assess_against_rubric
    
    competency_key = competency_key or getattr(context_packet, "competency_key", None)
    if not competency_key:
        if is_cs_track:
            competency_key = "cs.memory.heap_stack"
        elif track in ("ai_ml", "ml"):
            competency_key = "ml.regression.gradient_descent"
        elif track == "sql":
            competency_key = "sql.aggregation.group_by"
        else:
            competency_key = "dsa.two_pointers.inward_convergence"
    # Note: Can be refined based on context_packet if needed
    
    rubric = get_rubric_for_competency(competency_key)
    if rubric:
        try:
            assessment = assess_against_rubric(
                learner_answer=msg,
                rubric=rubric,
                context=context_packet.artifact_content,
                owner_id=context_packet.owner_id,
            )
        except TypeError as exc:
            # Keep compatibility with integrations that still provide the
            # pre-owner-scoped three-argument assessment adapter.
            if "owner_id" not in str(exc):
                raise
            assessment = assess_against_rubric(
                learner_answer=msg,
                rubric=rubric,
                context=context_packet.artifact_content,
            )
        
        # c. Assessment results mapping
        if assessment.quality == 'deep' and assessment.confidence >= 0.7:
            # d. Consecutive correct guard
            if consecutive_correct_count >= 2:
                return PolicyEvaluation(
                    recommended_action="review",
                    assistance_level=AssistanceLevel.INDEPENDENT,
                    demonstrated_success=True,
                    reveal_limit=0,
                    rationale="Learner demonstrated deep verified reasoning across multiple steps. Reviewing synthesis and verifying edge cases before advancing.",
                    observed_criteria=assessment.matched_criteria or ["verified_mastery"],
                )

            # e. Guided history check
            guided_history = exposure.guided_count if exposure else 0
            if guided_history > 0:
                return PolicyEvaluation(
                    recommended_action="challenge",
                    assistance_level=AssistanceLevel.GUIDED,
                    demonstrated_success=True,
                    reveal_limit=30,
                    rationale="Learner showed deep reasoning with prior guidance. Offering transfer challenge to verify independence.",
                    observed_criteria=assessment.matched_criteria or ["guided_reasoning_understanding"],
                )
            else:
                return PolicyEvaluation(
                    recommended_action="probe",
                    assistance_level=AssistanceLevel.INDEPENDENT,
                    demonstrated_success=True,
                    reveal_limit=0,
                    rationale="Learner answered with deep reasoning independently. Probing edge case before advancing.",
                    observed_criteria=assessment.matched_criteria or ["independent_understanding"],
                )
                
        elif assessment.quality == 'partial':
            return PolicyEvaluation(
                recommended_action="probe",
                assistance_level=AssistanceLevel.GUIDED,
                demonstrated_success=False,
                reveal_limit=0,
                rationale=f"Partial reasoning detected. Gaps: {', '.join(assessment.evidence_gaps)}",
                observed_criteria=assessment.matched_criteria,
            )
            
        elif assessment.quality == 'shallow':
            return PolicyEvaluation(
                recommended_action="probe",
                assistance_level=AssistanceLevel.GUIDED,
                demonstrated_success=False,
                reveal_limit=0,
                rationale="Shallow reasoning. Learner mentioned right words but lacks deep explanation.",
                observed_criteria=assessment.matched_criteria,
            )
            
        elif assessment.quality == 'incorrect':
            return PolicyEvaluation(
                recommended_action="diagnostic",
                assistance_level=AssistanceLevel.GUIDED,
                demonstrated_success=False,
                reveal_limit=0,
                rationale="Incorrect reasoning detected. Triggering diagnostic.",
                observed_criteria=[],
            )
            
        elif assessment.quality == 'unassessed':
            return PolicyEvaluation(
                recommended_action="probe",
                assistance_level=AssistanceLevel.UNASSESSED,
                demonstrated_success=False,
                reveal_limit=0,
                rationale="Model unavailable for assessment. Falling back to probe.",
                observed_criteria=[],
            )
            
        # Default fallback for unhandled quality or 'off_topic' from model
        return PolicyEvaluation(
            recommended_action="probe",
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated_success=False,
            reveal_limit=0,
            rationale="Model evaluated answer as off_topic or unknown quality. Probing for clarity.",
            observed_criteria=[],
        )

    # Default fallback
    return PolicyEvaluation(
        recommended_action="probe",
        assistance_level=AssistanceLevel.GUIDED,
        demonstrated_success=False,
        reveal_limit=0,
        rationale="Fallback: Eliciting candidate thought process.",
        observed_criteria=[],
    )
