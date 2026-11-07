import type {
  TrainingPrompt,
  SessionPack,
  Example,
} from "../../features/sessions/schemas";

export interface CandidateSafePrompt {
  id: string;
  version: number;
  familyIds: string[];
  difficulty: string;
  statement: string;
  constraints: string[];
  examples: Example[];
  /** Available clarification questions with answers stripped */
  availableClarifications: Array<{ id: string; question: string }>;
  /** Clarifications that have been explicitly asked and answered */
  revealedClarifications: Array<{ id: string; question: string; answer: string }>;
  /** Follow-up questions without internal evaluation criteria */
  revealedFollowups: Array<{ id: string; question: string }>;
}

export interface CandidateSafeSessionPack {
  id: string;
  version: number;
  stage: SessionPack["stage"];
  title: string;
  instructions: string;
  durationMinutes: number;
  debriefMinutes: number;
  inputFormat: SessionPack["inputFormat"];
  resourcePolicy: SessionPack["resourcePolicy"];
  promptIds: string[];
  rubricId: string;
  rubricVersion: number;
}

export interface ProjectionOptions {
  isEvaluator?: boolean;
  revealedClarificationIds?: string[];
  revealedFollowupIds?: string[];
}

/**
 * Projects a TrainingPrompt into a candidate-safe representation (§8.2, AC-01).
 *
 * Enforces strict security boundary [C11]:
 * - privateReference (approach, checks, expectedComplexity) is NEVER returned to candidates.
 * - followups.criterion is stripped to prevent leaking rubric benchmarks.
 * - clarification answers are only revealed if the candidate explicitly asked the question.
 * - repairLinks and source metadata are omitted.
 */
export function projectPrompt(
  prompt: TrainingPrompt,
  options: ProjectionOptions = {}
): CandidateSafePrompt | TrainingPrompt {
  if (options.isEvaluator) {
    return prompt;
  }

  const revealedClarificationSet = new Set(options.revealedClarificationIds ?? []);
  const revealedFollowupSet = new Set(options.revealedFollowupIds ?? []);

  // Questions only, answers stripped
  const availableClarifications = prompt.clarificationBranches.map((cb) => ({
    id: cb.id,
    question: cb.question,
  }));

  // Only include answers for questions explicitly asked
  const revealedClarifications = prompt.clarificationBranches
    .filter((cb) => revealedClarificationSet.has(cb.id))
    .map((cb) => ({
      id: cb.id,
      question: cb.question,
      answer: cb.answer,
    }));

  // Only include follow-ups that have been triggered, with criterion omitted
  const revealedFollowups = prompt.followups
    .filter((f) => revealedFollowupSet.has(f.id))
    .map((f) => ({
      id: f.id,
      question: f.question,
    }));

  return {
    id: prompt.id,
    version: prompt.version,
    familyIds: prompt.familyIds,
    difficulty: prompt.difficulty,
    statement: prompt.statement,
    constraints: prompt.constraints,
    examples: prompt.examples,
    availableClarifications,
    revealedClarifications,
    revealedFollowups,
  };
}

/**
 * Projects a SessionPack into a candidate-safe configuration.
 * Omits internal authoring metadata and source references.
 */
export function projectSessionPack(
  pack: SessionPack,
  options: { isEvaluator?: boolean } = {}
): CandidateSafeSessionPack | SessionPack {
  if (options.isEvaluator) {
    return pack;
  }

  return {
    id: pack.id,
    version: pack.version,
    stage: pack.stage,
    title: pack.title,
    instructions: pack.instructions,
    durationMinutes: pack.durationMinutes,
    debriefMinutes: pack.debriefMinutes,
    inputFormat: pack.inputFormat,
    resourcePolicy: pack.resourcePolicy,
    promptIds: pack.promptIds,
    rubricId: pack.rubricId,
    rubricVersion: pack.rubricVersion,
  };
}
