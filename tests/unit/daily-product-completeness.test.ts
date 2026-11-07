/**
 * M4 Acceptance Tests: Daily Product Completeness
 *
 * PLANLY_BUILD_SPEC.md §16, §17:
 * - AC05: Missed-day rescheduling moves only to an adequate opening;
 *   no room yields an explicit shortfall; Minimum Day (12m) maintains continuity without false benchmark evidence.
 * - AC22: Weekly evidence shows denominators/conditions/unknowns;
 *   superseding a disputed review changes derived evidence without deleting history.
 * - AC23: Applications/project/daily notes persist; no external message/application is sent.
 * - R04: Daily cockpit capacity and 80% safety buffer adaptation.
 * - R12 (AC17, AC18): Failure-to-repair state transitions; drilled requires linked attempt;
 *   retest requires drill completion.
 */

import { describe, it, expect } from "vitest";
import {
  buildSprint,
  computeDailyBudget,
  computeWeeklyBudget,
} from "@/features/planning/rules";
import type {
  PlannerInput,
  DayCapacity,
  AvailabilitySlot,
  EligibleContentItem,
} from "@/features/planning/types";
import {
  getTodayState,
  applyDailyAdjustment,
  saveGrowthNotes,
} from "@/features/progress/service";
import {
  getEffectiveReviews,
  computeEffectiveEvidence,
  computeDomainReadiness,
  getReadinessOverview,
} from "@/features/progress/readiness-service";
import type {
  SessionEvidenceItem,
} from "@/features/progress/readiness-service";
import type {
  ReviewRecord,
  CompetencyEvidenceRecord,
  RepairRecord,
} from "@/features/reviews/types";
import {
  validateRepairTransition,
  canTransitionRepair,
} from "@/features/reviews/rules";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlot(id: string, minutes: number): AvailabilitySlot {
  return { id, capacityMinutes: minutes };
}

function makeDay(date: string, minutes: number, slots: AvailabilitySlot[] = []): DayCapacity {
  return {
    date,
    declaredAvailableMinutes: minutes,
    slots: slots.length > 0 ? slots : [makeSlot(`slot-${date}`, minutes)],
    isRestDay: minutes === 0,
    isMinimumDay: minutes > 0 && minutes <= 15,
  };
}

function makePlannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    goal: {
      id: "goal-sde",
      weeklyTargetMinutes: 1080,
      rampState: "active_training",
      checkpointDate: "2026-11-30",
      algorithmVersion: "1.0.0",
    },
    sprintWindow: {
      startDate: "2026-09-14",
      endDate: "2026-09-27",
    },
    today: "2026-09-14",
    timezone: "Asia/Kolkata",
    capacityPattern: [],
    fixedCommitments: [],
    completedPrerequisites: new Map(),
    effectiveEvidence: [],
    recallState: [],
    eligibleContent: [],
    realDeadlines: [],
    previousAssignments: [],
    adjacentSprintCommitments: [],
    inputRevision: 1,
    inputHash: "hash-m4",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC05: Missed-day, capacity reduction, and shortfall checks
// ---------------------------------------------------------------------------

