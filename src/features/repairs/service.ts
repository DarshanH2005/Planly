/**
 * Repairs Service
 *
 * PLANLY_BUILD_SPEC.md §10.2, §17 (AC17, AC18), R12:
 * - Failure-to-repair lifecycle: proposed → scheduled → drilled → retested → improved | still_open
 * - AC17: 'drilled' requires an actual linked drill attempt/result; a task checkbox alone cannot close it
 * - AC18: Retest requires drill completion, distinct prompt, and unfamiliar conditions
 * - Enforces single open repair per competency
 */

import type { RepairRecord, CompetencyKey, RepairState } from "@/features/reviews/types";
import { FAILURE_TO_REPAIR } from "@/features/reviews/types";
import { validateRepairTransition } from "@/features/reviews/rules";
import type { RetestSessionSummary, RepairTransitionOptions } from "@/features/reviews/rules";
import type { Result } from "@/lib/validation/result";
import { ok, fail } from "@/lib/validation/result";
import { getLocalRepairs, saveLocalRepair } from "@/lib/storage/local-store";

export interface EnrichedRepair extends RepairRecord {
  triggerDescription: string;
  drillType: string;
  retestRequirement: string;
  triggerEvidenceNotes: string;
}

// Legacy demo data is retained only as a type fixture; owner records are read from durable local storage.
const repairStore = new Map<string, RepairRecord[]>([
  [
    "dev-owner-001",
    [
      {
        id: "rep-001",
        ownerId: "dev-owner-001",
        goalId: "goal-sde-cred",
        competencyKey: "boundaries",
        triggerEvidenceIds: ["ev-boundary-01", "ev-boundary-02"],
        hypothesis: "Off-by-one pointer termination during single-element and duplicate ranges in binary search / hash loops.",
        drillTaskId: "task-drill-boundaries-01",
        retestSessionId: null,
        state: "drilled", // Ready for retest
        closureCriterion: "Solve unfamiliar task containing single-element boundary and duplicate targets unassisted.",
        closureResult: null,
        version: 2,
      },
      {
        id: "rep-002",
        ownerId: "dev-owner-001",
        goalId: "goal-sde-cred",
        competencyKey: "adaptation",
        triggerEvidenceIds: ["ev-adapt-01"],
        hypothesis: "Struggled to transition from O(n) hash table to O(1) in-place pointers when space constraint tightened.",
        drillTaskId: "task-drill-adapt-01",
        retestSessionId: null,
        state: "scheduled",
        closureCriterion: "Demonstrate O(1) space redesign under changed follow-up constraints.",
        closureResult: null,
        version: 1,
      },
      {
        id: "rep-003",
        ownerId: "dev-owner-001",
        goalId: "goal-sde-cred",
        competencyKey: "pattern_selection",
        triggerEvidenceIds: ["ev-pattern-01"],
        hypothesis: "Attempted DP for simple greedy interval overlap problem.",
        drillTaskId: "task-drill-pattern-01",
        retestSessionId: "sess-retest-01",
        state: "improved",
        closureCriterion: "Correctly select greedy interval exchange argument on unfamiliar set.",
        closureResult: "Passed unassisted on 2026-09-06. Transferred to unfamiliar intervals.",
        version: 3,
      },
    ],
  ],
]);

/**
 * Load repairs for an owner enriched with §10.2 rules.
 */
export function getRepairs(ownerId: string): {
  active: EnrichedRepair[];
  resolved: EnrichedRepair[];
} {
  const records = getLocalRepairs(ownerId);

  const enrich = (r: RepairRecord): EnrichedRepair => {
    const meta = FAILURE_TO_REPAIR[r.competencyKey];
    return {
      ...r,
      triggerDescription: meta.triggerDescription,
      drillType: meta.drillType,
      retestRequirement: meta.retestRequirement,
      triggerEvidenceNotes:
        r.competencyKey === "boundaries"
          ? "Observed 2 missed boundary conditions in array hash sessions."
          : "Triggered from live technical session follow-up review.",
    };
  };

  const active = records.filter((r) => r.state !== "improved" && r.state !== "deferred").map(enrich);
  const resolved = records.filter((r) => r.state === "improved" || r.state === "deferred").map(enrich);

  return { active, resolved };
}

/**
 * Transition repair state adhering to AC17 and AC18 (§10.2).
 *
 * @param sessionLookup  Optional lookup for retest session evidence.
 *                       Required when transitioning to `retested` or `improved`.
 */
export function progressRepair(
  ownerId: string,
  repairId: string,
  newState: RepairState,
  params?: { drillTaskId?: string; retestSessionId?: string; closureResult?: string },
  sessionLookup?: (sessionId: string) => RetestSessionSummary | null,
): Result<EnrichedRepair> {
  const records = getLocalRepairs(ownerId);
  const existing = records.find((r) => r.id === repairId);
  if (!existing) {
    return fail("NOT_FOUND", `Repair ${repairId} not found`);
  }

  // Update optional drill/retest links before transition validation
  const candidate = {
    ...existing,
    drillTaskId: params?.drillTaskId ?? existing.drillTaskId,
    retestSessionId: params?.retestSessionId ?? existing.retestSessionId,
  };

  const validation = validateRepairTransition(candidate, ownerId, newState, {
    sessionLookup,
    closureResult: params?.closureResult,
  });
  if (!validation.ok) {
    return validation;
  }

  const updated: RepairRecord = {
    ...candidate,
    state: newState,
    version: existing.version + 1,
    closureResult: params?.closureResult ?? existing.closureResult,
  };

  saveLocalRepair(updated);

  const meta = FAILURE_TO_REPAIR[updated.competencyKey];
  return ok({
    ...updated,
    triggerDescription: meta.triggerDescription,
    drillType: meta.drillType,
    retestRequirement: meta.retestRequirement,
    triggerEvidenceNotes: "Updated transition",
  });
}
