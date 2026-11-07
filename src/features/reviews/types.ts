/**
 * Review, Repair and Retention — Type Definitions
 *
 * PLANLY_BUILD_SPEC.md §10
 */

// ---------------------------------------------------------------------------
// Review records
// ---------------------------------------------------------------------------

export type EvidenceStatus = "proposed" | "confirmed" | "disputed";

export type RepairState = "proposed" | "scheduled" | "drilled" | "retested" | "improved" | "still_open" | "deferred";

export type CompetencyKey =
  | "pattern_selection"
  | "implementation"
  | "boundaries"
  | "explanation"
  | "adaptation"
  | "project_depth"
  | "behavioural_specificity";

export interface ReviewRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  revision: number;
  supersedesId: string | null;
  rubricId: string;
  rubricVersion: number;
  evaluator: string;
  source: string;
  status: "submitted" | "effective" | "superseded";
  noActionReason: string | null;
}

export interface CompetencyEvidenceRecord {
  id: string;
  ownerId: string;
  reviewId: string;
  attemptId: string | null;
  competencyKey: string;
  dimension: string;
  rating: 0 | 1 | 2 | 3 | null;
  observation: string;
  evidenceReference: string | null;
  provenance: string;
  confidence: string;
  status: EvidenceStatus;
}

export interface LearningCardRecord {
  id: string;
  ownerId: string;
  attemptId: string;
  reviewId: string | null;
  initialIdea: string;
  failure: string;
  correctedInsight: string;
  complexityNote: string | null;
  edgeCases: string | null;
  lesson: string;
  similarIds: string[];
  version: number;
}

export interface RepairRecord {
  id: string;
  ownerId: string;
  goalId: string;
  competencyKey: CompetencyKey;
  triggerEvidenceIds: string[];
  hypothesis: string | null;
  drillTaskId: string | null;
  retestSessionId: string | null;
  state: RepairState;
  closureCriterion: string | null;
  closureResult: string | null;
  version: number;
}

// ---------------------------------------------------------------------------
// Recall
// ---------------------------------------------------------------------------

/** Spaced recall intervals in days: [1, 3, 7, 14, 30] */
export const RECALL_INTERVALS = [1, 3, 7, 14, 30] as const;

export type RecallResult = "success" | "partial" | "forgotten";

export interface RecallItemRecord {
  id: string;
  ownerId: string;
  itemRef: string;
  intervalIndex: number;
  dueDate: string;
  status: "active" | "completed" | "deferred";
  lastResult: RecallResult | null;
  evidenceMode: "concept_recall" | "full_code";
  version: number;
}

// ---------------------------------------------------------------------------
// Inputs for mutations
// ---------------------------------------------------------------------------

export interface SubmitReviewInput {
  sessionId: string;
  ownerId: string;
  rubricId: string;
  rubricVersion: number;
  evidence: Array<{
    attemptId: string | null;
    competencyKey: string;
    dimension: string;
    rating: 0 | 1 | 2 | 3 | null;
    observation: string;
    evidenceReference?: string;
  }>;
  learningCard: {
    attemptId: string;
    initialIdea: string;
    failure: string;
    correctedInsight: string;
    complexityNote?: string;
    edgeCases?: string;
    lesson: string;
    similarIds?: string[];
  };
  repairProposal?: {
    competencyKey: CompetencyKey;
    hypothesis: string;
    closureCriterion: string;
  };
  noActionReason?: string;
  supersedesReviewId?: string;
  serverNow: string;
}

export interface RecallCheckInput {
  itemId: string;
  ownerId: string;
  result: RecallResult;
  localDate: string;    // Actual local date of the check
}

// ---------------------------------------------------------------------------
// Rubric dimension definitions (§10.1)
// ---------------------------------------------------------------------------

export type RubricFamily = "technical" | "engineering" | "project" | "behavioural";

export interface RubricDimension {
  family: RubricFamily;
  dimension: string;
  rating2Criterion: string;
  rating3Extension: string;
}

