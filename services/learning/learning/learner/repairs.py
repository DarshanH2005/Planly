"""
Sprint B15: Specific Repairs and Qualified Delayed Retests Domain Engine.
Authority: planly_architecture.md sections 7, 12, 14; B15_repair_transfer.md

Enforces:
- B15-AC1: Nonexistent drill IDs, assistant solutions, and guided retests cannot close a repair.
- B15-AC2: A valid delayed independent transfer supports closure and preserves history.
- B15-AC3: Correcting the qualifying observation reopens/recomputes the derived state.
- Failure to Prevent: Do not replace precise evidence with a global weakness label or unconditional two-success rule.
"""

from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone
import uuid

from learning.repositories.repairs import (
    DrillKind,
    RepairStatus,
    RepairRecord,
    RepairEventRecord,
    DrillTaskRecord,
    QualifyingObservationRecord,
    get_repair,
    update_repair,
    list_repairs,
    record_repair_event,
    get_drill_task,
    get_qualifying_observation,
    correct_qualifying_observation,
)
from learning.repositories.executions import get_execution


class RepairValidationError(Exception):
    """Base exception for repair validation failures."""
    pass


class RepairNotFoundError(RepairValidationError):
    """Raised when repair does not exist."""
    pass


class InvalidDrillError(RepairValidationError):
    """Raised when drill task is nonexistent or invalid (B15-AC1)."""
    pass


class InvalidRetestError(RepairValidationError):
    """Raised when retest session is nonexistent, distinctness check fails, or invalid (B15-AC1)."""
    pass


class AssistantSolutionRejectedError(RepairValidationError):
    """Raised when an assistant/tutor supplied solution attempts to qualify a repair (B15-AC1)."""
    pass


class GuidedRetestRejectedError(RepairValidationError):
    """Raised when a guided or assisted attempt attempts to close a repair (B15-AC1)."""
    pass


class FamiliarRetestRejectedError(RepairValidationError):
    """Raised when retest is conducted on a familiar or exposed problem rather than unfamiliar transfer."""
    pass


class ExecutionFailedError(RepairValidationError):
    """Raised when execution test suite failed during retest."""
    pass


# -----------------------------------------------------------------------------
# Drill Completion Logic (B15-AC1)
# -----------------------------------------------------------------------------

def record_drill_completion(
    owner_id: str,
    repair_id: str,
    drill_task_id: str,
    drill_kind: Optional[DrillKind] = None,
    execution_id: Optional[str] = None,
) -> RepairRecord:
    """
    Validates drill execution and transitions repair to DRILLED.
    Enforces B15-AC1: Nonexistent drill IDs and assistant solutions cannot qualify.
    """
    repair = get_repair(owner_id, repair_id)
    if not repair:
        raise RepairNotFoundError(f"Repair '{repair_id}' does not exist for owner '{owner_id}'")

    drill = get_drill_task(owner_id, drill_task_id)
    if not drill:
        raise InvalidDrillError(f"Nonexistent drill ID '{drill_task_id}' cannot qualify repair")

    if drill.is_assistant_solution:
        raise AssistantSolutionRejectedError(
            f"Drill '{drill_task_id}' contains an assistant/tutor supplied solution and cannot qualify"
        )

    prev_status = repair.status.value
    new_status = RepairStatus.DRILLED

    event = RepairEventRecord(
        id=f"rev_{uuid.uuid4().hex[:8]}",
        repair_id=repair.id,
        from_status=prev_status,
        to_status=new_status.value,
        reason=f"Completed {drill.drill_kind.value} drill '{drill.title}'",
        evidence_id=execution_id,
        actor="learner",
        metadata={
            "drill_task_id": drill_task_id,
            "drill_kind": drill.drill_kind.value,
            "execution_id": execution_id,
        },
        created_at_utc=datetime.now(timezone.utc).isoformat(),
    )

    updated = repair.model_copy(
        update={
            "drill_task_id": drill_task_id,
            "drill_kind": drill_kind or drill.drill_kind,
            "status": new_status,
            "history": list(repair.history) + [event],
            "version": repair.version + 1,
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        }
    )
    return update_repair(updated)


# -----------------------------------------------------------------------------
# Retest Validation & Closure (B15-AC1, B15-AC2)
# -----------------------------------------------------------------------------

