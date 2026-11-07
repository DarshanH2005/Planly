/**
 * Sprint B19: Technical Interview Dialogue Service & Rubric Helpers
 * Authority: PLANLY_BUILD_SPEC.md §16-17; B19_technical_interview.md
 */

import type {
  TechnicalInterviewState,
  InterviewStage,
  InterviewTurn,
  SpecificGap,
  RubricEvaluation,
} from "./types";

const LEARNING_SERVICE_URL =
  process.env.NEXT_PUBLIC_LEARNING_SERVICE_URL || "http://127.0.0.1:8000";

/**
 * B19-AC1: Validates that the interviewer response addresses the candidate's chosen approach
 * instead of leaking or forcing the canonical reference solution.
 */
export function checkInterviewerFollowsLearnerApproach(
  candidateMessage: string,
  interviewerReply: string
): boolean {
  const lowerCand = candidateMessage.toLowerCase();
  const lowerReply = interviewerReply.toLowerCase();

  // If candidate proposed sorting, interviewer should discuss sorting, not force hash map
  if (lowerCand.includes("sort")) {
    return lowerReply.includes("sort") || lowerReply.includes("order") || lowerReply.includes("indices");
  }

  // If candidate proposed hash set, interviewer discusses hash set / duplicates
  if (lowerCand.includes("hash") || lowerCand.includes("set") || lowerCand.includes("dict")) {
    return lowerReply.includes("hash") || lowerReply.includes("set") || lowerReply.includes("seen") || lowerReply.includes("occurrence");
  }

  // If candidate proposed brute force, interviewer explores nested loops / complexity
  if (lowerCand.includes("nested") || lowerCand.includes("loop") || lowerCand.includes("brute")) {
    return lowerReply.includes("loop") || lowerReply.includes("nested") || lowerReply.includes("complexity");
  }

  return true;
}

/**
 * B19-AC2: Assesses complexity independently of passing code tests.
 * A weak or inaccurate complexity explanation remains an explicit, specific gap in the rubric.
 */
export function validateComplexityAnalysis(
  code: string,
  explanation: string
): { valid: boolean; gap?: SpecificGap } {
  const lowerExp = explanation.toLowerCase();
  const lowerCode = code.toLowerCase();

  const hasFormalTime =
    lowerExp.includes("o(n)") ||
    lowerExp.includes("linear") ||
    lowerExp.includes("o(n^2)") ||
    lowerExp.includes("quadratic") ||
    lowerExp.includes("o(1)");

  const hasFormalSpace =
    (lowerExp.includes("space") || lowerExp.includes("memory")) &&
    (lowerExp.includes("o(") || lowerExp.includes("constant") || lowerExp.includes("linear"));

  // Failure-to-Prevent: Vague explanation is not accepted as mastery
  if (!hasFormalTime || !hasFormalSpace) {
    return {
      valid: false,
      gap: {
        aspect: "complexity_analysis",
        gap_key: "complexity.explanation_vague_or_missing",
        description: "Learner provided a vague non-specific statement without formal Big-O bounds.",
        learner_statement: explanation,
        resolved: false,
      },
    };
  }

  // B19-AC2: Claiming O(1) space when code stores up to N elements in a set/dict
  const usesAuxiliaryStorage =
    lowerCode.includes("set(") ||
    lowerCode.includes("dict(") ||
    lowerCode.includes("{}") ||
    lowerCode.includes("seen");

  if (usesAuxiliaryStorage && (lowerExp.includes("o(1) space") || lowerExp.includes("constant space"))) {
    return {
      valid: false,
      gap: {
        aspect: "complexity_analysis",
        gap_key: "complexity.space_hash_set_underestimated",
        description: "Claimed O(1) space while allocating a hash set/map that stores up to N distinct elements.",
        learner_statement: explanation,
        resolved: false,
      },
    };
  }

  return { valid: true };
}

/**
 * B19-AC3: Simulates interview session resumption preserving stage and evidence.
 */
export function resumeInterviewSession(
  state: TechnicalInterviewState
): TechnicalInterviewState {
  return {
    ...state,
    is_interrupted: true,
    updated_at: new Date().toISOString(),
  };
}
