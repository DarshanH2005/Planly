"""
Sprint B13: Capacity-Aware Planning & Missed-Day Recovery Tests.
Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md

Verifies:
- B13-AC1: Reduced-capacity and skipped-day fixtures never overbook or mark missing work done.
- B13-AC2: Concurrent plan commits resolve by revision and retain original commitments.
- B13-AC3: The DSA loop-gap example leads to a short repair and retains Two Pointers.
- Failure to prevent: Incomplete work is never marked done automatically; calendar day advance is not a topic-advance signal.
"""

import math
import unittest
import json
import base64
import time
from datetime import datetime, timezone
from pathlib import Path
import sys

SERVICES_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.repositories.plans import (
    DailyCapacityMode,
    CommitmentKind,
    CommitmentStatus,
    PlanCommitmentRecord,
    PlanRecord,
    DailyDeclaredCapacity,
    get_or_create_goal,
    get_current_plan,
    get_declared_capacity,
    set_declared_capacity,
    commit_plan_revision,
    record_commitment_completed,
    record_skipped_day,
    reset_plans_store,
    RevisionConflictError,
)
from learning.learner.planner import (
    PlanPreview,
    build_plan_preview,
    compute_daily_budget,
    detect_loop_gap,
)
from learning.repositories.identity import bootstrap_allowed_owner, reset_identity_store
from learning.api.main import app

OWNER_ID = "00000000-0000-0000-0000-000000000001"


def _make_jwt(owner_id: str = OWNER_ID) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": owner_id,
        "email": "test@example.com",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    h = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    p = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"{h}.{p}.dummy_sig_planner"


async def _dispatch_request(method: str, path: str, token: str = None, body: dict = None):
    response_body = []
    status_code = None

    body_bytes = json.dumps(body).encode("utf-8") if body is not None else b""

    async def receive():
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message):
        nonlocal status_code
        if message["type"] == "http.response.start":
            status_code = message["status"]
        elif message["type"] == "http.response.body":
            response_body.append(message.get("body", b""))

    headers = [(b"host", b"testserver"), (b"content-type", b"application/json")]
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode("utf-8")))

    path_only, _, qs = path.partition("?")
    scope = {
        "type": "http",
        "method": method,
        "path": path_only,
        "raw_path": path_only.encode("utf-8"),
        "query_string": qs.encode("utf-8"),
        "headers": headers,
    }

    await app(scope, receive, send)
    raw = b"".join(response_body).decode("utf-8")
    data = json.loads(raw) if raw else None
    return status_code, data


