from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import uuid
import asyncio
import json

from learning.api.auth import get_current_owner, AuthenticatedOwner
from learning.domain.contracts import (
    RunReceipt,
    RunStatusResponse,
    RunEventsResponse,
    RunState,
    EventType,
    TeachingDecision,
    TurnRunRecord,
    ExternalCallReceipt,
)
from learning.repositories.evidence import (
    get_session,
    record_session_message,
    CrossOwnerReferenceError,
    DanglingReferenceError,
)
from learning.repositories.runs import (
    create_or_get_turn_run,
    get_turn_run,
    get_run_events,
    cancel_run,
    ActiveForegroundRunConflictError,
    RevisionConflictError,
)

router = APIRouter(tags=["Runs & Sessions"])


class SessionMessageInput(BaseModel):
    content: str
    expected_revision: int = Field(ge=1)
    client_request_id: Optional[str] = None
    auto_execute: bool = False


MessageInput = SessionMessageInput


@router.post(
    "/api/sessions/{session_id}/messages",
    response_model=RunReceipt,
    status_code=status.HTTP_202_ACCEPTED,
)
async def post_session_message(
    session_id: str,
    body: SessionMessageInput,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunReceipt:
    """
    Submits a learner message to the durable worker queue.
    - B04-AC1: Two competing tabs yield one accepted foreground run and one explicit revision/active conflict (409).
    - B04-AC2: Deduplicates requests with matching client_request_id.
    - Returns 202 Accepted with status and reconnectable events URLs.
    """
    session = get_session(owner.owner_id, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    client_req_id = body.client_request_id or f"req-{uuid.uuid4().hex[:12]}"

    try:
        run, was_created = create_or_get_turn_run(
            owner_id=owner.owner_id,
            classroom_id=session.classroom_id,
            session_id=session.id,
            expected_revision=body.expected_revision,
            client_request_id=client_req_id,
            message_content=body.content,
        )
    except RevisionConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ActiveForegroundRunConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except (CrossOwnerReferenceError, DanglingReferenceError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    learner_message_id: Optional[str] = None
    if body.auto_execute and was_created:
        # Single-writer rule (B04/B11): the endpoint persists the learner
        # message immediately — durable even if the provider/model fails —
        # and hands its ID to the workflow, which reuses it instead of
        # inserting a duplicate. The workflow is the sole writer of the
        # tutor reply. Previously both layers persisted both roles (2x/2x).
        try:
            learner_msg = record_session_message(
                owner_id=owner.owner_id,
                session_id=session.id,
                sender_role="learner",
                content=body.content,
                artifact_revision_snapshot=body.expected_revision,
                message_id=run.message_id,
            )
            learner_message_id = learner_msg.id
        except Exception:
            pass

        def _bg_execute(learner_message_id: Optional[str] = learner_message_id):
            claimed_run = None
            try:
                from learning.repositories.runs import claim_job_for_run
                from learning.workflows.lesson import execute_lesson_turn
                # Fair-claim: compete with the fleet worker for this run's job.
                # Loser skips — exactly one executor per turn (B11: no dupes).
                claimed = claim_job_for_run(owner.owner_id, run.id, worker_id="worker_api_inline")
                if claimed is None:
                    return
                claimed_run, _job = claimed
                execute_lesson_turn(
                    session_id=session.id,
                    owner_id=owner.owner_id,
                    learner_message=body.content,
                    expected_revision=body.expected_revision,
                    run_id=run.id,
                    learner_message_id=learner_message_id,
                    worker_id="worker_api_inline",
                    fence=claimed_run.fence,
                )
            except Exception as exc:
                from learning.repositories.runs import update_run_state, write_run_event
                from learning.domain.contracts import EventType, RunState
                update_run_state(
                    owner_id=owner.owner_id,
                    run_id=run.id,
                    state=RunState.FAILED,
                    error=f"{type(exc).__name__}: {exc}",
                )
                try:
                    write_run_event(
                        run_id=run.id,
                        worker_id="worker_api_inline",
                        fence=claimed_run.fence if claimed_run else run.fence,
                        event_type=EventType.ERROR,
                        payload={"error": str(exc)},
                    )
                except Exception:
                    pass

        background_tasks.add_task(_bg_execute)

    return RunReceipt(
        run_id=run.id,
        session_id=run.session_id,
        message_id=run.message_id or f"msg-{run.id}",
        accepted_revision=run.expected_revision,
        status_url=f"/api/runs/{run.id}",
        events_url=f"/api/runs/{run.id}/events",
    )


@router.post(
    "/api/runs/{run_id}/execute",
    response_model=RunStatusResponse,
)
async def execute_run_endpoint(
    run_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunStatusResponse:
    """
    Executes a queued turn run using the LangGraph lesson workflow.
    Emits THINKING, DECISION, CHUNK, and DONE events.
    """
    run = get_turn_run(owner.owner_id, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")

    from learning.workflows.lesson import execute_lesson_turn
    from learning.repositories.runs import claim_job_for_run

    claimed = claim_job_for_run(
        owner_id=owner.owner_id,
        run_id=run.id,
        worker_id="worker_api_execute",
        lease_seconds=60,
    )
    if claimed is None:
        current = get_turn_run(owner.owner_id, run_id)
        if current and current.state in (RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED):
            events = get_run_events(owner.owner_id, run_id, after_seq=0)
            return RunStatusResponse(
                run_id=current.id,
                session_id=current.session_id,
                state=current.state,
                expected_revision=current.expected_revision,
                decision=current.decision,
                error=current.error,
                events_count=len(events),
                events_url=f"/api/runs/{current.id}/events",
            )
        else:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Run is already claimed or no longer executable")
    else:
        run, _job = claimed

    events = get_run_events(owner.owner_id, run_id, after_seq=0)
    msg_text = ""
    for evt in events:
        if evt.event_type == EventType.QUEUED and isinstance(evt.payload, dict) and "message_content" in evt.payload:
            msg_text = evt.payload["message_content"]
            break

    # The explicit executor path is also a queue consumer. Persist the
    # learner turn before invoking the workflow so the observation's message
    # reference is valid and restart/retry remains idempotent.
    learner_message = record_session_message(
        owner_id=owner.owner_id,
        session_id=run.session_id,
        sender_role="learner",
        content=msg_text or "Continue lesson",
        artifact_revision_snapshot=run.expected_revision,
        message_id=run.message_id,
    )

    execute_lesson_turn(
        session_id=run.session_id,
        owner_id=owner.owner_id,
        learner_message=msg_text or "Continue lesson",
        expected_revision=run.expected_revision,
        run_id=run.id,
        worker_id="worker_api_execute",
        fence=run.fence,
        learner_message_id=learner_message.id,
    )

    updated_run = get_turn_run(owner.owner_id, run_id)
    all_events = get_run_events(owner.owner_id, run_id, after_seq=0)

    return RunStatusResponse(
        run_id=updated_run.id,
        session_id=updated_run.session_id,
        state=updated_run.state,
        expected_revision=updated_run.expected_revision,
        decision=updated_run.decision,
        error=updated_run.error,
        events_count=len(all_events),
        events_url=f"/api/runs/{updated_run.id}/events",
    )


@router.get(
    "/api/runs/{run_id}",
    response_model=RunStatusResponse,
)
async def get_run_status(
    run_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunStatusResponse:
    """
    Retrieves current durable status and decision for a run.
    """
    run = get_turn_run(owner.owner_id, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found",
        )

    events = get_run_events(owner.owner_id, run_id, after_seq=0)

    return RunStatusResponse(
        run_id=run.id,
        session_id=run.session_id,
        state=run.state,
        expected_revision=run.expected_revision,
        decision=run.decision,
        error=run.error,
        events_count=len(events),
        events_url=f"/api/runs/{run.id}/events",
    )


@router.get(
    "/api/runs/{run_id}/events",
    response_model=RunEventsResponse,
)
async def get_run_events_endpoint(
    run_id: str,
    after_seq: int = Query(default=0, ge=0),
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunEventsResponse:
    """
    B04-AC3: Polling-based event transport. 
    Resumes event streaming after sequence number `after_seq`.
    Provides reconnectable, ordered event delivery.
    NOTE: This is polling-based (not SSE). Clients should poll with increasing after_seq.
    """
    try:
        events = get_run_events(owner.owner_id, run_id, after_seq=after_seq)
        run = get_turn_run(owner.owner_id, run_id)
        if not run:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")
    except DanglingReferenceError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")

    all_events = get_run_events(owner.owner_id, run_id, after_seq=0)
    latest_seq = max([e.seq for e in all_events], default=0)
    is_complete = run.state in (RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED)

    return RunEventsResponse(
        run_id=run_id,
        events=events,
        latest_seq=latest_seq,
        is_complete=is_complete,
    )


@router.post(
    "/api/runs/{run_id}/cancel",
    response_model=RunStatusResponse,
)
async def cancel_active_run(
    run_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunStatusResponse:
    """
    B04-AC3: Cancels an active run. Preserves all previously accepted input,
    persisted sequence of events, and emits a CANCELLED event.
    """
    try:
        run = cancel_run(owner.owner_id, run_id)
    except DanglingReferenceError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")

    events = get_run_events(owner.owner_id, run_id, after_seq=0)

    return RunStatusResponse(
        run_id=run.id,
        session_id=run.session_id,
        state=run.state,
        expected_revision=run.expected_revision,
        decision=run.decision,
        error=run.error,
        events_count=len(events),
        events_url=f"/api/runs/{run.id}/events",
    )


@router.get(
    "/api/runs/{run_id}/record",
    response_model=TurnRunRecord,
)
async def get_turn_run_record(
    run_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> TurnRunRecord:
    """
    Returns complete internal TurnRunRecord including fencing and leasing metadata.
    """
    run = get_turn_run(owner.owner_id, run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found",
        )
    return run


@router.get(
    "/api/runs/{run_id}/external-receipts/{idempotency_key}",
    response_model=ExternalCallReceipt,
)
async def get_external_call_receipt_endpoint(
    run_id: str,
    idempotency_key: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> ExternalCallReceipt:
    """
    Returns external call billing/model receipt for verification.
    """
    from learning.repositories.runs import get_external_call_receipt
    receipt = get_external_call_receipt(owner.owner_id, idempotency_key)
    if not receipt or receipt.run_id != run_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"External call receipt '{idempotency_key}' not found for run '{run_id}'."
        )
    return receipt


@router.post(
    "/api/runs/{run_id}/process",
    response_model=RunStatusResponse,
)
async def process_run_endpoint(
    run_id: str,
    owner: AuthenticatedOwner = Depends(get_current_owner),
) -> RunStatusResponse:
    """
    Processes the next turn job for this run using the lesson worker,
    generating chunk, thinking, and done events and updating run state.
    """
    from learning.worker.lesson_worker import process_next_lesson_job

    run = get_turn_run(owner.owner_id, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")

    if run.state != RunState.COMPLETED:
        process_next_lesson_job(worker_id="worker_lesson_api")

    updated = get_turn_run(owner.owner_id, run_id) or run
    events = get_run_events(owner.owner_id, run_id, after_seq=0)

    return RunStatusResponse(
        run_id=updated.id,
        session_id=updated.session_id,
        state=updated.state,
        expected_revision=updated.expected_revision,
        decision=updated.decision,
        error=updated.error,
        events_count=len(events),
        events_url=f"/api/runs/{updated.id}/events",
    )


@router.get(
    "/api/runs/{run_id}/stream",
    summary="Unbuffered Server-Sent Events (SSE) stream for real-time turn execution",
)
async def stream_run_events(
    run_id: str,
    after_seq: int = Query(default=0, ge=0),
    owner: AuthenticatedOwner = Depends(get_current_owner),
):
    """
    B04/B28: Server-Sent Events (SSE) stream for real-time unbuffered token delivery.
    Yields events with sequence numbers, supporting reconnection via `after_seq`.
    """
    run = get_turn_run(owner.owner_id, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run '{run_id}' not found")

    async def event_generator():
        current_seq = after_seq
        max_polls = 600  # 60s max connection lifetime
        polls = 0
        while polls < max_polls:
            events = get_run_events(owner.owner_id, run_id, after_seq=current_seq)
            for evt in events:
                current_seq = max(current_seq, evt.seq)
                payload = {
                    "seq": evt.seq,
                    "event_type": evt.event_type.value,
                    "payload": evt.payload,
                    "created_at": evt.created_at,
                }
                yield f"id: {evt.seq}\nevent: {evt.event_type.value}\ndata: {json.dumps(payload)}\n\n"

            run_check = get_turn_run(owner.owner_id, run_id)
            if run_check and run_check.state in (RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED):
                # Send terminal event and close stream
                terminal_data = json.dumps({"state": run_check.state.value, "error": run_check.error})
                yield f"event: done\ndata: {terminal_data}\n\n"
                break

            await asyncio.sleep(0.1)
            polls += 1

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
