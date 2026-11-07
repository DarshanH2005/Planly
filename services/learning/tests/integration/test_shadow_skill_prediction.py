"""
Sprint B25: Shadow Skill Prediction Integration Tests
Authority: PLANLY_BUILD_SPEC.md §7, §14; B25_shadow_skill_model.md

Tests:
- B25-AC1: Shadow estimates cannot write canonical skill state.
- B25-AC2: Chronological split prevents future observation leakage.
- B25-AC3: Missing or insufficient data yields an honest insufficient-data result.
- Failure to Prevent: Optional experiment must never block core tutoring release or train on fake progress.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    SessionStage,
    SessionMode,
    LearningObservation,
)
from learning.repositories import evidence
from learning.learner.experiments.adapter import (
    BKTShadowAdapter,
    BKTShadowResult,
)
from learning.learner.experiments.bkt import BKTParameters, fit_bkt_sequence
from evals.skill_prediction.evaluate_bkt import run_shadow_skill_evaluation


class TestShadowSkillPrediction(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        self.owner_id = "test_learner_b25"
        self.cls = evidence.create_classroom(self.owner_id, "dsa", "Algorithms Practice")
        self.sess = evidence.create_session(
            self.owner_id, self.cls.id, stage=SessionStage.FOUNDATION, mode=SessionMode.PRACTICE
        )

    def test_b25_ac1_shadow_estimates_cannot_write_canonical_skill_state(self):
        """
        B25-AC1: Shadow estimates cannot write canonical skill state.
        Shadow pipeline is read-only and explicitly prohibited from modifying canonical observations.
        """
        adapter = BKTShadowAdapter(min_attempts_threshold=3)

        # 1. Direct write attempt raises PermissionError
        with self.assertRaises(PermissionError) as ctx:
            adapter.write_canonical_state("some_competency", 0.95)
        self.assertIn("cannot write canonical skill state", str(ctx.exception))
        self.assertIn("B25-AC1", str(ctx.exception))

        # 2. Seed 4 legitimate observations
        for i in range(4):
            evidence.record_observation(
                owner_id=self.owner_id,
                session_id=self.sess.id,
                competency_key="dsa.arrays.two_sum",
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.INDEPENDENT,
                demonstrated=True,
                evidence_text=f"Attempt {i+1} independently verified",
            )

        initial_count = len(evidence.get_owner_observations(self.owner_id))
        self.assertEqual(initial_count, 4)

        # 3. Run shadow evaluation
        result = adapter.evaluate_shadow_competency(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.two_sum",
        )

        self.assertEqual(result.status, "evaluated")
        self.assertTrue(result.is_shadow_only)

        # 4. Canonical state must be completely untouched
        post_count = len(evidence.get_owner_observations(self.owner_id))
        self.assertEqual(post_count, initial_count, "Canonical observations count modified by shadow evaluation!")

    def test_b25_ac2_chronological_split_prevents_future_observation_leakage(self):
        """
        B25-AC2: Chronological split prevents future observation leakage.
        Observations created after cutoff_timestamp must never be included in the training/evaluation dataset.
        """
        adapter = BKTShadowAdapter(min_attempts_threshold=5)

        # 4 past observations (2026-09-01)
        for i in range(4):
            evidence.record_observation(
                owner_id=self.owner_id,
                session_id=self.sess.id,
                competency_key="dsa.dp.knapsack",
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.INDEPENDENT,
                demonstrated=False,
                evidence_text=f"Past attempt {i+1}",
                created_at=f"2026-09-01T1{i}:00:00Z",
            )

        # 4 future observations (2026-09-10)
        for i in range(4):
            evidence.record_observation(
                owner_id=self.owner_id,
                session_id=self.sess.id,
                competency_key="dsa.dp.knapsack",
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.INDEPENDENT,
                demonstrated=True,
                evidence_text=f"Future attempt {i+1}",
                created_at=f"2026-09-10T1{i}:00:00Z",
            )

        # Apply cutoff before future observations
        cutoff = "2026-09-05T00:00:00Z"
        qualified_past = adapter.extract_qualified_chronological_attempts(
            owner_id=self.owner_id,
            competency_key="dsa.dp.knapsack",
            cutoff_timestamp=cutoff,
        )

        # Only 4 past attempts should be present; no future leakage!
        self.assertEqual(len(qualified_past), 4)
        for q in qualified_past:
            self.assertLess(q.created_at, cutoff)

        # When evaluated with cutoff, only 4 attempts are found (< 5 threshold) -> insufficient_data
        eval_with_cutoff = adapter.evaluate_shadow_competency(
            owner_id=self.owner_id,
            competency_key="dsa.dp.knapsack",
            cutoff_timestamp=cutoff,
        )
        self.assertEqual(eval_with_cutoff.status, "insufficient_data")
        self.assertEqual(eval_with_cutoff.sample_count, 4)

        # Without cutoff, all 8 attempts are evaluated
        eval_all = adapter.evaluate_shadow_competency(
            owner_id=self.owner_id,
            competency_key="dsa.dp.knapsack",
        )
        self.assertEqual(eval_all.status, "evaluated")
        self.assertEqual(eval_all.sample_count, 8)

    def test_b25_ac3_missing_or_insufficient_data_yields_honest_result(self):
        """
        B25-AC3: Missing or insufficient data yields an honest insufficient-data result.
        Must never synthesize fake learner outcomes or claim confidence without verified attempts.
        """
        adapter = BKTShadowAdapter(min_attempts_threshold=5)

        # Case A: 0 attempts
        res_zero = adapter.evaluate_shadow_competency(
            owner_id=self.owner_id,
            competency_key="dsa.graphs.topological_sort",
        )
        self.assertEqual(res_zero.status, "insufficient_data")
        self.assertEqual(res_zero.sample_count, 0)
        self.assertIsNone(res_zero.p_known_final)
        self.assertIsNone(res_zero.predicted_next_correctness)
        self.assertIn("Insufficient verified learner evidence", res_zero.message)

        # Case B: 3 attempts (< 5)
        for i in range(3):
            evidence.record_observation(
                owner_id=self.owner_id,
                session_id=self.sess.id,
                competency_key="dsa.graphs.topological_sort",
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.INDEPENDENT,
                demonstrated=True,
                evidence_text="Topological sort attempt",
            )

        res_three = adapter.evaluate_shadow_competency(
            owner_id=self.owner_id,
            competency_key="dsa.graphs.topological_sort",
        )
        self.assertEqual(res_three.status, "insufficient_data")
        self.assertEqual(res_three.sample_count, 3)
        self.assertIsNone(res_three.p_known_final)

    def test_b25_failure_to_prevent_does_not_train_on_fake_progress(self):
        """
        Failure to Prevent: Optional experiment must never train on fake progress.
        Tutor-supplied answers, conversational self-reports, or tutor explanations
        are strictly excluded from the BKT training dataset.
        """
        adapter = BKTShadowAdapter(min_attempts_threshold=2)

        # 1. Tutor explanation (fake progress)
        evidence.record_observation(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            competency_key="cs.os.virtual_memory",
            source_kind=SourceKind.TUTOR_EXPLANATION,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=False,
            evidence_text="Tutor explains virtual memory page tables",
        )

        # 2. Tutor-supplied answer (assisted work)
        evidence.record_observation(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            competency_key="cs.os.virtual_memory",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            demonstrated=False,
            evidence_text="Tutor wrote the page table walk code for the student",
        )

        # 3. Unassessed self report
        evidence.record_observation(
            owner_id=self.owner_id,
            session_id=self.sess.id,
            competency_key="cs.os.virtual_memory",
            source_kind=SourceKind.SELF_REPORT,
            assistance_level=AssistanceLevel.UNASSESSED,
            demonstrated=False,
            evidence_text="Learner says: I know virtual memory well",
        )

        qualified = adapter.extract_qualified_chronological_attempts(
            owner_id=self.owner_id,
            competency_key="cs.os.virtual_memory",
        )

        # All 3 unverified / assisted items must be filtered out!
        self.assertEqual(len(qualified), 0)

    def test_b25_cli_shadow_skill_evaluation(self):
        """Tests the evaluation runner CLI entrypoint."""
        cls_cli = evidence.create_classroom("cli_learner", "dsa", "Binary Search Track")
        sess_cli = evidence.create_session("cli_learner", cls_cli.id)

        # Seed 5 verified attempts
        for i in range(5):
            evidence.record_observation(
                owner_id="cli_learner",
                session_id=sess_cli.id,
                competency_key="dsa.binary_search",
                source_kind=SourceKind.EXECUTION_EVIDENCE,
                assistance_level=AssistanceLevel.INDEPENDENT,
                demonstrated=(i >= 2),
                evidence_text=f"Binary search verified attempt {i+1}",
            )

        report = run_shadow_skill_evaluation(
            owner_id="cli_learner",
            competencies=["dsa.binary_search"],
        )

        self.assertEqual(report["mode"], "shadow")
        self.assertFalse(report["can_write_canonical_state"])
        self.assertIn("dsa.binary_search", report["results"])
        comp_res = report["results"]["dsa.binary_search"]
        self.assertEqual(comp_res["status"], "evaluated")
        self.assertEqual(comp_res["sample_count"], 5)
        self.assertIsNotNone(comp_res["p_known_final"])
        self.assertIsNotNone(comp_res["bkt_brier_score"])
        self.assertIsNotNone(comp_res["baseline_recent_accuracy"])


if __name__ == "__main__":
    unittest.main()
