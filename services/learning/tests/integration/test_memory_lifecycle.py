"""
Sprint B22 Integration Tests: Corrections, Cache Invalidation and Data Deletion.
Authority: PLANLY_BUILD_SPEC.md §5-6, 11-12; B22_memory_lifecycle.md

Verifies:
- B22-AC1: An old summary cannot resurrect an invalidated misconception.
- B22-AC2: Deleted source bytes/derived entries cannot return via cache or a selected adapter.
- B22-AC3: A learner self-report correction remains appropriately qualified until verified.
- Failure to Prevent: Do not silently treat the newest assistant-generated summary
  as the most reliable source.
"""

import sys
import unittest
from pathlib import Path

SERVICES_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(SERVICES_DIR))

from learning.domain.contracts import (
    SourceKind,
    AssistanceLevel,
)
from learning.repositories.corrections import (
    reset_corrections_store,
    register_cached_summary,
    invalidate_misconception,
    query_active_summary,
    populate_adapter_caches,
    delete_source_data_with_tombstone,
    is_target_deleted_or_tombstoned,
    query_retrieval_adapters,
    apply_learner_correction,
    get_memory_claims,
    list_tombstones,
)
from learning.repositories.sources import calculate_measured_readiness
from learning.repositories import evidence
from learning.worker.projections import resolve_authoritative_claim_source

OWNER_ID = "00000000-0000-0000-0000-000000000001"


