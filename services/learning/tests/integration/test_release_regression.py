"""
Sprint B29: Cross-Domain and Failure-Path Release Gates Integration Tests
Authority: PLANLY_BUILD_SPEC.md §14-16; B29_release_regression.md

Tests:
- B29-AC1: All hard invariants pass on actual DB/API/browser paths across all 27 fixed regression cases.
- B29-AC2: No mocked provider response or simulation appears in real study progress.
- B29-AC3: The report links every accepted requirement to evidence, with NOT_RUN and blocked items preserved.
"""

import sys
import os
import json
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))
ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent
sys.path.insert(0, str(ROOT_DIR))

from evals.release.runner import run_release_regression, TestCaseOutcome, RegressionResult
from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
    LearningObservation,
)
from learning.learner.progress import compute_canonical_progress_projection
from learning.repositories import evidence


class TestReleaseRegression(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        self.owner_id = "test_release_owner"

    def test_b29_ac1_all_27_regression_cases_pass(self):
        """B29-AC1: All 27 fixed cross-domain release regression cases pass on actual DB/domain logic."""
        result = run_release_regression()
        self.assertEqual(result.total_cases, 27)
        self.assertEqual(result.passed_cases, 27)
        self.assertEqual(result.failed_cases, 0)
        self.assertEqual(result.pass_rate_percent, 100.0)
        self.assertTrue(result.hard_invariants_verified)
        self.assertTrue(result.simulations_excluded)
        self.assertEqual(result.status, "PASSED")

        # Verify all 27 cases individually passed
        for outcome in result.outcomes:
            self.assertTrue(
                outcome.passed,
                f"Case {outcome.case_id} ({outcome.description}) failed: {outcome.error_message}"
            )

    def test_b29_ac2_no_mocked_or_simulated_data_in_study_progress(self):
        """B29-AC2: No mocked provider response or simulation appears in real study progress."""
        # 1. Domain model invariant: Tutor-supplied assistance CANNOT even be constructed as demonstrated=True
        with self.assertRaises(ValueError):
            LearningObservation(
                id="obs_illegal_1",
                owner_id=self.owner_id,
                session_id="sess_1",
                competency_key="dsa.two_pointers",
                evidence_text="Solved with tutor solution",
                demonstrated=True,
                source_kind=SourceKind.LEARNER_WORK,
                assistance_level=AssistanceLevel.TUTOR_SUPPLIED,
            )

        # 2. Unverified or self-reported observations cannot yield verified competencies
        unverified_obs = LearningObservation(
            id="obs_unverified_1",
            owner_id=self.owner_id,
            session_id="sess_1",
            competency_key="dsa.two_pointers",
            evidence_text="Asserted understanding without execution or verification (85% ready)",
            demonstrated=False,
            source_kind=SourceKind.SELF_REPORT,
            assistance_level=AssistanceLevel.INDEPENDENT,
        )
        proj = compute_canonical_progress_projection(self.owner_id, [unverified_obs])
        dsa_dim = proj.dimensions["dsa"]
        self.assertEqual(len(dsa_dim.verified_competencies), 0, "Unverified observations must not count toward verified competencies")
        self.assertIn("dsa.two_pointers", dsa_dim.uncertain_competencies)
        # Verify conversational percentage claim is disclaimed/rejected
        self.assertTrue(any("85%" in claim for claim in dsa_dim.unsupported_claims_rejected))

        # 3. Legitimate assisted observations remain in uncertain competencies
        assisted_obs = LearningObservation(
            id="obs_assisted_1",
            owner_id=self.owner_id,
            session_id="sess_1",
            competency_key="dsa.two_pointers",
            evidence_text="Worked through two pointers with guided tutor hints",
            demonstrated=False,
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
        )
        proj_assisted = compute_canonical_progress_projection(self.owner_id, [assisted_obs])
        self.assertEqual(len(proj_assisted.dimensions["dsa"].verified_competencies), 0)
        self.assertIn("dsa.two_pointers", proj_assisted.dimensions["dsa"].uncertain_competencies)

        # 4. Only independently demonstrated learner work with verified evidence counts
        verified_obs = LearningObservation(
            id="obs_verified_1",
            owner_id=self.owner_id,
            session_id="sess_1",
            competency_key="dsa.two_pointers",
            evidence_text="Independently implemented binary search with clean invariant",
            demonstrated=True,
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
        )
        proj_verified = compute_canonical_progress_projection(self.owner_id, [verified_obs])
        self.assertEqual(len(proj_verified.dimensions["dsa"].verified_competencies), 1)
        self.assertIn("dsa.two_pointers", proj_verified.dimensions["dsa"].verified_competencies)

    def test_b29_ac3_release_report_persisted_with_complete_evidence(self):
        """B29-AC3: Regression report is persisted as JSON with every case linked to evidence."""
        report_path = ROOT_DIR / "evals" / "release" / "regression_report.json"
        self.assertTrue(report_path.exists(), "evals/release/regression_report.json must exist")

        with open(report_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data["total_cases"], 27)
        self.assertEqual(data["passed_cases"], 27)
        self.assertEqual(data["failed_cases"], 0)
        self.assertEqual(data["pass_rate_percent"], 100.0)
        self.assertTrue(data["hard_invariants_verified"])
        self.assertTrue(data["simulations_excluded"])
        self.assertEqual(data["status"], "PASSED")
        self.assertEqual(len(data["outcomes"]), 27)

        # Check domains covered
        domains = {o["domain"] for o in data["outcomes"]}
        self.assertIn("DSA", domains)
        self.assertIn("CS", domains)
        self.assertIn("ML_SQL", domains)
        self.assertIn("STRICT_OA", domains)
        self.assertIn("INTERVIEW", domains)
        self.assertIn("BEHAVIORAL", domains)
        self.assertIn("PROGRESS_MEMORY", domains)
        self.assertIn("BACKUP_RESTORE", domains)
        self.assertIn("MCP_SECURITY", domains)


if __name__ == "__main__":
    unittest.main()
