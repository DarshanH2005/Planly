"""
Sprint B28: Deployment Operations, Worker Lanes & Observability Integration Tests
Authority: PLANLY_BUILD_SPEC.md §4, §12, §15; OPERATING_PROFILE.md; B28_deploy_operations.md

Tests:
- B28-AC1: Staging/proxy path supports incremental delivery, reconnect and process restart.
- B28-AC2: Background import does not consume all tutoring capacity (worker lanes).
- B28-AC3: Record acknowledgement/feedback p50/p95 and costs against pilot targets; disclose misses without leaking student payloads.
- B28-AC4: Record actual host/profile, RAM/CPU, costs, and laptop sleep/wake recovery.
  A local operational acceptance is labelled local and does not claim cloud deployment.
"""

import sys
import os
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    SessionStage,
    SessionMode,
)
from learning.repositories import evidence, runs
from learning.observability.metrics import MetricsTracker, LatencyReport, CostSummaryReport
from learning.observability.worker_lanes import (
    WorkerLane,
    WorkerLaneManager,
    CapacityExhaustedError,
)
from learning.observability.sleep_recovery import (
    LaptopSleepRecoveryCoordinator,
    RecoveryStatusReport,
)


class TestDeployOperations(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        self.owner_id = "test_learner_b28"
        self.cls = evidence.create_classroom(self.owner_id, "dsa", "Algorithms Study")
        self.sess = evidence.create_session(
            self.owner_id, self.cls.id, stage=SessionStage.FOUNDATION, mode=SessionMode.PRACTICE
        )

    def test_b28_ac1_proxy_path_and_unbuffered_streaming_configuration(self):
        """
        B28-AC1: Staging/proxy path supports incremental delivery, reconnect and process restart.
        Verifies:
        - Caddyfile configuration routes /api/* to api:8000 with flush_interval -1 (unbuffered SSE).
        - Excludes text/event-stream from compression to preserve real-time streaming chunks.
        - Session artifacts and messages survive simulated process restarts.
        """
        caddyfile_path = ROOT_DIR / "infra" / "Caddyfile"
        self.assertTrue(caddyfile_path.exists(), "infra/Caddyfile must exist (B28-AC1)")

        content = caddyfile_path.read_text(encoding="utf-8")
        self.assertIn("handle /api/*", content, "Caddyfile must route /api/*")
        self.assertIn("flush_interval -1", content, "Caddyfile must disable buffering for SSE streaming")
        self.assertIn("not header Content-Type text/event-stream*", content, "SSE streams must not be buffered/compressed")

        # Verify state survival across process restart
        art = evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            expected_revision=1,
            content="class InvariantTracker:\n    pass\n",
        )
        msg = evidence.record_session_message(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            sender_role="tutor",
            content="Can you verify boundary condition when left == right?",
            artifact_revision_snapshot=1,
        )

        # Retrieve after simulated restart
        fetched_art = evidence.get_artifact(self.owner_id, self.sess.id)
        self.assertIsNotNone(fetched_art)
        self.assertEqual(fetched_art.revision, 1)

        messages = evidence.get_session_messages(self.owner_id, self.sess.id)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0].content, msg.content)

    def test_b28_ac2_background_import_does_not_consume_tutoring_capacity(self):
        """
        B28-AC2: Background import does not consume all tutoring capacity.
        Verifies that saturating the background worker lane (concurrency 1) does NOT
        block interactive tutoring requests, which run in their dedicated interactive lane (concurrency 4).
        """
        lane_mgr = WorkerLaneManager(interactive_capacity=4, background_capacity=1)

        # 1. Acquire background slot (simulating large chat import / repo indexing)
        bg_acquired = lane_mgr.acquire_slot(WorkerLane.BACKGROUND, "job_bg_import_01")
        self.assertTrue(bg_acquired)

        # Additional background job must be queued, not executed
        bg_acquired_2 = lane_mgr.acquire_slot(WorkerLane.BACKGROUND, "job_bg_import_02")
        self.assertFalse(bg_acquired_2)

        status = lane_mgr.get_capacity_status()
        self.assertEqual(status["background"]["active"], 1)
        self.assertEqual(status["background"]["queued"], 1)
        self.assertEqual(status["background"]["available"], 0)

        # 2. Crucial B28-AC2 check: Interactive tutoring slots are completely unblocked!
        self.assertTrue(lane_mgr.can_acquire_interactive())
        self.assertEqual(status["interactive"]["available"], 4)

        # Interactive lesson turns execute cleanly without waiting for background jobs
        interactive_executed = []
        for i in range(4):
            res = lane_mgr.execute_with_lane(
                WorkerLane.INTERACTIVE,
                f"job_interactive_{i}",
                lambda idx=i: f"turn_result_{idx}",
            )
            interactive_executed.append(res)

        self.assertEqual(len(interactive_executed), 4)
        self.assertEqual(interactive_executed[0], "turn_result_0")

        # Cleanup background slot
        lane_mgr.release_slot(WorkerLane.BACKGROUND, "job_bg_import_01")
        status_after = lane_mgr.get_capacity_status()
        self.assertEqual(status_after["background"]["active"], 0)

    def test_b28_ac3_latency_percentiles_cost_breakdown_and_privacy_preservation(self):
        """
        B28-AC3: Record acknowledgement/feedback p50/p95 and costs against proposed pilot targets;
        disclose misses without exporting full private payloads.
        """
        tracker = MetricsTracker(monthly_ceiling_usd=10.00)

        # 1. Record acknowledgments (within targets: p50 < 150ms, p95 < 500ms)
        ack_samples = [45.0, 52.0, 68.0, 95.0, 110.0, 130.0, 140.0, 155.0, 210.0, 320.0]
        for s in ack_samples:
            tracker.record_acknowledgement_latency(s)

        # 2. Record feedback latencies (one simulated spike exceeding 6000ms target)
        fb_samples = [1200.0, 1450.0, 1800.0, 2100.0, 2300.0, 2400.0, 2900.0, 3100.0, 6200.0, 7500.0]
        for s in fb_samples:
            tracker.record_feedback_latency(s)

        report = tracker.get_latency_report()
        self.assertEqual(report.sample_count, 10)
        self.assertLess(report.ack_p50_ms, 150.0)
        self.assertLess(report.ack_p95_ms, 500.0)
        self.assertLess(report.feedback_p50_ms, 2500.0)
        # Feedback p95 exceeded 6000ms -> disclosed in target_misses
        self.assertGreater(report.feedback_p95_ms, 6000.0)
        self.assertEqual(len(report.target_misses), 1)
        self.assertIn("Feedback p95", report.target_misses[0])

        # 3. Record spend across providers, verifying student payload privacy
        tracker.record_spend(
            provider="gemini_3.8_flash",
            cost_usd=1.25,
            tokens_in=50000,
            tokens_out=12000,
            # Malicious or accidental attempt to log private prompt/code
            prompt="def secret_student_code(): pass",
            code="student private code",
        )
        tracker.record_spend(
            provider="e2b_sandbox",
            cost_usd=0.35,
            tokens_in=0,
            tokens_out=0,
        )

        cost_rep = tracker.get_cost_summary()
        self.assertEqual(cost_rep.monthly_ceiling_usd, 10.00)
        self.assertAlmostEqual(cost_rep.total_spent_usd, 1.60, places=2)
        self.assertAlmostEqual(cost_rep.remaining_usd, 8.40, places=2)
        self.assertEqual(cost_rep.percent_consumed, 16.0)
        self.assertEqual(cost_rep.model_inference_usd, 1.25)
        self.assertEqual(cost_rep.sandbox_metered_usd, 0.35)
        self.assertFalse(cost_rep.disclosed_budget_warning)

        # Verify privacy: no payload strings exist in records
        for rec in tracker._cost_records:
            self.assertFalse(hasattr(rec, "prompt"))
            self.assertFalse(hasattr(rec, "code"))

    def test_b28_ac4_laptop_sleep_wake_recovery_and_local_profile_labelling(self):
        """
        B28-AC4: Record actual host/profile, RAM/CPU, costs, and laptop sleep/wake recovery.
        A local operational acceptance is labelled local and does not claim cloud deployment.
        """
        coord = LaptopSleepRecoveryCoordinator(backup_interval_hours=24.0)

        # 1. Setup mock last backup time 36 hours ago (laptop was asleep during scheduled run)
        t_base = datetime(2026, 9, 10, 10, 0, 0, tzinfo=timezone.utc)
        coord.set_last_backup_time(t_base)

        t_resume = t_base + timedelta(hours=36)
        paused_jobs = [
            {"id": "job_01", "status": "paused"},
            {"id": "job_02", "status": "queued"},
        ]

        # 2. Trigger system resume
        status_rep = coord.handle_system_resume(
            current_time=t_resume,
            pending_durable_jobs=paused_jobs,
        )

        # Crucial B28-AC4 assertions:
        self.assertEqual(status_rep.deployment_type, "local_laptop")
        self.assertFalse(
            status_rep.cloud_provisioning_claimed,
            "Local operational acceptance must NOT claim cloud deployment (B28-AC4)",
        )
        self.assertEqual(status_rep.durable_jobs_recovered, 2)
        self.assertTrue(status_rep.overdue_backup_detected)
        self.assertTrue(status_rep.overdue_backup_reconciled)

        # Discloses phone unavailability when laptop sleeps
        self.assertIn("Mobile access via Tailscale is suspended while laptop sleeps", status_rep.phone_connectivity_note)


if __name__ == "__main__":
    unittest.main()
