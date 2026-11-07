import { describe, it, expect } from "vitest";
import {
  checkInterviewerFollowsLearnerApproach,
  validateComplexityAnalysis,
  resumeInterviewSession,
} from "@/features/assessments/technical/service";
import type { TechnicalInterviewState } from "@/features/assessments/technical/types";

describe("Sprint B19: Technical Interview Dialogue and Explanation Rubric", () => {
  it("B19-AC1: verifies interviewer follows candidate's chosen approach rather than forcing reference solution", () => {
    // 1. Candidate proposes sorting approach
    const candSortMsg = "I will sort the numbers first so duplicates end up adjacent.";
    const validSortReply = "Sorting can group duplicates, but what happens to the original element indices when you sort?";
    const forcedHashReply = "No, you must use a hash map right to left.";

    expect(checkInterviewerFollowsLearnerApproach(candSortMsg, validSortReply)).toBe(true);
    expect(checkInterviewerFollowsLearnerApproach(candSortMsg, forcedHashReply)).toBe(false);

    // 2. Candidate proposes hash set approach
    const candHashMsg = "I will use a hash set seen to remember elements as I iterate.";
    const validHashReply = "Using a hash set is a sound O(n) idea. How will you track second occurrence ordering?";
    expect(checkInterviewerFollowsLearnerApproach(candHashMsg, validHashReply)).toBe(true);

    // 3. Candidate proposes nested loop brute force
    const candBruteMsg = "I will write a nested loop to check every pair.";
    const validBruteReply = "A nested loop works for small lists, but what would the time complexity be for large arrays?";
    expect(checkInterviewerFollowsLearnerApproach(candBruteMsg, validBruteReply)).toBe(true);
  });

  it("B19-AC2: verifies weak complexity explanation remains a specific gap despite passing code", () => {
    const passingCode = `
def first_repeat(nums):
    seen = set()
    for x in nums:
        if x in seen:
            return x
        seen.add(x)
    return None
`;

    // Candidate claims O(1) space despite allocating a set storing up to N elements
    const flawedAnalysis = "The time complexity is O(n) and auxiliary space is O(1) space because we just have one set.";
    const result = validateComplexityAnalysis(passingCode, flawedAnalysis);

    expect(result.valid).toBe(false);
    expect(result.gap).toBeDefined();
    expect(result.gap?.aspect).toBe("complexity_analysis");
    expect(result.gap?.gap_key).toBe("complexity.space_hash_set_underestimated");
    expect(result.gap?.description).toContain("Claimed O(1) space while allocating a hash set/map");
    expect(result.gap?.resolved).toBe(false);

    // Correct analysis with O(n) time and O(n) space passes
    const correctAnalysis = "Time complexity is O(n) since hash lookups are O(1) on average. Auxiliary space is O(n) in the worst case for the seen set.";
    const passedResult = validateComplexityAnalysis(passingCode, correctAnalysis);
    expect(passedResult.valid).toBe(true);
    expect(passedResult.gap).toBeUndefined();
  });

  it("B19-AC3: verifies mode restrictions and resume preserve stage, turns, and evidence", () => {
    const initialState: TechnicalInterviewState = {
      session_id: "sess-tech-01",
      owner_id: "owner-1",
      scenario_id: "tech_interview_first_repeating",
      classroom_id: "cls-1",
      mode: "strict",
      current_stage: "implementation",
      turns: [
        {
          id: "t1",
          role: "interviewer",
          stage: "clarification",
          content: "Welcome to your interview.",
          created_at: "2026-09-15T14:00:00Z",
        },
        {
          id: "t2",
          role: "candidate",
          stage: "approach",
          content: "I will use a hash set.",
          created_at: "2026-09-15T14:05:00Z",
        },
      ],
      current_code: "def first_repeat(nums): pass",
      code_revision: 2,
      rubric: {
        approach_demonstrated: true,
        approach_type: "hash_set",
        code_tests_passed: false,
        complexity_verified: false,
        follow_up_addressed: false,
        specific_gaps: [],
        interviewer_notes: [],
      },
      is_interrupted: false,
      is_assisted: false,
      created_at: "2026-09-15T14:00:00Z",
      updated_at: "2026-09-15T14:05:00Z",
    };

    const resumed = resumeInterviewSession(initialState);

    // Preserves stage and turns
    expect(resumed.current_stage).toBe("implementation");
    expect(resumed.turns.length).toBe(2);
    expect(resumed.rubric.approach_type).toBe("hash_set");
    expect(resumed.current_code).toBe("def first_repeat(nums): pass");
    // Interruption is stamped honestly
    expect(resumed.is_interrupted).toBe(true);
  });

  it("Failure to Prevent: rejects vague hand-waving explanations without formal Big-O bounds", () => {
    const passingCode = "def first_repeat(nums): return None";
    const vagueExplanations = [
      "My code is very optimal and super fast.",
      "It doesn't use much memory at all.",
      "Efficiency is high.",
    ];

    for (const text of vagueExplanations) {
      const res = validateComplexityAnalysis(passingCode, text);
      expect(res.valid).toBe(false);
      expect(res.gap?.gap_key).toBe("complexity.explanation_vague_or_missing");
    }
  });
});
