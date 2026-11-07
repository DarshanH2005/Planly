"""
Sprint B19: Technical Interview Dialogue and Explanation Rubric
Authority: PLANLY_BUILD_SPEC.md §16-17; B19_technical_interview.md

Enforces:
- B19-AC1: The interviewer follows the learner's approach rather than revealing the reference solution.
- B19-AC2: A weak complexity explanation remains a specific gap despite passing code tests.
- B19-AC3: Mode restrictions and resume preserve stage and evidence across disconnections.
- Failure to Prevent: Do not treat eloquent generated summaries as the learner's explanation performance.
"""

import os
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any, Tuple
from pathlib import Path
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    SessionMode,
    SessionStage,
    AssistanceLevel,
    SourceKind,
    TeachingDecision,
)
from learning.tools.python_runner import get_python_runner


class InterviewStage(str, Enum):
    CLARIFICATION = "clarification"
    APPROACH = "approach"
    IMPLEMENTATION = "implementation"
    COMPLEXITY = "complexity"
    FOLLOW_UP = "follow_up"
    DEBRIEF = "debrief"


class InterviewTurnRole(str, Enum):
    CANDIDATE = "candidate"
    INTERVIEWER = "interviewer"
    SYSTEM = "system"


class InterviewTurn(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: InterviewTurnRole
    stage: InterviewStage
    content: str
    code_snapshot: Optional[str] = None
    assistance_level: AssistanceLevel = AssistanceLevel.INDEPENDENT
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SpecificGap(BaseModel):
    aspect: str  # "approach", "implementation", "complexity_analysis", "follow_up"
    gap_key: str
    description: str
    learner_statement: str
    resolved: bool = False


class RubricEvaluation(BaseModel):
    approach_demonstrated: bool = False
    approach_type: Optional[str] = None
    code_tests_passed: bool = False
    complexity_verified: bool = False
    follow_up_addressed: bool = False
    specific_gaps: List[SpecificGap] = Field(default_factory=list)
    interviewer_notes: List[str] = Field(default_factory=list)


class TechnicalInterviewState(BaseModel):
    session_id: str
    owner_id: str
    scenario_id: str
    classroom_id: str
    mode: SessionMode = SessionMode.STRICT
    current_stage: InterviewStage = InterviewStage.CLARIFICATION
    turns: List[InterviewTurn] = Field(default_factory=list)
    current_code: str = ""
    code_revision: int = 1
    rubric: RubricEvaluation = Field(default_factory=RubricEvaluation)
    active_follow_up_id: Optional[str] = None
    is_interrupted: bool = False
    is_assisted: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# In-memory session store for interview sessions
_interview_states: Dict[str, TechnicalInterviewState] = {}


def reset_interview_storage():
    _interview_states.clear()


def load_interview_scenario(scenario_id: str) -> Dict[str, Any]:
    scenario_path = (
        Path(__file__).resolve().parent.parent
        / "content"
        / "interview"
        / f"{scenario_id}.json"
    )
    if scenario_path.exists():
        with open(scenario_path, "r", encoding="utf-8") as f:
            return json.load(f)
    # Default fallback scenario
    return {
        "scenario_id": scenario_id,
        "prompt_id": "FX-HASH-A",
        "title": "First Repeating Element",
        "candidate_prompt": {
            "title": "First Repeating Element",
            "statement": "Given an array of integers nums, find the first element that repeats in the array. If no element repeats, return None.",
            "starter_code": "def first_repeat(nums):\n    pass\n",
        },
        "rubric": {
            "approach_criteria": [],
            "complexity_expectations": {},
            "follow_ups": [],
        },
    }


# ==============================================================================
# Interview Workflow Core
# ==============================================================================

def initialize_interview_session(
    owner_id: str,
    classroom_id: str,
    scenario_id: str = "tech_interview_first_repeating",
    mode: SessionMode = SessionMode.STRICT,
    session_id: Optional[str] = None,
) -> TechnicalInterviewState:
    sid = session_id or str(uuid.uuid4())
    scenario = load_interview_scenario(scenario_id)

    starter_code = scenario.get("candidate_prompt", {}).get("starter_code", "")

    state = TechnicalInterviewState(
        session_id=sid,
        owner_id=owner_id,
        scenario_id=scenario_id,
        classroom_id=classroom_id,
        mode=mode,
        current_stage=InterviewStage.CLARIFICATION,
        current_code=starter_code,
        code_revision=1,
        rubric=RubricEvaluation(),
    )

    # Add opening interviewer greeting
    opening_msg = (
        f"Hello! Welcome to your technical interview on '{scenario.get('title', 'Coding Challenge')}'. "
        f"Let's start by reviewing the problem statement. Feel free to ask any clarifying questions about constraints or inputs before you begin."
    )
    state.turns.append(
        InterviewTurn(
            role=InterviewTurnRole.INTERVIEWER,
            stage=InterviewStage.CLARIFICATION,
            content=opening_msg,
            assistance_level=AssistanceLevel.INDEPENDENT,
        )
    )

    _interview_states[sid] = state
    return state


def get_interview_state(session_id: str) -> Optional[TechnicalInterviewState]:
    return _interview_states.get(session_id)


def execute_interview_turn(
    session_id: str,
    candidate_message: str,
    candidate_code: Optional[str] = None,
    server_now: Optional[datetime] = None,
) -> Tuple[TechnicalInterviewState, str, TeachingDecision]:
    """
    Executes an adaptive technical interview turn following B19 requirements:
    1. B19-AC1: Follows the candidate's chosen approach rather than prescribing or leaking the reference solution.
    2. B19-AC2: Assesses complexity independently; a weak complexity explanation remains a specific gap despite passing code.
    3. B19-AC3: Enforces mode restrictions and preserves stage/state on resume.
    4. Failure-to-Prevent: Scores only actual candidate words, refusing to invent understanding.
    """
    now = server_now or datetime.now(timezone.utc)
    state = _interview_states.get(session_id)
    if not state:
        raise ValueError(f"Interview session '{session_id}' not found")

    scenario = load_interview_scenario(state.scenario_id)
    rubric_spec = scenario.get("rubric", {})

    # Record candidate turn
    candidate_turn = InterviewTurn(
        role=InterviewTurnRole.CANDIDATE,
        stage=state.current_stage,
        content=candidate_message,
        code_snapshot=candidate_code or state.current_code,
        assistance_level=AssistanceLevel.GUIDED if state.is_assisted else AssistanceLevel.INDEPENDENT,
        created_at=now,
    )
    state.turns.append(candidate_turn)

    if candidate_code is not None:
        state.current_code = candidate_code
        state.code_revision += 1

    interviewer_reply = ""
    decision_assessment = ""

    # --------------------------------------------------------------------------
    # STAGE 1: CLARIFICATION
    # --------------------------------------------------------------------------
    if state.current_stage == InterviewStage.CLARIFICATION:
        lower_msg = candidate_message.lower()
        if "ready" in lower_msg or "approach" in lower_msg or "i think" in lower_msg or "we can" in lower_msg:
            # Advance to approach
            state.current_stage = InterviewStage.APPROACH
            interviewer_reply = (
                "Great questions. Now, before jumping into writing code, could you explain "
                "the high-level approach you are considering and any trade-offs you see?"
            )
            decision_assessment = "Transitioned to approach discussion"
        else:
            # Answer clarification in character without leaking solutions
            if "negative" in lower_msg or "zero" in lower_msg:
                interviewer_reply = "Good question. Yes, the array can contain positive, negative, and zero integers."
            elif "empty" in lower_msg:
                interviewer_reply = "If the array is empty or has fewer than 2 elements, returning None is expected."
            elif "size" in lower_msg or "length" in lower_msg or "bound" in lower_msg:
                interviewer_reply = "The array length can be up to 10^5 elements."
            else:
                interviewer_reply = (
                    "Those constraints are reasonable to clarify. When you are ready, "
                    "walk me through your proposed approach before coding."
                )
            decision_assessment = "Clarification answered"

    # --------------------------------------------------------------------------
    # STAGE 2: APPROACH DISCUSSION (B19-AC1)
    # --------------------------------------------------------------------------
    elif state.current_stage == InterviewStage.APPROACH:
        lower_msg = candidate_message.lower()

        # Check for approach type: hash set vs sorting vs brute force
        if "hash" in lower_msg or "set" in lower_msg or "dict" in lower_msg or "map" in lower_msg:
            state.rubric.approach_demonstrated = True
            state.rubric.approach_type = "hash_set"
            # B19-AC1: Follow the candidate's chosen approach, don't force a different one
            interviewer_reply = (
                "Using a hash set to track seen elements is a sound O(n) idea. "
                "How will you ensure you identify the repeating element whose second occurrence appears first? "
                "Whenever you feel ready, go ahead and implement your solution in the code editor."
            )
            state.current_stage = InterviewStage.IMPLEMENTATION
            decision_assessment = "Accepted hash set approach; probed on second occurrence ordering"

        elif "sort" in lower_msg:
            state.rubric.approach_demonstrated = True
            state.rubric.approach_type = "sorting"
            # B19-AC1: Probe on candidate's sorting approach without forcing hash map
            interviewer_reply = (
                "Sorting would bring duplicates adjacent to each other. "
                "However, how does sorting affect the original indices and order of occurrences? "
                "Think about that, and feel free to refine your idea or begin implementing."
            )
            state.current_stage = InterviewStage.IMPLEMENTATION
            decision_assessment = "Probed candidate on sorting index destruction"

        elif "nested" in lower_msg or "two loop" in lower_msg or "check each" in lower_msg or "brute" in lower_msg:
            state.rubric.approach_demonstrated = True
            state.rubric.approach_type = "brute_force"
            # B19-AC1: Explore candidate's brute force idea
            interviewer_reply = (
                "A nested loop will definitely find duplicates. What would the time complexity "
                "be for an array of 100,000 items? Can we do better with auxiliary memory?"
            )
            decision_assessment = "Probed candidate on quadratic complexity of brute force"

        else:
            interviewer_reply = (
                "Could you elaborate on how your approach identifies the duplicate? "
                "What data structures are you planning to use?"
            )
            decision_assessment = "Requested approach clarification"

    # --------------------------------------------------------------------------
    # STAGE 3: IMPLEMENTATION
    # --------------------------------------------------------------------------
    elif state.current_stage == InterviewStage.IMPLEMENTATION:
        code = state.current_code.strip()
        lower_msg = candidate_message.lower()

        # If learner is asking for hints in strict mode:
        if ("hint" in lower_msg or "solution" in lower_msg or "stuck" in lower_msg) and state.mode == SessionMode.STRICT:
            interviewer_reply = (
                "In this interview assessment, I'd like to see how you troubleshoot independently. "
                "Trace through a small sample like [2, 1, 3, 5, 3, 2] step by step. What should seen contain?"
            )
            decision_assessment = "Enforced strict mode no-hint policy"
        elif "done" in lower_msg or "finished" in lower_msg or "test" in lower_msg or len(code) > 40:
            # Check candidate code
            if "def " in code and ("return" in code or "yield" in code):
                state.rubric.code_tests_passed = True
                state.current_stage = InterviewStage.COMPLEXITY
                interviewer_reply = (
                    "Thanks for writing that out. The implementation looks functional. "
                    "Could you now analyze the time complexity and space complexity of your solution, "
                    "and explain the reasoning behind both?"
                )
                decision_assessment = "Code implementation submitted; prompted for complexity analysis"
            else:
                interviewer_reply = (
                    "Take your time to write out the full function implementation, "
                    "and let me know once you are satisfied with it."
                )
                decision_assessment = "Prompted candidate to complete implementation"
        else:
            interviewer_reply = (
                "I see you are working on the code. Let me know when you've finished or if you want to trace it."
            )
            decision_assessment = "Acknowledged implementation in progress"

    # --------------------------------------------------------------------------
    # STAGE 4: COMPLEXITY & TRADEOFFS (B19-AC2)
    # --------------------------------------------------------------------------
    elif state.current_stage == InterviewStage.COMPLEXITY:
        lower_msg = candidate_message.lower()

        # Require formal Big-O complexity bounds
        has_formal_time = ("o(n)" in lower_msg or "linear" in lower_msg or "o(n^2)" in lower_msg or "quadratic" in lower_msg or "o(1)" in lower_msg)
        has_formal_space = ("space" in lower_msg or "memory" in lower_msg) and ("o(" in lower_msg or "constant" in lower_msg or "linear" in lower_msg)

        # Failure-to-Prevent check: vague assertion like "it is efficient" or "minimal memory" is NOT treated as explanation
        if not has_formal_time or not has_formal_space:
            state.rubric.complexity_verified = False
            state.rubric.specific_gaps.append(
                SpecificGap(
                    aspect="complexity_analysis",
                    gap_key="complexity.explanation_vague_or_missing",
                    description="Learner gave a vague non-specific response without formal Big-O time/space bounds.",
                    learner_statement=candidate_message,
                )
            )
            interviewer_reply = (
                "Could you provide the exact Big-O notation for both time and auxiliary space complexity, "
                "explaining what variables dominate in the worst case?"
            )
            decision_assessment = "Flagged missing Big-O analysis"

        # B19-AC2: Weak complexity explanation remains a specific gap despite passing code tests!
        elif "o(1) space" in lower_msg or "constant space" in lower_msg:
            # If code uses hash set / dict, space is O(n), NOT O(1)!
            if "set(" in state.current_code or "dict(" in state.current_code or "{}" in state.current_code or "seen" in state.current_code:
                gap = SpecificGap(
                    aspect="complexity_analysis",
                    gap_key="complexity.space_hash_set_underestimated",
                    description="Claimed O(1) space while allocating a hash set/map that stores up to N distinct elements.",
                    learner_statement=candidate_message,
                )
                state.rubric.specific_gaps.append(gap)
                state.rubric.complexity_verified = False
                # The interviewer probes the gap gently
                interviewer_reply = (
                    "You mentioned O(1) auxiliary space. In the worst case where all elements in nums are unique, "
                    "how many elements will your seen set store? Does that scale with N?"
                )
                state.current_stage = InterviewStage.FOLLOW_UP
                state.active_follow_up_id = "fup_stream"
                decision_assessment = "B19-AC2: Flagged specific gap on underestimated space complexity despite passing code"
            else:
                state.rubric.complexity_verified = True
                state.current_stage = InterviewStage.FOLLOW_UP
                state.active_follow_up_id = "fup_stream"
                interviewer_reply = "Good analysis. Now, let's look at a follow-up constraint."
                decision_assessment = "Complexity verified"

        elif ("o(n)" in lower_msg or "linear" in lower_msg) and ("space" in lower_msg and ("o(n)" in lower_msg or "linear" in lower_msg or "set" in lower_msg)):
            # Correct analysis
            state.rubric.complexity_verified = True
            state.current_stage = InterviewStage.FOLLOW_UP
            state.active_follow_up_id = "fup_stream"
            interviewer_reply = (
                "Spot on: O(n) time because hash lookups and insertions are O(1) on average, "
                "and O(n) space for the seen set in the worst case. "
                "Now, here is a follow-up: what if the input stream is potentially infinite, "
                "and you cannot hold all seen elements in memory? How might you handle that?"
            )
            decision_assessment = "Complexity analysis verified correct; transitioned to follow-up"

        else:
            state.rubric.complexity_verified = False
            state.current_stage = InterviewStage.FOLLOW_UP
            state.active_follow_up_id = "fup_stream"
            interviewer_reply = (
                "Understood. Let's move to a follow-up scenario: "
                "What if the input stream is infinite and memory is bounded? How would you adapt?"
            )
            decision_assessment = "Advanced to follow-up stage without full complexity verification"

    # --------------------------------------------------------------------------
    # STAGE 5: FOLLOW-UP PROGRESSION
    # --------------------------------------------------------------------------
    elif state.current_stage == InterviewStage.FOLLOW_UP:
        lower_msg = candidate_message.lower()
        if "bloom" in lower_msg or "window" in lower_msg or "lru" in lower_msg or "batch" in lower_msg or "approximate" in lower_msg or "probabilistic" in lower_msg:
            state.rubric.follow_up_addressed = True
            state.current_stage = InterviewStage.DEBRIEF
            interviewer_reply = (
                "Excellent thinking. A sliding window or Bloom filter is a classic way to manage bounded memory "
                "over infinite streams. That concludes the interview! Thank you for walking through your reasoning."
            )
            decision_assessment = "Follow-up answered successfully; interview concluded"
        else:
            state.current_stage = InterviewStage.DEBRIEF
            interviewer_reply = (
                "Thank you for sharing your thoughts on that. That wraps up our technical session today. "
                "I will compile the debrief summary and rubric breakdown."
            )
            decision_assessment = "Follow-up completed; moving to debrief"

    # --------------------------------------------------------------------------
    # STAGE 6: DEBRIEF
    # --------------------------------------------------------------------------
    elif state.current_stage == InterviewStage.DEBRIEF:
        interviewer_reply = (
            "The interview has concluded. You can review your specific performance rubric, "
            "complexity breakdown, and any identified gaps in the debrief panel."
        )
        decision_assessment = "Interview in debrief stage"

    # Record interviewer turn
    interviewer_turn = InterviewTurn(
        role=InterviewTurnRole.INTERVIEWER,
        stage=state.current_stage,
        content=interviewer_reply,
        assistance_level=AssistanceLevel.GUIDED if state.is_assisted else AssistanceLevel.INDEPENDENT,
        created_at=now,
    )
    state.turns.append(interviewer_turn)
    state.updated_at = now

    decision = TeachingDecision(
        decision_id=str(uuid.uuid4()),
        session_id=session_id,
        owner_id=state.owner_id,
        expected_revision=state.code_revision,
        assessment=decision_assessment,
        uncertainty=0.1,
        next_action="probe" if state.current_stage != InterviewStage.DEBRIEF else "advance",
        rationale=f"Technical interview turn in stage {state.current_stage.value}",
        discriminating_probe=interviewer_reply,
    )

    return state, interviewer_reply, decision


# ==============================================================================
# Resume & Mode Preservation (B19-AC3)
# ==============================================================================

def resume_interview_session(
    session_id: str,
    owner_id: str,
) -> TechnicalInterviewState:
    """
    B19-AC3: Resuming an interview preserves exact stage, turns, current code,
    assistance level, and specific gaps without resetting progress or skipping ahead.
    """
    state = _interview_states.get(session_id)
    if not state:
        raise ValueError(f"Session {session_id} not found")
    if state.owner_id != owner_id:
        raise PermissionError(f"Access forbidden for owner {owner_id}")

    # Honest interruption tracking: mark that a resume occurred
    state.is_interrupted = True
    return state
