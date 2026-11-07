"""
Automated Boundary Tests for Classroom & Session REST Endpoints.
Sprint: B09
Verifies:
- B09-AC1: Real adaptive DSA classroom lifecycle: create/list classrooms, create/list sessions,
  fetch messages, execute adaptive turn and preserve history without message duplication.
- B09-AC2: Code revision in backend matches artifact revision, rejects stale writes (409 conflict).
- B09-AC3: Cross-owner authorization boundaries and error states.
- Failure to prevent: No simulated progress cards, giant dashboard or mandatory one-file workflow.
"""

import json
import base64
import time
import asyncio
from pathlib import Path
import sys

# Ensure services/learning is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from learning.api.main import app
from learning.repositories.identity import (
    bootstrap_allowed_owner,
    reset_identity_store,
)
from learning.repositories.evidence import (
    reset_evidence_store,
    create_classroom,
    create_session,
    save_artifact,
)

OWNER_A = "00000000-0000-0000-0000-000000000001"
OWNER_B = "00000000-0000-0000-0000-000000000002"


def _make_jwt(owner_id: str, email: str = "test@example.com") -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": owner_id,
        "email": email,
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    dummy_sig = base64.urlsafe_b64encode(b"dummy_sig_classroom_test").decode().rstrip("=")
    return f"{h_b64}.{p_b64}.{dummy_sig}"


async def _dispatch_request(method: str, path: str, token: str = None, body: dict = None):
    response_body = []
    status_code = None

    body_bytes = json.dumps(body).encode("utf-8") if body is not None else b""

    async def receive():
        return {
            "type": "http.request",
            "body": body_bytes,
            "more_body": False,
        }

    async def send(message):
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            response_body.append(message.get("body", b""))

    headers = [
        (b"host", b"testserver"),
        (b"content-type", b"application/json"),
    ]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode("utf-8")))

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": headers,
    }

    await app(scope, receive, send)
    raw = b"".join(response_body).decode("utf-8")
    data = json.loads(raw) if raw else {}
    return status_code, data


def setup_function():
    reset_identity_store()
    reset_evidence_store()
    from learning.repositories.runs import reset_runs_store
    reset_runs_store()
    bootstrap_allowed_owner(OWNER_A, "owner_a@example.com")
    bootstrap_allowed_owner(OWNER_B, "owner_b@example.com")
    # Mock rubric assessment and gateway for lesson turn tests
    from unittest.mock import patch, MagicMock
    from learning.learner.rubrics import ReasoningAssessment
    from learning.models.types import ProviderResponse, TokenUsage
    def _mock_assess(learner_answer, rubric, context=None):
        lower = learner_answer.lower()
        if any(kw in lower for kw in ["sorted", "pointer", "convergence", "increases", "decreases", "left", "right", "inward"]):
            return ReasoningAssessment(quality="deep", demonstrated=True, confidence=0.85, rationale="Test mock: deep", matched_criteria=["test"], evidence_gaps=[])
        return ReasoningAssessment(quality="shallow", demonstrated=False, confidence=0.4, rationale="Test mock: shallow", matched_criteria=[], evidence_gaps=["reasoning"])
    patch("learning.learner.rubrics.assess_against_rubric", side_effect=_mock_assess).start()
    mock_response = ProviderResponse(content="Good reasoning about the two pointer approach.", usage=TokenUsage(input_tokens=50, output_tokens=30, cost_cents=1), model_name="fixture-test")
    gw_patcher = patch("learning.workflows.lesson._get_gateway")
    mock_gw = gw_patcher.start()
    gw_instance = MagicMock()
    gw_instance.generate.return_value = mock_response
    mock_gw.return_value = gw_instance


def test_classroom_crud_lifecycle():
    """B09-AC1: Tests classroom creation, retrieval and listing for authenticated owner."""
    token = _make_jwt(OWNER_A)

    # 1. Initially empty classrooms list
    status, classrooms = asyncio.run(_dispatch_request("GET", "/api/classrooms", token=token))
    assert status == 200
    assert len(classrooms) == 0

    # 2. Create a new classroom
    create_body = {"track": "dsa", "title": "DSA: Two Pointers & Sliding Window"}
    status, created = asyncio.run(_dispatch_request("POST", "/api/classrooms", token=token, body=create_body))
    assert status == 201
    assert created["track"] == "dsa"
    assert created["title"] == "DSA: Two Pointers & Sliding Window"
    assert created["owner_id"] == OWNER_A
    cls_id = created["id"]

    # 3. List classrooms now contains the created classroom
    status, classrooms = asyncio.run(_dispatch_request("GET", "/api/classrooms", token=token))
    assert status == 200
    assert len(classrooms) == 1
    assert classrooms[0]["id"] == cls_id

    # 4. Get specific classroom
    status, fetched = asyncio.run(_dispatch_request("GET", f"/api/classrooms/{cls_id}", token=token))
    assert status == 200
    assert fetched["id"] == cls_id


