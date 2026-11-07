"""
CS Fundamentals Scenario Reasoning & Classroom Engine.
Sprint: B16
Authority: planly_architecture.md sections 2, 7-8; B16_cs_classroom.md

Implements:
1. CS Curriculum and Scenario definitions separating terminology, explanation, and scenario reasoning.
2. B16-AC1: Resume unanswered follow-ups without pretending they were answered.
3. B16-AC2: Distinguish shared address space concepts / tutor reference knowledge from demonstrated learner mastery.
4. B16-AC3: Strict track isolation ensuring CS observations cannot alter DSA or ML mastery.
5. Failure to Prevent: Ban generic syllabus dumps in favor of focused scenario reasoning and discriminating probes.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Tuple
from pydantic import BaseModel, Field

from learning.domain.contracts import (
    LearningObservation,
    SourceKind,
    AssistanceLevel,
    PendingTaskRecord,
    PendingTaskType,
    PendingTaskStatus,
)
from learning.domain.activities import (
    CurriculumGraph,
    MicroSkill,
)
from learning.repositories import evidence
from learning.repositories import sources

CS_CONTENT_DIR = Path(__file__).resolve().parent
CURRICULUM_FILE = CS_CONTENT_DIR / "curriculum.json"
SCENARIOS_DIR = CS_CONTENT_DIR / "scenarios"


class CSScenarioRubric(BaseModel):
    required_concepts: List[str] = Field(default_factory=list)
    forbidden_misconceptions: List[str] = Field(default_factory=list)
    scoring_criteria: str
    ideal_response_summary: str


class CSScenario(BaseModel):
    id: str
    micro_skill_id: str
    title: str
    category: str  # "terminology" | "explanation" | "scenario_reasoning"
    prompt: str
    context_code: Optional[str] = None
    evaluator_rubric: CSScenarioRubric


class CSRubricEvaluation(BaseModel):
    scenario_id: str
    is_demonstrated: bool
    matched_concepts: List[str]
    detected_misconceptions: List[str]
    feedback: str
    rationale: str


def load_cs_curriculum() -> CurriculumGraph:
    """Loads and validates the CS curriculum graph."""
    if not CURRICULUM_FILE.exists():
        raise FileNotFoundError(f"CS curriculum file not found at {CURRICULUM_FILE}")
    with open(CURRICULUM_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    graph = CurriculumGraph()
    for s in data["skills"]:
        graph.add_skill(MicroSkill(**s))
    graph.validate()
    return graph


def load_cs_scenarios() -> Dict[str, CSScenario]:
    """Loads all verified CS scenarios."""
    scenarios: Dict[str, CSScenario] = {}
    if not SCENARIOS_DIR.exists():
        return scenarios
    for p in sorted(SCENARIOS_DIR.glob("*.json")):
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            sc = CSScenario(**data)
            scenarios[sc.id] = sc
    return scenarios


# ==============================================================================
# B16-AC1: Resume Unanswered Follow-Ups Without Pretending They Were Answered
# ==============================================================================

class CSFollowupStatus(BaseModel):
    has_unanswered: bool
    pending_task_id: Optional[str] = None
    title: str = ""
    prompt_text: str = ""
    total_questions: int = 0
    active_question_index: int = 0
    active_question_label: str = ""
    active_question_text: str = ""


QUESTION_MAPPINGS = {
    "Q11": {
        "scenario_id": "cs_os_heap_process_isolation",
        "label": "Q11",
        "text": "Why isn't the heap 'one heap for the whole computer'? Explain what actually gets shared between threads.",
    },
    "Q12": {
        "scenario_id": "cs_os_concurrency_terminology",
        "label": "Q12",
        "text": "Give me the difference between these three in one sentence each: Race condition, Critical section, Mutex.",
    },
    "Q13": {
        "scenario_id": "cs_os_lock_scope_check_then_act",
        "label": "Q13",
        "text": "Why do we need to put both `if balance >= 80:` and `balance -= 80` inside the lock? What could happen if only `balance -= 80` were locked?",
    },
    "Q14": {
        "scenario_id": "cs_os_thread_stack_isolation",
        "label": "Q14",
        "text": "Imagine Thread A currently executes function1() and Thread B executes function2(). Why can't they use the same stack?",
    },
    "Q15": {
        "scenario_id": "cs_os_intermittent_race_seat_booking",
        "label": "Q15",
        "text": "A production backend occasionally creates two bookings for the final available seat, but developers cannot reproduce it easily locally. Why might this bug only occur occasionally instead of on every request?",
    },
}


def get_cs_unanswered_followups(owner_id: str, classroom_id: str) -> CSFollowupStatus:
    """
    B16-AC1: Inspects pending tasks for unanswered follow-ups (such as Q11-Q15).
    Guarantees that pending questions are preserved and resumed without falsely
    marking them answered or inventing completions.
    """
    tasks = sources.get_pending_tasks(
        owner_id=owner_id,
        classroom_id=classroom_id,
        task_type=PendingTaskType.UNANSWERED_FOLLOWUP,
        status=PendingTaskStatus.PENDING,
    )
    if not tasks:
        return CSFollowupStatus(has_unanswered=False)

    task = tasks[0]
    ctx = task.context_json or {}
    questions = ctx.get("questions", ["Q11", "Q12", "Q13", "Q14", "Q15"])

    # Determine which questions have verified learner demonstrations in this classroom
    # Check observations in classroom sessions
    sessions = evidence.list_sessions(owner_id, classroom_id)
    demonstrated_scenarios = set()
    for s in sessions:
        obs = evidence.get_session_observations(owner_id, s.id)
        for o in obs:
            if o.demonstrated and o.source_kind == SourceKind.LEARNER_WORK:
                demonstrated_scenarios.add(o.competency_key)

    active_idx = 0
    for idx, q_key in enumerate(questions):
        q_meta = QUESTION_MAPPINGS.get(q_key, {})
        sc_id = q_meta.get("scenario_id")
        if sc_id and sc_id not in demonstrated_scenarios:
            active_idx = idx
            break
    else:
        # All answered
        active_idx = len(questions)

    if active_idx >= len(questions):
        return CSFollowupStatus(
            has_unanswered=False,
            pending_task_id=task.id,
            title=task.title,
            total_questions=len(questions),
        )

    current_q_key = questions[active_idx]
    q_info = QUESTION_MAPPINGS.get(current_q_key, {})

    return CSFollowupStatus(
        has_unanswered=True,
        pending_task_id=task.id,
        title=task.title,
        prompt_text=task.prompt_text,
        total_questions=len(questions),
        active_question_index=active_idx,
        active_question_label=current_q_key,
        active_question_text=q_info.get("text", task.prompt_text),
    )


# ==============================================================================
# B16-AC2: Distinguish Shared Address Space Concepts from Demonstrated Knowledge
# ==============================================================================

def evaluate_cs_rubric(scenario: CSScenario, learner_text: str) -> CSRubricEvaluation:
    """
    B16-AC2: Evaluates a learner explanation against scenario rubric.
    Distinguishes tutor reference knowledge from demonstrated learner mastery.
    Detects required conceptual understandings while catching persistent misconceptions.
    """
    text_lower = learner_text.lower()
    rubric = scenario.evaluator_rubric

    # Check for forbidden misconceptions
    detected_misconceptions = []
    for misc in rubric.forbidden_misconceptions:
        misc_clean = misc.lower()
        # Direct check or keyword clusters
        if misc_clean in text_lower:
            detected_misconceptions.append(misc)
        elif misc_clean == "one heap for the entire computer" and (
            ("one heap" in text_lower and "whole computer" in text_lower)
            or ("single heap" in text_lower and "entire computer" in text_lower)
            or ("one single memory for one computer" in text_lower)
        ):
            detected_misconceptions.append(misc)
        elif misc_clean in ("heap shared across all programs", "heap shared across all processes") and (
            ("heap" in text_lower and "shared" in text_lower and "all processes" in text_lower)
            or ("heap is shared between everyone" in text_lower)
            or ("shared across all programs" in text_lower)
        ):
            detected_misconceptions.append(misc)
        elif misc_clean == "threads share stacks" and not any(neg in text_lower for neg in ["private stack", "own stack", "separate stack", "distinct stack"]) and (
            ("threads share stack" in text_lower)
            or ("threads share the stack" in text_lower)
            or ("threads share stacks" in text_lower)
            or ("share a stack" in text_lower)
            or ("same stack" in text_lower and "threads" in text_lower and "can use" in text_lower)
        ):
            detected_misconceptions.append(misc)
        elif misc_clean == "locking write is sufficient" and (
            ("only lock the write" in text_lower)
            or ("locking write is enough" in text_lower)
        ):
            detected_misconceptions.append(misc)

    # Check for required concepts
    matched_concepts = []
    concept_matchers = {
        "virtual_address_space": ["virtual address space", "address space", "virtual memory", "mmu"],
        "per_process_isolation": ["per-process", "per process", "process has its own", "separate process", "isolated process", "distinct process"],
        "threads_share_heap": ["threads share", "threads of the same process", "shared heap", "share the heap", "share heap"],
        "threads_have_own_stacks": ["own stack", "separate stack", "private stack", "registers and stack", "each thread has its own stack"],
        "race_condition_execution_order": ["timing", "interleaving", "execution order", "order of execution", "access shared"],
        "critical_section_shared_resource_code": ["code", "section", "shared resource", "access shared data", "one thread at a time"],
        "mutex_mutual_exclusion_primitive": ["lock", "mutual exclusion", "primitive", "only one thread", "acquire", "release"],
        "check_then_act_race": ["check-then-act", "toctou", "check before", "both pass", "both check", "check and"],
        "interleaved_check": ["interleaved", "interleaving", "both read", "simultaneously", "at the same time"],
        "overdraft_or_negative_balance": ["negative", "overdraft", "-60", "extra withdrawal", "below zero", "oversold"],
        "atomicity_of_check_and_update": ["atomic", "atomically", "both inside", "inside the lock", "enclosed"],
        "call_stack_activation_records": ["stack frame", "activation record", "call stack", "local variables"],
        "independent_call_paths": ["independent", "separate execution", "different functions", "call paths"],
        "return_addresses_corruption": ["corrupt", "overwrite", "return address", "clobber"],
        "local_variables_isolation": ["local variable", "locals", "isolated"],
        "non_deterministic_scheduling": ["non-deterministic", "scheduler", "preemption", "context switch", "interleaving"],
        "exact_thread_interleaving_window": ["narrow window", "timing window", "exact interleaving", "microscopic"],
        "high_concurrency_load": ["production load", "concurrency", "concurrent requests", "high traffic", "volume"],
        "time_window_between_check_and_update": ["between check and update", "between read and write", "window"],
        "separate_virtual_address_spaces": ["separate address space", "virtual address", "distinct address space", "isolated address"],
        "copy_on_write": ["copy on write", "copy-on-write", "cow", "new page"],
        "no_shared_heap_across_processes": ["not shared", "distinct heap", "parent's heap", "parent memory untouched", "will not see"],
        "isolated_memory": ["isolated", "unmodified", "private memory"],
        "read_modify_write_interleaving": ["read-modify-write", "read then write", "stale read"],
        "concurrent_read_of_stale_stock": ["stale stock", "read stock", "before write"],
        "sequential_decrements": ["decrement", "both decrement"],
        "negative_stock_result": ["negative stock", "oversold", "-1"],
        "intermediate_inconsistent_state": ["inconsistent", "intermediate state", "temporarily missing", "transient"],
        "temporary_lost_money": ["missing", "lost", "vanished"],
        "total_balance_invariant_violation": ["total balance", "invariant", "sum of balances"],
        "need_two_phase_or_joint_locking": ["both accounts", "joint lock", "lock both"],
    }

    for concept in rubric.required_concepts:
        matchers = concept_matchers.get(concept, [concept.replace("_", " ")])
        if any(m in text_lower for m in matchers):
            matched_concepts.append(concept)

    # Decision rule: Must have no detected misconceptions, and at least 60% of required concepts
    required_count = len(rubric.required_concepts)
    has_sufficient_concepts = len(matched_concepts) >= max(2, int(required_count * 0.6))
    is_demonstrated = (len(detected_misconceptions) == 0) and has_sufficient_concepts

    if is_demonstrated:
        feedback = f"Demonstrated understanding for {scenario.title}. Articulated key principles: {', '.join(matched_concepts)}."
        rationale = f"Independent response satisfied rubric criteria without misconceptions."
    elif detected_misconceptions:
        feedback = f"Identified persistent misconception: {', '.join(detected_misconceptions)}. Needs targeted clarification."
        rationale = f"Response contained prohibited misconceptions: {detected_misconceptions}."
    else:
        missing = [c for c in rubric.required_concepts if c not in matched_concepts]
        feedback = f"Partially explained, but missing core concepts: {', '.join(missing[:3])}."
        rationale = f"Response lacked sufficient required concepts ({len(matched_concepts)}/{required_count})."

    return CSRubricEvaluation(
        scenario_id=scenario.id,
        is_demonstrated=is_demonstrated,
        matched_concepts=matched_concepts,
        detected_misconceptions=detected_misconceptions,
        feedback=feedback,
        rationale=rationale,
    )


def record_cs_scenario_observation(
    owner_id: str,
    session_id: str,
    scenario_id: str,
    learner_text: str,
    is_guided: bool = False,
    is_tutor_explanation: bool = False,
) -> Tuple[LearningObservation, CSRubricEvaluation]:
    """
    B16-AC2: Records a CS observation following rigorous evidence contracts.
    Tutor explanations and guided trials NEVER record demonstrated=True.
    Only independent responses passing the scenario rubric achieve demonstrated=True.
    """
    scenarios = load_cs_scenarios()
    scenario = scenarios.get(scenario_id)
    if not scenario:
        raise ValueError(f"Unknown CS scenario ID: {scenario_id}")

    eval_result = evaluate_cs_rubric(scenario, learner_text)

    if is_tutor_explanation:
        source_kind = SourceKind.TUTOR_EXPLANATION
        assistance_level = AssistanceLevel.TUTOR_SUPPLIED
        demonstrated = False
        evidence_text = f"Tutor explained reference knowledge for {scenario.title}."
    elif is_guided:
        source_kind = SourceKind.LEARNER_WORK
        assistance_level = AssistanceLevel.GUIDED
        demonstrated = False
        evidence_text = f"Guided attempt on {scenario.title}: {eval_result.feedback}"
    elif eval_result.is_demonstrated:
        source_kind = SourceKind.LEARNER_WORK
        assistance_level = AssistanceLevel.INDEPENDENT
        demonstrated = True
        evidence_text = f"Verified independent demonstration for {scenario.title}: {eval_result.feedback}"
    else:
        source_kind = SourceKind.LEARNER_WORK
        assistance_level = AssistanceLevel.INDEPENDENT
        demonstrated = False
        evidence_text = f"Unverified demonstration for {scenario.title}: {eval_result.feedback}"

    obs = evidence.record_observation(
        owner_id=owner_id,
        session_id=session_id,
        competency_key=scenario.micro_skill_id,
        source_kind=source_kind,
        assistance_level=assistance_level,
        demonstrated=demonstrated,
        evidence_text=evidence_text,
    )

    return obs, eval_result


# ==============================================================================
# B16-AC3: Strict Track Isolation (CS Observations Do Not Alter DSA or ML)
# ==============================================================================

class TrackReadinessSnapshot(BaseModel):
    owner_id: str
    track: str
    verified_competencies_count: int
    verified_competency_keys: List[str]
    tutor_explanations_count: int
    unsupported_percentages_ignored: bool


def get_track_readiness_snapshot(owner_id: str, track: str) -> TrackReadinessSnapshot:
    """
    B16-AC3: Computes measured readiness isolated strictly to the specified track.
    CS observations cannot alter DSA or ML verified competency keys or counts.
    """
    # 1. Find all classrooms for owner in this track
    classrooms = evidence.list_classrooms(owner_id)
    matching_classrooms = [c for c in classrooms if c.track == track]

    demonstrated_competencies: Set[str] = set()
    tutor_explanations_count = 0

    for cls in matching_classrooms:
        sessions = evidence.list_sessions(owner_id, cls.id)
        for sess in sessions:
            obs = evidence.get_session_observations(owner_id, sess.id)
            for o in obs:
                # Only independent learner demonstrations in this track count
                if (
                    o.demonstrated is True
                    and o.assistance_level == AssistanceLevel.INDEPENDENT
                    and o.source_kind == SourceKind.LEARNER_WORK
                ):
                    demonstrated_competencies.add(o.competency_key)
                if o.source_kind == SourceKind.TUTOR_EXPLANATION:
                    tutor_explanations_count += 1

    return TrackReadinessSnapshot(
        owner_id=owner_id,
        track=track,
        verified_competencies_count=len(demonstrated_competencies),
        verified_competency_keys=sorted(list(demonstrated_competencies)),
        tutor_explanations_count=tutor_explanations_count,
        unsupported_percentages_ignored=True,
    )


# ==============================================================================
# Failure to Prevent: Do Not Replace Ongoing CS Lesson with Generic Syllabus Dump
# ==============================================================================

SYLLABUS_DUMP_PATTERNS = [
    r"OPERATING SYSTEMS\s*\n\s*-\s*process",
    r"COMPUTER NETWORKS\s*\n\s*-\s*OSI",
    r"DBMS THEORY\s*\n\s*-\s*relational",
    r"1\.\s*Operating Systems.*2\.\s*Computer Networks.*3\.\s*DBMS",
    r"Table of Contents:.*Operating Systems.*Networks",
]


def check_for_syllabus_dump(text: str) -> bool:
    """
    Returns True if the response contains a generic syllabus / curriculum dump
    rather than focused pedagogical reasoning on the active scenario.
    """
    for pat in SYLLABUS_DUMP_PATTERNS:
        if re.search(pat, text, re.IGNORECASE):
            return True
    # If text is an excessively long bulleted list of high-level topics without reasoning
    lines = [l.strip() for l in text.split("\n") if l.strip().startswith("-") or l.strip().startswith("*")]
    if len(lines) > 12 and any("network" in l.lower() for l in lines) and any("dbms" in l.lower() for l in lines):
        return True
    return False


def build_cs_focused_response(
    scenario: CSScenario,
    evaluation: CSRubricEvaluation,
    is_resuming_followup: bool = False,
) -> str:
    """
    Produces a focused, scenario-specific teaching response that adheres strictly
    to Failure-to-Prevent (no generic syllabus dumps).
    """
    if is_resuming_followup:
        return (
            f"Continuing from where we left off on concurrency fundamentals.\n\n"
            f"**{scenario.title}**\n\n"
            f"{scenario.prompt}\n\n"
            f"Focus on the exact mechanism—explain clearly without reciting definitions."
        )

    if evaluation.is_demonstrated:
        return (
            f"Excellent analysis. Your explanation correctly captures the underlying mechanics:\n"
            f"- {evaluation.feedback}\n\n"
            f"Next, let's explore how this applies under high concurrent load or edge-case execution."
        )
    elif evaluation.detected_misconceptions:
        return (
            f"Hold on—there is an important misconception here:\n"
            f"{evaluation.feedback}\n\n"
            f"Think carefully: does the OS give every process its own isolated virtual address space, "
            f"or can any process read and write any other process's heap? Re-evaluate what actually gets shared."
        )
    else:
        return (
            f"You've touched on part of the concept, but let's sharpen the explanation:\n"
            f"{evaluation.feedback}\n\n"
            f"Can you explain specifically how thread execution stacks behave compared to the process heap?"
        )
