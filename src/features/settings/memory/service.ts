/**
 * Sprint B22: Memory Lifecycle Client Service
 * Authority: PLANLY_BUILD_SPEC.md §5-6, 11-12; B22_memory_lifecycle.md
 */

import type {
  MemoryClaim,
  CorrectionRecord,
  TombstoneRecord,
  CachedSummaryRecord,
} from "./types";

/**
 * B22-AC1: Validates that an old cached summary cannot resurrect an invalidated misconception.
 * Returns false if the summary is contaminated by an invalidated misconception.
 */
export function validateSummaryReliability(
  summary: CachedSummaryRecord,
  invalidatedMisconceptions: string[]
): boolean {
  if (summary.is_invalidated) return false;
  const invalidSet = new Set(invalidatedMisconceptions);
  const containsInvalid = summary.referenced_misconceptions.some((m) =>
    invalidSet.has(m)
  );
  return !containsInvalid;
}

/**
 * B22-AC2: Verifies that deleted source data with an active tombstone
 * is strictly blocked from returning via cache or retrieval adapters.
 */
export function isTargetTombstoned(
  targetId: string,
  activeTombstones: TombstoneRecord[]
): boolean {
  return activeTombstones.some(
    (t) => t.target_id === targetId && !t.is_restored
  );
}

/**
 * B22-AC3: Validates a learner self-report correction.
 * Prohibits direct mastery overrides: self-reports remain unassessed until verified.
 */
export function validateLearnerCorrection(
  claim: MemoryClaim,
  newCompetencyKey: string,
  note: string,
  isSelfReport: boolean = true,
  attemptDirectMasteryOverride: boolean = false
): {
  isValid: boolean;
  demonstrated: boolean;
  assistanceLevel: string;
  sourceKind: string;
} {
  if (attemptDirectMasteryOverride && isSelfReport) {
    throw new Error(
      "Learner self-report cannot directly override verified mastery without execution evidence (B22-AC3)."
    );
  }

  return {
    isValid: true,
    demonstrated: false, // Strict qualification invariant
    assistanceLevel: isSelfReport ? "unassessed" : "independent",
    sourceKind: isSelfReport ? "self_report" : "learner_work",
  };
}

/**
 * Failure to Prevent:
 * Real execution evidence and learner work always outrank assistant summaries.
 */
export function resolveCompetencyConflict(
  evidenceDemonstrated: boolean,
  evidenceSourceKind: string,
  assistantSummaryClaim: string
): { winningSource: string; demonstrated: boolean } {
  // Real execution evidence always wins
  if (evidenceSourceKind === "execution_evidence" || evidenceSourceKind === "learner_work") {
    return {
      winningSource: evidenceSourceKind,
      demonstrated: evidenceDemonstrated,
    };
  }
  return {
    winningSource: "assistant_summary",
    demonstrated: false,
  };
}
