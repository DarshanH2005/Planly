import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple
import uuid
import hashlib
from learning.domain.contracts import (
    TurnRunRecord,
    RunEvent,
    RunState,
    RunLane,
    EventType,
    ExternalCallReceipt,
    ExternalCallStatus,
    TeachingDecision,
)
from learning.repositories.evidence import (
    get_session,
    CrossOwnerReferenceError,
    DanglingReferenceError,
)
from learning.repositories.db import get_db

class ActiveForegroundRunConflictError(Exception):
    pass

class RevisionConflictError(Exception):
    pass

class ExpiredWorkerWriteError(Exception):
    pass

class UncertainExternalCallError(Exception):
    pass

def reset_runs_store() -> None:
    db = get_db()
    with db:
        db.execute("DELETE FROM turn_runs")
        db.execute("DELETE FROM run_events")
        db.execute("DELETE FROM external_receipts")
        db.execute("DELETE FROM jobs_queue")

def create_or_get_turn_run(
    owner_id: str,
    classroom_id: str,
    session_id: str,
    expected_revision: int,
    client_request_id: str,
    message_content: str,
    lane: RunLane = RunLane.FOREGROUND,
) -> Tuple[TurnRunRecord, bool]:
    db = get_db()
    
    # 1. Deduplication
    cursor = db.execute("SELECT * FROM turn_runs WHERE owner_id = ? AND client_request_id = ?", (owner_id, client_request_id))
    row = cursor.fetchone()
    if row:
        d = dict(row)
        if d.get("decision"): d["decision"] = json.loads(d["decision"])
        return TurnRunRecord(**d), False

    # 2. Check session existence and revision
    session = get_session(owner_id, session_id)
    if not session:
        raise DanglingReferenceError(f"Session '{session_id}' not found")
    if session.current_revision != expected_revision:
        raise RevisionConflictError(
            f"Revision conflict: expected revision {expected_revision}, but current session revision is {session.current_revision} (B04-AC1)"
        )

    # 3. Active foreground run conflict
    if lane == RunLane.FOREGROUND:
        cursor = db.execute("SELECT id FROM turn_runs WHERE classroom_id = ? AND lane = ? AND state IN (?, ?)", 
                            (classroom_id, RunLane.FOREGROUND.value, RunState.QUEUED.value, RunState.RUNNING.value))
        if cursor.fetchone():
            raise ActiveForegroundRunConflictError(
                f"Active foreground run already in progress for classroom '{classroom_id}' (B04-AC1)"
            )

    run_id = f"run-{uuid.uuid4().hex[:12]}"
    message_id = f"msg-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    
    with db:
        db.execute(
            """INSERT INTO turn_runs (id, owner_id, classroom_id, session_id, client_request_id, expected_revision, state, lane, message_id, fence, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, owner_id, classroom_id, session_id, client_request_id, expected_revision, RunState.QUEUED.value, lane.value, message_id, 1, now, now)
        )
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps({
            "message_id": message_id,
            "expected_revision": expected_revision,
            "message_content": message_content,
        })
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, owner_id, run_id, 1, EventType.QUEUED.value, payload_str, now)
        )
        
        job_id = f"job-{uuid.uuid4().hex[:8]}"
        db.execute(
            "INSERT INTO jobs_queue (id, owner_id, run_id, lane, status, message_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (job_id, owner_id, run_id, lane.value, "pending", message_content, now)
        )
        
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    return TurnRunRecord(**dict(cursor.fetchone())), True

def create_turn_run(
    owner_id: str,
    classroom_id: str,
    session_id: str,
    client_request_id: str,
    expected_revision: int,
    lane: RunLane = RunLane.FOREGROUND,
    message_content: str = "",
) -> TurnRunRecord:
    run, _ = create_or_get_turn_run(owner_id, classroom_id, session_id, expected_revision, client_request_id, message_content, lane)
    return run

def get_turn_run(owner_id: str, run_id: str) -> Optional[TurnRunRecord]:
    db = get_db()
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ? AND owner_id = ?", (run_id, owner_id))
    row = cursor.fetchone()
    if row:
        d = dict(row)
        if d.get("decision"): d["decision"] = json.loads(d["decision"])
        return TurnRunRecord(**d)
    return None

get_run = get_turn_run

def claim_next_job(
    worker_id: str,
    lane: RunLane = RunLane.FOREGROUND,
    lease_seconds: int = 30,
) -> Optional[Tuple[TurnRunRecord, Dict[str, Any]]]:
    db = get_db()
    now = datetime.now(timezone.utc)
    lease_expires = (now + timedelta(seconds=lease_seconds)).isoformat()
    now_iso = now.isoformat()
    
    with db:
        cursor = db.execute("SELECT * FROM jobs_queue WHERE status = 'pending' AND lane = ? ORDER BY created_at ASC LIMIT 1", (lane.value,))
        job_row = cursor.fetchone()
        if not job_row:
            return None
            
        run_id = job_row["run_id"]
        cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
        run_row = cursor.fetchone()
        if not run_row:
            return None
            
        new_fence = run_row["fence"] + 1
        
        db.execute(
            "UPDATE turn_runs SET lease_owner = ?, lease_expires_at = ?, fence = ?, state = ?, updated_at = ? WHERE id = ?",
            (worker_id, lease_expires, new_fence, RunState.RUNNING.value, now_iso, run_id)
        )
        
        db.execute(
            "UPDATE jobs_queue SET status = 'claimed', lease_owner = ?, lease_expires_at = ? WHERE id = ?",
            (worker_id, lease_expires, job_row["id"])
        )
        
        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps({"worker_id": worker_id, "fence": new_fence})
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, run_row["owner_id"], run_id, seq, EventType.THINKING.value, payload_str, now_iso)
        )
        
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    run_dict = dict(cursor.fetchone())
    if run_dict.get("decision"): run_dict["decision"] = json.loads(run_dict["decision"])
    
    cursor = db.execute("SELECT * FROM jobs_queue WHERE id = ?", (job_row["id"],))
    return TurnRunRecord(**run_dict), dict(cursor.fetchone())

def claim_job_for_run(
    owner_id: str,
    run_id: str,
    worker_id: str,
    lease_seconds: int = 60,
) -> Optional[Tuple[TurnRunRecord, Dict[str, Any]]]:
    """
    Fair-claim a specific run's queued job (exactly-once execution).

    The API's inline fallback executor and the fleet worker compete for the
    same job row: whoever flips it pending->claimed owns the execution and
    the loser skips. Previously the inline path bypassed claiming entirely,
    so every turn executed twice (inline + fleet) and duplicated messages.
    Mirrors claim_next_job semantics: fence bump, RUNNING state, THINKING
    event. Returns None when the job is already claimed/finalized.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    lease_expires = (now + timedelta(seconds=lease_seconds)).isoformat()
    now_iso = now.isoformat()

    with db:
        cursor = db.execute(
            "SELECT * FROM jobs_queue WHERE run_id = ? AND owner_id = ? AND status = 'pending'",
            (run_id, owner_id),
        )
        job_row = cursor.fetchone()
        if not job_row:
            return None

        cursor = db.execute("SELECT * FROM turn_runs WHERE id = ? AND owner_id = ?", (run_id, owner_id))
        run_row = cursor.fetchone()
        if not run_row or run_row["state"] != RunState.QUEUED.value:
            return None

        new_fence = run_row["fence"] + 1

        db.execute(
            "UPDATE turn_runs SET lease_owner = ?, lease_expires_at = ?, fence = ?, state = ?, updated_at = ? WHERE id = ?",
            (worker_id, lease_expires, new_fence, RunState.RUNNING.value, now_iso, run_id),
        )

        db.execute(
            "UPDATE jobs_queue SET status = 'claimed', lease_owner = ?, lease_expires_at = ? WHERE id = ?",
            (worker_id, lease_expires, job_row["id"]),
        )

        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1

        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps({"worker_id": worker_id, "fence": new_fence})
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, owner_id, run_id, seq, EventType.THINKING.value, payload_str, now_iso),
        )

    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    run_dict = dict(cursor.fetchone())
    if run_dict.get("decision"): run_dict["decision"] = json.loads(run_dict["decision"])

    cursor = db.execute("SELECT * FROM jobs_queue WHERE id = ?", (job_row["id"],))
    return TurnRunRecord(**run_dict), dict(cursor.fetchone())

