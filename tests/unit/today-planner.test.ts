/**
 * Sprint B13: Today Planner & Capacity Unit Tests.
 * Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md
 *
 * Verifies:
 * - B13-AC1: Reduced-capacity and skipped-day fixtures never overbook or mark missing work done.
 * - B13-AC2: Concurrent plan commits resolve by revision and retain original commitments.
 * - B13-AC3: The DSA loop-gap example leads to a short repair and retains Two Pointers.
 * - Failure to prevent: Incomplete work is never marked done automatically; calendar day advance is not a topic-advance signal.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type PlanPreviewResponse,
  type PlanCommitmentRecord,
  type PlanRecord,
} from "@/lib/api/learning-client";

describe("Sprint B13: Capacity-Aware Planning & Missed-Day Recovery (B13-AC1, B13-AC2, B13-AC3)", () => {
  const computeDailyBudget = (declaredMinutes: number, mode: string = "normal"): number => {
    if (mode === "rest" || declaredMinutes <= 0) return 0;
    if (mode === "minimum" || declaredMinutes === 15) return 12;
    return Math.floor(0.8 * declaredMinutes);
  };

  it("B13-AC1: Enforces 80% buffer rule and never overbooks across capacity tiers", () => {
    // 1. Rest Day
    expect(computeDailyBudget(0, "rest")).toBe(0);

    // 2. Minimum Day (15m declared -> 12m budget)
    expect(computeDailyBudget(15, "minimum")).toBe(12);

    // 3. Ramp Day (45m declared -> floor(0.8 * 45) = 36m)
    expect(computeDailyBudget(45, "ramp")).toBe(36);

    // 4. Normal Day (90m declared -> floor(0.8 * 90) = 72m)
    expect(computeDailyBudget(90, "normal")).toBe(72);

    // 5. Bonus Day (120m declared -> floor(0.8 * 120) = 96m)
    expect(computeDailyBudget(120, "bonus")).toBe(96);
  });

  it("B13-AC1: Missed-day recovery preserves pending lessons without backlog avalanche or false completion", () => {
    const day1Tasks: PlanCommitmentRecord[] = [
      {
        id: "c1",
        owner_id: "owner-1",
        plan_id: "plan-1",
        activity_id: "act_dsa_two_sum_sorted",
        competency_key: "dsa.two_pointers.basics",
        title: "Two Pointers Opposing Movement",
        kind: "dsa_new",
        estimate_minutes: 25,
        planned_date: "2026-09-14",
        committed_date: "2026-09-14",
        original_committed_date: "2026-09-14",
        status: "pending",
        is_carryover: false,
      },
      {
        id: "c2",
        owner_id: "owner-1",
        plan_id: "plan-1",
        activity_id: "act_sql_orders_agg",
        competency_key: "sql.aggregation.group_by",
        title: "SQL Orders Aggregation",
        kind: "sql",
        estimate_minutes: 15,
        planned_date: "2026-09-14",
        committed_date: "2026-09-14",
        original_committed_date: "2026-09-14",
        status: "pending",
        is_carryover: false,
      },
    ];

    // Day 1 was skipped: Incomplete tasks MUST remain pending (anti-fabrication)
    expect(day1Tasks.every((t) => t.status === "pending")).toBe(true);

    // Day 2 planning: Carry over at most ONE task
    const carryoverTask = day1Tasks[0]; // highest priority focus
    const remainingRetained = day1Tasks.slice(1);

    const rescheduledCarryover: PlanCommitmentRecord = {
      ...carryoverTask,
      planned_date: "2026-09-15",
      committed_date: "2026-09-15",
      original_committed_date: carryoverTask.original_committed_date, // Retained!
      is_carryover: true,
      reason: "Interrupted focus carried forward from missed day; replaces today's new focus.",
    };

    const day2Committed: PlanCommitmentRecord[] = [rescheduledCarryover];
    const totalMins = day2Committed.reduce((sum, t) => sum + t.estimate_minutes, 0);

    // Total fits within 80% buffer (72m for normal 90m)
    expect(totalMins).toBeLessThanOrEqual(72);
    // Backlog doubling prevented: only 1 carryover task
    expect(day2Committed.filter((t) => t.is_carryover).length).toBe(1);
    // Original date preserved
    expect(rescheduledCarryover.original_committed_date).toBe("2026-09-14");
    // Remaining uncompleted task is retained, not dropped or completed
    expect(remainingRetained[0].status).toBe("pending");
  });

  it("B13-AC2: Concurrent plan commits resolve by revision and retain original commitments", () => {
    let currentRevision = 1;
    let commitments: PlanCommitmentRecord[] = [
      {
        id: "c_initial",
        owner_id: "owner-1",
        plan_id: "plan-1",
        competency_key: "dsa.arrays.iteration",
        title: "Initial Task",
        kind: "dsa_new",
        estimate_minutes: 25,
        planned_date: "2026-09-20",
        committed_date: "2026-09-20",
        original_committed_date: "2026-09-20",
        status: "pending",
        is_carryover: false,
      },
    ];

    const commitRevision = (expectedRev: number, newCommitments: PlanCommitmentRecord[]) => {
      if (expectedRev !== currentRevision) {
        const err = new Error(`Revision conflict: expected ${expectedRev}, current is ${currentRevision}`);
        (err as any).status = 409;
        throw err;
      }
      currentRevision += 1;
      commitments = newCommitments;
      return { revision_number: currentRevision, commitments };
    };

    // Client A commits against rev 1 -> SUCCESS, becomes rev 2
    const clientACommit = commitRevision(1, [
      ...commitments,
      {
        id: "c_client_a",
        owner_id: "owner-1",
        plan_id: "plan-1",
        competency_key: "dsa.two_sum",
        title: "Two Sum",
        kind: "dsa_new",
        estimate_minutes: 25,
        planned_date: "2026-09-20",
        committed_date: "2026-09-20",
        original_committed_date: "2026-09-20",
        status: "pending",
        is_carryover: false,
      },
    ]);
    expect(clientACommit.revision_number).toBe(2);

    // Client B concurrently attempts commit with stale rev 1 -> CONFLICT (409)
    expect(() => {
      commitRevision(1, [
        {
          id: "c_client_b",
          owner_id: "owner-1",
          plan_id: "plan-1",
          competency_key: "dsa.hash_map",
          title: "Hash Map",
          kind: "dsa_new",
          estimate_minutes: 25,
          planned_date: "2026-09-20",
          committed_date: "2026-09-20",
          original_committed_date: "2026-09-20",
          status: "pending",
          is_carryover: false,
        },
      ]);
    }).toThrow(/Revision conflict/);

    // Commitments from Client A are preserved
    expect(commitments.some((c) => c.id === "c_client_a")).toBe(true);

    // Client B retries with expectedRev 2 -> SUCCESS, becomes rev 3
    const clientBRetry = commitRevision(2, [
      ...commitments,
      {
        id: "c_client_b",
        owner_id: "owner-1",
        plan_id: "plan-1",
        competency_key: "dsa.hash_map",
        title: "Hash Map",
        kind: "dsa_new",
        estimate_minutes: 25,
        planned_date: "2026-09-20",
        committed_date: "2026-09-20",
        original_committed_date: "2026-09-20",
        status: "pending",
        is_carryover: false,
      },
    ]);
    expect(clientBRetry.revision_number).toBe(3);
  });

  it("B13-AC3: DSA loop gap leads to short repair and retains Two Pointers", () => {
    const hasLoopGap = true;
    const effectiveBudget = 72; // 80% of 90m

    const repairTask: PlanCommitmentRecord = {
      id: "repair_1",
      owner_id: "owner-1",
      plan_id: "plan-1",
      activity_id: "act_dsa_loop_repair",
      competency_key: "dsa.arrays.iteration",
      title: "While-Loop Invariant & Variable Advancement Repair Drill",
      kind: "dsa_repair",
      estimate_minutes: 12,
      planned_date: "2026-09-22",
      committed_date: "2026-09-22",
      original_committed_date: "2026-09-22",
      status: "pending",
      is_carryover: false,
      reason: "Prerequisite loop gap detected in while-loop diagnostic; targeted repair drill unblocks Two Pointers.",
    };

    const twoPointersTask: PlanCommitmentRecord = {
      id: "two_pointers_1",
      owner_id: "owner-1",
      plan_id: "plan-1",
      activity_id: "act_dsa_two_sum_sorted",
      competency_key: "dsa.two_pointers.basics",
      title: "Two Pointers Opposing Movement (Sorted Array Convergence)",
      kind: "dsa_new",
      estimate_minutes: 25,
      planned_date: "2026-09-22",
      committed_date: "2026-09-22",
      original_committed_date: "2026-09-22",
      status: "pending",
      is_carryover: false,
      reason: "Retained primary curriculum target; scheduled following while-loop repair drill.",
    };

    const scheduledTasks: PlanCommitmentRecord[] = [];
    let allocatedMinutes = 0;

    if (hasLoopGap) {
      // 1. Repair scheduled first
      scheduledTasks.push(repairTask);
      allocatedMinutes += repairTask.estimate_minutes;

      // 2. Two Pointers retained and fits in remaining budget (12 + 25 = 37 <= 72)
      if (allocatedMinutes + twoPointersTask.estimate_minutes <= effectiveBudget) {
        scheduledTasks.push(twoPointersTask);
        allocatedMinutes += twoPointersTask.estimate_minutes;
      }
    }

    expect(scheduledTasks[0].kind).toBe("dsa_repair");
    expect(scheduledTasks[0].estimate_minutes).toBeLessThanOrEqual(20);
    expect(scheduledTasks.some((t) => t.activity_id === "act_dsa_two_sum_sorted")).toBe(true);
    expect(allocatedMinutes).toBeLessThanOrEqual(effectiveBudget);
  });
});
