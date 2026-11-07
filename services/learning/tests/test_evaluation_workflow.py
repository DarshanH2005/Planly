"""
Sprint B10 Evaluation Workflow Tests.
Verifies B10-AC1, B10-AC3, and Failure-to-Prevent pedagogical guardrail.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from learning.repositories import evidence, executions
from learning.workflows.evaluate import evaluate_session_code
from learning.domain.contracts import (
    ClassroomRecord,
    SessionRecord,
    ArtifactRecord,
    ExecutionStatus,
)


class TestEvaluationWorkflow(unittest.TestCase):
    def setUp(self):
        evidence.reset_evidence_store()
        executions.reset_executions_store()

        self.owner_id = "00000000-0000-0000-0000-000000000001"

        cls = evidence.create_classroom(self.owner_id, "dsa", "DSA Inward Convergence")
        self.classroom_id = cls.id
        sess = evidence.create_session(self.owner_id, self.classroom_id, "foundation", "learn")
        self.session_id = sess.id

    def test_b10_ac1_real_correct_code_evaluation(self):
        """B10-AC1: Correct code evaluated against tests produces passing saved outcome."""
        correct_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    left, right = 0, len(numbers) - 1
    while left < right:
        s = numbers[left] + numbers[right]
        if s == target:
            return [left + 1, right + 1]
        elif s < target:
            left += 1
        else:
            right -= 1
    return []
"""
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=correct_code,
        )

        response = evaluate_session_code(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
        )

        # 1. Execution record verified
        self.assertTrue(response.execution.passed)
        self.assertEqual(response.execution.status, ExecutionStatus.PASSED)
        self.assertEqual(response.execution.tests_total, 4)
        self.assertEqual(response.execution.tests_passed, 4)
        self.assertFalse(response.is_stale)
        self.assertTrue(response.finite_test_pass)

        # 2. Failure-to-Prevent verified: Passing finite tests is NOT independent mastery!
        self.assertFalse(response.independent_mastery, "Passing finite tests must not grant independent mastery by itself")
        self.assertIn("not a correctness proof or independent mastery by itself", response.pedagogical_note)

        # 3. Execution record persisted in repository
        persisted = executions.get_execution(response.execution.id)
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted.id, response.execution.id)

    def test_b10_ac1_real_incorrect_code_evaluation(self):
        """B10-AC1: Incorrect code produces failing saved outcome with failure details."""
        incorrect_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    # Buggy: returns first two elements unconditionally
    return [1, 2]
"""
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=incorrect_code,
        )

        response = evaluate_session_code(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
        )

        self.assertFalse(response.execution.passed)
        self.assertEqual(response.execution.status, ExecutionStatus.FAILED)
        self.assertFalse(response.finite_test_pass)
        self.assertFalse(response.independent_mastery)
        self.assertIn("tests passed", response.pedagogical_note)

    def test_b10_ac3_edit_code_while_evaluation_runs_stale_result(self):
        """
        B10-AC3: Edit code while evaluation runs:
        The older result is marked stale and does NOT mark the new revision passed.
        """
        initial_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    l, r = 0, len(numbers) - 1
    while l < r:
        s = numbers[l] + numbers[r]
        if s == target:
            return [l + 1, r + 1]
        elif s < target:
            l += 1
        else:
            r -= 1
    return []
"""
        # 1. User has revision 1 saved (which moves session.current_revision to 2)
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,
            content=initial_code,
        )

        # 2. While evaluation of revision 1 was dispatched, user edited and saved revision 2 (moving current_revision to 3)
        newer_code = initial_code + "\n# Modified code with newer revision"
        evidence.save_artifact(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=2,
            content=newer_code,
        )

        # 3. Evaluation for revision 1 completes
        response = evaluate_session_code(
            owner_id=self.owner_id,
            session_id=self.session_id,
            expected_revision=1,  # Evaluated revision 1
            code_override=initial_code,
        )

        # Invariant verified:
        # - The result itself for revision 1 passed
        self.assertTrue(response.execution.passed)
        # - BUT it is marked stale because session current_revision (2) > evaluated revision (1)
        self.assertTrue(response.is_stale, "Result must be marked stale when current revision has advanced")
        self.assertTrue(response.execution.is_stale)
        self.assertIsNotNone(response.stale_warning)
        self.assertIn("has advanced to revision 2", response.stale_warning)
        # - And finite_test_pass for the active state is False!
        self.assertFalse(response.finite_test_pass, "Older result must NOT mark the new revision passed")

        # Check that persisted record is also flagged as stale
        persisted = executions.get_execution(response.execution.id)
        self.assertIsNotNone(persisted)
        self.assertTrue(persisted.is_stale)


if __name__ == "__main__":
    unittest.main()