def _validate_worker_lease_and_fence(run: TurnRunRecord, worker_id: str, fence: int) -> None:
    if run.lease_owner != worker_id:
        raise ExpiredWorkerWriteError(f"Worker '{worker_id}' is not the current lease owner of run '{run.id}'")
    if run.fence != fence:
        raise ExpiredWorkerWriteError(
            f"Fencing token conflict: worker fence {fence} != active run fence {run.fence} (worker fenced out)"
        )
    if run.lease_expires_at:
        expires = datetime.fromisoformat(run.lease_expires_at)
        now = datetime.now(timezone.utc)
        if now > expires:
            raise ExpiredWorkerWriteError(
                f"Lease for worker '{worker_id}' on run '{run.id}' expired at {run.lease_expires_at}"
            )

def write_run_event(
    run_id: str,
    worker_id: str,
    fence: int,
    event_type: EventType,
    payload: Dict[str, Any],
) -> RunEvent:
    db = get_db()
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    row = cursor.fetchone()
    if not row:
        raise DanglingReferenceError(f"Run '{run_id}' not found")
        
    d = dict(row)
    if d.get("decision"): d["decision"] = json.loads(d["decision"])
    run = TurnRunRecord(**d)
    
    _validate_worker_lease_and_fence(run, worker_id, fence)
    
    now = datetime.now(timezone.utc).isoformat()
    with db:
        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps(payload)
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, run.owner_id, run_id, seq, event_type.value, payload_str, now)
        )
    return RunEvent(id=evt_id, owner_id=run.owner_id, run_id=run_id, seq=seq, event_type=event_type, payload=payload, created_at=now)

