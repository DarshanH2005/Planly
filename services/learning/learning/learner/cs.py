"""
Sprint B16: CS Fundamentals Through Scenario Reasoning Domain Engine.
Authority: planly_architecture.md sections 2, 7-8; B16_cs_classroom.md

Enforces:
- B16-AC1: Resume unanswered follow-ups without pretending they were answered.
- B16-AC2: Distinguish shared address space concepts from the learner's demonstrated knowledge.
- B16-AC3: A CS observation cannot automatically alter unrelated DSA or ML mastery.
- Failure to Prevent: Do not replace the ongoing CS lesson with a generic syllabus dump.
"""

import json
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone
import uuid

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    PendingTaskType,
    PendingTaskStatus,
    PendingTaskRecord,
    LearningObservation,
)
from learning.domain.activities import (
    CurriculumGraph,
    MicroSkill,
    VerifiedActivity,
    CurriculumGraphValidationError,
)
from learning.repositories.sources import (
    get_pending_tasks,
    calculate_measured_readiness,
)
from learning.repositories.evidence import (
    record_observation,
    get_session_observations,
)

CONTENT_CS_DIR = Path(__file__).resolve().parent.parent / "content" / "cs"
CS_CURRICULUM_PATH = CONTENT_CS_DIR / "curriculum.json"
CS_ACTIVITIES_DIR = CONTENT_CS_DIR / "activities"


