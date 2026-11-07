/**
 * Review, Repair and Retention — Pure Domain Rules
 *
 * PLANLY_BUILD_SPEC.md §10: Review/repair/retention/readiness.
 * All functions are pure. No database, no clock.
 */

import type { Result } from "@/lib/validation/result";
import { ok, fail } from "@/lib/validation/result";
import type { SessionRecord } from "@/features/sessions/types";
import type {
  SubmitReviewInput,
  ReviewRecord,
  CompetencyEvidenceRecord,
  LearningCardRecord,
  RepairRecord,
  RecallCheckInput,
  RecallItemRecord,
  CompetencyKey,
  RecallResult,
} from "./types";
import { RECALL_INTERVALS, FAILURE_TO_REPAIR } from "./types";

// ---------------------------------------------------------------------------
// §9.2 Submit review validation
// ---------------------------------------------------------------------------

export interface SubmitReviewResult {
  review: Partial<ReviewRecord>;
  evidence: Partial<CompetencyEvidenceRecord>[];
  learningCard: Partial<LearningCardRecord>;
  repairProposal: Partial<RepairRecord> | null;
}

export function validateSubmitReview(
  session: SessionRecord,
  existingReviews: ReviewRecord[],
  input: SubmitReviewInput
): Result<SubmitReviewResult> {
  // Auth
  if (session.ownerId !== input.ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }

  // Must be finalized (or reviewed for superseding)
  if (session.state !== "finalized" && session.state !== "reviewed") {
    return fail("INVALID_STATE",
      `Cannot submit review for session in state '${session.state}'`
    );
  }

  // Validate evidence observations
  for (const ev of input.evidence) {
    // §10.1: A rating without a supporting observation/reference is invalid
    if (ev.rating !== null && (!ev.observation || ev.observation.trim().length === 0)) {
      return fail("VALIDATION_ERROR",
        `Rating ${ev.rating} for ${ev.competencyKey}/${ev.dimension} requires an observation`
      );
    }
  }

  // §10: Must have either a repair proposal or explicit no-action reason
  if (!input.repairProposal && !input.noActionReason) {
    return fail("VALIDATION_ERROR",
      "Review must include either a repair proposal or an explicit no-action reason"
    );
  }

  // Compute revision number
  const maxRevision = existingReviews.length > 0
    ? Math.max(...existingReviews.map((r) => r.revision))
    : 0;
  const newRevision = maxRevision + 1;

  // Build review
  const review: Partial<ReviewRecord> = {
    sessionId: input.sessionId,
    ownerId: input.ownerId,
    revision: newRevision,
    supersedesId: input.supersedesReviewId ?? null,
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    evaluator: "owner",
    source: "self",
    status: "submitted",
    noActionReason: input.noActionReason ?? null,
  };

  // Build evidence
  const evidence: Partial<CompetencyEvidenceRecord>[] = input.evidence.map((ev) => ({
    ownerId: input.ownerId,
    attemptId: ev.attemptId ?? null,
    competencyKey: ev.competencyKey,
    dimension: ev.dimension,
    rating: ev.rating,
    observation: ev.observation,
    evidenceReference: ev.evidenceReference ?? null,
    provenance: "self",
    confidence: "proposed",
    status: "proposed" as const,
  }));

  // Build learning card
  const learningCard: Partial<LearningCardRecord> = {
    ownerId: input.ownerId,
    attemptId: input.learningCard.attemptId,
    initialIdea: input.learningCard.initialIdea,
    failure: input.learningCard.failure,
    correctedInsight: input.learningCard.correctedInsight,
    complexityNote: input.learningCard.complexityNote ?? null,
    edgeCases: input.learningCard.edgeCases ?? null,
    lesson: input.learningCard.lesson,
    similarIds: input.learningCard.similarIds ?? [],
    version: 1,
  };

  // Build repair proposal
  let repairProposal: Partial<RepairRecord> | null = null;
  if (input.repairProposal) {
    const key = input.repairProposal.competencyKey;
    const repairInfo = FAILURE_TO_REPAIR[key];
    repairProposal = {
      ownerId: input.ownerId,
      competencyKey: key,
      hypothesis: input.repairProposal.hypothesis,
      state: "proposed",
      closureCriterion: input.repairProposal.closureCriterion ||
        (repairInfo ? repairInfo.retestRequirement : undefined),
      version: 1,
    };
  }

  return ok({
    review,
    evidence,
    learningCard,
    repairProposal,
  });
}

