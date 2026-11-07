"""
Lesson Worker Implementation.
Sprint: B09
Authority: planly_architecture.md section 8

Pulls claimed turn jobs from durable queue and executes the LangGraph lesson workflow,
emitting chunk, thinking, decision, and done events and committing observations.
"""

from typing import Optional, Tuple, Dict, Any
import logging
from learning.domain.contracts import (
    TurnRunRecord,
    TeachingDecision,
    RunLane,
    EventType,
    RunState,
)
from learning.repositories.runs import (
    claim_next_job,
    write_run_event,
    complete_run,
    get_turn_run,
    update_run_state,
)
from learning.repositories.evidence import (
    record_session_message,
    get_session,
)
from learning.workflows.lesson import execute_lesson_turn

logger = logging.getLogger('planly.worker')

def process_next_lesson_job(
    worker_id: str = "lesson_worker_1",
    lane: RunLane = RunLane.FOREGROUND,
    lease_seconds: int = 60,
) -> Optional[Tuple[TurnRunRecord, TeachingDecision]]:
    """
    Claims the next pending turn job in the queue and executes the LangGraph lesson workflow.
    """
    claimed = claim_next_job(worker_id=worker_id, lane=lane, lease_seconds=lease_seconds)
    if not claimed:
        return None

    run, job = claimed
    message_content = job.get("message_content", "")

    # A session may have been deleted after a run was queued (or while a worker
    # was down).  This is a terminal data-reference error, not a worker crash:
    # acknowledge the job so it cannot be reclaimed indefinitely on restart.
    if not get_session(run.owner_id, run.session_id):
        error = f"DanglingReferenceError: Session '{run.session_id}' does not exist"
        logger.warning("Finalizing run %s: %s", run.id, error)
        update_run_state(
            owner_id=run.owner_id,
            run_id=run.id,
            state=RunState.FAILED,
            error=error,
        )
        write_run_event(
            run_id=run.id,
            worker_id=worker_id,
            fence=run.fence,
            event_type=EventType.ERROR,
            payload={"error": error, "code": "session_not_found"},
        )
        return get_turn_run(run.owner_id, run.id) or run, None

    # Record user message in session message history exactly once
    # (single-writer rule): persist here for durability, hand the ID to the
    # workflow, and let the workflow own the tutor reply. Previously both
    # this worker and the workflow persisted both roles (2x/2x per turn).
    learner_message_id = None
    try:
        learner_msg = record_session_message(
            owner_id=run.owner_id,
            session_id=run.session_id,
            sender_role="learner",
            content=message_content,
            artifact_revision_snapshot=run.expected_revision,
            message_id=run.message_id,
        )
        learner_message_id = learner_msg.id
    except Exception as e:
        logger.error(f"Failed to record learner message for run {run.id}: {e}", exc_info=True)

    # Execute LangGraph workflow turn
    try:
        result = execute_lesson_turn(
            session_id=run.session_id,
            owner_id=run.owner_id,
            learner_message=message_content,
            expected_revision=run.expected_revision,
            run_id=run.id,
            classroom_id=run.classroom_id,
            worker_id=worker_id,
            fence=run.fence,
            learner_message_id=learner_message_id,
        )
    except Exception as e:
        logger.error(f"Workflow error for run {run.id}: {e}", exc_info=True)
        update_run_state(
            owner_id=run.owner_id,
            run_id=run.id,
            state=RunState.FAILED,
            error=f"{type(e).__name__}: {e}",
        )
        write_run_event(
            run_id=run.id,
            worker_id=worker_id,
            fence=run.fence,
            event_type=EventType.ERROR,
            payload={"error": str(e)}
        )
        # The run is now terminal and its claimed queue row has been finalized.
        # Returning keeps a bad individual job from taking down the long-lived
        # worker process or generating a restart/reclaim error loop.
        return get_turn_run(run.owner_id, run.id) or run, None

    dec_dict = result.get("teaching_decision")
    decision = TeachingDecision(**dec_dict) if dec_dict else None

    # The workflow commit node is the sole writer of the tutor reply;
    # recording it here as well duplicated every tutor message (B11).

    updated_run = get_turn_run(run.owner_id, run.id)
    return updated_run or run, decision
