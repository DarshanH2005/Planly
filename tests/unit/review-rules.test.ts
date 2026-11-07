/**
 * Review, Repair, and Recall Rules Tests
 *
 * PLANLY_BUILD_SPEC.md §10
 */

import { describe, it, expect } from "vitest";
import {
  validateSubmitReview,
  canTransitionRepair,
  validateRepairTransition,
  computeNextRecall,
  shouldTriggerRepair,
} from "@/features/reviews/rules";
import { RECALL_INTERVALS } from "@/features/reviews/types";
import type { SessionRecord } from "@/features/sessions/types";
import type { ReviewRecord, RepairRecord, RecallItemRecord, CompetencyEvidenceRecord } from "@/features/reviews/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    ownerId: "owner-1",
    taskId: "task-1",
    goalId: "goal-1",
    stage: "foundation",
    mode: "practice",
    evaluatorMode: "scripted_solo",
    packId: "pack-1",
    packVersion: 1,
    rubricId: "rubric-1",
    rubricVersion: 1,
    bundleHash: "abc123",
    resourcePolicy: { docs: false, ai: false, hints: false, notes: true },
    state: "finalized",
    finishReason: "submitted",
    startedAt: "2026-09-14T10:00:00Z",
    deadlineAt: "2026-09-14T11:30:00Z",
    finalizedAt: "2026-09-14T11:00:00Z",
    isInterrupted: false,
    isAssisted: false,
    linkedPriorSessionId: null,
    cancelReason: null,
    version: 3,
    ...overrides,
  };
}

function makeRepair(overrides: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: "repair-1",
    ownerId: "owner-1",
    goalId: "goal-1",
    competencyKey: "boundaries",
    triggerEvidenceIds: ["ev-1"],
    hypothesis: "Misses off-by-one edge cases",
    drillTaskId: null,
    retestSessionId: null,
    state: "proposed",
    closureCriterion: "Pass unfamiliar boundary task",
    closureResult: null,
    version: 1,
    ...overrides,
  };
}