// ---------------------------------------------------------------------------
// §10.2 Repair state transitions
// ---------------------------------------------------------------------------

const VALID_REPAIR_TRANSITIONS: Record<string, string[]> = {
  proposed: ["scheduled", "deferred"],
  scheduled: ["drilled", "deferred"],
  drilled: ["retested", "deferred"],
  retested: ["improved", "still_open", "deferred"],
  improved: [],
  still_open: ["proposed"], // Can re-open
  deferred: ["proposed"],   // Can re-activate
};

export function canTransitionRepair(from: string, to: string): boolean {
  return VALID_REPAIR_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Minimal session data required for retest evidence validation.
 * The service layer provides this via a lookup function — the rules stay pure.
 */
export interface RetestSessionSummary {
  id: string;
  ownerId: string;
  state: string;              // must be 'finalized' | 'reviewed'
  familiarity: string;        // must be 'unseen_declared' for transfer criterion
  isAssisted: boolean;        // must be false for unassisted evidence
  outcome?: string;           // from linked review, if available
}

/**
 * Options for repair transition validation. The session lookup is optional
 * so that simple state-machine tests can run without I/O wiring, but
 * transitions to `retested` and `improved` will fail without it.
 */
export interface RepairTransitionOptions {
  /** Lookup returning retest session data. Required for retested/improved. */
  sessionLookup?: (sessionId: string) => RetestSessionSummary | null;
  /** Closure result text. Required for improved. */
  closureResult?: string;
}

export function validateRepairTransition(
  repair: RepairRecord,
  ownerId: string,
  newState: RepairRecord["state"],
  options?: RepairTransitionOptions,
): Result<Partial<RepairRecord>> {
  if (repair.ownerId !== ownerId) {
    return fail("AUTH_ERROR", "Repair does not belong to this owner");
  }

  if (!canTransitionRepair(repair.state, newState)) {
    return fail("INVALID_STATE",
      `Cannot transition repair from '${repair.state}' to '${newState}'`
    );
  }

  // §10.2: "drilled" requires an actual linked attempt/result
  if (newState === "drilled" && !repair.drillTaskId) {
    return fail("VALIDATION_ERROR",
      "Cannot mark repair as drilled without a linked drill task"
    );
  }

  // §10.2: Retest must follow drill completion
  if (newState === "retested" && repair.state !== "drilled") {
    return fail("VALIDATION_ERROR",
      "Retest must follow drill completion"
    );
  }

  // §10.2: "retested" requires a valid, unfamiliar, unassisted retest session
  if (newState === "retested") {
    if (!repair.retestSessionId) {
      return fail("VALIDATION_ERROR",
        "Cannot mark repair as retested without a linked retest session"
      );
    }
    if (repair.retestSessionId === repair.drillTaskId) {
      return fail("VALIDATION_ERROR",
        "Retest session must be distinct from the drill session"
      );
    }
    const retestValidation = validateRetestSession(
      repair, options?.sessionLookup,
    );
    if (!retestValidation.ok) return retestValidation;
  }

  // §10.2: "improved" requires closure evidence from a real retest
  if (newState === "improved") {
    if (!options?.closureResult?.trim()) {
      return fail("VALIDATION_ERROR",
        "Cannot mark repair as improved without a closure result describing the evidence"
      );
    }
    // Verify retest session has a passing review
    if (repair.retestSessionId && options?.sessionLookup) {
      const session = options.sessionLookup(repair.retestSessionId);
      if (session && session.state !== "reviewed") {
        return fail("VALIDATION_ERROR",
          "Retest session must be reviewed before marking repair as improved"
        );
      }
    }
  }

  return ok({
    state: newState,
    version: repair.version + 1,
  });
}

/**
 * Validate the retest session against §10.2 requirements:
 * - Session must exist (real, not fabricated)
 * - Session must belong to the same owner
 * - Session must be finalized or reviewed
 * - Session must be unfamiliar (unseen_declared)
 * - Session must be unassisted
 */
function validateRetestSession(
  repair: RepairRecord,
  sessionLookup?: (sessionId: string) => RetestSessionSummary | null,
): Result<Partial<RepairRecord>> {
  if (!sessionLookup) {
    return fail("VALIDATION_ERROR",
      "Session lookup is required to validate retest evidence"
    );
  }

  const session = sessionLookup(repair.retestSessionId!);
  if (!session) {
    return fail("VALIDATION_ERROR",
      `Retest session '${repair.retestSessionId}' does not exist`
    );
  }

  if (session.ownerId !== repair.ownerId) {
    return fail("AUTH_ERROR",
      "Retest session does not belong to the repair owner"
    );
  }

  if (session.state !== "finalized" && session.state !== "reviewed") {
    return fail("VALIDATION_ERROR",
      `Retest session must be finalized or reviewed, but is '${session.state}'`
    );
  }

  if (session.familiarity !== "unseen_declared") {
    return fail("VALIDATION_ERROR",
      "Retest session must use an unfamiliar (unseen) prompt for transfer evidence"
    );
  }

  if (session.isAssisted) {
    return fail("VALIDATION_ERROR",
      "Retest session must be unassisted for valid transfer evidence"
    );
  }

  return ok({ state: "retested" as RepairRecord["state"] });
}

// ---------------------------------------------------------------------------
// §10.3 Spaced recall: next interval computation
// ---------------------------------------------------------------------------

/**
 * Compute the next recall state after a check result.
 *
 * §10.3:
 * - Success → advance to next interval (capped at 30 days)
 * - Failure/forgotten/hinted/watched → reset to interval 1 tomorrow
 * - Partial → leave stage and due date unchanged
 */
export function computeNextRecall(
  current: RecallItemRecord,
  result: RecallResult,
  localDate: string
): Partial<RecallItemRecord> {
  if (result === "success") {
    const nextIndex = Math.min(
      current.intervalIndex + 1,
      RECALL_INTERVALS.length - 1
    );
    const intervalDays = RECALL_INTERVALS[nextIndex];
    const dueDate = addDays(localDate, intervalDays);

    return {
      intervalIndex: nextIndex,
      dueDate,
      lastResult: "success",
      status: nextIndex >= RECALL_INTERVALS.length - 1 ? "completed" : "active",
      version: current.version + 1,
    };
  }

  if (result === "forgotten") {
    // Reset to interval 0 (1 day), due tomorrow
    return {
      intervalIndex: 0,
      dueDate: addDays(localDate, 1),
      lastResult: "forgotten",
      status: "active",
      version: current.version + 1,
    };
  }

  // Partial: leave unchanged
  return {
    lastResult: "partial",
    version: current.version + 1,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Determine if a competency key has enough evidence for a repair trigger.
 *
 * §10.2: One unclear bad result creates a diagnostic hypothesis, not
 * a confident weakness. Concrete reproducible failures or repeated
 * comparable observations can support a repair.
 */
export function shouldTriggerRepair(
  competencyKey: CompetencyKey,
  evidenceItems: CompetencyEvidenceRecord[]
): { shouldRepair: boolean; isDiagnosticOnly: boolean } {
  const relevantEvidence = evidenceItems.filter(
    (e) => e.competencyKey === competencyKey && e.rating !== null && e.rating <= 1
  );

  if (relevantEvidence.length === 0) {
    return { shouldRepair: false, isDiagnosticOnly: false };
  }

  if (relevantEvidence.length === 1) {
    // Single unclear bad result → diagnostic only
    return { shouldRepair: false, isDiagnosticOnly: true };
  }

  // Multiple comparable observations → support a repair
  return { shouldRepair: true, isDiagnosticOnly: false };
}
