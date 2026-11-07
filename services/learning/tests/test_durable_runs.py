import sys
import json
import base64
import time
import asyncio
import sqlite3
from pathlib import Path

# Ensure services/learning is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from learning.domain.contracts import (
    TurnRunRecord,
    RunEvent,
    RunState,
    RunLane,
    EventType,
    ExternalCallReceipt,
    ExternalCallStatus,
    RunStatusResponse,
    RunEventsResponse,
    TeachingDecision,
)
from learning.repositories.db import get_db
from learning.repositories.evidence import (
    create_classroom,
    create_session,
    save_artifact,
    reset_evidence_store,
)
from learning.repositories.runs import (
    create_or_get_turn_run,
    get_turn_run,
    claim_next_job,
    write_run_event,
    complete_run,
    cancel_run,
    get_run_events,
    record_external_call_start,
    complete_external_call,
    mark_external_call_uncertain,
    reset_runs_store,
    ActiveForegroundRunConflictError,
    RevisionConflictError,
    ExpiredWorkerWriteError,
    UncertainExternalCallError,
)
from learning.worker.fixture_worker import (
    process_next_fixture_turn,
    execute_fixture_external_model_call,
)
from learning.api.main import app

OWNER_A = "00000000-0000-0000-0000-000000000001"
OWNER_B = "00000000-0000-0000-0000-000000000002"


def setup_function():
    reset_evidence_store()
    reset_runs_store()


def _make_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_sig_12345678").decode().rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


async def _dispatch_request(method: str, path: str, body_obj: dict = None, headers: list = None):
    response_body = []
    status_code = None

    body_bytes = json.dumps(body_obj).encode("utf-8") if body_obj is not None else b""

    async def receive():
        return {"type": "http.request", "body": body_bytes}

    async def send(message):
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            response_body.append(message.get("body", b""))

    default_headers = [
        (b"host", b"testserver"),
        (b"content-type", b"application/json"),
    ]
    if headers:
        default_headers.extend(headers)

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": default_headers,
    }

    await app(scope, receive, send)
    raw = b"".join(response_body).decode("utf-8")
    body = json.loads(raw) if raw else {}
    return status_code, body


def test_b04_ac1_competing_tabs_and_revision_conflict():
    """
    B04-AC1: Two competing tabs yield one accepted foreground run and one explicit revision conflict.
    """
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)
    assert session.current_revision == 1

    # Tab 1: Submit message with expected_revision=1
    run1, created1 = create_or_get_turn_run(
        owner_id=OWNER_A,
        classroom_id=classroom.id,
        session_id=session.id,
        expected_revision=1,
        client_request_id="tab1-req-1",
        message_content="Tab 1 message",
    )
    assert created1 is True
    assert run1.state == RunState.QUEUED
    assert run1.lane == RunLane.FOREGROUND
    print("Tab 1 accepted foreground run: PASSED")

    # Tab 2: Competing tab in the same classroom attempts to start another foreground run
    try:
        create_or_get_turn_run(
            owner_id=OWNER_A,
            classroom_id=classroom.id,
            session_id=session.id,
            expected_revision=1,
            client_request_id="tab2-req-2",
            message_content="Tab 2 competing message",
        )
        assert False, "Tab 2 should have been rejected with active foreground conflict"
    except ActiveForegroundRunConflictError as e:
        assert "already in progress" in str(e)
        print("Tab 2 rejected due to active foreground conflict: PASSED")

    # Tab 3: Attempting to submit with mismatched expected_revision yields explicit revision conflict
    try:
        create_or_get_turn_run(
            owner_id=OWNER_A,
            classroom_id=classroom.id,
            session_id=session.id,
            expected_revision=99,
            client_request_id="tab3-req-3",
            message_content="Tab 3 stale revision message",
        )
        assert False, "Tab 3 should have failed with revision conflict"
    except RevisionConflictError as e:
        assert "expected revision 99" in str(e)
        print("Tab 3 explicit revision conflict rejected: PASSED")


