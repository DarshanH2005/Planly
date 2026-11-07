"""
Sprint B21 Integration Tests: Evidence-based Debrief and Quiet Progress Views.
Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md

Verifies:
- B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.
- B21-AC2: Changing/superseding evidence updates the read projection consistently.
- B21-AC3: User can reach the next lesson without navigating a dashboard wall.
- Failure to Prevent: Do not spend this sprint recreating the clutter the user rejected.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    AssistanceLevel,
    LearningObservation,
    SourceKind,
)
from learning.learner.progress import (
    compute_canonical_progress_projection,
    recalculate_projection_on_evidence_change,
    build_quiet_session_debrief,
    build_quiet_weekly_review,
    UserApplicationRecord,
    reset_application_store,
)
from learning.repositories import evidence

OWNER_ID = "00000000-0000-0000-0000-000000000001"


class TestProgressDebrief(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        reset_application_store()
        self.cls = evidence.create_classroom(
            owner_id=OWNER_ID,
            track="dsa",
            title="Algorithms Core",
        )
        self.sess = evidence.create_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            stage="foundation",
            mode="practice",
        )

    def test_b21_ac1_unsupported_percentages_never_appear_as_real_metrics(self):
        """
        B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.
        """
        # Record observation containing conversational percentage claim
        obs1 = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_sum_hash_map",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Candidate solved Two Sum independently in 14 minutes. Raw chat mentioned 85% ready.",
        )

        # Record guided observation claiming 5-7% progress
        obs2 = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.SELF_REPORT,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Tutor hinted at inward convergence. Candidate estimated 5-7% progress.",
        )

        projection = compute_canonical_progress_projection(
            owner_id=OWNER_ID,
            observations=[obs1, obs2],
        )

        # Two Sum is verified because it was independent work with demonstrated=True
        dsa_dim = projection.dimensions["dsa"]
        self.assertIn("two_sum_hash_map", dsa_dim.verified_competencies)

        # Guided observation with self-reported percentage MUST NOT be verified!
        self.assertNotIn("two_pointers_converge", dsa_dim.verified_competencies)
        self.assertIn("two_pointers_converge", dsa_dim.uncertain_competencies)

        # Conversational percentages are disclaimed, NEVER treated as capability metrics
        self.assertTrue(any("85%" in claim for claim in projection.disclaimed_percentages))
        self.assertTrue(any("5-7%" in claim for claim in projection.disclaimed_percentages))

        # Rejection of speculative hiring probability on application records (Implement 4)
        with self.assertRaises(ValueError):
            UserApplicationRecord(
                owner_id=OWNER_ID,
                company_name="Acme Corp",
                role_title="Senior Engineer",
                speculative_hiring_probability=0.82,  # Must raise ValueError
            )

    def test_b21_ac2_changing_superseding_evidence_updates_read_projection(self):
        """
        B21-AC2: Changing/superseding evidence updates the read projection consistently.
        """
        # Step 1: Initial guided/unverified observation
        obs_initial = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Learner required tutor hint for right pointer decrement.",
        )

        proj1 = compute_canonical_progress_projection(
            owner_id=OWNER_ID,
            observations=[obs_initial],
        )
        self.assertNotIn("two_pointers_converge", proj1.dimensions["dsa"].verified_competencies)
        self.assertIn("two_pointers_converge", proj1.dimensions["dsa"].uncertain_competencies)
        self.assertEqual(proj1.total_verified_competencies, 0)
        self.assertEqual(proj1.total_uncertain_competencies, 1)

        # Step 2: Later delayed independent retest passes and supersedes earlier guidance
        obs_superseding = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Learner verified Two Pointers inward convergence on blank-editor transfer.",
        )

        proj2 = recalculate_projection_on_evidence_change(
            owner_id=OWNER_ID,
            all_current_observations=[obs_initial, obs_superseding],
        )
        self.assertIn("two_pointers_converge", proj2.dimensions["dsa"].verified_competencies)
        self.assertNotIn("two_pointers_converge", proj2.dimensions["dsa"].uncertain_competencies)
        self.assertEqual(proj2.total_verified_competencies, 1)
        self.assertEqual(proj2.total_uncertain_competencies, 0)

        # Step 3: Observation retraction reopens the competency
        obs_retraction = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.EXECUTION_EVIDENCE,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=False,
            evidence_text="Regression: learner missed two-pointer convergence under duplicate inputs.",
        )

        proj3 = recalculate_projection_on_evidence_change(
            owner_id=OWNER_ID,
            all_current_observations=[obs_initial, obs_superseding, obs_retraction],
        )
        self.assertNotIn("two_pointers_converge", proj3.dimensions["dsa"].verified_competencies)
        self.assertIn("two_pointers_converge", proj3.dimensions["dsa"].uncertain_competencies)
        self.assertEqual(proj3.total_verified_competencies, 0)
        self.assertEqual(proj3.total_uncertain_competencies, 1)

    def test_b21_ac3_user_can_reach_next_lesson_without_dashboard_wall(self):
        """
        B21-AC3: User can reach the next lesson without navigating a dashboard wall.
        """
        obs1 = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_sum_hash_map",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Blank-editor hash map implementation passed all unit tests.",
        )
        obs2 = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Candidate needed hint on non-decreasing invariant.",
        )

        debrief = build_quiet_session_debrief(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            classroom_id=self.cls.id,
            session_observations=[obs1, obs2],
            track="dsa",
        )

        # 1. Shows what improved
        self.assertEqual(len(debrief.what_improved), 1)
        self.assertEqual(debrief.what_improved[0]["competency_key"], "two_sum_hash_map")

        # 2. Shows what remains uncertain
        self.assertEqual(len(debrief.what_remains_uncertain), 1)
        self.assertEqual(debrief.what_remains_uncertain[0]["competency_key"], "two_pointers_converge")

        # 3. Direct next lesson CTA without dashboard wall
        self.assertEqual(debrief.next_step.route, f"/classrooms/{self.cls.id}")
        self.assertEqual(debrief.next_step.action_label, "Start Independent Transfer")
        self.assertIn("two_pointers_converge", debrief.next_step.title)

    def test_b21_quiet_weekly_review_clutter_free(self):
        """
        Verifies quiet weekly review produces concise recommendations without gamification clutter.
        """
        obs = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="cs.os.virtual_memory_isolation",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.INDEPENDENT,
            demonstrated=True,
            evidence_text="Candidate clearly explained per-process virtual memory and MMU page tables.",
        )
        review = build_quiet_weekly_review(
            owner_id=OWNER_ID,
            observations=[obs],
        )
        self.assertTrue(review.clutter_free)
        self.assertIn("cs.os.virtual_memory_isolation", review.verified_this_week)

    def test_b21_api_endpoints(self):
        """
        Verifies FastAPI progress endpoints (projection, debrief, weekly review, applications).
        """
        import asyncio
        from fastapi import HTTPException
        from learning.api.auth import AuthenticatedOwner
        from learning.api.progress import (
            get_progress_projection_endpoint,
            get_session_debrief_endpoint,
            get_weekly_review_endpoint,
            post_user_application_endpoint,
            list_user_applications_endpoint,
            ApplicationInput,
        )

        owner = AuthenticatedOwner(owner_id=OWNER_ID, email="learner@example.com")

        # 1. Projection endpoint
        proj = asyncio.run(get_progress_projection_endpoint(owner=owner))
        self.assertEqual(proj.owner_id, OWNER_ID)
        self.assertIn("dsa", proj.dimensions)
        self.assertIn("cs", proj.dimensions)

        # 2. Debrief endpoint
        debrief = asyncio.run(get_session_debrief_endpoint(session_id=self.sess.id, owner=owner))
        self.assertEqual(debrief.session_id, self.sess.id)
        self.assertEqual(debrief.next_step.route, f"/classrooms/{self.cls.id}")

        # 3. Weekly review endpoint
        weekly = asyncio.run(get_weekly_review_endpoint(owner=owner))
        self.assertTrue(weekly.clutter_free)

        # 4. User applications endpoint (valid)
        app_input = ApplicationInput(
            company_name="Google",
            role_title="Software Engineer",
            status="applied",
            user_notes="Practiced distributed systems and B-tree indexing.",
        )
        saved_app = asyncio.run(post_user_application_endpoint(payload=app_input, owner=owner))
        self.assertEqual(saved_app.company_name, "Google")
        self.assertEqual(saved_app.status, "applied")

        apps = asyncio.run(list_user_applications_endpoint(owner=owner))
        self.assertEqual(len(apps), 1)
        self.assertEqual(apps[0].company_name, "Google")

        # 5. User applications endpoint (rejecting speculative hiring odds)
        bad_input = ApplicationInput(
            company_name="Meta",
            role_title="Production Engineer",
            speculative_hiring_probability=0.88,
        )
        with self.assertRaises(HTTPException) as cm:
            asyncio.run(post_user_application_endpoint(payload=bad_input, owner=owner))
        self.assertEqual(cm.exception.status_code, 422)
        self.assertIn("strictly prohibited", cm.exception.detail)


if __name__ == "__main__":
    unittest.main()