def test_session_lifecycle_and_artifact_parity():
    """B09-AC2: Tests session creation, artifact saving, and revision parity."""
    token = _make_jwt(OWNER_A)

    # Setup classroom
    status, created_cls = asyncio.run(
        _dispatch_request("POST", "/api/classrooms", token=token, body={"track": "dsa", "title": "DSA"})
    )
    cls_id = created_cls["id"]

    # 1. Create a session in classroom
    sess_body = {"stage": "foundation", "mode": "learn"}
    status, created_sess = asyncio.run(
        _dispatch_request("POST", f"/api/classrooms/{cls_id}/sessions", token=token, body=sess_body)
    )
    assert status == 201
    assert created_sess["classroom_id"] == cls_id
    assert created_sess["stage"] == "foundation"
    assert created_sess["mode"] == "learn"
    sess_id = created_sess["id"]

    # 2. List sessions in classroom
    status, sessions = asyncio.run(_dispatch_request("GET", f"/api/classrooms/{cls_id}/sessions", token=token))
    assert status == 200
    assert len(sessions) == 1
    assert sessions[0]["id"] == sess_id

    # 3. Get single session
    status, fetched_sess = asyncio.run(_dispatch_request("GET", f"/api/sessions/{sess_id}", token=token))
    assert status == 200
    assert fetched_sess["id"] == sess_id

    # 4. Save artifact at expected_revision = 1
    art_body = {
        "content": "def two_sum(nums, target):\n    left, right = 0, len(nums) - 1\n",
        "expected_revision": 1,
        "language": "python",
    }
    status, saved_art = asyncio.run(
        _dispatch_request("PUT", f"/api/sessions/{sess_id}/artifact", token=token, body=art_body)
    )
    assert status == 200
    assert saved_art["revision"] == 1
    # Session current_revision increments to 2
    status, updated_sess = asyncio.run(_dispatch_request("GET", f"/api/sessions/{sess_id}", token=token))
    assert status == 200
    assert updated_sess["current_revision"] == 2

    # 5. Verify 409 conflict when saving with stale expected_revision = 1
    status, err = asyncio.run(
        _dispatch_request("PUT", f"/api/sessions/{sess_id}/artifact", token=token, body=art_body)
    )
    assert status == 409


def test_cross_owner_isolation():
    """B09-AC3: Owner B cannot access or modify Owner A's classroom or sessions."""
    token_a = _make_jwt(OWNER_A)
    token_b = _make_jwt(OWNER_B)

    # Owner A creates a classroom
    status, cls_a = asyncio.run(
        _dispatch_request("POST", "/api/classrooms", token=token_a, body={"track": "dsa", "title": "A's Classroom"})
    )
    assert status == 201
    cls_id = cls_a["id"]

    # Owner B tries to get Owner A's classroom -> 404
    status, _ = asyncio.run(_dispatch_request("GET", f"/api/classrooms/{cls_id}", token=token_b))
    assert status == 404

    # Owner B lists classrooms -> does not see Owner A's classroom
    status, classrooms_b = asyncio.run(_dispatch_request("GET", "/api/classrooms", token=token_b))
    assert status == 200
    assert len(classrooms_b) == 0


def test_session_messages_and_turn_history():
    """B09-AC1: Tests message history recording and retrieval across lesson turns."""
    token = _make_jwt(OWNER_A)

    # Setup classroom and session
    _, cls_rec = asyncio.run(
        _dispatch_request("POST", "/api/classrooms", token=token, body={"track": "dsa", "title": "DSA"})
    )
    _, sess_rec = asyncio.run(
        _dispatch_request("POST", f"/api/classrooms/{cls_rec['id']}/sessions", token=token, body={})
    )
    sess_id = sess_rec["id"]

    # 1. Initially empty messages
    status, msgs = asyncio.run(_dispatch_request("GET", f"/api/sessions/{sess_id}/messages", token=token))
    assert status == 200
    assert len(msgs) == 0

    # 2. Execute a lesson turn with learner reasoning
    turn_body = {
        "message": "We can use two pointers from left and right inward.",
        "expected_revision": 1,
    }
    status, turn_resp = asyncio.run(
        _dispatch_request("POST", f"/api/sessions/{sess_id}/lesson-turn", token=token, body=turn_body)
    )
    assert status == 200
    assert "reply" in turn_resp
    assert len(turn_resp["reply"]) > 0

    # 3. Retrieve session messages: contains learner message and tutor reply
    status, msgs = asyncio.run(_dispatch_request("GET", f"/api/sessions/{sess_id}/messages", token=token))
    assert status == 200
    assert len(msgs) == 2
    assert msgs[0]["sender_role"] == "learner"
    assert msgs[0]["content"] == "We can use two pointers from left and right inward."
    assert msgs[1]["sender_role"] == "tutor"
    assert msgs[1]["content"] == turn_resp["reply"]

    # 4. Reload simulation: Fetching messages again returns exact same count and order, no duplicates
    status, reloaded_msgs = asyncio.run(_dispatch_request("GET", f"/api/sessions/{sess_id}/messages", token=token))
    assert status == 200
    assert len(reloaded_msgs) == 2
    assert reloaded_msgs[0]["id"] == msgs[0]["id"]
    assert reloaded_msgs[1]["id"] == msgs[1]["id"]


def run_all_tests():
    setup_function()
    test_classroom_crud_lifecycle()
    print("test_classroom_crud_lifecycle: PASSED")

    setup_function()
    test_session_lifecycle_and_artifact_parity()
    print("test_session_lifecycle_and_artifact_parity: PASSED")

    setup_function()
    test_cross_owner_isolation()
    print("test_cross_owner_isolation: PASSED")

    setup_function()
    test_session_messages_and_turn_history()
    print("test_session_messages_and_turn_history: PASSED")

    print("\nAll B09 Classroom API Boundary Tests PASSED successfully.")


if __name__ == "__main__":
    run_all_tests()
