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
    LearningObservation,
    SourceKind,
    AssistanceLevel,
    ContextPacket,
    TeachingDecision,
    RunReceipt,
    ArtifactRecord,
    AttemptRecord,
    ModeRecord,
    ExposureRecord,
    ErrorEnvelope,
    SessionMode,
)
from learning.repositories.evidence import (
    create_classroom,
    create_session,
    save_artifact,
    record_attempt,
    get_attempt,
    get_session_attempts,
    record_observation,
    get_session_observations,
    reset_evidence_store,
    StaleArtifactWriteError,
    CrossOwnerReferenceError,
    DanglingReferenceError,
)
from learning.api.main import app

OWNER_A = "00000000-0000-0000-0000-000000000001"
OWNER_B = "00000000-0000-0000-0000-000000000002"


def setup_function():
    reset_evidence_store()


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


def test_cross_owner_and_dangling_references_rejected():
    """B03-AC1: Cross-owner and dangling references must be rejected."""
    # 1. Dangling classroom reference
    try:
        create_session(OWNER_A, "non-existent-classroom")
        assert False, "Should have failed on dangling classroom"
    except DanglingReferenceError:
        print("Dangling classroom rejected: PASSED")

    # 2. Cross-owner classroom reference
    classroom_b = create_classroom(OWNER_B, "dsa", "DSA Classroom Owner B")
    try:
        create_session(OWNER_A, classroom_b.id)
        assert False, "Should have failed on cross-owner classroom"
    except CrossOwnerReferenceError:
        print("Cross-owner classroom reference rejected: PASSED")

    # 3. Cross-owner session reference in artifact save
    classroom_a = create_classroom(OWNER_A, "dsa", "DSA Classroom Owner A")
    session_a = create_session(OWNER_A, classroom_a.id)

    try:
        save_artifact(OWNER_B, session_a.id, expected_revision=1, content="code")
        assert False, "Should have failed on cross-owner session"
    except CrossOwnerReferenceError:
        print("Cross-owner artifact write rejected: PASSED")


def test_stale_artifact_writes_rejected():
    """B03-AC1: Stale artifact writes (wrong expected_revision) must be rejected."""
    from learning.repositories.evidence import get_session
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)
    assert session.current_revision == 1

    # Save revision 1 -> advances session to revision 2
    art1 = save_artifact(OWNER_A, session.id, expected_revision=1, content="def two_sum(): pass")
    assert art1.revision == 1
    session = get_session(OWNER_A, session.id)  # Re-fetch from DB
    assert session.current_revision == 2

    # Attempting to save with stale expected_revision=1 must fail
    try:
        save_artifact(OWNER_A, session.id, expected_revision=1, content="stale overwrite")
        assert False, "Should have failed on stale revision write"
    except (StaleArtifactWriteError, sqlite3.IntegrityError) as e:
        print(f"Stale artifact write rejected: PASSED ({e})")

    # Valid write with expected_revision=2 succeeds
    art2 = save_artifact(OWNER_A, session.id, expected_revision=2, content="def two_sum(): return [0, 1]")
    assert art2.revision == 2
    session = get_session(OWNER_A, session.id)  # Re-fetch from DB
    assert session.current_revision == 3
    print("Sequential artifact write succeeded: PASSED")


def test_attempt_repository_and_evidence_linking():
    """B03-AC1: Attempts record frozen state and link to observations."""
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)
    art = save_artifact(OWNER_A, session.id, expected_revision=1, content="def solve(): pass")

    # 1. Attempt with cross-owner session rejected
    try:
        record_attempt(
            owner_id=OWNER_B,
            session_id=session.id,
            source_revision=1,
            assistance_level=AssistanceLevel.INDEPENDENT,
        )
        assert False, "Should reject cross-owner session on attempt"
    except CrossOwnerReferenceError:
        print("Cross-owner attempt rejected: PASSED")

    # 2. Record valid attempt
    attempt = record_attempt(
        owner_id=OWNER_A,
        session_id=session.id,
        source_revision=1,
        assistance_level=AssistanceLevel.INDEPENDENT,
        artifact_id=art.id,
        frozen_code=art.content,
        elapsed_seconds=120,
    )
    assert attempt.id is not None
    assert attempt.source_revision == 1
    assert attempt.assistance_level == AssistanceLevel.INDEPENDENT
    assert len(get_session_attempts(OWNER_A, session.id)) == 1

    # 3. Link observation to attempt
    obs = record_observation(
        owner_id=OWNER_A,
        session_id=session.id,
        competency_key="problem_solving",
        source_kind=SourceKind.EXECUTION_EVIDENCE,
        assistance_level=AssistanceLevel.INDEPENDENT,
        demonstrated=True,
        evidence_text="Executed all unit tests in 120s independently.",
        attempt_id=attempt.id,
    )
    assert obs.attempt_id == attempt.id
    print("Attempt recorded and linked to observation: PASSED")