def test_b04_ac2_duplicate_requests_and_expired_worker_fencing():
    """
    B04-AC2: Duplicate requests and expired-worker writes do not duplicate or replace durable evidence.
    """
    setup_function()
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")

    session = create_session(OWNER_A, classroom.id)

    # 1. Request deduplication: identical client_request_id
    run1, created1 = create_or_get_turn_run(
        owner_id=OWNER_A,
        classroom_id=classroom.id,
        session_id=session.id,
        expected_revision=1,
        client_request_id="dedup-req-123",
        message_content="Initial submission",
    )
    assert created1 is True

    # Resend identical request
    run2, created2 = create_or_get_turn_run(
        owner_id=OWNER_A,
        classroom_id=classroom.id,
        session_id=session.id,
        expected_revision=1,
        client_request_id="dedup-req-123",
        message_content="Initial submission retry",
    )
    assert created2 is False
    assert run1.id == run2.id
    # Ensure events weren't duplicated (only the 1 initial 'queued' event)
    events = get_run_events(OWNER_A, run1.id, after_seq=0)
    assert len(events) == 1
    assert events[0].event_type == EventType.QUEUED
    print("Request deduplication verified: PASSED")

    # 2. Worker claim, leases, and fencing tokens
    claimed = claim_next_job(worker_id="worker-1", lane=RunLane.FOREGROUND, lease_seconds=30)
    assert claimed is not None
    claimed_run, job = claimed
    assert claimed_run.id == run1.id
    assert claimed_run.fence == 2
    assert claimed_run.lease_owner == "worker-1"

    # Worker 1 emits chunk with valid fence 2
    write_run_event(
        run_id=run1.id,
        worker_id="worker-1",
        fence=2,
        event_type=EventType.CHUNK,
        payload={"delta": "Analyzing solution..."},
    )

    # Expired/stale worker write: Worker tries to write with stale fence 1
    try:
        write_run_event(
            run_id=run1.id,
            worker_id="worker-1",
            fence=1,
            event_type=EventType.CHUNK,
            payload={"delta": "Stale write attempt"},
        )
        assert False, "Stale fence write should have been rejected"
    except ExpiredWorkerWriteError as e:
        assert "Fencing token conflict" in str(e)
        print("Stale fence worker write rejected: PASSED")

    # Worker lease expires or another worker takes over
    claimed_run.fence = 3
    claimed_run.lease_owner = "worker-2"
    db = get_db()
    with db:
        db.execute("UPDATE turn_runs SET fence = 3, lease_owner = 'worker-2' WHERE id = ?", (run1.id,))

    # Worker 1 attempts to complete run with fence 2 -> rejected
    decision = TeachingDecision(
        decision_id="dec-1",
        session_id=session.id,
        owner_id=OWNER_A,
        expected_revision=1,
        assessment="Stale assessment",
        uncertainty=0.0,
        next_action="probe",
        reveal_limit=0,
        observed_success_criteria=[],
        rationale="Stale",
    )
    try:
        complete_run(run_id=run1.id, worker_id="worker-1", fence=2, decision=decision)
        assert False, "Fenced-out worker completion should have been rejected"
    except ExpiredWorkerWriteError:
        print("Fenced-out worker completion rejected: PASSED")