class TestCapacityAwarePlanner(unittest.TestCase):
    def setUp(self):
        reset_plans_store()
        reset_identity_store()
        bootstrap_allowed_owner(OWNER_ID)
        self.jwt = _make_jwt(OWNER_ID)

    def test_b13_ac1_reduced_capacity_fixtures_never_overbook(self):
        """
        B13-AC1: Reduced-capacity fixtures respect the 80% buffer rule and never overbook.
        """
        # 1. Rest Day: 0m declared / Rest mode
        preview_rest = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-14",
            declared_mode=DailyCapacityMode.REST,
            declared_minutes_override=0,
        )
        self.assertEqual(preview_rest.effective_budget_minutes, 0)
        self.assertEqual(preview_rest.today_committed_minutes, 0)
        self.assertEqual(len(preview_rest.today_commitments), 0, "Rest day must allocate 0 tasks")
        self.assertIn("rest_day", preview_rest.explanations)

        # 2. Minimum Day: 15m declared / Minimum mode -> 12m budget (continuity drill)
        preview_min = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-15",
            declared_mode=DailyCapacityMode.MINIMUM,
            declared_minutes_override=15,
        )
        self.assertEqual(preview_min.effective_budget_minutes, 12)
        self.assertLessEqual(preview_min.today_committed_minutes, 12)
        self.assertEqual(len(preview_min.today_commitments), 1)
        self.assertEqual(preview_min.today_commitments[0].kind, CommitmentKind.CONTINUITY)
        self.assertEqual(preview_min.today_commitments[0].estimate_minutes, 12)

        # 3. Ramp Day: 45m declared -> floor(0.8 * 45) = 36m budget
        preview_ramp = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-16",
            declared_mode=DailyCapacityMode.RAMP,
            declared_minutes_override=45,
        )
        self.assertEqual(preview_ramp.effective_budget_minutes, 36)
        self.assertLessEqual(preview_ramp.today_committed_minutes, 36, "Ramp day must not overbook 36m budget")
        self.assertGreater(preview_ramp.today_committed_minutes, 0)

        # 4. Normal Day: 90m declared -> floor(0.8 * 90) = 72m budget
        preview_normal = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-17",
            declared_mode=DailyCapacityMode.NORMAL,
            declared_minutes_override=90,
        )
        self.assertEqual(preview_normal.effective_budget_minutes, 72)
        self.assertLessEqual(preview_normal.today_committed_minutes, 72, "Normal day must not overbook 72m budget")
        self.assertGreater(preview_normal.today_committed_minutes, 0)

        # 5. Bonus Day: 120m declared -> floor(0.8 * 120) = 96m budget
        preview_bonus = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-18",
            declared_mode=DailyCapacityMode.BONUS,
            declared_minutes_override=120,
        )
        self.assertEqual(preview_bonus.effective_budget_minutes, 96)
        self.assertLessEqual(preview_bonus.today_committed_minutes, 96, "Bonus day must not overbook 96m budget")

    def test_b13_ac1_skipped_day_preserves_work_and_prevents_backlog_avalanche(self):
        """
        B13-AC1: Missed day preserves pending lessons and reduces new allocation
        instead of doubling backlog. Incomplete work is never marked done.
        """
        plan = get_current_plan(OWNER_ID, start_date="2026-09-14")

        # Day 1: User commits 2 tasks for 2026-09-14
        c1 = PlanCommitmentRecord(
            id="c1",
            owner_id=OWNER_ID,
            plan_id=plan.id,
            activity_id="act_dsa_two_sum_sorted",
            competency_key="dsa.two_pointers.basics",
            title="Two Pointers Opposing Movement",
            kind=CommitmentKind.DSA_NEW,
            estimate_minutes=25,
            planned_date="2026-09-14",
            committed_date="2026-09-14",
            original_committed_date="2026-09-14",
            status=CommitmentStatus.PENDING,
            reason="Primary focus for Day 1",
        )
        c2 = PlanCommitmentRecord(
            id="c2",
            owner_id=OWNER_ID,
            plan_id=plan.id,
            activity_id="act_sql_orders_agg",
            competency_key="sql.aggregation.group_by",
            title="SQL Orders Aggregation",
            kind=CommitmentKind.SQL,
            estimate_minutes=15,
            planned_date="2026-09-14",
            committed_date="2026-09-14",
            original_committed_date="2026-09-14",
            status=CommitmentStatus.PENDING,
            reason="Supporting focus for Day 1",
        )

        commit_plan_revision(
            owner_id=OWNER_ID,
            plan_id=plan.id,
            expected_revision=1,
            commitments=[c1, c2],
        )

        # Day 1 was skipped: learner missed the day
        record_skipped_day(OWNER_ID, "2026-09-14")

        # Invariant check: Incomplete tasks on Day 1 MUST NOT be marked completed
        plan_after_miss = get_current_plan(OWNER_ID)
        for task in plan_after_miss.commitments:
            self.assertEqual(
                task.status,
                CommitmentStatus.PENDING,
                "Missed day must NEVER mark incomplete work completed (anti-fabrication invariant)",
            )

        # Day 2: Learner returns on 2026-09-15 with normal capacity (90m -> 72m budget)
        preview_day2 = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-15",
            declared_mode=DailyCapacityMode.NORMAL,
            declared_minutes_override=90,
        )

        # Invariant check: At most ONE carryover task is scheduled (replaces today's new focus)
        carryovers = [t for t in preview_day2.today_commitments if t.is_carryover]
        self.assertEqual(len(carryovers), 1, "Must carry over at most ONE task to prevent backlog avalanche")
        self.assertEqual(carryovers[0].activity_id, "act_dsa_two_sum_sorted")
        self.assertEqual(carryovers[0].original_committed_date, "2026-09-14", "Original committed date must be retained")

        # Invariant check: Total today committed minutes respects 80% buffer (72m)
        self.assertLessEqual(preview_day2.today_committed_minutes, 72)

        # Invariant check: The other missed task (SQL) remains in retained backlog, not lost or fabricated
        retained_ids = [t.id for t in preview_day2.retained_commitments]
        self.assertIn("c2", retained_ids, "Secondary uncompleted task must remain retained in backlog")

    def test_b13_ac2_concurrent_plan_commits_resolve_by_revision(self):
        """
        B13-AC2: Concurrent plan commits resolve by revision and retain original commitments.
        """
        plan = get_current_plan(OWNER_ID, start_date="2026-09-20")
        initial_revision = plan.revision_number
        self.assertEqual(initial_revision, 1)

        # Client A and Client B both preview plan against revision 1
        preview_a = build_plan_preview(OWNER_ID, today_date="2026-09-20")
        preview_b = build_plan_preview(OWNER_ID, today_date="2026-09-20")
        self.assertEqual(preview_a.current_revision, 1)
        self.assertEqual(preview_b.current_revision, 1)

        # Client A commits with expected_revision=1 -> SUCCESS, becomes revision 2
        commit_a = commit_plan_revision(
            owner_id=OWNER_ID,
            plan_id=plan.id,
            expected_revision=1,
            commitments=preview_a.today_commitments,
        )
        self.assertEqual(commit_a.revision_number, 2)
        saved_commitments = [c.id for c in commit_a.commitments]

        # Client B concurrently tries to commit with stale expected_revision=1 -> CONFLICT (409)
        with self.assertRaises(RevisionConflictError) as ctx:
            commit_plan_revision(
                owner_id=OWNER_ID,
                plan_id=plan.id,
                expected_revision=1,  # Stale revision!
                commitments=preview_b.today_commitments,
            )
        self.assertIn("revision conflict", str(ctx.exception).lower())

        # Original commitments from Client A are preserved
        current_plan = get_current_plan(OWNER_ID)
        self.assertEqual(current_plan.revision_number, 2)
        self.assertEqual([c.id for c in current_plan.commitments], saved_commitments)

        # Client B retries with expected_revision=2 -> SUCCESS, becomes revision 3
        commit_b_retry = commit_plan_revision(
            owner_id=OWNER_ID,
            plan_id=plan.id,
            expected_revision=2,
            commitments=preview_b.today_commitments,
        )
        self.assertEqual(commit_b_retry.revision_number, 3)

    def test_b13_ac3_dsa_loop_gap_leads_to_short_repair_and_retains_two_pointers(self):
        """
        B13-AC3: The DSA loop-gap example leads to a short repair and retains Two Pointers.
        """
        # Learner has an identified while-loop step defect (from B11 case 3)
        preview = build_plan_preview(
            owner_id=OWNER_ID,
            today_date="2026-09-22",
            declared_mode=DailyCapacityMode.NORMAL,
            declared_minutes_override=90,
            has_loop_gap_override=True,  # Loop invariant gap detected
        )

        # 1. Prerequisite loop repair is identified
        self.assertIn("dsa.arrays.iteration", preview.prerequisite_repairs)

        # 2. Targeted repair drill is scheduled first
        scheduled_kinds = [t.kind for t in preview.today_commitments]
        self.assertIn(CommitmentKind.DSA_REPAIR, scheduled_kinds)

        repair_task = next(t for t in preview.today_commitments if t.kind == CommitmentKind.DSA_REPAIR)
        self.assertEqual(repair_task.estimate_minutes, 12, "Repair drill must be short (12 min)")
        self.assertIn("While-Loop Invariant", repair_task.title)

        # 3. Two Pointers is RETAINED (either scheduled today or retained in dependent schedule)
        all_activities = [t.activity_id for t in preview.today_commitments + preview.retained_commitments]
        self.assertIn(
            "act_dsa_two_sum_sorted",
            all_activities,
            "Two Pointers activity must be retained as dependent target, not skipped or discarded (B13-AC3)",
        )

        # 4. Total committed minutes strictly adheres to 80% buffer (72m)
        self.assertLessEqual(preview.today_committed_minutes, 72)

    def test_fastapi_planning_endpoints_integration(self):
        """
        Boundary tests for FastAPI /api/plans routes:
        - GET /today
        - POST /preview
        - POST /commit (including 409 conflict)
        - PUT /capacity
        - POST /commitments/{id}/complete
        - POST /skipped-day
        """
        async def _run():
            # 1. Update capacity
            code, cap = await _dispatch_request(
                "PUT",
                "/api/plans/capacity",
                token=self.jwt,
                body={"date": "2026-09-25", "declared_minutes": 60, "mode": "ramp"},
            )
            self.assertEqual(code, 200)
            self.assertEqual(cap["declared_minutes"], 60)
            self.assertEqual(cap["mode"], "ramp")

            # 2. Preview plan
            code, prev = await _dispatch_request(
                "POST",
                "/api/plans/preview",
                token=self.jwt,
                body={"today_date": "2026-09-25", "declared_minutes_override": 60},
            )
            self.assertEqual(code, 200)
            self.assertEqual(prev["effective_budget_minutes"], 48)  # floor(0.8*60)
            self.assertGreater(len(prev["today_commitments"]), 0)

            # 3. Commit plan
            plan_id = prev["plan_id"]
            commitments = prev["today_commitments"]
            code, committed = await _dispatch_request(
                "POST",
                "/api/plans/commit",
                token=self.jwt,
                body={
                    "plan_id": plan_id,
                    "expected_revision": 1,
                    "commitments": commitments,
                },
            )
            self.assertEqual(code, 200)
            self.assertEqual(committed["revision_number"], 2)

            # 4. Concurrent commit conflict test (409)
            code, conflict = await _dispatch_request(
                "POST",
                "/api/plans/commit",
                token=self.jwt,
                body={
                    "plan_id": plan_id,
                    "expected_revision": 1,  # Stale! Current is 2
                    "commitments": commitments,
                },
            )
            self.assertEqual(code, 409)
            self.assertIn("conflict", conflict.get("detail", "").lower())

            # 5. Get today plan
            code, today = await _dispatch_request(
                "GET",
                "/api/plans/today?date=2026-09-25",
                token=self.jwt,
            )
            self.assertEqual(code, 200)
            self.assertEqual(today["today_date"], "2026-09-25")

            # 6. Complete commitment
            first_comm_id = commitments[0]["id"]
            code, comp_res = await _dispatch_request(
                "POST",
                f"/api/plans/commitments/{first_comm_id}/complete",
                token=self.jwt,
            )
            self.assertEqual(code, 200)
            self.assertEqual(comp_res["status"], "completed")

            # 7. Record skipped day
            code, skip_res = await _dispatch_request(
                "POST",
                "/api/plans/skipped-day",
                token=self.jwt,
                body={"date": "2026-09-26"},
            )
            self.assertEqual(code, 200)

        import asyncio
        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
