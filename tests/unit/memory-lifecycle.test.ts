import { describe, it, expect } from "vitest";
import {
  validateSummaryReliability,
  isTargetTombstoned,
  validateLearnerCorrection,
  resolveCompetencyConflict,
} from "@/features/settings/memory/service";
import type {
  CachedSummaryRecord,
  TombstoneRecord,
  MemoryClaim,
} from "@/features/settings/memory/types";

describe("Sprint B22: Memory Lifecycle, Corrections & Privacy", () => {
  it("B22-AC1: verifies an old summary cannot resurrect an invalidated misconception", () => {
    const invalidatedMisconceptions = ["cs.os.single_heap_for_computer"];

    // 1. Old cached summary that references the invalidated misconception
    const oldSummary: CachedSummaryRecord = {
      id: "summ-01",
      owner_id: "owner-1",
      summary_text: "Learner believes there is one global heap for the whole computer.",
      referenced_misconceptions: ["cs.os.single_heap_for_computer"],
      referenced_observation_ids: ["obs-old-01"],
      is_invalidated: false,
      created_at: "2026-09-10T10:00:00Z",
    };

    // Must be rejected as unreliable
    expect(validateSummaryReliability(oldSummary, invalidatedMisconceptions)).toBe(false);

    // 2. Fresh summary after correction
    const freshSummary: CachedSummaryRecord = {
      id: "summ-02",
      owner_id: "owner-1",
      summary_text: "Learner correctly articulates per-process virtual memory and private heap isolation.",
      referenced_misconceptions: [],
      referenced_observation_ids: ["obs-new-02"],
      is_invalidated: false,
      created_at: "2026-09-12T10:00:00Z",
    };

    expect(validateSummaryReliability(freshSummary, invalidatedMisconceptions)).toBe(true);
  });

  it("B22-AC2: verifies deleted source entries with active tombstones cannot return via cache", () => {
    const tombstones: TombstoneRecord[] = [
      {
        id: "tomb-01",
        owner_id: "owner-1",
        target_id: "obs-chat-sensitive-01",
        target_type: "observation",
        reason: "User requested data deletion",
        deleted_at: new Date().toISOString(),
        restore_token: "rst-token-12345",
        is_restored: false,
      },
    ];

    // Tombstoned target must be blocked
    expect(isTargetTombstoned("obs-chat-sensitive-01", tombstones)).toBe(true);

    // Non-deleted target is active
    expect(isTargetTombstoned("obs-active-02", tombstones)).toBe(false);

    // Restored tombstone allows access
    tombstones[0].is_restored = true;
    expect(isTargetTombstoned("obs-chat-sensitive-01", tombstones)).toBe(false);
  });

  it("B22-AC3: verifies a learner self-report correction remains qualified without direct mastery overrides", () => {
    const claim: MemoryClaim = {
      id: "claim-01",
      owner_id: "owner-1",
      competency_key: "dsa.dp.knapsack_01",
      claim_text: "Learner struggling with 0/1 knapsack state transitions.",
      source_observation_ids: ["obs-1"],
      is_misconception: false,
      status: "active",
      demonstrated: false,
      source_kind: "learner_work",
      assistance_level: "guided",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 1. Learner submits honest self-report correction
    const res = validateLearnerCorrection(
      claim,
      "dsa.dp.knapsack_01",
      "I actually understand knapsack transitions now after doing practice."
    );

    expect(res.isValid).toBe(true);
    expect(res.sourceKind).toBe("self_report");
    expect(res.assistanceLevel).toBe("unassessed");
    // Demonstrated MUST be false until verified execution!
    expect(res.demonstrated).toBe(false);

    // 2. Candidate attempts direct mastery override via self-report
    expect(() =>
      validateLearnerCorrection(
        claim,
        "dsa.dp.knapsack_01",
        "Mark me master of DP!",
        true,
        true // attempt direct mastery override
      )
    ).toThrow("Learner self-report cannot directly override verified mastery");
  });

  it("Failure to Prevent: real execution evidence outranks assistant-generated summary", () => {
    // Verified execution evidence
    const conflictResult = resolveCompetencyConflict(
      true,
      "execution_evidence",
      "Assistant summary claiming learner is weak in arrays"
    );

    expect(conflictResult.winningSource).toBe("execution_evidence");
    expect(conflictResult.demonstrated).toBe(true);
  });
});
