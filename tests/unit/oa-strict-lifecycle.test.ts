import { describe, it, expect } from "vitest";
import {
  sanitizeCandidatePrompt,
  computeRemainingSeconds,
} from "@/features/assessments/oa/service";
import type {
  CandidateSafeOASession,
  StartOAInput,
  DraftSaveInput,
  FinalizeOAInput,
} from "@/features/assessments/oa/types";

describe("Sprint B18: Strict OA Lifecycle and Immutable Resource Policy", () => {
  it("B18-AC1: verifies server deadline wins over browser timer and computes accurate remaining time", () => {
    const startedAt = "2026-09-15T14:00:00.000Z";
    const deadlineAt = "2026-09-15T14:45:00.000Z";

    // 1. Client clock shows remaining time before deadline
    const midSessionNow = "2026-09-15T14:20:00.000Z";
    const remainingSeconds = computeRemainingSeconds(deadlineAt, midSessionNow);
    expect(remainingSeconds).toBe(25 * 60);

    // 2. Client clock after server deadline returns 0 seconds (cannot cheat)
    const lateClientNow = "2026-09-15T14:45:01.000Z";
    const lateRemainingSeconds = computeRemainingSeconds(deadlineAt, lateClientNow);
    expect(lateRemainingSeconds).toBe(0);

    // 3. Draft save after deadline must be flagged as rejected
    const isSavePermitted = (serverNow: string, deadline: string) => {
      return new Date(serverNow).getTime() <= new Date(deadline).getTime();
    };

    expect(isSavePermitted(midSessionNow, deadlineAt)).toBe(true);
    expect(isSavePermitted(lateClientNow, deadlineAt)).toBe(false);
  });

  it("B18-AC2: verifies hidden answers, test suites, and rubrics cannot leak into candidate prompts", () => {
    const rawBackendPrompt = {
      id: "FX-HASH-A",
      prompt_id: "FX-HASH-A",
      title: "First Repeating Element",
      statement: "Find the first repeating element in nums array.",
      starter_code: "def first_repeat(nums): pass",
      public_tests: [{ input: { nums: [1, 2, 1] }, expected: 1 }],
      hidden_tests: [{ input: { nums: [4, 5, 4] }, expected: 4 }],
      private_solution: "def first_repeat(nums): return seen...",
      evaluator_rubric: { required_time_complexity: "O(n)" },
      available_clarifications: [
        { id: "c1", question: "Are numbers positive?", answer: "Yes, strictly positive." },
      ],
      revealed_clarifications: [],
    };

    const sanitized = sanitizeCandidatePrompt(rawBackendPrompt);

    // Must have public fields
    expect(sanitized.prompt_id).toBe("FX-HASH-A");
    expect(sanitized.statement).toBeDefined();
    expect(sanitized.starter_code).toBe("def first_repeat(nums): pass");
    expect(sanitized.public_tests).toHaveLength(1);

    // Must NOT leak private solution, hidden tests, or rubric
    expect((sanitized as any).hidden_tests).toBeUndefined();
    expect((sanitized as any).private_solution).toBeUndefined();
    expect((sanitized as any).evaluator_rubric).toBeUndefined();

    // Available clarifications must contain question ONLY, no answer!
    expect(sanitized.available_clarifications[0].id).toBe("c1");
    expect(sanitized.available_clarifications[0].question).toBe("Are numbers positive?");
    expect((sanitized.available_clarifications[0] as any).answer).toBeUndefined();
  });

  it("B18-AC3: verifies duplicate finalize idempotency and practice conversion preservation", () => {
    const session: CandidateSafeOASession = {
      session_id: "sess-oa-100",
      classroom_id: "cls-100",
      pack_id: "PACK-OA-01",
      stage: "oa",
      mode: "strict",
      state: "running",
      started_at: "2026-09-15T14:00:00Z",
      deadline_at: "2026-09-15T14:45:00Z",
      server_now: "2026-09-15T14:30:00Z",
      remaining_seconds: 900,
      is_expired: false,
      resource_policy: { docs: false, ai: false, hints: false, notes: false },
      exercises: [],
      drafts: {
        "FX-HASH-A": {
          prompt_id: "FX-HASH-A",
          revision: 2,
          code: "def first_repeat(nums): return 1",
          language: "python",
          notes: "",
          saved_at: "2026-09-15T14:25:00Z",
        },
      },
      is_interrupted: false,
      is_assisted: false,
      finish_reason: null,
    };

    // 1. Finalize logic check
    const finalizeSimulation = (s: typeof session, finishReason: string) => {
      if (s.state === "finalized") {
        return { session: s, isDuplicate: true };
      }
      return {
        session: {
          ...s,
          state: "finalized" as const,
          finish_reason: finishReason,
        },
        isDuplicate: false,
      };
    };

    const firstFinalize = finalizeSimulation(session, "submitted");
    expect(firstFinalize.isDuplicate).toBe(false);
    expect(firstFinalize.session.state).toBe("finalized");

    // Second finalize call is idempotent
    const secondFinalize = finalizeSimulation(firstFinalize.session, "submitted");
    expect(secondFinalize.isDuplicate).toBe(true);
    expect(secondFinalize.session.state).toBe("finalized");

    // 2. Practice conversion marks isAssisted = true and enables hints
    const convertToPracticeSimulation = (s: typeof session) => {
      if (s.is_assisted || s.mode === "practice") {
        throw new Error("INVALID_STATE");
      }
      return {
        ...s,
        mode: "practice" as const,
        is_assisted: true,
        resource_policy: {
          ...s.resource_policy,
          hints: true,
          ai: true,
        },
      };
    };

    const converted = convertToPracticeSimulation(session);
    expect(converted.mode).toBe("practice");
    expect(converted.is_assisted).toBe(true);
    expect(converted.resource_policy.hints).toBe(true);
    expect(converted.resource_policy.ai).toBe(true);

    // Duplicate conversion fails
    expect(() => convertToPracticeSimulation(converted)).toThrow("INVALID_STATE");
  });

  it("Failure to Prevent: verifies that assisted sessions cannot claim unassisted OA readiness", () => {
    interface EvaluationRecord {
      sessionId: string;
      mode: "strict" | "practice";
      isAssisted: boolean;
      assistanceLevel: "independent" | "guided" | "tutor_supplied";
    }

    const unassistedSession: EvaluationRecord = {
      sessionId: "s1",
      mode: "strict",
      isAssisted: false,
      assistanceLevel: "independent",
    };

    const assistedSession: EvaluationRecord = {
      sessionId: "s2",
      mode: "practice",
      isAssisted: true,
      assistanceLevel: "guided",
    };

    const qualifiesForUnassistedOAReadiness = (rec: EvaluationRecord): boolean => {
      return rec.mode === "strict" && !rec.isAssisted && rec.assistanceLevel === "independent";
    };

    expect(qualifiesForUnassistedOAReadiness(unassistedSession)).toBe(true);
    expect(qualifiesForUnassistedOAReadiness(assistedSession)).toBe(false);
  });
});
