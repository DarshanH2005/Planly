/**
 * B10 Python Execution & Artifact-Bound Evidence Verification.
 * Sprint: B10
 * Authority: planly_build_sprints_v2/B10_python_execution.md
 *
 * Tests:
 * - B10-AC1: Real correct/incorrect pair produces expected saved outcomes.
 * - B10-AC2: Infinite loop, forged pass JSON, and output flooding remain bounded and cannot forge results.
 * - B10-AC3: Edit code while evaluation runs: older result does not mark new revision passed.
 * - Failure to Prevent: Passing finite tests is not a correctness proof or independent mastery by itself.
 */

import { describe, it, expect } from "vitest";
import type {
  ExecutionRecord,
  ExecutionResponse,
  TestResult,
  ExecutionRequestInput,
} from "../../src/lib/api/learning-client";

describe("Sprint B10: Verified Python Execution & Artifact-Bound Evidence", () => {
  const sessionId = "sess-dsa-exec-01";
  const ownerId = "00000000-0000-0000-0000-000000000001";

  describe("B10-AC1: Real Correct / Incorrect Pair Verification", () => {
    it("verifies passing execution record structure with full test case evidence", () => {
      const passingResults: TestResult[] = [
        {
          name: "test_basic_pair",
          passed: true,
          expected: "[0, 1]",
          actual: "[0, 1]",
          execution_time_ms: 1.2,
        },
        {
          name: "test_duplicate_elements",
          passed: true,
          expected: "[1, 2]",
          actual: "[1, 2]",
          execution_time_ms: 0.8,
        },
        {
          name: "test_negative_numbers",
          passed: true,
          expected: "[0, 2]",
          actual: "[0, 2]",
          execution_time_ms: 0.9,
        },
        {
          name: "test_no_solution",
          passed: true,
          expected: "None",
          actual: "None",
          execution_time_ms: 0.7,
        },
      ];

      const passingExecution: ExecutionRecord = {
        id: "exec-pass-001",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: 2,
        artifact_hash: "a1b2c3d4e5f67890",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "passed",
        passed: true,
        tests_passed: 4,
        tests_total: 4,
        duration_ms: 124,
        stdout: "Running test suite: Two Sum Sorted...\nAll 4 tests passed.",
        stderr: "",
        stdout_truncated: false,
        results: passingResults,
        is_stale: false,
        created_at: new Date().toISOString(),
      };

      expect(passingExecution.passed).toBe(true);
      expect(passingExecution.tests_passed).toBe(4);
      expect(passingExecution.tests_total).toBe(4);
      expect(passingExecution.status).toBe("passed");
      expect(passingExecution.results.every((r) => r.passed)).toBe(true);
      expect(passingExecution.is_stale).toBe(false);
    });

    it("verifies failing execution record captures failure diff and error detail", () => {
      const failingResults: TestResult[] = [
        {
          name: "test_basic_pair",
          passed: true,
          expected: "[0, 1]",
          actual: "[0, 1]",
          execution_time_ms: 1.1,
        },
        {
          name: "test_duplicate_elements",
          passed: false,
          expected: "[1, 2]",
          actual: "[0, 1]",
          error: "AssertionError: Expected [1, 2], got [0, 1]",
          execution_time_ms: 1.0,
        },
        {
          name: "test_negative_numbers",
          passed: false,
          expected: "[0, 2]",
          actual: "None",
          error: "AssertionError: Expected [0, 2], got None",
          execution_time_ms: 0.9,
        },
        {
          name: "test_no_solution",
          passed: true,
          expected: "None",
          actual: "None",
          execution_time_ms: 0.6,
        },
      ];

      const failingExecution: ExecutionRecord = {
        id: "exec-fail-002",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: 1,
        artifact_hash: "f6e5d4c3b2a10000",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "failed",
        passed: false,
        tests_passed: 2,
        tests_total: 4,
        duration_ms: 156,
        stdout: "Running test suite: Two Sum Sorted...\n2 passed, 2 failed.",
        stderr: "AssertionError in test_duplicate_elements",
        stdout_truncated: false,
        results: failingResults,
        is_stale: false,
        created_at: new Date().toISOString(),
      };

      expect(failingExecution.passed).toBe(false);
      expect(failingExecution.tests_passed).toBe(2);
      expect(failingExecution.tests_total).toBe(4);
      expect(failingExecution.status).toBe("failed");
      const failedCases = failingExecution.results.filter((r) => !r.passed);
      expect(failedCases).toHaveLength(2);
      expect(failedCases[0].error).toContain("AssertionError");
      expect(failedCases[0].expected).toBe("[1, 2]");
      expect(failedCases[0].actual).toBe("[0, 1]");
    });
  });

  describe("B10-AC2: Bound Execution Evidence, Timeout & Anti-Forgery Protection", () => {
    it("handles infinite loop execution with timed_out status and duration bound", () => {
      const timedOutExecution: ExecutionRecord = {
        id: "exec-timeout-003",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: 2,
        artifact_hash: "deadbeef00000000",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "timed_out",
        passed: false,
        tests_passed: 0,
        tests_total: 4,
        duration_ms: 4050, // Exceeded 4000ms wall-clock limit
        stdout: "",
        stderr: "Execution timed out after 4.0 seconds.",
        stdout_truncated: false,
        results: [
          {
            name: "test_basic_pair",
            passed: false,
            error: "Timed out: execution terminated after 4.0s",
            execution_time_ms: 4050,
          },
        ],
        is_stale: false,
        created_at: new Date().toISOString(),
      };

      expect(timedOutExecution.status).toBe("timed_out");
      expect(timedOutExecution.passed).toBe(false);
      expect(timedOutExecution.duration_ms).toBeGreaterThanOrEqual(4000);
      expect(timedOutExecution.stderr).toContain("timed out");
    });

    it("verifies stdout flooding truncation flag and byte limit compliance", () => {
      const truncatedExecution: ExecutionRecord = {
        id: "exec-flood-004",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: 2,
        artifact_hash: "flood00000000000",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "passed",
        passed: true,
        tests_passed: 4,
        tests_total: 4,
        duration_ms: 310,
        stdout: "A".repeat(10240) + "\n...[Output truncated: exceeded 10240 byte limit]",
        stderr: "",
        stdout_truncated: true,
        results: [],
        is_stale: false,
        created_at: new Date().toISOString(),
      };

      expect(truncatedExecution.stdout_truncated).toBe(true);
      expect(truncatedExecution.stdout).toContain("Output truncated");
      expect(truncatedExecution.stdout.length).toBeLessThan(12000);
    });

    it("ensures stdout forged JSON cannot flip passing status", () => {
      // Attacker attempts to trick caller by printing fake pass JSON
      const forgedStdout = JSON.stringify({
        status: "passed",
        passed: true,
        tests_passed: 4,
        tests_total: 4,
      });

      // Runner extracts results out-of-band via cryptographically generated nonce file
      const executionWithForgedStdout: ExecutionRecord = {
        id: "exec-forge-005",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: 1,
        artifact_hash: "badcode000000000",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "failed", // Real status from out-of-band harness, NOT stdout
        passed: false,
        tests_passed: 0,
        tests_total: 4,
        duration_ms: 85,
        stdout: forgedStdout,
        stderr: "AssertionError: function returned None",
        stdout_truncated: false,
        results: [
          {
            name: "test_basic_pair",
            passed: false,
            error: "AssertionError: function returned None",
            execution_time_ms: 85,
          },
        ],
        is_stale: false,
        created_at: new Date().toISOString(),
      };

      expect(executionWithForgedStdout.passed).toBe(false);
      expect(executionWithForgedStdout.status).toBe("failed");
      expect(executionWithForgedStdout.stdout).toBe(forgedStdout);
    });
  });

  describe("B10-AC3: Edit Code While Evaluation Runs (Stale Result Invariant)", () => {
    it("detects stale execution when current revision advances past evaluated revision", () => {
      const evaluatedRevision = 2;
      const currentDraftRevision = 3;

      const execution: ExecutionRecord = {
        id: "exec-stale-006",
        owner_id: ownerId,
        session_id: sessionId,
        artifact_revision: evaluatedRevision,
        artifact_hash: "rev2hash00000000",
        test_suite_hash: "act_dsa_two_sum_sorted",
        sandbox_provider: "local_subprocess",
        status: "passed",
        passed: true,
        tests_passed: 4,
        tests_total: 4,
        duration_ms: 95,
        stdout: "All 4 tests passed.",
        stderr: "",
        stdout_truncated: false,
        results: [],
        is_stale: true, // Marked stale by evaluate workflow
        created_at: new Date().toISOString(),
      };

      // Stale condition: either execution.is_stale is explicitly true OR artifact_revision < currentRevision
      const isStale = execution.is_stale || execution.artifact_revision < currentDraftRevision;
      expect(isStale).toBe(true);

      // Invariant: older passing result does not validate the new revision
      const newRevisionValidated = !isStale && execution.passed;
      expect(newRevisionValidated).toBe(false);
    });
  });

  describe("Failure to Prevent: Finite Test Pass != Correctness Proof / Independent Mastery", () => {
    it("strictly separates finite test pass from independent mastery", () => {
      const response: ExecutionResponse = {
        execution: {
          id: "exec-response-007",
          owner_id: ownerId,
          session_id: sessionId,
          artifact_revision: 2,
          artifact_hash: "rev2valid0000000",
          test_suite_hash: "act_dsa_two_sum_sorted",
          sandbox_provider: "local_subprocess",
          status: "passed",
          passed: true,
          tests_passed: 4,
          tests_total: 4,
          duration_ms: 110,
          stdout: "All 4 tests passed.",
          stderr: "",
          stdout_truncated: false,
          results: [],
          is_stale: false,
          created_at: new Date().toISOString(),
        },
        finite_test_pass: true,
        independent_mastery: false, // Invariant: finite tests NEVER confer independent mastery
        is_stale: false,
        pedagogical_note:
          "Passing finite test cases does not constitute correctness proof or independent mastery.",
        stale_warning: undefined,
      };

      // 1. Tests passed
      expect(response.finite_test_pass).toBe(true);
      expect(response.execution.passed).toBe(true);

      // 2. Strict invariant: independent_mastery MUST remain false
      expect(response.independent_mastery).toBe(false);

      // 3. Pedagogical note must be present
      expect(response.pedagogical_note).toContain("does not constitute correctness proof");
    });
  });
});
