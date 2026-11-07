"""
Integration Tests for Sprint B18: Strict OA Lifecycle and Immutable Resource Policy
Authority: PLANLY_BUILD_SPEC.md §16-17; B18_strict_oa.md

Verifies:
- B18-AC1: Server deadline wins over a forged browser timer and survives refresh.
- B18-AC2: Hidden answers, internal test suites, and private solutions cannot enter candidate payloads before finish.
- B18-AC3: Duplicate finalize is idempotent and practice conversion preserves the original strict attempt.
- Failure to Prevent: A timed practice session with hidden AI hints is not an unassisted OA result.
"""

import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
import uuid

# Add services/learning to path
SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    SessionMode,
    SessionStage,
    AssistanceLevel,
)
from learning.domain.modes import (
    start_oa_session,
    get_oa_session,
    save_oa_draft,
    get_candidate_safe_payload,
    request_oa_clarification,
    finalize_oa_session,
    convert_oa_to_practice,
    record_oa_interruption,
    reset_oa_storage,
    ImmutableExerciseVersion,
    ResourcePolicy,
)
from learning.api.assessments import DEFAULT_OA_EXERCISES

OWNER_ID = "00000000-0000-0000-0000-000000000001"
CLASSROOM_ID = "11111111-1111-1111-1111-111111111111"