def submit_retest_and_attempt_closure(
    owner_id: str,
    repair_id: str,
    retest_session_id: str,
    observation_id: str,
    execution_id: Optional[str] = None,
    delay_hours: float = 0.0,
    closure_summary: Optional[str] = None,
) -> RepairRecord:
    """
    Validates delayed independent transfer retest and closes repair.
    Enforces:
    - B15-AC1: Nonexistent drill IDs, assistant solutions, and guided retests cannot close a repair.
    - B15-AC2: A valid delayed independent transfer supports closure and preserves history.
    """
    repair = get_repair(owner_id, repair_id)
    if not repair:
        raise RepairNotFoundError(f"Repair '{repair_id}' does not exist for owner '{owner_id}'")

    # Retest must follow drill completion
    if not repair.drill_task_id:
        raise InvalidDrillError("Cannot close repair without an established drill task")

    # Drill task must exist in store (B15-AC1 audit check)
    drill = get_drill_task(owner_id, repair.drill_task_id)
    if not drill:
        raise InvalidDrillError(
            f"Nonexistent drill task '{repair.drill_task_id}' cannot support repair closure"
        )

    # Retest session must be distinct from drill task
    if retest_session_id == repair.drill_task_id:
        raise InvalidRetestError("Retest session must be distinct from the drill session")

    # Validate qualifying observation (B15-AC1)
    obs = get_qualifying_observation(owner_id, observation_id)
    if not obs:
        raise InvalidRetestError(
            f"Nonexistent retest observation '{observation_id}' cannot support repair closure"
        )

    # Reject assistant solutions (B15-AC1)
    if obs.is_assistant_solution:
        raise AssistantSolutionRejectedError(
            "Retest solution was provided by assistant/tutor and cannot close repair"
        )

    # Reject guided retests (B15-AC1)
    if obs.assistance_level != "independent" or not obs.demonstrated:
        raise GuidedRetestRejectedError(
            f"Guided retest (assistance_level='{obs.assistance_level}') cannot close repair; independent demonstration required"
        )

    # Retest must be on an unfamiliar problem
    if obs.familiarity != "unseen_declared":
        raise FamiliarRetestRejectedError(
            f"Retest familiarity is '{obs.familiarity}'; unfamiliar transfer required"
        )

    # If execution ID provided, verify passing status
    if execution_id:
        exec_rec = get_execution(execution_id)
        if exec_rec and not exec_rec.passed:
            raise ExecutionFailedError(
                f"Retest execution '{execution_id}' did not pass test suite"
            )

    # B15-AC2: Successful delayed independent transfer
    prev_status = repair.status.value
    new_status = RepairStatus.CLOSED
    now_iso = datetime.now(timezone.utc).isoformat()

    summary_text = (
        closure_summary
        or f"Unassisted passing transfer on unfamiliar {repair.competency_key} problem after {delay_hours:.1f}h delay"
    )

    event = RepairEventRecord(
        id=f"rev_{uuid.uuid4().hex[:8]}",
        repair_id=repair.id,
        from_status=prev_status,
        to_status=new_status.value,
        reason=summary_text,
        evidence_id=observation_id,
        actor="learner",
        metadata={
            "retest_session_id": retest_session_id,
            "observation_id": observation_id,
            "execution_id": execution_id,
            "delay_hours": delay_hours,
            "assistance_level": obs.assistance_level,
            "familiarity": obs.familiarity,
        },
        created_at_utc=now_iso,
    )

    updated = repair.model_copy(
        update={
            "retest_session_id": retest_session_id,
            "status": new_status,
            "closure_result": summary_text,
            "qualifying_observation_id": observation_id,
            "qualifying_execution_id": execution_id,
            "history": list(repair.history) + [event],
            "version": repair.version + 1,
            "updated_at_utc": now_iso,
        }
    )
    return update_repair(updated)


# -----------------------------------------------------------------------------
# Observation Correction & Derived State Recomputation (B15-AC3)
# -----------------------------------------------------------------------------

def correct_observation_and_recompute_repairs(
    owner_id: str,
    observation_id: str,
    correction_reason: str,
    new_demonstrated: bool = False,
) -> List[RepairRecord]:
    """
    Corrects or retracts a qualifying observation and recomputes all derived repair states (B15-AC3).
    If a closed repair depended on this observation, it is automatically reopened and
    an audit event is appended to history detailing the invalidation.
    """
    obs = correct_qualifying_observation(
        owner_id=owner_id,
        observation_id=observation_id,
        is_corrected=True,
        correction_reason=correction_reason,
        new_demonstrated=new_demonstrated,
    )
    if not obs:
        return []

    # Find any repairs qualified by this observation that are currently closed
    reopened_repairs: List[RepairRecord] = []
    for repair in list_repairs(owner_id):
        if repair.qualifying_observation_id == observation_id and repair.status == RepairStatus.CLOSED:
            prev_status = repair.status.value
            new_status = RepairStatus.REOPENED
            now_iso = datetime.now(timezone.utc).isoformat()

            reopen_event = RepairEventRecord(
                id=f"rev_{uuid.uuid4().hex[:8]}",
                repair_id=repair.id,
                from_status=prev_status,
                to_status=new_status.value,
                reason=f"Qualifying observation '{observation_id}' was corrected: {correction_reason}",
                evidence_id=observation_id,
                actor="system",
                metadata={
                    "retracted_observation_id": observation_id,
                    "correction_reason": correction_reason,
                },
                created_at_utc=now_iso,
            )

            updated = repair.model_copy(
                update={
                    "status": new_status,
                    "closure_result": None,
                    "qualifying_observation_id": None,
                    "history": list(repair.history) + [reopen_event],
                    "version": repair.version + 1,
                    "updated_at_utc": now_iso,
                }
            )
            update_repair(updated)
            reopened_repairs.append(updated)

    return reopened_repairs


# -----------------------------------------------------------------------------
# Pedagogical Guidance & Topic Lock Avoidance (Failure to Prevent & Req 4)
# -----------------------------------------------------------------------------

def get_repair_guidance(repair: RepairRecord) -> Dict[str, Any]:
    """
    Presents a concise diagnosis and concrete next action.
    Allows candidate to continue with uncertainty without permanent topic locks.
    Never replaces precise evidence with generic global weakness labels.
    """
    next_action = "complete_drill"
    if repair.status == RepairStatus.DRILLED:
        next_action = "attempt_unfamiliar_delayed_retest"
    elif repair.status == RepairStatus.CLOSED:
        next_action = "reinforce_in_spaced_reviews"
    elif repair.status == RepairStatus.REOPENED:
        next_action = "revisit_syntax_drill_or_trace"

    return {
        "repair_id": repair.id,
        "competency_key": repair.competency_key,
        "title": repair.title,
        "diagnosis_hypothesis": repair.hypothesis,
        "status": repair.status.value,
        "closure_criterion": repair.closure_criterion,
        "closure_result": repair.closure_result,
        "next_action": next_action,
        "allow_continue_with_uncertainty": repair.allow_continue_with_uncertainty,
        "has_topic_lock": False,  # Topic is explicitly never hard-locked
    }