def complete_run(
    run_id: str,
    worker_id: str,
    fence: int,
    decision: TeachingDecision,
) -> TurnRunRecord:
    db = get_db()
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    row = cursor.fetchone()
    if not row:
        raise DanglingReferenceError(f"Run '{run_id}' not found")
        
    d = dict(row)
    if d.get("decision"): d["decision"] = json.loads(d["decision"])
    run = TurnRunRecord(**d)
    
    _validate_worker_lease_and_fence(run, worker_id, fence)
    
    now = datetime.now(timezone.utc).isoformat()
    decision_json = decision.model_dump_json()
    
    with db:
        db.execute(
            "UPDATE turn_runs SET state = ?, decision = ?, updated_at = ? WHERE id = ?",
            (RunState.COMPLETED.value, decision_json, now, run_id)
        )
        # Finalize the queue row with the run. Without this write a
        # successfully completed turn remains permanently `claimed` and can
        # be mistaken for an interrupted job after a worker restart.
        db.execute(
            "UPDATE jobs_queue SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL WHERE run_id = ? AND status IN ('pending', 'claimed')",
            (run_id,),
        )
        
        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload = {"decision_id": decision.decision_id, "next_action": decision.next_action}
        payload_str = json.dumps(payload)
        
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, run.owner_id, run_id, seq, EventType.DONE.value, payload_str, now)
        )
        
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    d2 = dict(cursor.fetchone())
    d2["decision"] = json.loads(d2["decision"])
    return TurnRunRecord(**d2)

def cancel_run(owner_id: str, run_id: str) -> TurnRunRecord:
    db = get_db()
    run = get_turn_run(owner_id, run_id)
    if not run:
        raise DanglingReferenceError(f"Run '{run_id}' not found")
        
    if run.state in (RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED):
        return run
        
    now = datetime.now(timezone.utc).isoformat()
    with db:
        db.execute("UPDATE turn_runs SET state = ?, updated_at = ? WHERE id = ?", (RunState.CANCELLED.value, now, run_id))
        
        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps({"cancelled_at": now})
        
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, owner_id, run_id, seq, EventType.CANCELLED.value, payload_str, now)
        )
        
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    d = dict(cursor.fetchone())
    if d.get("decision"): d["decision"] = json.loads(d["decision"])
    return TurnRunRecord(**d)