def load_cs_curriculum() -> CurriculumGraph:
    """Loads and validates the canonical CS micro-skill curriculum."""
    if not CS_CURRICULUM_PATH.exists():
        raise FileNotFoundError(f"CS curriculum file not found at {CS_CURRICULUM_PATH}")

    with open(CS_CURRICULUM_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    graph = CurriculumGraph()
    for skill_data in data.get("skills", []):
        graph.add_skill(MicroSkill(**skill_data))

    graph.validate()
    return graph


def load_cs_activities() -> List[VerifiedActivity]:
    """Loads and verifies all canonical CS scenario activities."""
    if not CS_ACTIVITIES_DIR.exists():
        return []

    activities: List[VerifiedActivity] = []
    for file_path in sorted(CS_ACTIVITIES_DIR.glob("*.json")):
        with open(file_path, "r", encoding="utf-8") as f:
            act = VerifiedActivity(**json.load(f))
            # Verify SHA-256 content hash
            computed = act.compute_content_hash()
            if act.provenance.content_hash != computed:
                raise ValueError(
                    f"Content hash mismatch for activity '{act.id}': "
                    f"stored={act.provenance.content_hash}, computed={computed}"
                )
            activities.append(act)
    return activities


# -----------------------------------------------------------------------------
# B16-AC1: Resuming Unanswered Follow-ups Without Fabrication
# -----------------------------------------------------------------------------

def resume_unanswered_followup(
    owner_id: str,
    task_id: str,
    classroom_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resumes an imported unanswered follow-up question (e.g. Q11-Q15) in its pending,
    unattempted state. Never fabricates prior learner answers or assumes completion.
    """
    tasks = get_pending_tasks(owner_id, classroom_id=classroom_id)
    task = next((t for t in tasks if t.id == task_id or t.task_type == PendingTaskType.UNANSWERED_FOLLOWUP), None)
    if not task:
        # If lookup by ID directly
        task = next((t for t in tasks if t.id == task_id), None)

    if not task:
        raise ValueError(f"Pending task '{task_id}' not found for owner '{owner_id}'")

    if task.status != PendingTaskStatus.PENDING:
        return {
            "task_id": task.id,
            "status": task.status.value,
            "is_resumed": False,
            "message": f"Task already in status '{task.status.value}'",
        }

    # Extract pending follow-up prompt
    prompt = task.title
    context_questions = task.context_json.get("pending_questions", []) if task.context_json else []

    return {
        "task_id": task.id,
        "title": task.title,
        "status": PendingTaskStatus.PENDING.value,
        "is_assumed_answered": False,
        "fabricated_responses": False,
        "active_prompt": prompt,
        "pending_questions": context_questions,
        "action_required": "learner_response_required",
    }


# -----------------------------------------------------------------------------
# B16-AC2: Distinguish Shared Address Space Concepts from Demonstrated Knowledge
# -----------------------------------------------------------------------------

def evaluate_heap_memory_understanding(
    owner_id: str,
    session_id: str,
    learner_response: str,
    prior_tutor_reference_obs: Optional[LearningObservation] = None,
) -> Tuple[bool, Optional[LearningObservation]]:
    """
    B16-AC2: Distinguishes tutor reference explanation (heap vs stack memory model)
    from verified learner demonstrated knowledge.
    
    If prior_tutor_reference_obs exists, its demonstrated status is False and assistance
    level is TUTOR_SUPPLIED. It is preserved as reference only.
    Only when the learner's response independently articulates the core invariant
    (heap memory resides in process virtual address space and survives thread stack
    frame cleanup) is a new demonstrated observation created.
    """
    if prior_tutor_reference_obs:
        # Verify invariant: tutor reference is NEVER marked demonstrated
        assert prior_tutor_reference_obs.demonstrated is False
        assert prior_tutor_reference_obs.assistance_level == AssistanceLevel.TUTOR_SUPPLIED

    normalized = learner_response.lower()

    # Core pedagogical criteria:
    # 1. Recognizes heap memory belongs to the process address space
    # 2. Recognizes it survives individual thread stack frame exit
    has_process_heap = any(kw in normalized for kw in ["heap", "process address space", "process virtual memory"])
    has_survival = any(kw in normalized for kw in ["survives", "persists", "valid", "not destroyed", "accessible"])
    has_stack_contrast = any(kw in normalized for kw in ["stack", "frame", "thread stack", "lifo"])

    if has_process_heap and has_survival and has_stack_contrast:
        # Verified independent demonstration
        new_obs = record_observation(
            owner_id=owner_id,
            session_id=session_id,
            competency_key="cs.os.explanation.per_process_heap",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text=f"Learner independently demonstrated heap persistence: '{learner_response[:120]}...'",
        )
        return True, new_obs

    # Did not demonstrate understanding independently
    return False, None


# -----------------------------------------------------------------------------
# B16-AC3: Cross-Track Isolation
# -----------------------------------------------------------------------------

def record_cs_scenario_observation(
    owner_id: str,
    session_id: str,
    competency_key: str,
    demonstrated: bool,
    evidence_text: str,
    assistance_level: AssistanceLevel = AssistanceLevel.INDEPENDENT,
) -> LearningObservation:
    """
    B16-AC3: Records a CS observation and guarantees that unrelated DSA or ML
    mastery records and readiness calculations remain strictly unaffected.
    """
    if not competency_key.startswith("cs.") and not competency_key.startswith("process_") and not competency_key.startswith("thread_"):
        raise ValueError(f"Expected CS competency key, got '{competency_key}'")

    obs = record_observation(
        owner_id=owner_id,
        session_id=session_id,
        competency_key=competency_key,
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=assistance_level,
        demonstrated=demonstrated,
        evidence_text=evidence_text,
    )
    return obs


def verify_track_isolation(
    owner_id: str,
    dsa_session_id: str,
    ml_session_id: str,
    initial_dsa_keys: List[str],
    initial_ml_keys: List[str],
) -> Dict[str, Any]:
    """
    B16-AC3 verification helper: asserts that CS observations have not mutated
    DSA or ML demonstrated competency lists or readiness measures.
    """
    dsa_obs = get_session_observations(owner_id, dsa_session_id)
    ml_obs = get_session_observations(owner_id, ml_session_id)

    dsa_readiness = calculate_measured_readiness(dsa_obs)
    ml_readiness = calculate_measured_readiness(ml_obs)

    current_dsa_keys = sorted(dsa_readiness.get("verified_competency_keys", []))
    current_ml_keys = sorted(ml_readiness.get("verified_competency_keys", []))

    dsa_intact = current_dsa_keys == sorted(initial_dsa_keys)
    ml_intact = current_ml_keys == sorted(initial_ml_keys)

    return {
        "dsa_intact": dsa_intact,
        "ml_intact": ml_intact,
        "dsa_verified_keys": current_dsa_keys,
        "ml_verified_keys": current_ml_keys,
        "isolation_preserved": dsa_intact and ml_intact,
    }


# -----------------------------------------------------------------------------
# Failure to Prevent: Guard against Generic Syllabus Dumps
# -----------------------------------------------------------------------------

def detect_generic_syllabus_dump(response_text: str) -> bool:
    """
    Failure to Prevent:
    Do not replace the ongoing CS lesson with a generic syllabus dump.
    Returns True if the response looks like an unstructured chapter outline or syllabus dump.
    """
    lines = [line.strip() for line in response_text.splitlines() if line.strip()]
    if len(lines) > 20 and all(line.startswith(("-", "*", "Chapter", "Module", "1.", "2.", "3.")) for line in lines[:8]):
        return True
    
    # Check for excessive bullet-point index dump
    bullet_count = sum(1 for line in lines if line.startswith(("-", "*", "•")))
    if bullet_count > 15 and len(response_text) > 2000 and "scenario" not in response_text.lower():
        return True

    return False
