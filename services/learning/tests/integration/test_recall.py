"""
Sprint B14 Integration Tests: Recall Scheduling with Explicit Review Evidence.
Authority: planly_architecture.md sections 7, 12; B14_recall_scheduler.md

Verifies:
- B14-AC1: Duplicate review requests do not advance the schedule twice.
- B14-AC2: Due dates survive restart and timezone boundary tests.
- B14-AC3: A high recall estimate does not unlock an unfamiliar DSA readiness claim.
- Failure to prevent: FSRS measures declarative item recall; it does NOT estimate interview pass probability.
"""

import unittest
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from learning.repositories.recall import (
    RecallRating,
    RecallItemKind,
    RecallCardState,
    RecallItemRecord,
    ReviewLogRecord,
    create_or_get_recall_item,
    get_recall_item,
    reset_recall_store,
    export_recall_state,
    import_recall_state,
)
from learning.learner.recall import (
    recall_scheduler,
    process_review_submission,
    to_local_study_date,
    is_item_due,
    generate_recall_from_mistake,
    generate_recall_from_concept,
    evaluate_dsa_readiness,
    get_due_recall_tasks_for_planner,
)
from learning.repositories.plans import CommitmentKind


class TestRecallSchedulerIntegration(unittest.TestCase):
    def setUp(self):
        reset_recall_store()
        self.owner_id = "test-learner-b14"

    # -------------------------------------------------------------------------
    # B14-AC1: Duplicate review requests do not advance the schedule twice
    # -------------------------------------------------------------------------

    def test_b14_ac1_duplicate_review_requests_idempotency(self):
        """
        B14-AC1: Submitting a review with the same review_request_id must return
        the existing record and NOT advance the card stability or step a second time.
        """
        # 1. Create a recall item from a while-loop mistake
        item = generate_recall_from_mistake(
            owner_id=self.owner_id,
            mistake_key="while_loop_variable_advancement",
            observation_text="Loop checked x + 1 repeatedly instead of current_num + 1.",
            corrected_rule="Always increment dynamic element in while loop traversal.",
            counterexample="nums = [100, 4, 200, 1, 3, 2], set contains 2 and 3.",
            competency_key="dsa.hash_set.consecutive_sequence",
        )
        self.assertEqual(item.review_count, 0)
        self.assertEqual(item.step, 0)
        self.assertEqual(item.state, RecallCardState.NEW)

        # 2. First review submission with unique review_request_id="req_token_001"
        now_dt = datetime(2026, 9, 15, 10, 0, 0, tzinfo=timezone.utc)
        item_v1, log_v1, created_v1 = process_review_submission(
            owner_id=self.owner_id,
            item_id=item.id,
            review_request_id="req_token_001",
            rating=RecallRating.GOOD,
            reviewed_at_utc=now_dt,
        )

        self.assertTrue(created_v1, "Initial review submission should succeed and create a log")
        self.assertEqual(item_v1.review_count, 1)
        self.assertGreater(item_v1.stability, 0.0)
        saved_due = item_v1.due_at_utc
        saved_stability = item_v1.stability
        saved_difficulty = item_v1.difficulty
        saved_step = item_v1.step

        # 3. Duplicate review submission with identical review_request_id="req_token_001"
        item_v2, log_v2, created_v2 = process_review_submission(
            owner_id=self.owner_id,
            item_id=item.id,
            review_request_id="req_token_001",
            rating=RecallRating.GOOD,
            reviewed_at_utc=now_dt,
        )

        # INVARIANT: Duplicate submission must NOT advance the schedule twice
        self.assertFalse(created_v2, "Duplicate review request must be recognized as idempotent")
        self.assertEqual(item_v2.review_count, 1, "Review count must remain 1, not 2")
        self.assertEqual(item_v2.due_at_utc, saved_due, "Due date must not be pushed further into future")
        self.assertEqual(item_v2.stability, saved_stability, "Stability must not be incremented twice")
        self.assertEqual(item_v2.difficulty, saved_difficulty, "Difficulty must remain unchanged")
        self.assertEqual(item_v2.step, saved_step, "Card step must not advance twice")
        self.assertEqual(log_v1.id, log_v2.id, "Should return existing review log record")

    # -------------------------------------------------------------------------
    # B14-AC2: Due dates survive restart and timezone boundary tests
    # -------------------------------------------------------------------------

    def test_b14_ac2_due_dates_survive_restart(self):
        """
        B14-AC2: Spaced repetition parameters (due_at_utc, stability, difficulty)
        survive state export and re-import simulating a service restart.
        """
        # Create and review an item
        item = generate_recall_from_concept(
            owner_id=self.owner_id,
            concept_key="hash_map_complement",
            title="Hash Map Complement Lookup Invariant",
            prompt="Given target and num, what key is looked up in the map?",
            answer="Look up complement = target - num in O(1).",
            competency_key="dsa.hash_map.lookup",
        )

        now_dt = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)
        item_reviewed, _, _ = process_review_submission(
            owner_id=self.owner_id,
            item_id=item.id,
            review_request_id="review_init_100",
            rating=RecallRating.EASY,
            reviewed_at_utc=now_dt,
        )

        original_due = item_reviewed.due_at_utc
        original_stability = item_reviewed.stability
        original_difficulty = item_reviewed.difficulty
        original_count = item_reviewed.review_count

        # Simulate service restart: export state, reset store, import state
        exported = export_recall_state()
        reset_recall_store()
        self.assertIsNone(get_recall_item(self.owner_id, item.id))

        import_recall_state(exported)
        restored = get_recall_item(self.owner_id, item.id)

        self.assertIsNotNone(restored, "Item must be restored after restart")
        self.assertEqual(restored.due_at_utc, original_due)
        self.assertEqual(restored.stability, original_stability)
        self.assertEqual(restored.difficulty, original_difficulty)
        self.assertEqual(restored.review_count, original_count)

        # Subsequent review after restart continues from restored FSRS state
        later_dt = datetime(2026, 9, 18, 12, 0, 0, tzinfo=timezone.utc)
        item_v2, _, _ = process_review_submission(
            owner_id=self.owner_id,
            item_id=restored.id,
            review_request_id="review_later_101",
            rating=RecallRating.GOOD,
            reviewed_at_utc=later_dt,
        )
        self.assertEqual(item_v2.review_count, 2)
        self.assertGreater(item_v2.stability, original_stability)

    def test_b14_ac2_timezone_boundary_conversion(self):
        """
        B14-AC2: Timezone boundary test.
        A UTC instant on evening of Date 1 is converted to Date 2 in Asia/Kolkata (UTC+5:30).
        """
        # UTC instant: 2026-09-15 22:30:00 UTC
        # In Asia/Kolkata (+05:30): 2026-09-16 04:00:00 IST
        utc_instant = "2026-09-15T22:30:00Z"

        utc_date = to_local_study_date(utc_instant, timezone_name="UTC")
        self.assertEqual(utc_date, "2026-09-15", "In UTC timezone, the study date is Sept 15")

        kolkata_date = to_local_study_date(utc_instant, timezone_name="Asia/Kolkata")
        self.assertEqual(kolkata_date, "2026-09-16", "In Asia/Kolkata, the study date must be Sept 16")

        # Check due evaluation as of 2026-09-15 18:00:00 UTC (Sept 15 23:30 IST)
        as_of_dt = datetime(2026, 9, 15, 18, 0, 0, tzinfo=timezone.utc)
        self.assertFalse(
            is_item_due(utc_instant, as_of_dt, timezone_name="Asia/Kolkata"),
            "Item due Sept 16 morning IST is NOT due on Sept 15 night IST",
        )

        # Check due evaluation as of 2026-09-16 01:00:00 UTC (Sept 16 06:30 IST)
        as_of_next_morning = datetime(2026, 9, 16, 1, 0, 0, tzinfo=timezone.utc)
        self.assertTrue(
            is_item_due(utc_instant, as_of_next_morning, timezone_name="Asia/Kolkata"),
            "Item due Sept 16 morning IST IS due on Sept 16 IST",
        )

    # -------------------------------------------------------------------------
    # B14-AC3: High recall estimate does not unlock unfamiliar DSA readiness
    # -------------------------------------------------------------------------

    def test_b14_ac3_high_recall_does_not_unlock_unfamiliar_dsa_readiness(self):
        """
        B14-AC3 & Failure to Prevent:
        FSRS measures declarative item recall; it does NOT estimate the probability
        of cracking an interview or unlock an unfamiliar DSA readiness claim.
        """
        # Create item for Two Pointers inward convergence
        item = generate_recall_from_concept(
            owner_id=self.owner_id,
            concept_key="two_pointers_inward_convergence",
            title="Two Pointers Sorted Inward Convergence Invariant",
            prompt="How do left and right pointers move when sum < target in a sorted array?",
            answer="Increment left pointer (left += 1) because array is monotonically sorted.",
            competency_key="dsa.two_pointers.inward_convergence",
        )

        # Learner reviews this flashcard 5 times with EASY -> very high retention
        base_time = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)
        curr_item = item
        for i in range(5):
            curr_item, _, _ = process_review_submission(
                owner_id=self.owner_id,
                item_id=curr_item.id,
                review_request_id=f"drill_easy_{i}",
                rating=RecallRating.EASY,
                reviewed_at_utc=base_time + timedelta(days=i * 3),
            )

        self.assertGreater(curr_item.stability, 5.0)
        self.assertEqual(curr_item.review_count, 5)
        self.assertGreaterEqual(curr_item.retrievability, 0.90)

        # INVARIANT: High declarative recall (e.g. R >= 0.90) WITHOUT verified
        # independent code execution on an unfamiliar transfer problem MUST NOT unlock readiness!
        readiness = evaluate_dsa_readiness(
            competency_key="dsa.two_pointers.inward_convergence",
            recall_item=curr_item,
            verified_problem_solving_success=False,  # No independent code execution
        )

        self.assertFalse(
            readiness["readiness_unlocked"],
            "High FSRS recall estimate must NEVER unlock an unfamiliar DSA readiness claim without code execution (B14-AC3)",
        )
        self.assertEqual(readiness["status"], "not_demonstrated")
        self.assertIn("does not unlock unfamiliar dsa readiness", readiness["reason"].lower())

        # When genuine independent execution evidence is provided:
        readiness_verified = evaluate_dsa_readiness(
            competency_key="dsa.two_pointers.inward_convergence",
            recall_item=curr_item,
            verified_problem_solving_success=True,
        )
        self.assertTrue(readiness_verified["readiness_unlocked"])
        self.assertEqual(readiness_verified["status"], "demonstrated")

    # -------------------------------------------------------------------------
    # Planner Integration Contract Tests (Section 22.1 & 22.2)
    # -------------------------------------------------------------------------

    def test_planner_contract_due_reviews_bounded(self):
        """
        Tests that get_due_recall_tasks_for_planner caps review allocation at
        at most 2 items and 15 minutes total per study day.
        """
        # Create 4 recall items that are all due today
        past_utc = datetime(2026, 9, 10, 10, 0, 0, tzinfo=timezone.utc).isoformat()
        for i in range(4):
            create_or_get_recall_item(
                owner_id=self.owner_id,
                item_key=f"item_due_{i}",
                title=f"Concept Review {i}",
                prompt=f"Prompt {i}",
                answer=f"Answer {i}",
                competency_key="sql.aggregation.group_by" if i % 2 == 0 else "cs.dbms.transactions",
                expected_minutes=5,
                initial_due_utc=past_utc,
            )

        # Request reviews for planner for 2026-09-14
        commitments = get_due_recall_tasks_for_planner(
            owner_id=self.owner_id,
            target_date="2026-09-14",
            timezone_name="Asia/Kolkata",
            max_items=2,
            max_minutes=15,
        )

        # Assert Section 22.1 cap: at most 2 review items and at most 15 min total
        self.assertLessEqual(len(commitments), 2)
        total_minutes = sum(c.estimate_minutes for c in commitments)
        self.assertLessEqual(total_minutes, 15)
        for c in commitments:
            self.assertEqual(c.planned_date, "2026-09-14")
            self.assertIn(c.kind, [CommitmentKind.CS_RECALL, CommitmentKind.DSA_REVIEW, CommitmentKind.DSA_REPAIR, "cs_recall", "dsa_review", "dsa_repair"])


if __name__ == "__main__":
    unittest.main()