function makeRecallItem(overrides: Partial<RecallItemRecord> = {}): RecallItemRecord {
  return {
    id: "recall-1",
    ownerId: "owner-1",
    itemRef: "F01:hash-map-basics",
    intervalIndex: 0,
    dueDate: "2026-09-15",
    status: "active",
    lastResult: null,
    evidenceMode: "concept_recall",
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Review submission
// ---------------------------------------------------------------------------

describe("validateSubmitReview", () => {
  it("succeeds with valid evidence and learning card", () => {
    const session = makeSession({ state: "finalized" });
    const result = validateSubmitReview(session, [], {
      sessionId: "session-1",
      ownerId: "owner-1",
      rubricId: "rubric-1",
      rubricVersion: 1,
      evidence: [
        {
          attemptId: "attempt-1",
          competencyKey: "implementation",
          dimension: "implementation",
          rating: 2,
          observation: "Correct solution with clean code",
        },
      ],
      learningCard: {
        attemptId: "attempt-1",
        initialIdea: "Brute force O(n²)",
        failure: "TLE on large input",
        correctedInsight: "Use hash map for O(n) lookup",
        lesson: "Always check for hash map optimization on lookup problems",
      },
      noActionReason: "No repair needed — met criteria independently",
      serverNow: "2026-09-14T11:15:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.review.revision).toBe(1);
      expect(result.data.evidence.length).toBe(1);
      expect(result.data.learningCard.lesson).toContain("hash map");
      expect(result.data.repairProposal).toBeNull();
    }
  });

  it("rejects rating without observation", () => {
    const session = makeSession({ state: "finalized" });
    const result = validateSubmitReview(session, [], {
      sessionId: "session-1",
      ownerId: "owner-1",
      rubricId: "rubric-1",
      rubricVersion: 1,
      evidence: [
        {
          attemptId: "attempt-1",
          competencyKey: "implementation",
          dimension: "implementation",
          rating: 1,
          observation: "", // empty — invalid per §10.1
        },
      ],
      learningCard: {
        attemptId: "attempt-1",
        initialIdea: "",
        failure: "",
        correctedInsight: "",
        lesson: "lesson",
      },
      noActionReason: "No action",
      serverNow: "2026-09-14T11:15:00Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects review without repair or no-action reason", () => {
    const session = makeSession({ state: "finalized" });
    const result = validateSubmitReview(session, [], {
      sessionId: "session-1",
      ownerId: "owner-1",
      rubricId: "rubric-1",
      rubricVersion: 1,
      evidence: [],
      learningCard: {
        attemptId: "attempt-1",
        initialIdea: "",
        failure: "",
        correctedInsight: "",
        lesson: "lesson",
      },
      // No repairProposal AND no noActionReason
      serverNow: "2026-09-14T11:15:00Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects review on running session", () => {
    const session = makeSession({ state: "running" });
    const result = validateSubmitReview(session, [], {
      sessionId: "session-1",
      ownerId: "owner-1",
      rubricId: "rubric-1",
      rubricVersion: 1,
      evidence: [],
      learningCard: {
        attemptId: "attempt-1",
        initialIdea: "",
        failure: "",
        correctedInsight: "",
        lesson: "lesson",
      },
      noActionReason: "No action",
      serverNow: "2026-09-14T11:15:00Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_STATE");
  });

  it("increments revision on superseding review", () => {
    const session = makeSession({ state: "reviewed" });
    const existing: ReviewRecord[] = [
      {
        id: "rev-1",
        ownerId: "owner-1",
        sessionId: "session-1",
        revision: 1,
        supersedesId: null,
        rubricId: "rubric-1",
        rubricVersion: 1,
        evaluator: "owner",
        source: "self",
        status: "submitted",
        noActionReason: "No action",
      },
    ];

    const result = validateSubmitReview(session, existing, {
      sessionId: "session-1",
      ownerId: "owner-1",
      rubricId: "rubric-1",
      rubricVersion: 1,
      evidence: [],
      learningCard: {
        attemptId: "attempt-1",
        initialIdea: "",
        failure: "",
        correctedInsight: "",
        lesson: "lesson",
      },
      noActionReason: "Updated assessment",
      supersedesReviewId: "rev-1",
      serverNow: "2026-09-14T12:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.review.revision).toBe(2);
      expect(result.data.review.supersedesId).toBe("rev-1");
    }
  });
});

// ---------------------------------------------------------------------------
// Repair state transitions
// ---------------------------------------------------------------------------

describe("repair transitions", () => {
  it("allows proposed → scheduled", () => {
    expect(canTransitionRepair("proposed", "scheduled")).toBe(true);
  });
  it("allows scheduled → drilled", () => {
    expect(canTransitionRepair("scheduled", "drilled")).toBe(true);
  });
  it("allows drilled → retested", () => {
    expect(canTransitionRepair("drilled", "retested")).toBe(true);
  });
  it("allows retested → improved", () => {
    expect(canTransitionRepair("retested", "improved")).toBe(true);
  });
  it("rejects proposed → drilled (skipping scheduled)", () => {
    expect(canTransitionRepair("proposed", "drilled")).toBe(false);
  });
  it("rejects drilled without drill task", () => {
    const repair = makeRepair({ state: "scheduled", drillTaskId: null });
    const result = validateRepairTransition(repair, "owner-1", "drilled");
    expect(result.ok).toBe(false);
  });
  it("allows drilled with drill task", () => {
    const repair = makeRepair({ state: "scheduled", drillTaskId: "task-drill-1" });
    const result = validateRepairTransition(repair, "owner-1", "drilled");
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spaced recall
// ---------------------------------------------------------------------------

describe("computeNextRecall", () => {
  it("advances interval on success", () => {
    const item = makeRecallItem({ intervalIndex: 0, dueDate: "2026-09-15" });
    const next = computeNextRecall(item, "success", "2026-09-15");

    expect(next.intervalIndex).toBe(1);
    // Next interval is 3 days → due 2026-09-18
    expect(next.dueDate).toBe("2026-09-18");
    expect(next.lastResult).toBe("success");
  });

  it("resets to interval 0 on forgotten", () => {
    const item = makeRecallItem({ intervalIndex: 3, dueDate: "2026-09-28" });
    const next = computeNextRecall(item, "forgotten", "2026-09-28");

    expect(next.intervalIndex).toBe(0);
    // Due tomorrow
    expect(next.dueDate).toBe("2026-09-29");
    expect(next.lastResult).toBe("forgotten");
  });

  it("leaves unchanged on partial", () => {
    const item = makeRecallItem({ intervalIndex: 2, dueDate: "2026-09-21" });
    const next = computeNextRecall(item, "partial", "2026-09-21");

    expect(next.intervalIndex).toBeUndefined(); // Not changed
    expect(next.dueDate).toBeUndefined();       // Not changed
    expect(next.lastResult).toBe("partial");
  });

  it("caps at max interval (30 days)", () => {
    const item = makeRecallItem({ intervalIndex: 4, dueDate: "2026-10-14" });
    const next = computeNextRecall(item, "success", "2026-10-14");

    expect(next.intervalIndex).toBe(4); // stays at max index
    expect(next.status).toBe("completed");
  });

  it("follows correct interval sequence: 1, 3, 7, 14, 30", () => {
    expect(RECALL_INTERVALS).toEqual([1, 3, 7, 14, 30]);
  });
});

// ---------------------------------------------------------------------------
// Repair trigger detection
// ---------------------------------------------------------------------------

describe("shouldTriggerRepair", () => {
  it("returns diagnostic only for single bad observation", () => {
    const evidence: CompetencyEvidenceRecord[] = [
      {
        id: "ev-1",
        ownerId: "owner-1",
        reviewId: "rev-1",
        attemptId: "att-1",
        competencyKey: "boundaries",
        dimension: "testing_debugging",
        rating: 1,
        observation: "Missed off-by-one",
        evidenceReference: null,
        provenance: "self",
        confidence: "proposed",
        status: "proposed",
      },
    ];

    const result = shouldTriggerRepair("boundaries", evidence);
    expect(result.shouldRepair).toBe(false);
    expect(result.isDiagnosticOnly).toBe(true);
  });

  it("triggers repair for multiple bad observations", () => {
    const evidence: CompetencyEvidenceRecord[] = [
      {
        id: "ev-1",
        ownerId: "owner-1",
        reviewId: "rev-1",
        attemptId: "att-1",
        competencyKey: "boundaries",
        dimension: "testing_debugging",
        rating: 1,
        observation: "Missed off-by-one in arrays",
        evidenceReference: null,
        provenance: "self",
        confidence: "proposed",
        status: "proposed",
      },
      {
        id: "ev-2",
        ownerId: "owner-1",
        reviewId: "rev-2",
        attemptId: "att-2",
        competencyKey: "boundaries",
        dimension: "testing_debugging",
        rating: 0,
        observation: "Empty array not handled",
        evidenceReference: null,
        provenance: "self",
        confidence: "proposed",
        status: "proposed",
      },
    ];

    const result = shouldTriggerRepair("boundaries", evidence);
    expect(result.shouldRepair).toBe(true);
    expect(result.isDiagnosticOnly).toBe(false);
  });

  it("returns no repair for unrelated evidence", () => {
    const evidence: CompetencyEvidenceRecord[] = [
      {
        id: "ev-1",
        ownerId: "owner-1",
        reviewId: "rev-1",
        attemptId: "att-1",
        competencyKey: "implementation", // Different key
        dimension: "implementation",
        rating: 1,
        observation: "Incomplete solution",
        evidenceReference: null,
        provenance: "self",
        confidence: "proposed",
        status: "proposed",
      },
    ];

    const result = shouldTriggerRepair("boundaries", evidence);
    expect(result.shouldRepair).toBe(false);
    expect(result.isDiagnosticOnly).toBe(false);
  });
});