class TestStrictOALifecycle(unittest.TestCase):
    def setUp(self):
        reset_oa_storage()

    # ==========================================================================
    # B18-AC1: Server Deadline & Immunity to Browser Clock Forgery
    # ==========================================================================

    def test_b18_ac1_server_deadline_wins_over_forged_timer_and_survives_refresh(self):
        """
        B18-AC1:
        1. Start strict OA session with 45-minute duration at server time T0.
        2. Server persists authoritative start and deadline (T0 + 45min).
        3. Client attempts to save draft before deadline -> succeeds with incremented revision.
        4. Client attempts to save draft 1 second after server deadline -> rejected with DEADLINE_PASSED.
        5. Refreshing / reconnecting computes remaining time strictly from server clock and never resets deadline.
        """
        t0 = datetime(2026, 9, 15, 14, 0, 0, tzinfo=timezone.utc)
        session = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )

        expected_deadline = t0 + timedelta(minutes=45)
        self.assertEqual(session.deadline_at, expected_deadline)
        self.assertEqual(session.mode, SessionMode.STRICT)
        self.assertEqual(session.stage, SessionStage.OA)
        self.assertEqual(session.state, "running")

        # 1. On-time draft save at T0 + 10 min
        t1 = t0 + timedelta(minutes=10)
        ok_save, err, draft = save_oa_draft(
            session=session,
            prompt_id="FX-HASH-A",
            code="def first_repeat(nums):\n    seen = set()\n    for x in nums:\n        if x in seen: return x\n        seen.add(x)\n    return None\n",
            language="python",
            notes="Linear scan with hash set",
            expected_revision=1,
            server_now=t1,
        )
        self.assertTrue(ok_save)
        self.assertIsNone(err)
        self.assertIsNotNone(draft)
        self.assertEqual(draft.revision, 2)
        self.assertIn("seen = set()", draft.code)

        # 2. Client attempts late save 1 second past server deadline at T0 + 45min + 1sec
        t_late = t0 + timedelta(minutes=45, seconds=1)
        ok_late, err_late, _ = save_oa_draft(
            session=session,
            prompt_id="FX-HASH-A",
            code="def first_repeat(nums): return 'late_cheat'",
            language="python",
            notes="Late attempt",
            expected_revision=2,
            server_now=t_late,
        )
        self.assertFalse(ok_late)
        self.assertEqual(err_late, "DEADLINE_PASSED")

        # Server-saved draft must remain untouched at revision 2
        current_draft = session.drafts["FX-HASH-A"]
        self.assertEqual(current_draft.revision, 2)
        self.assertIn("seen = set()", current_draft.code)
        self.assertNotIn("late_cheat", current_draft.code)

        # 3. Refresh / reconnect simulation: candidate fetches payload at T0 + 30 min
        t_refresh = t0 + timedelta(minutes=30)
        payload = get_candidate_safe_payload(session, server_now=t_refresh)

        # Invariant: deadline_at has not shifted; remaining seconds computed strictly from server clock
        self.assertEqual(payload["deadline_at"], expected_deadline.isoformat())
        self.assertEqual(payload["remaining_seconds"], 15 * 60)  # 15 minutes remaining
        self.assertFalse(payload["is_expired"])

        # Refreshing after deadline reports is_expired = True and 0 remaining seconds
        payload_after = get_candidate_safe_payload(session, server_now=t_late)
        self.assertEqual(payload_after["deadline_at"], expected_deadline.isoformat())
        self.assertEqual(payload_after["remaining_seconds"], 0)
        self.assertTrue(payload_after["is_expired"])

    # ==========================================================================
    # B18-AC2: Strict Payload Sanitization & Constrained Clarifications
    # ==========================================================================

    def test_b18_ac2_hidden_answers_cannot_enter_candidate_payloads_before_finish(self):
        """
        B18-AC2:
        1. Candidate safe payload omits hidden test suites, private reference solutions, and rubrics.
        2. Available clarifications expose questions ONLY; answers are not included.
        3. Explicit query for valid authored branch reveals answer and records event.
        4. Query for unauthored branch or free-form question is rejected.
        5. Other unasked branches remain completely without answers.
        6. Outside resources, AI hints, and coaching are disabled by resource policy.
        """
        t0 = datetime(2026, 9, 15, 14, 0, 0, tzinfo=timezone.utc)
        session = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )

        # 1. Inspect candidate payload
        payload = get_candidate_safe_payload(session, server_now=t0)
        exercises = payload["exercises"]
        self.assertEqual(len(exercises), 2)

        for ex in exercises:
            # Must NOT contain private solutions or hidden test suites
            self.assertNotIn("hidden_tests", ex)
            self.assertNotIn("private_solution", ex)
            self.assertNotIn("rubric", ex)
            self.assertNotIn("evaluator_rubric", ex)

            # Available clarifications must contain questions ONLY
            for c in ex["available_clarifications"]:
                self.assertNotIn("answer", c)
                self.assertIn("id", c)
                self.assertIn("question", c)

            # No revealed clarifications initially
            self.assertEqual(len(ex["revealed_clarifications"]), 0)

        # Resource policy in strict mode has no AI, no hints, no outside docs
        policy = payload["resource_policy"]
        self.assertFalse(policy["docs"])
        self.assertFalse(policy["ai"])
        self.assertFalse(policy["hints"])

        # 2. Candidate queries valid authored branch "clarify-types" on FX-HASH-A
        ok_clarify, err_c, data_c = request_oa_clarification(
            session=session,
            prompt_id="FX-HASH-A",
            branch_id="clarify-types",
            server_now=t0 + timedelta(minutes=5),
        )
        self.assertTrue(ok_clarify)
        self.assertIsNone(err_c)
        self.assertEqual(data_c["branch_id"], "clarify-types")
        self.assertIn("positive, negative, and zero integers", data_c["answer"])

        # 3. Candidate queries unauthored / random branch
        ok_invalid, err_inv, _ = request_oa_clarification(
            session=session,
            prompt_id="FX-HASH-A",
            branch_id="clarify-what-is-the-algorithm",
            server_now=t0 + timedelta(minutes=6),
        )
        self.assertFalse(ok_invalid)
        self.assertIn("VALIDATION_ERROR", err_inv)

        # 4. Re-check payload: clarify-types is revealed, but clarify-empty remains hidden
        payload_updated = get_candidate_safe_payload(session, server_now=t0 + timedelta(minutes=7))
        ex_hash = next(e for e in payload_updated["exercises"] if e["prompt_id"] == "FX-HASH-A")

        self.assertEqual(len(ex_hash["revealed_clarifications"]), 1)
        self.assertEqual(ex_hash["revealed_clarifications"][0]["id"], "clarify-types")
        self.assertIn("positive, negative", ex_hash["revealed_clarifications"][0]["answer"])

        # "clarify-empty" must still be in available_clarifications without answer
        empty_c = next(c for c in ex_hash["available_clarifications"] if c["id"] == "clarify-empty")
        self.assertNotIn("answer", empty_c)

    # ==========================================================================
    # B18-AC3: Duplicate Finalize Idempotency & Practice Conversion
    # ==========================================================================

    def test_b18_ac3_duplicate_finalize_and_practice_conversion_preserve_original_attempt(self):
        """
        B18-AC3:
        1. Finalizing session freezes exactly one AttemptRecord per prompt with INDEPENDENT assistance.
        2. Duplicate finalize is idempotent and returns the identical frozen attempts without duplicates.
        3. If timeout occurs, late code submitted during finalize is rejected, freezing only pre-deadline draft.
        4. Converting to practice flags is_assisted = True and mode = SessionMode.PRACTICE, preserving original attempts.
        5. Duplicate practice conversion is rejected (INVALID_STATE).
        """
        t0 = datetime(2026, 9, 15, 14, 0, 0, tzinfo=timezone.utc)
        session = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )

        # Save draft on time
        t_save = t0 + timedelta(minutes=20)
        save_oa_draft(
            session=session,
            prompt_id="FX-HASH-A",
            code="def first_repeat(nums): return 5",
            language="python",
            notes="Valid on-time code",
            expected_revision=1,
            server_now=t_save,
        )

        # 1. Finalize on time at T0 + 35 min
        t_final = t0 + timedelta(minutes=35)
        ok_fin1, sess_fin1, attempts1 = finalize_oa_session(
            session=session,
            finish_reason="submitted",
            server_now=t_final,
        )
        self.assertTrue(ok_fin1)
        self.assertEqual(sess_fin1.state, "finalized")
        self.assertEqual(sess_fin1.finish_reason, "submitted")
        self.assertEqual(len(attempts1), 2)

        attempt_hash = next(a for a in attempts1 if a.exposure_state.get("prompt_id") == "FX-HASH-A")
        self.assertEqual(attempt_hash.frozen_code, "def first_repeat(nums): return 5")
        self.assertEqual(attempt_hash.assistance_level, AssistanceLevel.INDEPENDENT)
        self.assertEqual(attempt_hash.mode, SessionMode.STRICT)

        # 2. Duplicate finalize call at T0 + 36 min (idempotency check)
        t_dup = t0 + timedelta(minutes=36)
        ok_fin2, sess_fin2, attempts2 = finalize_oa_session(
            session=session,
            finish_reason="submitted",
            server_now=t_dup,
        )
        self.assertTrue(ok_fin2)
        self.assertEqual(sess_fin2.state, "finalized")
        # Invariant: identical attempt IDs, no new attempts created
        self.assertEqual([a.id for a in attempts1], [a.id for a in attempts2])

        # 3. Test timeout finalize ignoring late code
        session_timeout = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )
        # Save pre-deadline work
        save_oa_draft(
            session=session_timeout,
            prompt_id="FX-HASH-A",
            code="def first_repeat(nums): return 'ontime'",
            language="python",
            notes="",
            expected_revision=1,
            server_now=t0 + timedelta(minutes=30),
        )

        # Timeout finalize: client claims submitted, but server_now is 1 min past deadline
        t_past_deadline = t0 + timedelta(minutes=46)
        ok_to, sess_to, attempts_to = finalize_oa_session(
            session=session_timeout,
            finish_reason="submitted",
            final_drafts=[
                {
                    "prompt_id": "FX-HASH-A",
                    "code": "def first_repeat(nums): return 'late_cheat_in_finalize'",
                    "expected_revision": 2,
                }
            ],
            server_now=t_past_deadline,
        )
        self.assertTrue(ok_to)
        # Coerced to timeout because server deadline passed
        self.assertEqual(sess_to.finish_reason, "timeout")
        att_to = next(a for a in attempts_to if a.exposure_state.get("prompt_id") == "FX-HASH-A")
        # Invariant: freezes pre-deadline saved draft, NOT the late code!
        self.assertEqual(att_to.frozen_code, "def first_repeat(nums): return 'ontime'")

        # 4. Practice conversion
        session_active = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )
        ok_conv, err_conv, conv_sess = convert_oa_to_practice(
            session=session_active,
            reason="Learner requested algorithm hints",
            server_now=t0 + timedelta(minutes=20),
        )
        self.assertTrue(ok_conv)
        self.assertIsNone(err_conv)
        self.assertTrue(conv_sess.is_assisted)
        self.assertEqual(conv_sess.mode, SessionMode.PRACTICE)
        self.assertTrue(conv_sess.resource_policy.hints)
        self.assertTrue(conv_sess.resource_policy.ai)

        # 5. Duplicate practice conversion is rejected
        ok_dup_c, err_dup_c, _ = convert_oa_to_practice(
            session=session_active,
            reason="Second conversion request",
            server_now=t0 + timedelta(minutes=21),
        )
        self.assertFalse(ok_dup_c)
        self.assertIn("INVALID_STATE", err_dup_c)

    # ==========================================================================
    # Failure to Prevent: Timed Practice Session With AI Hints is Not Unassisted
    # ==========================================================================

    def test_failure_to_prevent_assisted_session_cannot_produce_unassisted_oa_result(self):
        """
        Failure to Prevent:
        A timed practice session with hidden AI hints is not an unassisted OA result.
        1. An assessment session converted to practice or marked is_assisted=True
           must NOT produce an INDEPENDENT attempt.
        2. Its attempts must be stamped with assistance_level = GUIDED.
        3. Readiness calculations must not count assisted attempts toward unassisted mastery.
        """
        t0 = datetime(2026, 9, 15, 14, 0, 0, tzinfo=timezone.utc)
        session = start_oa_session(
            owner_id=OWNER_ID,
            classroom_id=CLASSROOM_ID,
            pack_id="PACK-OA-01",
            pack_version=1,
            duration_minutes=45,
            exercises=DEFAULT_OA_EXERCISES,
            server_now=t0,
        )

        # Learner receives AI assistance / converts session to practice
        convert_oa_to_practice(
            session=session,
            reason="Tutor provided algorithmic hint",
            server_now=t0 + timedelta(minutes=15),
        )
        self.assertTrue(session.is_assisted)

        # Learner completes exercise
        save_oa_draft(
            session=session,
            prompt_id="FX-HASH-A",
            code="def first_repeat(nums): return nums[0]",
            language="python",
            notes="",
            expected_revision=1,
            server_now=t0 + timedelta(minutes=25),
        )

        # Finalize assisted session
        _, _, attempts = finalize_oa_session(
            session=session,
            finish_reason="submitted",
            server_now=t0 + timedelta(minutes=30),
        )

        for a in attempts:
            # MUST NOT be stamped as INDEPENDENT
            self.assertNotEqual(a.assistance_level, AssistanceLevel.INDEPENDENT)
            self.assertEqual(a.assistance_level, AssistanceLevel.GUIDED)
            self.assertTrue(a.exposure_state["is_assisted"])

    # ==========================================================================
    # FastAPI HTTP Boundary Tests
    # ==========================================================================

    def test_b18_oa_fastapi_endpoints_boundary(self):
        """
        Verifies complete OA lifecycle through FastAPI routes:
        - POST /api/assessments/oa/start
        - GET /api/assessments/oa/{session_id}
        - POST /api/assessments/oa/{session_id}/draft
        - POST /api/assessments/oa/{session_id}/clarify
        - POST /api/assessments/oa/{session_id}/finalize
        - POST /api/assessments/oa/{session_id}/convert-practice
        """
        import json
        import base64
        import time
        import asyncio
        from learning.api.main import app

        def _jwt(owner: str) -> str:
            header = {"alg": "HS256", "typ": "JWT"}
            payload = {
                "sub": owner,
                "email": "candidate@example.com",
                "role": "authenticated",
                "exp": int(time.time()) + 3600,
            }
            h_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
            p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
            dummy_sig = base64.urlsafe_b64encode(b"sig").decode().rstrip("=")
            return f"{h_b64}.{p_b64}.{dummy_sig}"

        async def _dispatch(method: str, path: str, token: str = None, body: dict = None):
            resp_body = []
            status_code = None
            body_bytes = json.dumps(body).encode("utf-8") if body is not None else b""

            async def receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}

            async def send(msg):
                nonlocal status_code
                if msg["type"] == "http.response.start":
                    status_code = msg["status"]
                elif msg["type"] == "http.response.body":
                    resp_body.append(msg.get("body", b""))

            headers = [(b"host", b"testserver"), (b"content-type", b"application/json")]
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
            raw = b"".join(resp_body).decode("utf-8")
            return status_code, json.loads(raw) if raw else {}

        token = _jwt(OWNER_ID)

        # 1. Start OA
        status_code, start_res = asyncio.run(_dispatch(
            "POST",
            "/api/assessments/oa/start",
            token=token,
            body={"classroom_id": CLASSROOM_ID, "pack_id": "PACK-OA-01", "duration_minutes": 45},
        ))
        self.assertEqual(status_code, 201)
        sess_id = start_res["session_id"]
        self.assertEqual(start_res["mode"], "strict")
        self.assertEqual(start_res["stage"], "oa")
        self.assertFalse(start_res["is_expired"])
        self.assertEqual(len(start_res["exercises"]), 2)

        # 2. Get OA Candidate Safe Payload
        status_code, get_res = asyncio.run(_dispatch(
            "GET",
            f"/api/assessments/oa/{sess_id}",
            token=token,
        ))
        self.assertEqual(status_code, 200)
        self.assertEqual(get_res["session_id"], sess_id)
        # Verify zero leak of hidden test suite
        for ex in get_res["exercises"]:
            self.assertNotIn("hidden_tests", ex)
            self.assertNotIn("private_solution", ex)

        # 3. Save Draft
        status_code, draft_res = asyncio.run(_dispatch(
            "POST",
            f"/api/assessments/oa/{sess_id}/draft",
            token=token,
            body={
                "prompt_id": "FX-HASH-A",
                "code": "def first_repeat(nums): return None",
                "language": "python",
                "notes": "initial draft",
                "expected_revision": 1,
            },
        ))
        self.assertEqual(status_code, 200)
        self.assertEqual(draft_res["revision"], 2)

        # Stale revision conflict check (409)
        status_code, stale_res = asyncio.run(_dispatch(
            "POST",
            f"/api/assessments/oa/{sess_id}/draft",
            token=token,
            body={
                "prompt_id": "FX-HASH-A",
                "code": "def first_repeat(nums): return 1",
                "expected_revision": 1,  # Stale, server has 2!
            },
        ))
        self.assertEqual(status_code, 409)

        # 4. Clarification Request
        status_code, clarify_res = asyncio.run(_dispatch(
            "POST",
            f"/api/assessments/oa/{sess_id}/clarify",
            token=token,
            body={"prompt_id": "FX-HASH-A", "branch_id": "clarify-types"},
        ))
        self.assertEqual(status_code, 200)
        self.assertIn("positive, negative", clarify_res["answer"])

        # 5. Practice Conversion
        status_code, conv_res = asyncio.run(_dispatch(
            "POST",
            f"/api/assessments/oa/{sess_id}/convert-practice",
            token=token,
            body={"reason": "Candidate requested hint on second duplicate index"},
        ))
        self.assertEqual(status_code, 200)
        self.assertEqual(conv_res["mode"], "practice")
        self.assertTrue(conv_res["is_assisted"])

        # 6. Finalize OA
        status_code, fin_res = asyncio.run(_dispatch(
            "POST",
            f"/api/assessments/oa/{sess_id}/finalize",
            token=token,
            body={"finish_reason": "submitted"},
        ))
        self.assertEqual(status_code, 200)
        self.assertEqual(fin_res["status"], "finalized")
        self.assertEqual(fin_res["attempts_count"], 2)


if __name__ == "__main__":
    unittest.main()

