"""
FIXTURE_DETERMINISTIC_WORKER_TEST_ONLY
======================================
VISIBLY LABELLED AS A TEST-ONLY FIXTURE.
DO NOT SHIP THIS FIXTURE WORKER AS THE AI TUTOR (B04 Requirement 4).

Provides deterministic run processing, bounded lanes, lease simulation,
and external call receipt tracking for integration tests.
"""

from typing import Optional, Tuple, Dict, Any
from learning.domain.contracts import (
    TurnRunRecord,
    TeachingDecision,
    RunLane,
    EventType,
    ExternalCallReceipt,
    ExternalCallStatus,
)
from learning.repositories.runs import (
    claim_next_job,
    write_run_event,
    complete_run,
    record_external_call_start,
    complete_external_call,
    mark_external_call_uncertain,
)


def process_next_fixture_turn(
    worker_id: str = "test-worker-1",
    lane: RunLane = RunLane.FOREGROUND,
    lease_seconds: int = 30,
) -> Optional[Tuple[TurnRunRecord, TeachingDecision]]:
    """
    Claims and processes a single pending turn job deterministically.
    Never holds a DB transaction across any remote/model call.
    """
    claimed = claim_next_job(worker_id=worker_id, lane=lane, lease_seconds=lease_seconds)
    if not claimed:
        return None

    run, job = claimed

    # 1. Emit chunk event (sequence 3)
    write_run_event(
        run_id=run.id,
        worker_id=worker_id,
        fence=run.fence,
        event_type=EventType.CHUNK,
        payload={"delta": "Deterministic fixture feedback on learner submission."},
    )

    # 2. Record deterministic TeachingDecision
    decision = TeachingDecision(
        decision_id=f"dec-{run.id}",
        session_id=run.session_id,
        owner_id=run.owner_id,
        expected_revision=run.expected_revision,
        assessment="Deterministic fixture assessment for test verification",
        uncertainty=0.1,
        next_action="probe",
        reveal_limit=1,
        observed_success_criteria=["test_criterion_met"],
        rationale="Fixture deterministic run processing (TEST ONLY)",
        model_version="fixture-deterministic-v1",
    )

    # 3. Complete run and emit DONE event (sequence 4)
    completed = complete_run(
        run_id=run.id,
        worker_id=worker_id,
        fence=run.fence,
        decision=decision,
    )
    return completed, decision


def execute_fixture_external_model_call(
    owner_id: str,
    idempotency_key: str,
    prompt_payload: Dict[str, Any],
    run_id: Optional[str] = None,
    simulate_network_disconnect: bool = False,
) -> ExternalCallReceipt:
    """
    Simulates external model inference with exactly-once idempotency tracking (B04-AC2 / B04-AC3).
    Never holds a database transaction during the external remote invocation.
    If simulate_network_disconnect is True, marks status UNCERTAIN to preserve unconfirmed effects without double billing.
    """
    receipt, should_execute = record_external_call_start(
        owner_id=owner_id,
        idempotency_key=idempotency_key,
        call_type="model_inference",
        request_data=prompt_payload,
        run_id=run_id,
    )

    if not should_execute:
        # Deduplicated / cached call
        return receipt

    if simulate_network_disconnect:
        # Simulate timeout/disconnect during remote call: status transitions to UNCERTAIN
        return mark_external_call_uncertain(owner_id=owner_id, idempotency_key=idempotency_key)

    # Successful remote invocation
    return complete_external_call(
        owner_id=owner_id,
        idempotency_key=idempotency_key,
        response_payload={"completion": "Fixture response text"},
        cost_cents=1,
    )
