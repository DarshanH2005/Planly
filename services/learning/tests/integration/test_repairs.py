"""
Sprint B15: Integration Tests for Specific Repairs and Qualified Delayed Retests.
Authority: B15_repair_transfer.md; planly_architecture.md sections 7, 12, 14.

Acceptance Evidence:
- B15-AC1: Nonexistent drill IDs, assistant solutions, and guided retests cannot close a repair.
- B15-AC2: A valid delayed independent transfer supports closure and preserves history.
- B15-AC3: Correcting the qualifying observation reopens/recomputes the derived state.
- Failure to Prevent: Do not replace precise evidence with a global weakness label or unconditional two-success rule.
"""

import unittest
from datetime import datetime, timezone

from learning.repositories.repairs import (
    DrillKind,
    RepairStatus,
    create_repair,
    get_repair,
    reset_repairs_store,
    register_drill_task,
    record_qualifying_observation,
    export_repairs_state,
    import_repairs_state,
)
from learning.repositories.executions import (
    record_execution,
    reset_executions_store,
)
from learning.domain.contracts import ExecutionStatus
from learning.learner.repairs import (
    record_drill_completion,
    submit_retest_and_attempt_closure,
    correct_observation_and_recompute_repairs,
    get_repair_guidance,
    InvalidDrillError,
    InvalidRetestError,
    AssistantSolutionRejectedError,
    GuidedRetestRejectedError,
    FamiliarRetestRejectedError,
)