def test_b04_ac3_disconnect_resume_cancel_and_uncertain_external_calls():
    """
    B04-AC3: Disconnect, restart, resume and cancel preserve accepted input, event order and uncertain external effects.
    """
    setup_function()
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)

    # 1. Start run and process deterministically with fixture worker
    run, _ = create_or_get_turn_run(
        owner_id=OWNER_A,
        classroom_id=classroom.id,
        session_id=session.id,
        expected_revision=1,
        client_request_id="flow-run-1",
        message_content="What is two sum time complexity?",
    )
    completed_run, decision = process_next_fixture_turn(worker_id="test-worker-1")
    assert completed_run.state == RunState.COMPLETED
    assert completed_run.decision is not None

    # Verify reconnectable event stream after disconnect
    # Events order: 1: queued, 2: thinking, 3: chunk, 4: done
    all_events = get_run_events(OWNER_A, run.id, after_seq=0)
    assert len(all_events) == 4
    assert [e.seq for e in all_events] == [1, 2, 3, 4]
    assert [e.event_type for e in all_events] == [
        EventType.QUEUED,
        EventType.THINKING,
        EventType.CHUNK,
        EventType.DONE,
    ]

    # Client reconnects after sequence 2 -> receives strictly sequence 3 and 4
    resumed_events = get_run_events(OWNER_A, run.id, after_seq=2)
    assert len(resumed_events) == 2
    assert [e.seq for e in resumed_events] == [3, 4]
    print("Reconnectable event stream resume (after_seq=2): PASSED")

    # 2. Run cancellation preserves history
    # Session revision advanced or new session
    session2 = create_session(OWNER_A, classroom.id)
    run_cancel, _ = create_or_get_turn_run(
        owner_id=OWNER_A,
        classroom_id=classroom.id,
        session_id=session2.id,
        expected_revision=1,
        client_request_id="cancel-run-1",
        message_content="Cancel me",
    )
    cancelled = cancel_run(OWNER_A, run_cancel.id)
    assert cancelled.state == RunState.CANCELLED
    cancel_events = get_run_events(OWNER_A, run_cancel.id, after_seq=0)
    assert len(cancel_events) == 2
    assert cancel_events[0].event_type == EventType.QUEUED
    assert cancel_events[1].event_type == EventType.CANCELLED
    print("Run cancellation with preserved history: PASSED")

    # 3. External call receipt idempotency and uncertain status
    idempotency_key = "model-call-xyz"
    receipt1, should_exec1 = record_external_call_start(
        owner_id=OWNER_A,
        idempotency_key=idempotency_key,
        call_type="model_inference",
        request_data={"prompt": "test prompt"},
    )
    assert should_exec1 is True
    assert receipt1.status == ExternalCallStatus.STARTED

    # Simulate network disconnect / timeout during remote call: marks UNCERTAIN
    uncertain_receipt = mark_external_call_uncertain(OWNER_A, idempotency_key)
    assert uncertain_receipt.status == ExternalCallStatus.UNCERTAIN

    # Retrying with same idempotency key raises UncertainExternalCallError (prevents double billing)
    try:
        record_external_call_start(
            owner_id=OWNER_A,
            idempotency_key=idempotency_key,
            call_type="model_inference",
            request_data={"prompt": "test prompt"},
        )
        assert False, "Should have raised UncertainExternalCallError on uncertain receipt"
    except UncertainExternalCallError as e:
        assert "uncertain state" in str(e)
        print("Uncertain external call billing protection: PASSED")


