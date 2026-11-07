import { describe, it, expect } from "vitest";
import {
  validateRepairTransition,
  canTransitionRepair,
} from "@/features/reviews/rules";
import type {
  RetestSessionSummary,
  RepairTransitionOptions,
} from "@/features/reviews/rules";
import type { RepairRecord } from "@/features/reviews/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepair(overrides: Partial<RepairRecord> = {}): RepairRecord {
  return {
    id: "repair-test-001",
    ownerId: "owner-1",
    goalId: "goal-1",
    competencyKey: "implementation",
    triggerEvidenceIds: ["ev-001"],
    hypothesis: "Test hypothesis",
    drillTaskId: "drill-session-001",
    retestSessionId: null,
    state: "proposed",
    closureCriterion: "Complete unfamiliar implementation unassisted",
    closureResult: null,
    version: 1,
    ...overrides,
  };
}

function makeSession(overrides: Partial<RetestSessionSummary> = {}): RetestSessionSummary {
  return {
    id: "retest-session-001",
    ownerId: "owner-1",
    state: "finalized",
    familiarity: "unseen_declared",
    isAssisted: false,
    outcome: undefined,
    ...overrides,
  };
}

function makeLookup(
  sessions: Record<string, RetestSessionSummary>,
): (id: string) => RetestSessionSummary | null {
  return (id: string) => sessions[id] ?? null;
}

// ---------------------------------------------------------------------------
// §10.2 Evidence gate: the audit's critical failure
// ---------------------------------------------------------------------------

describe("repair evidence gate — audit failure scenario", () => {
  it("MUST reject retested with a nonexistent retest session ID", () => {
    // This is the exact audit failure: using a nonexistent session ID
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "does-not-exist",
    });

    const lookup = makeLookup({}); // empty — no sessions exist

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.message).toContain("does not exist");
    }
  });

  it("MUST reject improved without any closure result", () => {
    const repair = makeRepair({
      state: "retested",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const result = validateRepairTransition(repair, "owner-1", "improved", {
      // No closureResult provided
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.message).toContain("closure result");
    }
  });

  it("MUST reject the full audit path: nonexistent drill → retested → improved", () => {
    // Step 1: proposed → scheduled (should work)
    const repair1 = makeRepair({ state: "proposed" });
    const r1 = validateRepairTransition(repair1, "owner-1", "scheduled");
    expect(r1.ok).toBe(true);

    // Step 2: scheduled → drilled with a drill ID (should work)
    const repair2 = makeRepair({
      state: "scheduled",
      drillTaskId: "does-not-exist",
    });
    const r2 = validateRepairTransition(repair2, "owner-1", "drilled");
    expect(r2.ok).toBe(true);

    // Step 3: drilled → retested with nonexistent session (MUST FAIL)
    const repair3 = makeRepair({
      state: "drilled",
      drillTaskId: "does-not-exist",
      retestSessionId: "also-does-not-exist",
    });
    const lookup = makeLookup({});
    const r3 = validateRepairTransition(repair3, "owner-1", "retested", {
      sessionLookup: lookup,
    });
    expect(r3.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §10.2 Retest session validation — individual checks
// ---------------------------------------------------------------------------

describe("repair retest session validation", () => {
  it("rejects retested without a retestSessionId", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: null,
    });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: makeLookup({}),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("linked retest session");
    }
  });

  it("rejects retested when retest session is the same as drill session", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "drill-session-001", // Same as drill!
    });

    const session = makeSession({ id: "drill-session-001" });
    const lookup = makeLookup({ "drill-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("distinct from the drill");
    }
  });

  it("rejects retested with a familiar retest session", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ familiarity: "familiar" });
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("unfamiliar");
    }
  });

  it("rejects retested with an assisted retest session", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ isAssisted: true });
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("unassisted");
    }
  });

  it("rejects retested when retest session is still running", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ state: "running" });
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("finalized or reviewed");
    }
  });

  it("rejects retested when session belongs to different owner", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ ownerId: "different-owner" });
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUTH_ERROR");
    }
  });

  it("rejects retested when no session lookup is provided", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    // No sessionLookup at all
    const result = validateRepairTransition(repair, "owner-1", "retested");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Session lookup is required");
    }
  });
});

// ---------------------------------------------------------------------------
// §10.2 Improved transition — closure evidence
// ---------------------------------------------------------------------------