class TestRepairsIntegration(unittest.TestCase):

    def setUp(self):
        reset_repairs_store()
        reset_executions_store()
        self.owner_id = "owner_test_b15"

    def test_b15_ac1_nonexistent_drill_ids_cannot_qualify_or_close(self):
        """
        B15-AC1: Nonexistent drill IDs cannot qualify or close a repair.
        """
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Variable Increment Repair",
            hypothesis="Index pointer j was not incremented in while loop causing infinite loop",
        )

        # 1. Attempting to record drill with nonexistent drill_task_id must fail
        with self.assertRaises(InvalidDrillError) as ctx:
            record_drill_completion(
                owner_id=self.owner_id,
                repair_id=repair.id,
                drill_task_id="nonexistent_drill_id_999",
            )
        self.assertIn("Nonexistent drill ID", str(ctx.exception))

        # 2. Attempting to close without a valid drill task must fail
        with self.assertRaises(InvalidDrillError) as ctx:
            submit_retest_and_attempt_closure(
                owner_id=self.owner_id,
                repair_id=repair.id,
                retest_session_id="session_retest_1",
                observation_id="obs_1",
            )
        self.assertIn("established drill task", str(ctx.exception))

    def test_b15_ac1_assistant_solutions_cannot_qualify_or_close(self):
        """
        B15-AC1: Assistant solutions (tutor-supplied code) cannot qualify a drill or close a repair.
        """
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers Boundary Repair",
            hypothesis="Left/Right pointers did not handle duplicate elements at boundaries",
        )

        # 1. Drill with assistant-supplied code cannot qualify
        drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers Boundary Drill",
            drill_kind=DrillKind.SYNTAX_DRILL,
            prompt="Write the while left < right boundary condition",
            is_assistant_solution=True,  # Code was provided by assistant
        )

        with self.assertRaises(AssistantSolutionRejectedError) as ctx:
            record_drill_completion(
                owner_id=self.owner_id,
                repair_id=repair.id,
                drill_task_id=drill.id,
            )
        self.assertIn("assistant/tutor supplied solution", str(ctx.exception))

        # 2. Register valid drill completed by learner
        valid_drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers Boundary Drill Valid",
            drill_kind=DrillKind.SYNTAX_DRILL,
            prompt="Write the while left < right boundary condition",
            is_assistant_solution=False,
        )
        record_drill_completion(
            owner_id=self.owner_id,
            repair_id=repair.id,
            drill_task_id=valid_drill.id,
        )

        # 3. Retest where solution was assistant-supplied cannot close repair
        obs_assistant = record_qualifying_observation(
            owner_id=self.owner_id,
            session_id="session_retest_assistant",
            competency_key="dsa.two_pointers.sorted_array",
            demonstrated=True,
            assistance_level="tutor_supplied",
            is_assistant_solution=True,
            familiarity="unseen_declared",
            evidence_text="Assistant generated the complete optimal two-pointer loop",
        )

        with self.assertRaises(AssistantSolutionRejectedError) as ctx:
            submit_retest_and_attempt_closure(
                owner_id=self.owner_id,
                repair_id=repair.id,
                retest_session_id="session_retest_assistant",
                observation_id=obs_assistant.id,
            )
        self.assertIn("provided by assistant/tutor", str(ctx.exception))

    def test_b15_ac1_guided_retests_cannot_close_repair(self):
        """
        B15-AC1: Guided retests (hints, scaffolds, guidance) cannot close a repair.
        Independent demonstration is mandatory.
        """
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Variable Repair",
            hypothesis="Index pointer increment was omitted in loop body",
        )
        drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Variable Drill",
            drill_kind=DrillKind.TRACE,
            prompt="Trace i and j pointer values through array iterations",
        )
        record_drill_completion(self.owner_id, repair.id, drill.id)

        # Retest observation marked guided
        obs_guided = record_qualifying_observation(
            owner_id=self.owner_id,
            session_id="session_retest_guided",
            competency_key="dsa.arrays.iteration",
            demonstrated=True,
            assistance_level="guided",  # Guidance / hints were provided
            is_assistant_solution=False,
            familiarity="unseen_declared",
            evidence_text="Learner fixed loop variable after tutor provided hint to check increment step",
        )

        with self.assertRaises(GuidedRetestRejectedError) as ctx:
            submit_retest_and_attempt_closure(
                owner_id=self.owner_id,
                repair_id=repair.id,
                retest_session_id="session_retest_guided",
                observation_id=obs_guided.id,
            )
        self.assertIn("Guided retest", str(ctx.exception))

    def test_b15_ac1_identical_session_or_familiar_problem_rejected(self):
        """
        B15-AC1: Retest session must be distinct from the drill session, and
        must be an unfamiliar transfer problem (not already familiar or solution exposed).
        """
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Variable Repair",
            hypothesis="Index pointer increment was omitted",
        )
        drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Drill",
            drill_kind=DrillKind.SYNTAX_DRILL,
            prompt="Write while loop",
        )
        record_drill_completion(self.owner_id, repair.id, drill.id)

        # 1. Retest session identical to drill task ID must be rejected
        with self.assertRaises(InvalidRetestError) as ctx:
            submit_retest_and_attempt_closure(
                owner_id=self.owner_id,
                repair_id=repair.id,
                retest_session_id=drill.id,  # Same as drill
                observation_id="any_obs",
            )
        self.assertIn("distinct", str(ctx.exception))

        # 2. Familiar problem retest must be rejected
        obs_familiar = record_qualifying_observation(
            owner_id=self.owner_id,
            session_id="session_retest_familiar",
            competency_key="dsa.arrays.iteration",
            demonstrated=True,
            assistance_level="independent",
            familiarity="familiar",  # Familiar, not unseen transfer
            evidence_text="Learner solved problem identical to earlier drill",
        )
        with self.assertRaises(FamiliarRetestRejectedError) as ctx:
            submit_retest_and_attempt_closure(
                owner_id=self.owner_id,
                repair_id=repair.id,
                retest_session_id="session_retest_familiar",
                observation_id=obs_familiar.id,
            )
        self.assertIn("unfamiliar transfer required", str(ctx.exception))

    def test_b15_ac2_valid_delayed_independent_transfer_supports_closure_and_preserves_history(self):
        """
        B15-AC2: A valid delayed independent transfer supports closure and preserves history.
        """
        # 1. Create repair with precise hypothesis
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers Sorted Array Step Invariant",
            hypothesis="Missing pointer movement rule when sum equals target with duplicate values",
            closure_criterion="Unassisted passing execution on unfamiliar delayed transfer exercise",
        )
        self.assertEqual(repair.status, RepairStatus.OPEN)
        self.assertEqual(len(repair.history), 1)

        # 2. Complete syntax drill
        drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers While Step Drill",
            drill_kind=DrillKind.SYNTAX_DRILL,
            prompt="Write the inner while loop to skip duplicate sorted elements",
        )
        repaired_drilled = record_drill_completion(self.owner_id, repair.id, drill.id)
        self.assertEqual(repaired_drilled.status, RepairStatus.DRILLED)
        self.assertEqual(len(repaired_drilled.history), 2)

        # 3. Conduct distinct, unfamiliar, unassisted retest with passing code execution
        exec_rec = record_execution(
            self.owner_id,
            session_id="session_unseen_transfer_42",
            status=ExecutionStatus.PASSED,
            passed=True,
            tests_total=5,
            tests_passed=5,
        )

        obs_transfer = record_qualifying_observation(
            owner_id=self.owner_id,
            session_id="session_unseen_transfer_42",
            competency_key="dsa.two_pointers.sorted_array",
            demonstrated=True,
            assistance_level="independent",
            is_assistant_solution=False,
            familiarity="unseen_declared",
            evidence_text="Candidate independently implemented two-sum-sorted with duplicate skip without hints",
        )

        # 4. Submit retest after a 24-hour delayed interval
        closed_repair = submit_retest_and_attempt_closure(
            owner_id=self.owner_id,
            repair_id=repair.id,
            retest_session_id="session_unseen_transfer_42",
            observation_id=obs_transfer.id,
            execution_id=exec_rec.id,
            delay_hours=24.0,
            closure_summary="Independently solved unseen Two Pointers problem with 5/5 passing tests after 24h delay",
        )

        # Assert closure and explicit evidence
        self.assertEqual(closed_repair.status, RepairStatus.CLOSED)
        self.assertEqual(closed_repair.qualifying_observation_id, obs_transfer.id)
        self.assertEqual(closed_repair.qualifying_execution_id, exec_rec.id)
        self.assertIn("Independently solved unseen Two Pointers", closed_repair.closure_result)

        # Assert full history is preserved (initial -> drilled -> closed)
        self.assertEqual(len(closed_repair.history), 3)
        self.assertEqual(closed_repair.history[0].to_status, "open")
        self.assertEqual(closed_repair.history[1].to_status, "drilled")
        self.assertEqual(closed_repair.history[2].to_status, "closed")

        # Assert restart persistence: serialize, reset, deserialize
        exported = export_repairs_state()
        reset_repairs_store()
        self.assertIsNone(get_repair(self.owner_id, repair.id))

        import_repairs_state(exported)
        restored = get_repair(self.owner_id, repair.id)
        self.assertIsNotNone(restored)
        self.assertEqual(restored.status, RepairStatus.CLOSED)
        self.assertEqual(len(restored.history), 3)
        self.assertEqual(restored.closure_result, closed_repair.closure_result)

    def test_b15_ac3_correcting_qualifying_observation_reopens_derived_state(self):
        """
        B15-AC3: Correcting the qualifying observation reopens/recomputes the derived state.
        When evidence that justified closure is retracted or corrected, closure is invalidated
        and the repair returns to REOPENED with audit trail preserved.
        """
        # 1. Setup closed repair
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Variable Repair",
            hypothesis="Pointer increment missing in loop",
        )
        drill = register_drill_task(
            owner_id=self.owner_id,
            competency_key="dsa.arrays.iteration",
            title="Loop Drill",
            drill_kind=DrillKind.TRACE,
            prompt="Trace loop pointers",
        )
        record_drill_completion(self.owner_id, repair.id, drill.id)

        obs = record_qualifying_observation(
            owner_id=self.owner_id,
            session_id="session_retest_suspect",
            competency_key="dsa.arrays.iteration",
            demonstrated=True,
            assistance_level="independent",
            familiarity="unseen_declared",
            evidence_text="Candidate appeared to solve loop independently",
        )

        closed = submit_retest_and_attempt_closure(
            owner_id=self.owner_id,
            repair_id=repair.id,
            retest_session_id="session_retest_suspect",
            observation_id=obs.id,
            closure_summary="Closed based on suspect session observation",
        )
        self.assertEqual(closed.status, RepairStatus.CLOSED)
        self.assertEqual(len(closed.history), 3)

        # 2. Tutor / audit detects that candidate actually pasted solution from external window
        reopened_list = correct_observation_and_recompute_repairs(
            owner_id=self.owner_id,
            observation_id=obs.id,
            correction_reason="Observation invalidated: audit confirmed solution was pasted from external browser tab",
            new_demonstrated=False,
        )

        self.assertEqual(len(reopened_list), 1)
        reopened = reopened_list[0]

        # Assert derived state is reopened and closure result invalidated
        self.assertEqual(reopened.status, RepairStatus.REOPENED)
        self.assertIsNone(reopened.closure_result)
        self.assertIsNone(reopened.qualifying_observation_id)

        # Assert history is appended, preserving all prior events
        self.assertEqual(len(reopened.history), 4)
        last_event = reopened.history[-1]
        self.assertEqual(last_event.from_status, "closed")
        self.assertEqual(last_event.to_status, "reopened")
        self.assertIn("pasted from external browser tab", last_event.reason)

    def test_failure_to_prevent_no_global_weakness_label_and_no_topic_lock(self):
        """
        Failure to Prevent & Section 14:
        Do not replace precise evidence with a global weakness label or unconditional two-success rule.
        Presents a concise reason and next action; allows candidate to continue with uncertainty without permanent topic locks.
        """
        repair = create_repair(
            owner_id=self.owner_id,
            competency_key="dsa.two_pointers.sorted_array",
            title="Two Pointers Boundary Rule",
            hypothesis="Index bounds check omitted when while left < right advances both pointers",
        )

        guidance = get_repair_guidance(repair)

        # Precise hypothesis preserved, never generic "weak in DSA"
        self.assertEqual(
            guidance["diagnosis_hypothesis"],
            "Index bounds check omitted when while left < right advances both pointers",
        )
        self.assertFalse(guidance["has_topic_lock"], "Repairs must never hard-lock candidate from curriculum")
        self.assertTrue(guidance["allow_continue_with_uncertainty"])
        self.assertEqual(guidance["next_action"], "complete_drill")


if __name__ == "__main__":
    unittest.main()