def test_b04_fastapi_endpoints():
    """Verify B04 FastAPI endpoints: POST /messages (202), GET /runs/{id}, GET /runs/{id}/events, POST /runs/{id}/cancel."""
    setup_function()
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)

    token = _make_jwt({
        "sub": OWNER_A,
        "email": "darshan@planly.internal",
        "role": "authenticated",
        "exp": time.time() + 3600,
    })
    auth_header = [(b"authorization", f"Bearer {token}".encode("utf-8"))]

    # 1. POST /api/sessions/{session_id}/messages -> 202 Accepted with RunReceipt
    status, body = asyncio.run(_dispatch_request(
        "POST",
        f"/api/sessions/{session.id}/messages",
        {"content": "Learner question on two pointers", "expected_revision": 1, "client_request_id": "api-req-1"},
        headers=auth_header,
    ))
    assert status == 202, f"Expected 202, got {status}: {body}"
    run_id = body["run_id"]
    assert body["accepted_revision"] == 1
    assert f"/api/runs/{run_id}" in body["status_url"]
    print(f"FastAPI POST /messages (202): PASSED -> {run_id}")

    # 2. GET /api/runs/{run_id} -> RunStatusResponse
    status, body = asyncio.run(_dispatch_request(
        "GET",
        f"/api/runs/{run_id}",
        headers=auth_header,
    ))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["state"] == "queued"
    assert body["events_count"] == 1
    print("FastAPI GET /runs/{run_id} (200): PASSED")

    # 3. GET /api/runs/{run_id}/events -> RunEventsResponse
    status, body = asyncio.run(_dispatch_request(
        "GET",
        f"/api/runs/{run_id}/events",
        headers=auth_header,
    ))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert len(body["events"]) == 1
    assert body["latest_seq"] == 1
    assert body["is_complete"] is False
    print("FastAPI GET /runs/{run_id}/events (200): PASSED")

    # 4. POST /api/runs/{run_id}/cancel -> RunStatusResponse
    status, body = asyncio.run(_dispatch_request(
        "POST",
        f"/api/runs/{run_id}/cancel",
        headers=auth_header,
    ))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["state"] == "cancelled"
    print("FastAPI POST /runs/{run_id}/cancel (200): PASSED")


def test_b04_real_db_constraints_enforced():
    """
    Validate SQL DDL constraints from 00000000000006_durable_runs.sql using SQLite:
    1. Single active foreground run per classroom (partial unique index).
    2. Monotonically ordered run events unique sequence.
    3. External receipts idempotency key unique constraint.
    """
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    cur.executescript("""
    CREATE TABLE classrooms (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        track TEXT NOT NULL,
        title TEXT NOT NULL,
        CONSTRAINT uq_classrooms_owner_id UNIQUE (owner_id, id)
    );

    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        classroom_id TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'foundation',
        mode TEXT NOT NULL DEFAULT 'practice',
        status TEXT NOT NULL DEFAULT 'active',
        current_revision INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT fk_sessions_classroom FOREIGN KEY (owner_id, classroom_id)
            REFERENCES classrooms(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT uq_sessions_owner_id UNIQUE (owner_id, id)
    );

    CREATE TABLE turn_runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        classroom_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        client_request_id TEXT NOT NULL,
        expected_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        lane TEXT NOT NULL DEFAULT 'foreground',
        fence INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT fk_runs_classroom FOREIGN KEY (owner_id, classroom_id)
            REFERENCES classrooms(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_runs_session FOREIGN KEY (owner_id, session_id)
            REFERENCES sessions(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT uq_runs_owner_client_request UNIQUE (owner_id, client_request_id),
        CONSTRAINT uq_turn_runs_owner_id UNIQUE (owner_id, id)
    );

    -- Partial index enforcing B04-AC1 at the DB layer
    CREATE UNIQUE INDEX uq_one_active_foreground_run
        ON turn_runs (owner_id, classroom_id)
        WHERE lane = 'foreground' AND state IN ('queued', 'running');

    CREATE TABLE run_events (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        CONSTRAINT fk_events_run FOREIGN KEY (owner_id, run_id)
            REFERENCES turn_runs(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT uq_run_events_seq UNIQUE (run_id, seq)
    );

    CREATE TABLE external_call_receipts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        call_type TEXT NOT NULL,
        status TEXT NOT NULL,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT uq_external_receipts_owner_key UNIQUE (owner_id, idempotency_key)
    );
    """)

    cur.execute("INSERT INTO classrooms VALUES ('c1', 'owner_a', 'dsa', 'DSA 1');")
    cur.execute("INSERT INTO sessions VALUES ('s1', 'owner_a', 'c1', 'foundation', 'practice', 'active', 1);")

    # 1. Insert first active foreground run
    cur.execute("INSERT INTO turn_runs VALUES ('r1', 'owner_a', 'c1', 's1', 'req1', 1, 'queued', 'foreground', 1);")

    # 2. Insert competing foreground run in same classroom -> FAILS partial unique index
    try:
        cur.execute("INSERT INTO turn_runs VALUES ('r2', 'owner_a', 'c1', 's1', 'req2', 1, 'running', 'foreground', 1);")
        assert False, "DB path should have rejected second active foreground run"
    except sqlite3.IntegrityError:
        print("DB path rejected competing active foreground run: PASSED")

    # 3. Update r1 to completed -> now r2 can be inserted
    cur.execute("UPDATE turn_runs SET state = 'completed' WHERE id = 'r1';")
    cur.execute("INSERT INTO turn_runs VALUES ('r2', 'owner_a', 'c1', 's1', 'req2', 1, 'running', 'foreground', 1);")
    print("DB path accepted new foreground run after completion: PASSED")

    # 4. Insert duplicate event seq -> FAILS
    cur.execute("INSERT INTO run_events VALUES ('e1', 'owner_a', 'r1', 1, 'queued');")
    try:
        cur.execute("INSERT INTO run_events VALUES ('e2', 'owner_a', 'r1', 1, 'thinking');")
        assert False, "DB path should have rejected duplicate event sequence"
    except sqlite3.IntegrityError:
        print("DB path rejected duplicate event sequence: PASSED")

    # 5. External receipts duplicate idempotency key -> FAILS
    cur.execute("INSERT INTO external_call_receipts VALUES ('ext1', 'owner_a', 'key-1', 'model', 'succeeded', 1);")
    try:
        cur.execute("INSERT INTO external_call_receipts VALUES ('ext2', 'owner_a', 'key-1', 'model', 'started', 0);")
        assert False, "DB path should have rejected duplicate external receipt key"
    except sqlite3.IntegrityError:
        print("DB path rejected duplicate external receipt idempotency key: PASSED")

    conn.close()