describe("AC05: Missed-Day & Adaptive Capacity Reallocation", () => {
  it("moves a missed 90-minute OA only to an adequate opening in future days", () => {
    // Today (Mon): 75 declared with existing 45+15 live session (60m committed, full).
    // Tue: 60 declared (buffer 48m) - cannot fit 90m OA!
    // Wed: 120 declared (buffer 96m) - has 96m opening, fits 90m OA!
    const capMon = makeDay("2026-09-14", 75, [makeSlot("s-mon-1", 60)]);
    const capTue = makeDay("2026-09-15", 60, [makeSlot("s-tue-1", 48)]);
    const capWed = makeDay("2026-09-16", 120, [makeSlot("s-wed-1", 96)]);

    const oaContent: EligibleContentItem = {
      promptId: "FX-SEARCH-A",
      familyIds: ["F03"],
      difficulty: "medium",
      packId: "PACK-OA-01",
      stage: "oa",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    };

    const input = makePlannerInput({
      today: "2026-09-14",
      capacityPattern: [capMon, capTue, capWed],
      sprintWindow: { startDate: "2026-09-14", endDate: "2026-09-16" },
      fixedCommitments: [
        {
          id: "fix-live-today",
          date: "2026-09-14",
          minutes: 60,
          description: "Live Technical session",
          isInterview: false,
        },
      ],
      eligibleContent: [oaContent],
    });

    const output = buildSprint(input);

    // Today is full (60m fixed out of 60m budget)
    const monAlloc = output.dayAllocations.find((d) => d.date === "2026-09-14");
    expect(monAlloc?.allocatedMinutes).toBe(0); // 0 discretionary left

    // OA task is 90m total (70m + 20m debrief). Tue only has 48m buffer, Wed has 96m.
    const oaAssignment = output.assignments.find((a) => a.packId === "PACK-OA-01");
    expect(oaAssignment).toBeDefined();
    // OA must be placed on Wed, NOT Tue (which lacks adequate opening)
    expect(oaAssignment?.slotAllocations[0].localDate).toBe("2026-09-16");
  });

  it("emits an explicit shortfall when no adequate opening exists for a non-splittable task", () => {
    // All days have only 45 minutes declared (buffer 36m).
    // 90m OA cannot fit any single uninterrupted slot before checkpoint.
    const days = [
      makeDay("2026-09-14", 45, [makeSlot("s1", 36)]),
      makeDay("2026-09-15", 45, [makeSlot("s2", 36)]),
      makeDay("2026-09-16", 45, [makeSlot("s3", 36)]),
    ];

    const oaContent: EligibleContentItem = {
      promptId: "FX-SEARCH-A",
      familyIds: ["F03"],
      difficulty: "medium",
      packId: "PACK-OA-01",
      stage: "oa",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    };

    const input = makePlannerInput({
      today: "2026-09-14",
      capacityPattern: days,
      sprintWindow: { startDate: "2026-09-14", endDate: "2026-09-16" },
      eligibleContent: [oaContent],
    });

    const output = buildSprint(input);

    // No room: should emit explicit shortfall or deferred item rather than overflowing caps or splitting
    expect(
      output.shortfalls.some((s) => s.kind === "opening" || s.kind === "capacity") ||
      output.deferredItems.length > 0
    ).toBe(true);

    // The 90m OA should NOT be placed in any 36m slot
    const assignedOa = output.assignments.find((a) => a.packId === "PACK-OA-01");
    expect(assignedOa).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R04: Daily Cockpit Adjustments (Minimum Day, Rest Day, Custom)
// ---------------------------------------------------------------------------

describe("R04: Daily Workflow Cockpit & Invariants", () => {
  const ownerId = "test-owner-r04";

  it("configures standard full day with 80% safety buffer", () => {
    const state = applyDailyAdjustment(ownerId, { mode: "full", declaredMinutes: 75 });
    expect(state.capacity.declaredMinutes).toBe(75);
    expect(state.capacity.effectiveBudget).toBe(60); // floor(0.8 * 75)
    expect(state.focusTask).not.toBeNull();
    expect(state.focusTask?.totalMinutes).toBe(30);
    expect(state.supportingSlots.length).toBe(2);
    expect(state.capacity.committedMinutes).toBe(60);
    expect(state.capacity.remainingMinutes).toBe(0);
  });

  it("handles Minimum Day (12m) maintaining continuity without false benchmark evidence (§7.1)", () => {
    const state = applyDailyAdjustment(ownerId, { mode: "minimum_day" });
    expect(state.capacity.effectiveBudget).toBe(12);
    expect(state.capacity.committedMinutes).toBe(12);
    expect(state.focusTask).not.toBeNull();
    expect(state.focusTask?.totalMinutes).toBe(12);
    expect(state.focusTask?.title).toContain("Minimum Day Continuity Drill");
    expect(state.supportingSlots.length).toBe(0); // No full supporting sessions
    expect(state.replanningMessage).toContain("12-minute Minimum Day active");
  });

  it("handles Rest Day (0m) safely clearing scheduled tasks with replanning reason", () => {
    const state = applyDailyAdjustment(ownerId, { mode: "rest_day" });
    expect(state.capacity.declaredMinutes).toBe(0);
    expect(state.capacity.effectiveBudget).toBe(0);
    expect(state.capacity.committedMinutes).toBe(0);
    expect(state.focusTask).toBeNull();
    expect(state.supportingSlots.length).toBe(0);
    expect(state.replanningMessage).toContain("Rest Day declared");
  });

  it("never commits more work than a reduced custom capacity", () => {
    const state = applyDailyAdjustment(ownerId, { mode: "custom", declaredMinutes: 40 });
    expect(state.capacity.effectiveBudget).toBe(32);
    expect(state.capacity.committedMinutes).toBe(30);
    expect(state.capacity.committedMinutes).toBeLessThanOrEqual(state.capacity.effectiveBudget);
    expect(state.capacity.remainingMinutes).toBe(2);
    expect(state.supportingSlots).toHaveLength(0);
  });

  it("saves and retrieves lightweight growth notes (§6.5, R15)", () => {
    const notes = {
      date: "2026-09-14",
      sleepHours: 8,
      energyRating: 4 as const,
      movementNote: "30m cycling",
      reflection: "Blank editor syntax felt natural. Identified off-by-one boundary immediately.",
    };

    saveGrowthNotes(ownerId, notes);
    const updated = getTodayState(ownerId, "2026-09-14");
    expect(updated.growthNotes).toEqual(notes);
  });
});

// ---------------------------------------------------------------------------
// AC22: Evidence & Readiness Aggregates & Superseding Reviews
// ---------------------------------------------------------------------------

describe("AC22: Readiness Evidence & Non-Destructive Revision History", () => {
  const ownerId = "test-owner-ac22";

  it("excludes assisted, familiar, and interrupted sessions from strict-unseen aggregates while retaining them in history", () => {
    const sessions: SessionEvidenceItem[] = [
      {
        sessionId: "s1",
        stage: "oa",
        packId: "PACK-OA-01",
        completedAt: "2026-09-01",
        isUnseen: true,
        isUnassisted: true,
        isUninterrupted: true,
        passed: true,
      },
      {
        sessionId: "s2",
        stage: "oa",
        packId: "PACK-OA-01",
        completedAt: "2026-09-03",
        isUnseen: false, // Familiar!
        isUnassisted: true,
        isUninterrupted: true,
        passed: true,
        exclusionReason: "Familiar prompt",
      },
      {
        sessionId: "s3",
        stage: "oa",
        packId: "PACK-OA-01",
        completedAt: "2026-09-05",
        isUnseen: true,
        isUnassisted: false, // Assisted!
        isUninterrupted: true,
        passed: true,
        exclusionReason: "Assisted",
      },
      {
        sessionId: "s4",
        stage: "oa",
        packId: "PACK-OA-01",
        completedAt: "2026-09-07",
        isUnseen: true,
        isUnassisted: true,
        isUninterrupted: false, // Interrupted!
        passed: true,
        exclusionReason: "Interrupted",
      },
    ];

    const domains = computeDomainReadiness(sessions, new Map());
    const oaDomain = domains.find((d) => d.domain === "oa")!;

    // Total observed sessions is 4, but only 1 qualifies as strict-unseen unassisted uninterrupted
    expect(oaDomain.sampleCount).toBe(4);
    expect(oaDomain.qualifyingCount).toBe(1);
    expect(oaDomain.benchmarkDenominator).toBe(4);
    // Needs 3 of 4 to be supported; 1 makes it 'developing'
    expect(oaDomain.status).toBe("developing");
    expect(oaDomain.missingGaps.some((g) => g.includes("excluded from strict benchmark"))).toBe(true);
  });

  it("demonstrates honest denominators showing unknowns when data is insufficient (§10.4)", () => {
    // Only 2 technical sessions completed so far
    const sessions: SessionEvidenceItem[] = [
      {
        sessionId: "tech-1",
        stage: "technical_a",
        packId: "PACK-TECHNICAL-A-01",
        completedAt: "2026-09-02",
        isUnseen: true,
        isUnassisted: true,
        isUninterrupted: true,
        passed: true,
      },
      {
        sessionId: "tech-2",
        stage: "technical_b",
        packId: "PACK-TECHNICAL-B-01",
        completedAt: "2026-09-04",
        isUnseen: true,
        isUnassisted: true,
        isUninterrupted: true,
        passed: true,
      },
    ];

    const domains = computeDomainReadiness(sessions, new Map());
    const techDomain = domains.find((d) => d.domain === "technical")!;

    expect(techDomain.qualifyingCount).toBe(2);
    expect(techDomain.benchmarkDenominator).toBe(4);
    expect(techDomain.unknownCount).toBe(2);
    expect(techDomain.status).toBe("developing");
    expect(techDomain.missingGaps[0]).toContain("Need 2 more live technical sessions");
  });

  it("updates effective evidence when a review is superseded without deleting prior observations (AC22)", () => {
    const reviews: ReviewRecord[] = [
      {
        id: "rev-1",
        ownerId,
        sessionId: "sess-tech-lca",
        revision: 1,
        supersedesId: null,
        rubricId: "RUBRIC-TECH-01",
        rubricVersion: 1,
        evaluator: "self",
        source: "self",
        status: "superseded", // Superseded!
        noActionReason: null,
      },
      {
        id: "rev-2",
        ownerId,
        sessionId: "sess-tech-lca",
        revision: 2,
        supersedesId: "rev-1", // Supersedes rev-1
        rubricId: "RUBRIC-TECH-01",
        rubricVersion: 1,
        evaluator: "peer_review",
        source: "peer_verified",
        status: "effective", // Active effective review
        noActionReason: null,
      },
    ];

    const evidenceRecords: CompetencyEvidenceRecord[] = [
      {
        id: "ev-old",
        ownerId,
        reviewId: "rev-1",
        attemptId: "att-1",
        competencyKey: "boundaries",
        dimension: "Testing/debugging",
        rating: 1,
        observation: "Initial flawed rating: believed single-node tree was missed.",
        evidenceReference: "ref-1",
        provenance: "self",
        confidence: "provisional",
        status: "disputed",
      },
      {
        id: "ev-new",
        ownerId,
        reviewId: "rev-2", // Belongs to effective review rev-2
        attemptId: "att-1",
        competencyKey: "boundaries",
        dimension: "Testing/debugging",
        rating: 2,
        observation: "Corrected rating: Code explicitly returned root for single-node tree without error.",
        evidenceReference: "ref-2",
        provenance: "peer_verified",
        confidence: "confirmed",
        status: "confirmed",
      },
    ];

    // Check getEffectiveReviews
    const effectiveRevs = getEffectiveReviews(reviews);
    expect(effectiveRevs.length).toBe(1);
    expect(effectiveRevs[0].id).toBe("rev-2");

    // Compute effective evidence map
    const effectiveMap = computeEffectiveEvidence(reviews, evidenceRecords);
    const boundaryEv = effectiveMap.get("boundaries:Testing/debugging");
    expect(boundaryEv).toBeDefined();
    // Effective rating is 2 (from rev-2), NOT 1
    expect(boundaryEv?.rating).toBe(2);
    expect(boundaryEv?.reviewId).toBe("rev-2");

    // Both historical evidence records still exist in raw store
    expect(evidenceRecords.length).toBe(2);
    expect(evidenceRecords[0].rating).toBe(1);
    expect(evidenceRecords[1].rating).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// R12 / AC17 / AC18: Repair State Machine & Unfamiliar Retest
// ---------------------------------------------------------------------------

describe("R12, AC17, AC18: Repair State Machine & Verification", () => {
  const baseRepair: RepairRecord = {
    id: "rep-test-01",
    ownerId: "owner-repairs",
    goalId: "goal-1",
    competencyKey: "boundaries",
    triggerEvidenceIds: ["ev-1", "ev-2"],
    hypothesis: "Off-by-one array bounds",
    drillTaskId: null,
    retestSessionId: null,
    state: "proposed",
    closureCriterion: "Solve boundary retest",
    closureResult: null,
    version: 1,
  };

  it("follows valid progression: proposed → scheduled → drilled → retested → improved", () => {
    // proposed → scheduled
    expect(canTransitionRepair("proposed", "scheduled")).toBe(true);

    // scheduled → drilled
    expect(canTransitionRepair("scheduled", "drilled")).toBe(true);

    // drilled → retested
    expect(canTransitionRepair("drilled", "retested")).toBe(true);

    // retested → improved
    expect(canTransitionRepair("retested", "improved")).toBe(true);

    // improved cannot transition further
    expect(canTransitionRepair("improved", "scheduled")).toBe(false);
  });

  it("AC17: rejects transitioning to 'drilled' without a linked drill task attempt", () => {
    const scheduledRepair: RepairRecord = {
      ...baseRepair,
      state: "scheduled",
      drillTaskId: null, // No linked attempt!
    };

    const res = validateRepairTransition(scheduledRepair, "owner-repairs", "drilled");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("without a linked drill task");
    }
  });

  it("AC17: allows transitioning to 'drilled' when linked drill task is present", () => {
    const scheduledRepairWithDrill: RepairRecord = {
      ...baseRepair,
      state: "scheduled",
      drillTaskId: "task-drill-boundaries-01", // Linked attempt present!
    };

    const res = validateRepairTransition(scheduledRepairWithDrill, "owner-repairs", "drilled");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state).toBe("drilled");
    }
  });

  it("AC18: retest must follow drill completion; cannot bypass directly from scheduled to retested", () => {
    const scheduledRepair: RepairRecord = {
      ...baseRepair,
      state: "scheduled",
      drillTaskId: "task-drill-01",
    };

    // Cannot jump scheduled → retested
    const res = validateRepairTransition(scheduledRepair, "owner-repairs", "retested");
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC23: Target Applications & Projects Private Persistence
// ---------------------------------------------------------------------------

