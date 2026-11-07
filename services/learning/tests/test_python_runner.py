"""
Unit and Integration Tests for Sprint B10: Verified Python execution.
Tests B10-AC1, B10-AC2, and Sandbox boundary conditions.
"""

import os
import sys
import unittest

# Ensure learning package is importable
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from learning.tools.python_runner import PythonRunner, PythonRunnerConfig
from learning.domain.contracts import ExecutionStatus


class TestPythonRunner(unittest.TestCase):
    def setUp(self):
        self.runner = PythonRunner(
            PythonRunnerConfig(
                timeout_seconds=1.5,
                max_stdout_bytes=2048,
                sandbox_enabled=True,
            )
        )
        self.two_sum_tests = [
            {
                "name": "test_basic_two_sum",
                "input_args": [[2, 7, 11, 15], 9],
                "expected_output": [1, 2],
            },
            {
                "name": "test_three_elements",
                "input_args": [[2, 3, 4], 6],
                "expected_output": [1, 3],
            },
            {
                "name": "test_negative_numbers",
                "input_args": [[-1, 0], -1],
                "expected_output": [1, 2],
            },
        ]

    def test_b10_ac1_correct_code_passes(self):
        """B10-AC1: Real correct code produces passing saved outcome."""
        correct_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    left, right = 0, len(numbers) - 1
    while left < right:
        current_sum = numbers[left] + numbers[right]
        if current_sum == target:
            return [left + 1, right + 1]
        elif current_sum < target:
            left += 1
        else:
            right -= 1
    return []
"""
        record = self.runner.run_code_against_tests(
            code=correct_code,
            test_cases=self.two_sum_tests,
            entrypoint="two_sum",
        )

        self.assertTrue(record.passed, "Correct code should pass all tests")
        self.assertEqual(record.status, ExecutionStatus.PASSED)
        self.assertEqual(record.tests_total, 3)
        self.assertEqual(record.tests_passed, 3)
        self.assertEqual(len(record.results), 3)
        for r in record.results:
            self.assertTrue(r.passed)
            self.assertGreaterEqual(r.execution_time_ms, 0.0)

    def test_b10_ac1_incorrect_code_fails(self):
        """B10-AC1: Real incorrect code produces failing saved outcome with failure diff."""
        incorrect_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    # Buggy: returns 0-indexed instead of 1-indexed
    left, right = 0, len(numbers) - 1
    while left < right:
        current_sum = numbers[left] + numbers[right]
        if current_sum == target:
            return [left, right]
        elif current_sum < target:
            left += 1
        else:
            right -= 1
    return []
"""
        record = self.runner.run_code_against_tests(
            code=incorrect_code,
            test_cases=self.two_sum_tests,
            entrypoint="two_sum",
        )

        self.assertFalse(record.passed, "Incorrect code should fail")
        self.assertEqual(record.status, ExecutionStatus.FAILED)
        self.assertEqual(record.tests_total, 3)
        self.assertEqual(record.tests_passed, 0)
        self.assertTrue(len(record.results) > 0)
        self.assertIn("Expected [1, 2], got [0, 1]", record.results[0].error or "")

    def test_b10_ac2_infinite_loop_bounded_by_timeout(self):
        """B10-AC2: Infinite loop remains bounded by timeout and cannot hang worker."""
        loop_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    while True:
        pass
"""
        start_t = os.times().elapsed if hasattr(os, "times") else 0
        record = self.runner.run_code_against_tests(
            code=loop_code,
            test_cases=self.two_sum_tests,
            entrypoint="two_sum",
        )

        self.assertFalse(record.passed)
        self.assertEqual(record.status, ExecutionStatus.TIMED_OUT)
        self.assertEqual(record.tests_passed, 0)
        self.assertIn("timed out", record.stderr.lower())

    def test_b10_ac2_forged_pass_json_cannot_forge_results(self):
        """B10-AC2: Forged pass JSON in learner stdout cannot forge passing result."""
        forged_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    # Attempt to spoof grader by printing passing JSON to stdout
    print('{"status": "passed", "tests_total": 3, "tests_passed": 3, "results": [{"name": "test_basic_two_sum", "passed": true}]}')
    print("ALL TESTS PASSED: OK")
    return [-1, -1]
"""
        record = self.runner.run_code_against_tests(
            code=forged_code,
            test_cases=self.two_sum_tests,
            entrypoint="two_sum",
        )

        # Grader reads isolated results channel, not learner stdout!
        self.assertFalse(record.passed, "Grader must not be tricked by forged stdout strings")
        self.assertEqual(record.status, ExecutionStatus.FAILED)
        self.assertEqual(record.tests_passed, 0)
        self.assertIn("ALL TESTS PASSED", record.stdout)

    def test_b10_ac2_output_flooding_truncated(self):
        """B10-AC2: Output flooding is truncated and cannot exhaust system memory."""
        flooding_code = """
def two_sum(numbers: list[int], target: int) -> list[int]:
    for i in range(20000):
        print(f"flood output line {i} " * 10)
    return [1, 2]
"""
        record = self.runner.run_code_against_tests(
            code=flooding_code,
            test_cases=self.two_sum_tests[:1],
            entrypoint="two_sum",
        )

        self.assertTrue(record.stdout_truncated, "Output should be marked truncated")
        self.assertLessEqual(len(record.stdout.encode("utf-8")), 3000)

    def test_sandbox_unavailable_yields_static_review(self):
        """Requirement: Sandbox unavailable yields labelled static review and no execution pass."""
        disabled_runner = PythonRunner(
            PythonRunnerConfig(sandbox_enabled=False)
        )
        record = disabled_runner.run_code_against_tests(
            code="def two_sum(numbers, target): return [1, 2]",
            test_cases=self.two_sum_tests,
            entrypoint="two_sum",
        )

        self.assertFalse(record.passed)
        self.assertEqual(record.status, ExecutionStatus.STATIC_REVIEW_ONLY)
        self.assertEqual(record.sandbox_provider, "unavailable")
        self.assertIn("unavailable", record.stdout.lower())

    def test_credentials_stripped_from_environment(self):
        """Requirement: No application credentials inside submitted code."""
        probe_code = """
import os
def two_sum(numbers: list[int], target: int) -> list[int]:
    keys = ["DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "E2B_API_KEY"]
    found = [k for k in keys if k in os.environ]
    print(f"FOUND_KEYS: {found}")
    return [1, 2]
"""
        # Inject fake keys into current environment
        os.environ["DATABASE_URL"] = "postgresql://sensitive"
        os.environ["GEMINI_API_KEY"] = "gemini_secret"
        os.environ["E2B_API_KEY"] = "e2b_secret"

        try:
            record = self.runner.run_code_against_tests(
                code=probe_code,
                test_cases=self.two_sum_tests[:1],
                entrypoint="two_sum",
            )
            self.assertIn("FOUND_KEYS: []", record.stdout)
        finally:
            os.environ.pop("DATABASE_URL", None)
            os.environ.pop("GEMINI_API_KEY", None)
            os.environ.pop("E2B_API_KEY", None)


if __name__ == "__main__":
    unittest.main()