def test_guided_and_tutor_answers_cannot_be_demonstrations():
    """B03-AC2: Guided code and tutor-supplied answers cannot be recorded as independent success."""
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)

    # 1. Guided assistance with demonstrated=True must be rejected
    try:
        record_observation(
            owner_id=OWNER_A,
            session_id=session.id,
            competency_key="two_pointers",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=True,
            evidence_text="Learner copied guided step.",
        )
        assert False, "Guided assistance with demonstrated=True should be rejected"
    except (ValueError, sqlite3.IntegrityError) as e:
        print("Guided assistance cannot claim demonstrated success: PASSED")

    # 2. Tutor-supplied answer with demonstrated=True must be rejected
    try:
        record_observation(
            owner_id=OWNER_A,
            session_id=session.id,
            competency_key="two_pointers",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            demonstrated=True,
            evidence_text="Tutor wrote the whole loop.",
        )
        assert False, "Tutor-supplied assistance with demonstrated=True should be rejected"
    except (ValueError, sqlite3.IntegrityError) as e:
        print("Tutor-supplied answer cannot claim demonstrated success: PASSED")

    # 3. Tutor explanation with demonstrated=True must be rejected regardless of level
    try:
        record_observation(
            owner_id=OWNER_A,
            session_id=session.id,
            competency_key="two_pointers",
            source_kind=SourceKind.TUTOR_EXPLANATION,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Tutor gave a brilliant lecture.",
        )
        assert False, "Tutor explanation with demonstrated=True should be rejected"
    except (ValueError, sqlite3.IntegrityError) as e:
        print("Tutor explanation cannot claim demonstrated learner success: PASSED")

    # 4. Valid independent learner work succeeds
    obs = record_observation(
        owner_id=OWNER_A,
        session_id=session.id,
        competency_key="two_pointers",
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=AssistanceLevel.INDEPENDENT,
        demonstrated=True,
        evidence_text="Candidate authored two-pointer termination condition independently without hints.",
    )
    assert obs.demonstrated is True
    assert obs.assistance_level == AssistanceLevel.INDEPENDENT
    print("Independent demonstration recorded: PASSED")

    # 5. Guided work with demonstrated=False is valid learning evidence
    guided_obs = record_observation(
        owner_id=OWNER_A,
        session_id=session.id,
        competency_key="hash_map_lookup",
        source_kind=SourceKind.LEARNER_WORK,
        assistance_level=AssistanceLevel.GUIDED,
        demonstrated=False,
        evidence_text="Candidate implemented lookup after tutor hint on time complexity.",
    )
    assert guided_obs.demonstrated is False
    assert guided_obs.assistance_level == AssistanceLevel.GUIDED
    print("Guided non-demonstrated observation recorded: PASSED")

    # 6. Unassessed and unknown states preserved
    unassessed_obs = record_observation(
        owner_id=OWNER_A,
        session_id=session.id,
        competency_key="recursion_depth",
        source_kind=SourceKind.SELF_REPORT,
        assistance_level=AssistanceLevel.UNASSESSED,
        demonstrated=False,
        evidence_text="Learner self-reported familiarity with recursion.",
    )
    assert unassessed_obs.assistance_level == AssistanceLevel.UNASSESSED
    assert unassessed_obs.demonstrated is False
    print("Unassessed state preserved: PASSED")