describe("repair improved transition — closure evidence", () => {
  it("rejects improved with empty closure result", () => {
    const repair = makeRepair({
      state: "retested",
      retestSessionId: "retest-session-001",
    });

    const result = validateRepairTransition(repair, "owner-1", "improved", {
      closureResult: "   ", // whitespace only
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("closure result");
    }
  });

  it("rejects improved when retest session is not reviewed", () => {
    const repair = makeRepair({
      state: "retested",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ state: "finalized" }); // not reviewed
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "improved", {
      closureResult: "Demonstrated transfer",
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("reviewed");
    }
  });

  it("accepts improved with valid closure result and reviewed session", () => {
    const repair = makeRepair({
      state: "retested",
      drillTaskId: "drill-session-001",
      retestSessionId: "retest-session-001",
    });

    const session = makeSession({ state: "reviewed" });
    const lookup = makeLookup({ "retest-session-001": session });

    const result = validateRepairTransition(repair, "owner-1", "improved", {
      closureResult: "Solved unfamiliar medium-difficulty boundary problem unassisted in 22 minutes.",
      sessionLookup: lookup,
    });

    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10.2 Happy path — valid full lifecycle
// ---------------------------------------------------------------------------

describe("repair full lifecycle — valid evidence", () => {
  it("completes the full repair cycle with valid evidence at each step", () => {
    // proposed → scheduled
    const r1 = validateRepairTransition(
      makeRepair({ state: "proposed" }),
      "owner-1",
      "scheduled",
    );
    expect(r1.ok).toBe(true);

    // scheduled → drilled (with drill task)
    const r2 = validateRepairTransition(
      makeRepair({ state: "scheduled", drillTaskId: "drill-001" }),
      "owner-1",
      "drilled",
    );
    expect(r2.ok).toBe(true);

    // drilled → retested (with valid unfamiliar session)
    const retestSession = makeSession({
      id: "retest-001",
      state: "finalized",
      familiarity: "unseen_declared",
      isAssisted: false,
    });
    const r3 = validateRepairTransition(
      makeRepair({
        state: "drilled",
        drillTaskId: "drill-001",
        retestSessionId: "retest-001",
      }),
      "owner-1",
      "retested",
      { sessionLookup: makeLookup({ "retest-001": retestSession }) },
    );
    expect(r3.ok).toBe(true);

    // retested → improved (with closure result and reviewed session)
    const reviewedSession = makeSession({
      id: "retest-001",
      state: "reviewed",
    });
    const r4 = validateRepairTransition(
      makeRepair({
        state: "retested",
        drillTaskId: "drill-001",
        retestSessionId: "retest-001",
      }),
      "owner-1",
      "improved",
      {
        closureResult: "Demonstrated unassisted transfer on unfamiliar boundary problem.",
        sessionLookup: makeLookup({ "retest-001": reviewedSession }),
      },
    );
    expect(r4.ok).toBe(true);
  });

  it("allows retested with a reviewed (not just finalized) session", () => {
    const repair = makeRepair({
      state: "drilled",
      drillTaskId: "drill-001",
      retestSessionId: "retest-001",
    });

    const session = makeSession({ state: "reviewed" });
    const result = validateRepairTransition(repair, "owner-1", "retested", {
      sessionLookup: makeLookup({ "retest-001": session }),
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Existing state machine tests (backward compatibility)
// ---------------------------------------------------------------------------

describe("repair state machine — backward compatibility", () => {
  it("still rejects invalid state transitions", () => {
    expect(canTransitionRepair("proposed", "drilled")).toBe(false);
    expect(canTransitionRepair("proposed", "improved")).toBe(false);
    expect(canTransitionRepair("scheduled", "retested")).toBe(false);
    expect(canTransitionRepair("improved", "proposed")).toBe(false);
  });

  it("still allows deferred from any active state", () => {
    for (const state of ["proposed", "scheduled", "drilled", "retested"] as const) {
      expect(canTransitionRepair(state, "deferred")).toBe(true);
    }
  });

  it("still requires drillTaskId for drilled transition", () => {
    const repair = makeRepair({
      state: "scheduled",
      drillTaskId: null,
    });
    const result = validateRepairTransition(repair, "owner-1", "drilled");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("drill task");
    }
  });

  it("still allows deferred without session lookup", () => {
    const repair = makeRepair({ state: "drilled" });
    const result = validateRepairTransition(repair, "owner-1", "deferred");
    expect(result.ok).toBe(true);
  });
});
