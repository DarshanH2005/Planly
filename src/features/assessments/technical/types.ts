/**
 * Sprint B19: Technical Interview Dialogue and Explanation Rubric Types
 * Authority: PLANLY_BUILD_SPEC.md §16-17; B19_technical_interview.md
 */

export type InterviewStage =
  | "clarification"
  | "approach"
  | "implementation"
  | "complexity"
  | "follow_up"
  | "debrief";

export type InterviewTurnRole = "candidate" | "interviewer" | "system";

export interface InterviewTurn {
  id: string;
  role: InterviewTurnRole;
  stage: InterviewStage;
  content: string;
  code_snapshot?: string | null;
  created_at: string;
}

export interface SpecificGap {
  aspect: "approach" | "implementation" | "complexity_analysis" | "follow_up";
  gap_key: string;
  description: string;
  learner_statement: string;
  resolved: boolean;
}

export interface RubricEvaluation {
  approach_demonstrated: boolean;
  approach_type?: string | null;
  code_tests_passed: boolean;
  complexity_verified: boolean;
  follow_up_addressed: boolean;
  specific_gaps: SpecificGap[];
  interviewer_notes: string[];
}

export interface TechnicalInterviewState {
  session_id: string;
  owner_id: string;
  scenario_id: string;
  classroom_id: string;
  mode: "strict" | "practice";
  current_stage: InterviewStage;
  turns: InterviewTurn[];
  current_code: string;
  code_revision: number;
  rubric: RubricEvaluation;
  active_follow_up_id?: string | null;
  is_interrupted: boolean;
  is_assisted: boolean;
  created_at: string;
  updated_at: string;
}