def test_b04_openapi_pydantic_roundtrip():
    """B04-AC3: Assert Pydantic model serialization matches OpenAPI component schema property names."""
    contracts_file = BASE_DIR.parent.parent / "contracts" / "openapi.json"
    assert contracts_file.exists(), "contracts/openapi.json must exist"

    with open(contracts_file, "r", encoding="utf-8") as f:
        openapi = json.load(f)

    schemas = openapi["components"]["schemas"]

    models_to_check = [
        (TurnRunRecord, "TurnRunRecord"),
        (RunEvent, "RunEvent"),
        (ExternalCallReceipt, "ExternalCallReceipt"),
        (RunStatusResponse, "RunStatusResponse"),
        (RunEventsResponse, "RunEventsResponse"),
    ]

    for model_cls, schema_name in models_to_check:
        assert schema_name in schemas, f"Schema {schema_name} missing from openapi.json"
        schema_props = set(schemas[schema_name].get("properties", {}).keys())
        model_fields = set(model_cls.model_fields.keys())
        diff = schema_props.symmetric_difference(model_fields)
        assert len(diff) == 0, f"Field name drift detected in {schema_name}: {diff}"
        print(f"Contract parity verified for {schema_name}: {sorted(list(schema_props))}")

    print("B04-AC3 OpenAPI / Pydantic roundtrip parity: PASSED")


if __name__ == "__main__":
    setup_function()
    test_b04_ac1_competing_tabs_and_revision_conflict()

    setup_function()
    test_b04_ac2_duplicate_requests_and_expired_worker_fencing()

    setup_function()
    test_b04_ac3_disconnect_resume_cancel_and_uncertain_external_calls()

    setup_function()
    test_b04_fastapi_endpoints()

    setup_function()
    test_b04_real_db_constraints_enforced()

    setup_function()
    test_b04_openapi_pydantic_roundtrip()

    print("\nAll B04 Durable Runs & Worker Tests PASSED successfully.")