class TestMemoryLifecycle(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        reset_corrections_store()
        self.cls = evidence.create_classroom(
            owner_id=OWNER_ID,
            track="dsa",
            title="DSA Track",
        )
        self.sess = evidence.create_session(
            owner_id=OWNER_ID,
            classroom_id=self.cls.id,
            stage="foundation",
            mode="practice",
        )

    def test_b22_ac1_old_summary_cannot_resurrect_invalidated_misconception(self):
        """
        B22-AC1: An old summary cannot resurrect an invalidated misconception.
        """
        # Register a cached summary referencing an old misconception
        summary = register_cached_summary(
            owner_id=OWNER_ID,
            summary_text="Learner struggles with while-loop variable increment in Two Pointers.",
            referenced_misconceptions=["while_loop_x_fixed"],
            referenced_observation_ids=["obs_old_01"],
        )
        self.assertFalse(summary.is_invalidated)

        active = query_active_summary(OWNER_ID)
        self.assertIsNotNone(active)
        self.assertEqual(active.id, summary.id)

        # Invalidate misconception
        invalidation_result = invalidate_misconception(
            owner_id=OWNER_ID,
            competency_key="while_loop_x_fixed",
            reason="Learner proved mastery of while loop variable increment in B11 evaluation.",
        )
        self.assertIn(summary.id, invalidation_result["invalidated_summaries"])

        # Querying active summaries must NOT return the invalidated summary
        active_after = query_active_summary(OWNER_ID)
        self.assertIsNone(active_after)

    def test_b22_ac2_deleted_source_bytes_cannot_return_via_cache_or_adapter(self):
        """
        B22-AC2: Deleted source bytes/derived entries cannot return via cache or a selected adapter.
        """
        target_id = "msg_sensitive_prompt_01"
        payload = {"text": "Confidential salary negotiation context and proprietary system diagram."}

        # 1. Populate retrieval adapter caches (vector, keyword)
        populate_adapter_caches(target_id, payload)
        res_before = query_retrieval_adapters(OWNER_ID, target_id)
        self.assertEqual(res_before["status"], "active")
        self.assertTrue(res_before["vector_cache_hit"])
        self.assertTrue(res_before["keyword_cache_hit"])

        # 2. Perform explicit privacy deletion
        tombstone = delete_source_data_with_tombstone(
            owner_id=OWNER_ID,
            target_id=target_id,
            target_type="source_message",
            reason="User GDPR / explicit data deletion request.",
        )
        self.assertTrue(is_target_deleted_or_tombstoned(OWNER_ID, target_id))
        self.assertIn(tombstone, list_tombstones(OWNER_ID))

        # 3. Retrieval adapters MUST return tombstoned status and zero cache hits / zero data
        res_after = query_retrieval_adapters(OWNER_ID, target_id)
        self.assertEqual(res_after["status"], "tombstoned")
        self.assertFalse(res_after["vector_cache_hit"])
        self.assertFalse(res_after["keyword_cache_hit"])
        self.assertIsNone(res_after["data"])

    def test_b22_ac3_learner_self_report_remains_qualified_until_verified(self):
        """
        B22-AC3: A learner self-report correction remains appropriately qualified until verified.
        """
        # Create initial target observation
        obs_initial = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="two_pointers_converge",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Required tutor hint.",
        )

        # Learner submits self-report correction
        correction, qualified_obs = apply_learner_correction(
            owner_id=OWNER_ID,
            target_observation_id=obs_initial.id,
            new_competency_key="two_pointers_converge",
            correction_note="I understand two pointers inward convergence now.",
            is_self_report=True,
        )

        # Must be appropriately qualified
        self.assertEqual(qualified_obs.source_kind, SourceKind.SELF_REPORT)
        self.assertEqual(qualified_obs.assistance_level, AssistanceLevel.UNASSESSED)
        self.assertFalse(qualified_obs.demonstrated)

        # Measured readiness must NOT unlock or verify this competency without independent execution!
        readiness = calculate_measured_readiness([obs_initial, qualified_obs])
        self.assertNotIn("two_pointers_converge", readiness["verified_competency_keys"])
        self.assertEqual(readiness["verified_competencies_count"], 0)

    def test_b22_failure_to_prevent_learner_work_outranks_assistant_summary(self):
        """
        Failure to Prevent: Do not silently treat the newest assistant-generated summary
        as the most reliable source.
        """
        learner_execution = {
            "competency_key": "while_loop_invariant",
            "result": "passed_tests",
            "code": "while current + 1 in num_set:\n    current += 1",
        }
        assistant_summary = {
            "competency_key": "while_loop_invariant",
            "summary": "Learner may still be confusing the while loop variable.",
        }

        resolution = resolve_authoritative_claim_source(
            learner_execution_claim=learner_execution,
            assistant_generated_summary=assistant_summary,
        )

        self.assertEqual(resolution["selected_source"], "learner_execution")
        self.assertEqual(resolution["authority_rank"], 1)
        self.assertIn("outranks assistant summary", resolution["note"])

    def test_b22_api_privacy_endpoints(self):
        """
        Verifies FastAPI privacy endpoints.
        """
        import asyncio
        from learning.api.auth import AuthenticatedOwner
        from learning.api.privacy import (
            get_claims_endpoint,
            post_correction_endpoint,
            post_invalidate_misconception_endpoint,
            delete_entity_endpoint,
            get_tombstones_endpoint,
            LearnerCorrectionInput,
            InvalidateMisconceptionInput,
        )

        owner = AuthenticatedOwner(owner_id=OWNER_ID, email="privacy@example.com")

        # 1. Post correction
        obs = evidence.record_observation(
            owner_id=OWNER_ID,
            session_id=self.sess.id,
            competency_key="cs.os.lock_contention",
            source_kind=SourceKind.LEARNER_WORK,
            assistance_level=AssistanceLevel.GUIDED,
            demonstrated=False,
            evidence_text="Needed hint on critical section scope.",
        )
        corr_input = LearnerCorrectionInput(
            target_observation_id=obs.id,
            new_competency_key="cs.os.lock_contention",
            correction_note="Reviewed mutual exclusion and atomic check-then-act.",
            is_self_report=True,
        )
        corr_res = asyncio.run(post_correction_endpoint(payload=corr_input, owner=owner))
        self.assertEqual(corr_res.target_observation_id, obs.id)

        # 2. Invalidate misconception endpoint
        inval_input = InvalidateMisconceptionInput(
            competency_key="cs.os.lock_contention",
            reason="Verified atomic check-then-act critical section in code.",
        )
        inval_res = asyncio.run(post_invalidate_misconception_endpoint(payload=inval_input, owner=owner))
        self.assertEqual(inval_res["competency_key"], "cs.os.lock_contention")

        # 3. Delete entity endpoint
        del_res = asyncio.run(delete_entity_endpoint(
            target_type="source_message",
            target_id="msg_test_privacy_delete",
            owner=owner,
        ))
        self.assertTrue(del_res.success)
        self.assertEqual(del_res.target_id, "msg_test_privacy_delete")

        # 4. Get tombstones endpoint
        tombs = asyncio.run(get_tombstones_endpoint(owner=owner))
        self.assertGreaterEqual(len(tombs), 1)


if __name__ == "__main__":
    unittest.main()