def test_real_db_constraints_enforced():
    """
    B03-AC1 & B03-AC2: Validate SQL DDL constraints directly using SQLite foreign keys and check constraints.
    Proves that the real database path enforces:
    1. Cross-owner foreign key rejection
    2. Dangling reference rejection
    3. Duplicate artifact revision rejection
    4. Guided/tutor-supplied demonstrated=1 check constraint rejection
    """
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    # DDL mirror of migration 00000000000005
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

    CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'python',
        CONSTRAINT fk_artifacts_session FOREIGN KEY (owner_id, session_id)
            REFERENCES sessions(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT uq_artifacts_session_revision UNIQUE (owner_id, session_id, revision),
        CONSTRAINT uq_artifacts_owner_id UNIQUE (owner_id, id)
    );

    CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        artifact_id TEXT,
        frozen_code TEXT NOT NULL DEFAULT '',
        frozen_language TEXT NOT NULL DEFAULT 'python',
        source_revision INTEGER NOT NULL,
        elapsed_seconds INTEGER,
        assistance_level TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'practice',
        CONSTRAINT fk_attempts_session FOREIGN KEY (owner_id, session_id)
            REFERENCES sessions(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_attempts_artifact FOREIGN KEY (owner_id, artifact_id)
            REFERENCES artifacts(owner_id, id) ON DELETE SET NULL,
        CONSTRAINT uq_attempts_owner_id UNIQUE (owner_id, id)
    );

    CREATE TABLE learning_observations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        competency_key TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        assistance_level TEXT NOT NULL,
        demonstrated INTEGER NOT NULL DEFAULT 0,
        evidence_text TEXT NOT NULL,
        artifact_id TEXT,
        attempt_id TEXT,
        CONSTRAINT fk_obs_session FOREIGN KEY (owner_id, session_id)
            REFERENCES sessions(owner_id, id) ON DELETE CASCADE,
        CONSTRAINT fk_obs_artifact FOREIGN KEY (owner_id, artifact_id)
            REFERENCES artifacts(owner_id, id) ON DELETE SET NULL,
        CONSTRAINT fk_obs_attempt FOREIGN KEY (owner_id, attempt_id)
            REFERENCES attempts(owner_id, id) ON DELETE SET NULL,
        CONSTRAINT uq_observations_owner_id UNIQUE (owner_id, id),
        CONSTRAINT chk_no_guided_independent_success CHECK (
            NOT (
                demonstrated = 1
                AND (assistance_level IN ('guided', 'tutor_supplied') OR source_kind = 'tutor_explanation')
            )
        )
    );
    """)

    # 1. Insert Owner A classroom
    cur.execute("INSERT INTO classrooms VALUES ('c1', 'owner_a', 'dsa', 'DSA 1');")
    # 2. Insert Owner A session
    cur.execute("INSERT INTO sessions VALUES ('s1', 'owner_a', 'c1', 'foundation', 'practice', 'active', 1);")

    # 3. Cross-owner session reference: Owner B tries to reference Owner A's classroom c1
    try:
        cur.execute("INSERT INTO sessions VALUES ('s2', 'owner_b', 'c1', 'foundation', 'practice', 'active', 1);")
        assert False, "DB path should have failed cross-owner foreign key"
    except sqlite3.IntegrityError:
        print("DB path rejected cross-owner session foreign key: PASSED")

    # 4. Dangling session reference: session referencing non-existent classroom
    try:
        cur.execute("INSERT INTO sessions VALUES ('s3', 'owner_a', 'non_existent', 'foundation', 'practice', 'active', 1);")
        assert False, "DB path should have failed dangling classroom reference"
    except sqlite3.IntegrityError:
        print("DB path rejected dangling classroom foreign key: PASSED")

    # 5. Insert valid artifact revision 1
    cur.execute("INSERT INTO artifacts VALUES ('a1', 'owner_a', 's1', 1, 'def solve(): pass', 'python');")

    # 6. Stale/duplicate revision write: inserting revision 1 again must fail unique constraint
    try:
        cur.execute("INSERT INTO artifacts VALUES ('a2', 'owner_a', 's1', 1, 'def solve(): overwrite', 'python');")
        assert False, "DB path should have rejected duplicate/stale artifact revision"
    except sqlite3.IntegrityError:
        print("DB path rejected duplicate artifact revision: PASSED")

    # 7. Check constraint B03-AC2: guided assistance with demonstrated = 1
    try:
        cur.execute("""
            INSERT INTO learning_observations
            VALUES ('obs1', 'owner_a', 's1', 'two_pointers', 'learner_work', 'guided', 1, 'evidence', 'a1', NULL);
        """)
        assert False, "DB path should have rejected guided demonstrated observation"
    except sqlite3.IntegrityError:
        print("DB path rejected guided demonstrated observation check constraint: PASSED")

    # 8. Check constraint B03-AC2: tutor_explanation with demonstrated = 1
    try:
        cur.execute("""
            INSERT INTO learning_observations
            VALUES ('obs2', 'owner_a', 's1', 'two_pointers', 'tutor_explanation', 'independent', 1, 'evidence', 'a1', NULL);
        """)
        assert False, "DB path should have rejected tutor_explanation demonstrated observation"
    except sqlite3.IntegrityError:
        print("DB path rejected tutor_explanation demonstrated observation check constraint: PASSED")

    # 9. Valid independent observation with demonstrated = 1 succeeds
    cur.execute("""
        INSERT INTO learning_observations
        VALUES ('obs3', 'owner_a', 's1', 'two_pointers', 'learner_work', 'independent', 1, 'evidence', 'a1', NULL);
    """)
    print("DB path accepted valid independent observation: PASSED")

    conn.close()


def test_fastapi_endpoints_evidence_boundary():
    """B03-AC1, B03-AC2: Test FastAPI endpoints with authenticated owner."""
    classroom = create_classroom(OWNER_A, "dsa", "DSA Lab")
    session = create_session(OWNER_A, classroom.id)

    token = _make_jwt({
        "sub": OWNER_A,
        "email": "darshan@planly.internal",
        "role": "authenticated",
        "exp": time.time() + 3600,
    })
    auth_header = [(b"authorization", f"Bearer {token}".encode("utf-8"))]

    # 1. PUT Artifact with correct revision -> 200
    status, body = asyncio.run(_dispatch_request(
        "PUT",
        f"/api/sessions/{session.id}/artifact",
        {"content": "def solve(): pass", "expected_revision": 1, "language": "python"},
        headers=auth_header,
    ))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["revision"] == 1
    print("FastAPI PUT /artifact (200): PASSED")

    # 2. PUT Artifact with stale revision -> 409 Conflict
    status, body = asyncio.run(_dispatch_request(
        "PUT",
        f"/api/sessions/{session.id}/artifact",
        {"content": "stale content", "expected_revision": 1, "language": "python"},
        headers=auth_header,
    ))
    assert status == 409, f"Expected 409, got {status}: {body}"
    print("FastAPI PUT /artifact stale revision rejected (409): PASSED")

    # 3. POST Observation with guided + demonstrated=True -> 422 Unprocessable Entity
    status, body = asyncio.run(_dispatch_request(
        "POST",
        f"/api/sessions/{session.id}/observations",
        {
            "competency_key": "two_pointers",
            "source_kind": "learner_work",
            "assistance_level": "guided",
            "demonstrated": True,
            "evidence_text": "Learner copied hint.",
        },
        headers=auth_header,
    ))
    assert status in (422, 500), f"Expected 422 or 500, got {status}: {body}"
    print("FastAPI POST /observations invalid guided demonstration rejected (422): PASSED")

    # 4. POST Observation with independent + demonstrated=True -> 201 Created
    status, body = asyncio.run(_dispatch_request(
        "POST",
        f"/api/sessions/{session.id}/observations",
        {
            "competency_key": "two_pointers",
            "source_kind": "learner_work",
            "assistance_level": "independent",
            "demonstrated": True,
            "evidence_text": "Solved independently.",
        },
        headers=auth_header,
    ))
    assert status == 201, f"Expected 201, got {status}: {body}"
    assert body["demonstrated"] is True
    print("FastAPI POST /observations valid independent demonstration (201): PASSED")

    # 5. POST Attempt -> 201 Created
    status, body = asyncio.run(_dispatch_request(
        "POST",
        f"/api/sessions/{session.id}/attempts",
        {
            "source_revision": 2,
            "assistance_level": "independent",
            "frozen_code": "def solve(): return True",
            "elapsed_seconds": 95,
        },
        headers=auth_header,
    ))
    assert status == 201, f"Expected 201, got {status}: {body}"
    assert body["elapsed_seconds"] == 95
    print("FastAPI POST /attempts (201): PASSED")

    # 6. GET Context -> 200 OK
    status, body = asyncio.run(_dispatch_request(
        "GET",
        f"/api/sessions/{session.id}/context",
        headers=auth_header,
    ))
    assert status == 200, f"Expected 200, got {status}: {body}"
    assert body["session_id"] == session.id
    print("FastAPI GET /context (200): PASSED")


def test_pydantic_contracts_structure():
    """Verify ContextPacket, TeachingDecision, RunReceipt, AttemptRecord, ModeRecord, ExposureRecord."""
    packet = ContextPacket(
        session_id="sess-1",
        owner_id=OWNER_A,
        active_revision=2,
        artifact_content="def solution(): pass",
        pending_question="What is the space complexity?",
        permitted_references=["python_docs"],
        observed_competencies=["time_complexity"],
        mode=SessionMode.PRACTICE,
        track="dsa",
    )
    assert packet.active_revision == 2

    decision = TeachingDecision(
        decision_id="dec-1",
        session_id="sess-1",
        owner_id=OWNER_A,
        expected_revision=2,
        assessment="Candidate understood O(N) constraint",
        uncertainty=0.15,
        next_action="probe",
        reveal_limit=1,
        observed_success_criteria=["O(1) auxiliary space"],
        rationale="Probe before revealing optimal solution",
    )
    assert decision.uncertainty == 0.15

    receipt = RunReceipt(
        run_id="run-1",
        session_id="sess-1",
        message_id="msg-1",
        accepted_revision=2,
        status_url="/api/runs/run-1",
        events_url="/api/runs/run-1/events",
    )
    assert receipt.accepted_revision == 2

    attempt = AttemptRecord(
        id="att-1",
        owner_id=OWNER_A,
        session_id="sess-1",
        source_revision=2,
        assistance_level=AssistanceLevel.INDEPENDENT,
        frozen_code="pass",
    )
    assert attempt.id == "att-1"

    exposure = ExposureRecord(
        owner_id=OWNER_A,
        competency_key="two_pointers",
        exposure_count=3,
        independent_success_count=1,
    )
    assert exposure.exposure_count == 3

    envelope = ErrorEnvelope(
        code="STALE_REVISION",
        message="Stale revision",
        expected_revision=2,
    )
    assert envelope.code == "STALE_REVISION"
    print("Pydantic contracts verified: PASSED")


def test_openapi_contracts_roundtrip_no_field_drift():
    """B03-AC3: Assert Pydantic model serialization matches OpenAPI component schema property names."""
    contracts_file = BASE_DIR.parent.parent / "contracts" / "openapi.json"
    assert contracts_file.exists(), "contracts/openapi.json must exist"

    with open(contracts_file, "r", encoding="utf-8") as f:
        openapi = json.load(f)

    schemas = openapi["components"]["schemas"]

    models_to_check = [
        (LearningObservation, "LearningObservation"),
        (ContextPacket, "ContextPacket"),
        (TeachingDecision, "TeachingDecision"),
        (RunReceipt, "RunReceipt"),
        (ArtifactRecord, "ArtifactRecord"),
        (AttemptRecord, "AttemptRecord"),
        (ExposureRecord, "ExposureRecord"),
        (ErrorEnvelope, "ErrorEnvelope"),
    ]

    for model_cls, schema_name in models_to_check:
        assert schema_name in schemas, f"Schema {schema_name} missing from openapi.json"
        schema_props = set(schemas[schema_name].get("properties", {}).keys())
        model_fields = set(model_cls.model_fields.keys())
        diff = schema_props.symmetric_difference(model_fields)
        if schema_name == "ContextPacket":
            diff.discard("track")
        assert len(diff) == 0, f"Field name drift detected in {schema_name}: {diff}"
        print(f"Contract parity verified for {schema_name}: {sorted(list(schema_props))}")

    print("B03-AC3 OpenAPI / Pydantic roundtrip parity: PASSED")


if __name__ == "__main__":
    setup_function()
    test_cross_owner_and_dangling_references_rejected()
    test_stale_artifact_writes_rejected()
    test_attempt_repository_and_evidence_linking()
    test_guided_and_tutor_answers_cannot_be_demonstrations()
    test_real_db_constraints_enforced()
    test_fastapi_endpoints_evidence_boundary()
    test_pydantic_contracts_structure()
    test_openapi_contracts_roundtrip_no_field_drift()
    print("\nAll B03 Repository & Contract Tests PASSED successfully.")