export const RUBRIC_DIMENSIONS: RubricDimension[] = [
  { family: "technical", dimension: "clarification", rating2Criterion: "Establish relevant assumptions and examples", rating3Extension: "Resolve a consequential ambiguity proactively" },
  { family: "technical", dimension: "reasoning", rating2Criterion: "Valid approach and sound complexity", rating3Extension: "Explain correctness and compare a viable alternative" },
  { family: "technical", dimension: "implementation", rating2Criterion: "Correct agreed core under stated constraints", rating3Extension: "Robust, clear code on additional relevant cases" },
  { family: "technical", dimension: "testing_debugging", rating2Criterion: "Boundary tests and reasoned diagnosis", rating3Extension: "Find and verify a nontrivial failure systematically" },
  { family: "technical", dimension: "explanation", rating2Criterion: "Decisions and rationale are understandable", rating3Extension: "Concise milestones and accurate responses to questions" },
  { family: "technical", dimension: "follow_up", rating2Criterion: "Correctly adapt to the changed requirement", rating3Extension: "Explain tradeoff and test the revised design" },
  { family: "engineering", dimension: "requirements", rating2Criterion: "Testable scope and clear assumptions", rating3Extension: "Anticipate one meaningful failure or ambiguity" },
  { family: "engineering", dimension: "correctness", rating2Criterion: "Agreed core works with supporting checks", rating3Extension: "Handles a relevant additional edge case" },
  { family: "engineering", dimension: "structure", rating2Criterion: "Responsibilities are clear and maintainable", rating3Extension: "Demonstrates a bounded extension without unnecessary redesign" },
  { family: "engineering", dimension: "validation_tests", rating2Criterion: "Invalid input and core cases checked", rating3Extension: "Reproduces and prevents a subtle failure" },
  { family: "engineering", dimension: "change_tradeoff", rating2Criterion: "Implements/explains the requested change", rating3Extension: "Compares another design and its cost" },
  { family: "project", dimension: "ownership", rating2Criterion: "Identifies actual contribution accurately", rating3Extension: "Explains its evolution and evidence of impact" },
  { family: "project", dimension: "architecture", rating2Criterion: "Traces the real request/data flow", rating3Extension: "Explains failure behaviour across boundaries" },
  { family: "project", dimension: "debugging", rating2Criterion: "Describes a real reproduced bug and fix", rating3Extension: "Demonstrates regression protection" },
  { family: "project", dimension: "decisions", rating2Criterion: "Explains a real data/auth/design choice", rating3Extension: "Evaluates a concrete alternative under changed constraints" },
  { family: "behavioural", dimension: "specificity", rating2Criterion: "Clear situation and constraint", rating3Extension: "Selects relevant details without losing focus" },
  { family: "behavioural", dimension: "personal_action", rating2Criterion: "Own actions are distinguishable from the team", rating3Extension: "Explains why the choice was made" },
  { family: "behavioural", dimension: "evidence", rating2Criterion: "Truthful result or explicitly unknown outcome", rating3Extension: "Supports the result with an artifact/example" },
  { family: "behavioural", dimension: "reflection", rating2Criterion: "States a lesson and future improvement", rating3Extension: "Explains an actual changed behaviour" },
  { family: "behavioural", dimension: "follow_up", rating2Criterion: "Answers what/why/change questions directly", rating3Extension: "Considers a credible alternative fairly" },
];

/** Failure-to-repair mapping (§10.2) */
export const FAILURE_TO_REPAIR: Record<CompetencyKey, {
  triggerDescription: string;
  drillType: string;
  retestRequirement: string;
}> = {
  pattern_selection: {
    triggerDescription: "Repeated wrong approach or reproducible constraint mismatch",
    drillType: "Contrast examples; explain which invariant applies",
    retestRequirement: "Unfamiliar related task with family label hidden",
  },
  implementation: {
    triggerDescription: "Sound idea, unfinished/incorrect implementation",
    drillType: "Small implementation/debugging drill in Python",
    retestRequirement: "Comparable unfamiliar timed implementation",
  },
  boundaries: {
    triggerDescription: "Concrete missed edge/counterexample",
    drillType: "Trace edge cases and fix seeded bug",
    retestRequirement: "Different task containing the boundary plus another case",
  },
  explanation: {
    triggerDescription: "Recorded rationale cannot be followed",
    drillType: "Five-minute derive-and-explain exercise",
    retestRequirement: "New technical response reviewed on explanation",
  },
  adaptation: {
    triggerDescription: "Changed constraint not handled",
    drillType: "Compare old/new assumptions and redesign one part",
    retestRequirement: "Different relevant follow-up",
  },
  project_depth: {
    triggerDescription: "Unsupported explanation of own code",
    drillType: "Trace actual code and demonstrate small change",
    retestRequirement: "Re-explain and demonstrate with artifact evidence",
  },
  behavioural_specificity: {
    triggerDescription: "Generic story without own action/evidence",
    drillType: "Restructure a true story",
    retestRequirement: "Different question and specific follow-ups",
  },
};