def recover_expired_leases(now: Optional[datetime] = None) -> int:
    """Return interrupted claimed jobs to the durable queue.

    The lease, rather than process lifetime, determines ownership. A restarted
    worker therefore resumes work with a new fencing token and cannot accept
    writes from the old process.
    """
    db = get_db()
    now_iso = (now or datetime.now(timezone.utc)).isoformat()
    with db:
        expired = db.execute(
            "SELECT id, run_id FROM jobs_queue WHERE status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?",
            (now_iso,),
        ).fetchall()
        for job in expired:
            db.execute(
                "UPDATE jobs_queue SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL WHERE id = ?",
                (job["id"],),
            )
            db.execute(
                "UPDATE turn_runs SET state = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? "
                "WHERE id = ? AND state IN (?, ?)",
                (RunState.QUEUED.value, now_iso, job["run_id"], RunState.QUEUED.value, RunState.RUNNING.value),
            )
    return len(expired)

def get_run_events(owner_id: str, run_id: str, after_seq: int = 0) -> List[RunEvent]:
    db = get_db()
    run = get_turn_run(owner_id, run_id)
    if not run:
        raise DanglingReferenceError(f"Run '{run_id}' not found")
        
    cursor = db.execute("SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC", (run_id, after_seq))
    res = []
    for row in cursor:
        d = dict(row)
        d["payload"] = json.loads(d["payload"])
        res.append(RunEvent(**d))
    return res

def record_external_call_start(
    owner_id: str,
    idempotency_key: str,
    call_type: str,
    request_data: Dict[str, Any],
    run_id: Optional[str] = None,
) -> Tuple[ExternalCallReceipt, bool]:
    db = get_db()
    cursor = db.execute("SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?", (owner_id, idempotency_key))
    row = cursor.fetchone()
    if row:
        d = dict(row)
        if d.get("response_payload"): d["response_payload"] = json.loads(d["response_payload"])
        existing = ExternalCallReceipt(**d)
        if existing.status == ExternalCallStatus.SUCCEEDED:
            return existing, False
        if existing.status == ExternalCallStatus.UNCERTAIN:
            raise UncertainExternalCallError(
                f"External call '{idempotency_key}' is in an uncertain state. Reconciliation required before re-invoking (B04-AC3)."
            )
        return existing, False
        
    request_hash = hashlib.sha256(str(sorted(request_data.items())).encode()).hexdigest()
    rec_id = f"ext-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    
    with db:
        db.execute(
            "INSERT INTO external_receipts (id, owner_id, idempotency_key, call_type, status, request_hash, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (rec_id, owner_id, idempotency_key, call_type, ExternalCallStatus.STARTED.value, request_hash, run_id, now)
        )
        
    return ExternalCallReceipt(id=rec_id, owner_id=owner_id, idempotency_key=idempotency_key, call_type=call_type, status=ExternalCallStatus.STARTED, request_hash=request_hash, run_id=run_id, created_at=now), True

def complete_external_call(
    owner_id: str,
    idempotency_key: str,
    response_payload: Dict[str, Any],
    cost_cents: int = 0,
) -> ExternalCallReceipt:
    db = get_db()
    with db:
        cursor = db.execute("SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?", (owner_id, idempotency_key))
        row = cursor.fetchone()
        if not row:
            raise DanglingReferenceError(f"External call receipt '{idempotency_key}' not found")
            
        db.execute(
            "UPDATE external_receipts SET status = ?, response_payload = ?, cost_cents = ? WHERE id = ?",
            (ExternalCallStatus.SUCCEEDED.value, json.dumps(response_payload), cost_cents, row["id"])
        )
        
    cursor = db.execute("SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?", (owner_id, idempotency_key))
    d = dict(cursor.fetchone())
    d["response_payload"] = json.loads(d["response_payload"])
    return ExternalCallReceipt(**d)

def fail_external_call(
    owner_id: str,
    idempotency_key: str,
    response_payload: Dict[str, Any],
) -> ExternalCallReceipt:
    """Finalize a call that definitively did not reach a usable provider result.

    A missing credential or rejected budget is known failure, not an uncertain
    billable call. Persisting it prevents an idempotent replay from looking like
    an in-flight request forever.
    """
    db = get_db()
    with db:
        cursor = db.execute(
            "SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?",
            (owner_id, idempotency_key),
        )
        row = cursor.fetchone()
        if not row:
            raise DanglingReferenceError(f"External call receipt '{idempotency_key}' not found")
        db.execute(
            "UPDATE external_receipts SET status = ?, response_payload = ? WHERE id = ?",
            (ExternalCallStatus.FAILED.value, json.dumps(response_payload), row["id"]),
        )

    cursor = db.execute(
        "SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?",
        (owner_id, idempotency_key),
    )
    data = dict(cursor.fetchone())
    data["response_payload"] = json.loads(data["response_payload"])
    return ExternalCallReceipt(**data)

