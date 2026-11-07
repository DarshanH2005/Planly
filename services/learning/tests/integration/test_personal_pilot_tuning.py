"""
Sprint B30: Personal Pilot, Learning Outcomes and Final Handoff Integration Tests
Authority: PLANLY_BUILD_SPEC.md §14-16; B30_personal_pilot_tuning.md

Tests:
- B30-AC1: No invented pilot outcomes or automatic learning-gain claims.
- B30-AC2: Policy changes preserve the technical and evidence regression gates.
- B30-AC3: The learner can continue daily without needing the original builder chat context.
"""

import os
import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from evals.release.runner import run_release_regression
from learning.config import parse_simple_yaml
from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    LearningObservation,
)
from learning.learner.progress import compute_canonical_progress_projection
from learning.repositories import evidence


class TestPersonalPilotTuning(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        self.owner_id = "test_pilot_learner"

    def test_b30_ac1_no_invented_pilot_outcomes_or_automatic_learning_gains(self):
        """B30-AC1: Policy enforces zero fake progress, no conversational percentages, and strictly verified evidence."""
        # 1. Verify teaching policy declarative rules
        policy_path = ROOT_DIR / "config" / "teaching_policy.yaml"
        self.assertTrue(policy_path.exists(), "config/teaching_policy.yaml must exist")

        policy_text = policy_path.read_text(encoding="utf-8")
        policy = parse_simple_yaml(policy_text)

        guards = policy.get("progress_guards", {})
        self.assertTrue(guards.get("prohibit_simulated_readiness"), "Simulated readiness must be prohibited")
        self.assertTrue(guards.get("prohibit_conversational_percentages"), "Conversational percentages must be prohibited")
        self.assertTrue(guards.get("prohibit_speculative_hiring_odds"), "Speculative hiring odds must be prohibited")

        # 2. Verify domain logic rejects claims without execution evidence
        obs = LearningObservation(
            id="pilot_obs_1",
            owner_id=self.owner_id,
            session_id="pilot_sess_1",
            competency_key="dsa.two_pointers",
            evidence_text="Claimed 95% readiness without test execution",
            demonstrated=False,
            source_kind=SourceKind.SELF_REPORT,
            assistance_level=AssistanceLevel.INDEPENDENT,
        )
        proj = compute_canonical_progress_projection(self.owner_id, [obs])
        dsa_dim = proj.dimensions["dsa"]
        self.assertEqual(len(dsa_dim.verified_competencies), 0)
        self.assertIn("dsa.two_pointers", dsa_dim.uncertain_competencies)
        self.assertTrue(any("95%" in c for c in dsa_dim.unsupported_claims_rejected))

    def test_b30_ac2_policy_changes_preserve_technical_and_evidence_gates(self):
        """B30-AC2: Policy changes preserve the technical and evidence regression gates (100% pass on 27 cases)."""
        result = run_release_regression()
        self.assertEqual(result.total_cases, 27)
        self.assertEqual(result.passed_cases, 27)
        self.assertEqual(result.failed_cases, 0)
        self.assertEqual(result.pass_rate_percent, 100.0)
        self.assertEqual(result.status, "PASSED")
        self.assertTrue(result.hard_invariants_verified)

    def test_b30_ac3_operator_handoff_and_daily_continuation_completeness(self):
        """B30-AC3: The learner can continue daily without needing the original builder chat context."""
        # 1. Operator manual exists and covers essential operations
        handoff_path = ROOT_DIR / "docs" / "operator_handoff.md"
        self.assertTrue(handoff_path.exists(), "docs/operator_handoff.md must exist")
        content = handoff_path.read_text(encoding="utf-8")
        self.assertIn("Quickstart: Starting Planly Daily", content)
        self.assertIn("http://localhost:3000", content)
        self.assertIn("uvicorn learning.api.main:app", content)
        self.assertIn("Creating a Database Backup", content)
        self.assertIn("Restoring from a Backup", content)
        self.assertIn("Troubleshooting Common Issues", content)

        # 2. Pilot results document exists and details calibrated trial outcomes
        pilot_results_path = ROOT_DIR / "docs" / "pilot-results.md"
        self.assertTrue(pilot_results_path.exists(), "docs/pilot-results.md must exist")
        pilot_content = pilot_results_path.read_text(encoding="utf-8")
        self.assertIn("Empirical Trial Sessions", pilot_content)
        self.assertIn("Two Pointers", pilot_content)
        self.assertIn("Virtual Memory", pilot_content)
        self.assertIn("Tutoring & UX Friction Tuning", pilot_content)
        self.assertIn("Spaced Recall & Delayed Transfer Schedule", pilot_content)

        # 3. Prompt config for pilot feedback exists and is valid
        feedback_prompt_path = ROOT_DIR / "config" / "prompts" / "pilot_feedback.yaml"
        self.assertTrue(feedback_prompt_path.exists(), "config/prompts/pilot_feedback.yaml must exist")
        feedback_text = feedback_prompt_path.read_text(encoding="utf-8")
        feedback_config = parse_simple_yaml(feedback_text)
        self.assertIn("system_prompt", feedback_config)
        self.assertIn("model", feedback_config)


if __name__ == "__main__":
    unittest.main()
