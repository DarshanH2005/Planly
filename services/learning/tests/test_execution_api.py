"""
FastAPI Boundary Tests for Sprint B10: Verified Python Execution Endpoints.
Verifies B10-AC1, B10-AC2, B10-AC3 via direct ASGI app dispatch (zero third-party dependencies).
"""

import os
import sys
import json
import base64
import time
import asyncio
import unittest
from pathlib import Path

# Ensure services/learning is on sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from learning.api.main import app
from learning.repositories.identity import (
    bootstrap_allowed_owner,
    reset_identity_store,
)
from learning.repositories import evidence, executions
from learning.domain.contracts import ExecutionStatus

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
    dummy_sig = base64.urlsafe_b64encode(b"dummy_sig_execution_test").decode().rstrip("=")
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
    body_res = json.loads(raw) if raw else {}
    return status_code, body_res


def dispatch(method: str, path: str, token: str = None, body: dict = None):
    return asyncio.run(_dispatch_request(method, path, token, body))


class TestExecutionApi(unittest.TestCase):
    def setUp(self):
        reset_identity_store()
        bootstrap_allowed_owner(OWNER_A, "learner@planly.dev")
        bootstrap_allowed_owner(OWNER_B, "attacker@planly.dev")
        evidence.reset_evidence_store()
        executions.reset_executions_store()

        self.owner_id = OWNER_A
        self.other_owner_id = OWNER_B

        self.token_a = _make_jwt(self.owner_id, "learner@planly.dev")
        self.token_b = _make_jwt(self.other_owner_id, "attacker@planly.dev")

        # Create test classroom & session
        cls = evidence.create_classroom(self.owner_id, "dsa", "DSA Inward Convergence")
        self.classroom_id = cls.id
        sess = evidence.create_session(self.owner_id, self.classroom_id, "foundation", "learn")
        self.session_id = sess.id

    def test_api_b10_ac1_correct_execution(self):
        """B10-AC1: POST /execute with correct code returns passing execution outcome."""
        correct_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    l, r = 0, len(numbers) - 1
    while l < r:
        s = numbers[l] + numbers[r]
        if s == target:
            return [l + 1, r + 1]
        elif s < target:
            l += 1
        else:
            r -= 1
    return []
"""
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=correct_code,
        )

        status_code, data = dispatch(
            "POST",
            f"/api/sessions/{self.session_id}/execute",
            self.token_a,
            {"revision": 1, "test_suite_id": "act_dsa_two_sum_sorted"},
        )
        self.assertEqual(status_code, 200)

        self.assertTrue(data["execution"]["passed"])
        self.assertEqual(data["execution"]["status"], "passed")
        self.assertEqual(data["execution"]["tests_passed"], 4)
        self.assertFalse(data["is_stale"])
        self.assertTrue(data["finite_test_pass"])

        # Failure-to-Prevent verified: Passing finite tests != independent mastery
        self.assertFalse(data["independent_mastery"])
        self.assertIn("not a correctness proof", data["pedagogical_note"])

    def test_api_b10_ac1_incorrect_execution(self):
        """B10-AC1: POST /execute with incorrect code returns failing execution outcome."""
        incorrect_code = "def two_sum(numbers, target): return [0, 0]"
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=incorrect_code,
        )

        status_code, data = dispatch(
            "POST",
            f"/api/sessions/{self.session_id}/execute",
            self.token_a,
            {"revision": 1, "test_suite_id": "act_dsa_two_sum_sorted"},
        )
        self.assertEqual(status_code, 200)

        self.assertFalse(data["execution"]["passed"])
        self.assertEqual(data["execution"]["status"], "failed")
        self.assertFalse(data["finite_test_pass"])
        self.assertFalse(data["independent_mastery"])

    def test_api_b10_ac2_forged_stdout_and_flooding(self):
        """B10-AC2: POST /execute with forged stdout JSON does not spoof passing status."""
        forged_code = """
def two_sum(numbers, target):
    print('{"status": "passed", "tests_passed": 99}')
    return [-1, -1]
"""
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=forged_code,
        )

        status_code, data = dispatch(
            "POST",
            f"/api/sessions/{self.session_id}/execute",
            self.token_a,
            {"revision": 1},
        )
        self.assertEqual(status_code, 200)

        self.assertFalse(data["execution"]["passed"])
        self.assertEqual(data["execution"]["status"], "failed")

    def test_api_b10_ac3_stale_execution_after_newer_edit(self):
        """B10-AC3: Older execution result is flagged stale when code is edited."""
        initial_code = """
def two_sum(numbers, target):
    l, r = 0, len(numbers) - 1
    while l < r:
        s = numbers[l] + numbers[r]
        if s == target: return [l + 1, r + 1]
        elif s < target: l += 1
        else: r -= 1
    return []
"""
        evidence.save_artifact(self.owner_id, self.session_id, 1, initial_code)
        # Edit and save revision 2
        evidence.save_artifact(self.owner_id, self.session_id, 2, initial_code + "\n# rev 2")

        # Evaluate revision 1
        status_code, data = dispatch(
            "POST",
            f"/api/sessions/{self.session_id}/execute",
            self.token_a,
            {"revision": 1, "code_override": initial_code},
        )
        self.assertEqual(status_code, 200)

        self.assertTrue(data["is_stale"])
        self.assertTrue(data["execution"]["is_stale"])
        self.assertIsNotNone(data["stale_warning"])
        self.assertFalse(data["finite_test_pass"])

    def test_api_list_and_get_executions(self):
        """GET /executions history and single execution retrieval with owner isolation."""
        evidence.save_artifact(self.owner_id, self.session_id, 1, "def two_sum(n, t): return [1, 2]")

        # Dispatch execution
        status_code, post_data = dispatch(
            "POST",
            f"/api/sessions/{self.session_id}/execute",
            self.token_a,
            {"revision": 1},
        )
        self.assertEqual(status_code, 200)
        exec_id = post_data["execution"]["id"]

        # List executions
        status_code, executions_list = dispatch(
            "GET",
            f"/api/sessions/{self.session_id}/executions",
            self.token_a,
        )
        self.assertEqual(status_code, 200)
        self.assertGreaterEqual(len(executions_list), 1)
        self.assertEqual(executions_list[0]["id"], exec_id)

        # Get single execution
        status_code, single_data = dispatch(
            "GET",
            f"/api/sessions/{self.session_id}/executions/{exec_id}",
            self.token_a,
        )
        self.assertEqual(status_code, 200)
        self.assertEqual(single_data["id"], exec_id)

        # Cross-owner access blocked
        status_code, cross_data = dispatch(
            "GET",
            f"/api/sessions/{self.session_id}/executions/{exec_id}",
            self.token_b,
        )
        self.assertEqual(status_code, 404)


if __name__ == "__main__":
    unittest.main()