def mark_external_call_uncertain(
    owner_id: str,
    idempotency_key: str,
) -> ExternalCallReceipt:
    db = get_db()
    with db:
        cursor = db.execute("SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?", (owner_id, idempotency_key))
        row = cursor.fetchone()
        if not row:
            raise DanglingReferenceError(f"External call receipt '{idempotency_key}' not found")
            
        db.execute(
            "UPDATE external_receipts SET status = ? WHERE id = ?",
            (ExternalCallStatus.UNCERTAIN.value, row["id"])
        )
        
    cursor = db.execute("SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?", (owner_id, idempotency_key))
    d = dict(cursor.fetchone())
    if d.get("response_payload"): d["response_payload"] = json.loads(d["response_payload"])
    return ExternalCallReceipt(**d)

def get_external_call_receipt(
    owner_id: str,
    idempotency_key: str,
) -> Optional[ExternalCallReceipt]:
    """Retrieves an external call receipt by owner and idempotency key."""
    db = get_db()
    cursor = db.execute(
        "SELECT * FROM external_receipts WHERE owner_id = ? AND idempotency_key = ?",
        (owner_id, idempotency_key)
    )
    row = cursor.fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("request_data"):
        d["request_data"] = json.loads(d["request_data"])
    if d.get("response_payload"):
        d["response_payload"] = json.loads(d["response_payload"])
    return ExternalCallReceipt(**d)

def append_run_event(
    owner_id: str,
    run_id: str,
    event_type: EventType,
    payload: Dict[str, Any],
) -> RunEvent:
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    with db:
        cursor = db.execute("SELECT COUNT(*) as c FROM run_events WHERE run_id = ?", (run_id,))
        seq = cursor.fetchone()["c"] + 1
        
        evt_id = f"evt-{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps(payload)
        
        db.execute(
            "INSERT INTO run_events (id, owner_id, run_id, seq, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (evt_id, owner_id, run_id, seq, event_type.value, payload_str, now)
        )
        
    return RunEvent(id=evt_id, owner_id=owner_id, run_id=run_id, seq=seq, event_type=event_type, payload=payload, created_at=now)

def update_run_state(
    run_id: str,
    state: RunState,
    owner_id: Optional[str] = None,
    decision: Optional[TeachingDecision] = None,
    error: Optional[str] = None,
    lease_owner: Optional[str] = None,
    lease_expires_at: Optional[str] = None,
) -> Optional[TurnRunRecord]:
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    with db:
        cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
        if not cursor.fetchone():
            return None
            
        updates = ["state = ?", "updated_at = ?"]
        params = [state.value, now]
        
        if decision:
            updates.append("decision = ?")
            params.append(decision.model_dump_json())
        if error is not None:
            updates.append("error = ?")
            params.append(error)
        if lease_owner is not None:
            updates.append("lease_owner = ?")
            params.append(lease_owner)
        if lease_expires_at is not None:
            updates.append("lease_expires_at = ?")
            params.append(lease_expires_at)
            
        params.append(run_id)
        db.execute(f"UPDATE turn_runs SET {', '.join(updates)} WHERE id = ?", params)

        if state in (RunState.COMPLETED, RunState.FAILED, RunState.CANCELLED):
            job_status = "completed" if state == RunState.COMPLETED else state.value
            db.execute(
                "UPDATE jobs_queue SET status = ? WHERE run_id = ? AND status IN ('pending', 'claimed')",
                (job_status, run_id),
            )
                       
    cursor = db.execute("SELECT * FROM turn_runs WHERE id = ?", (run_id,))
    d = dict(cursor.fetchone())
    if d.get("decision"): d["decision"] = json.loads(d["decision"])
    return TurnRunRecord(**d)
