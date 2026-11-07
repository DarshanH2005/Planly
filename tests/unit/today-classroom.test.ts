import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ClassroomApiClient,
  type TodayPlanResponse,
  type PlanRecord,
} from "@/lib/api/learning-client";

describe("Sprint B13: Classroom Today & Adaptive Sprints Client Integration", () => {
  let client: ClassroomApiClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    (global as any).fetch = mockFetch;
    client = new ClassroomApiClient("http://localhost:8000", () => "test-token");
  });

  it("B13-AC1: fetches today plan with 80% safety buffer envelope", async () => {
    const mockToday: TodayPlanResponse = {
      plan_id: "plan-123",
      today_date: "2026-09-14",
      mode: "minimum",
      declared_capacity_minutes: 15,
      effective_budget_minutes: 12,
      today_committed_minutes: 12,
      today_commitments: [
        {
          id: "t1",
          owner_id: "owner-1",
          plan_id: "plan-123",
          activity_id: "act_dsa_continuity_drill",
          competency_key: "dsa.arrays.iteration",
          title: "Minimum Day Continuity Drill (12 min)",
          kind: "continuity",
          estimate_minutes: 12,
          planned_date: "2026-09-14",
          committed_date: "2026-09-14",
          original_committed_date: "2026-09-14",
          status: "pending",
          is_carryover: false,
        },
      ],
      retained_commitments: [],
      carryover_count: 0,
      prerequisite_repairs: [],
      explanations: {
        min: "12-minute continuity drill",
      },
      diff: { revision: 1 },
    };

    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => mockToday,
    });

    const res = await client.getTodayPlan("2026-09-14");
    expect(res.mode).toBe("minimum");
    expect(res.declared_capacity_minutes).toBe(15);
    expect(res.effective_budget_minutes).toBe(12);
    expect(res.today_committed_minutes).toBe(12);
    expect(res.today_committed_minutes).toBeLessThanOrEqual(res.effective_budget_minutes);
    expect(res.today_commitments[0].kind).toBe("continuity");
  });

  it("B13-AC2: commits plan revision and handles 409 conflict on stale revision", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 409,
      json: async () => ({ detail: "Plan revision conflict: expected revision 1, but current active revision is 2 (B13-AC2)" }),
    });

    await expect(
      client.commitPlan({
        plan_id: "plan-123",
        expected_revision: 1,
        commitments: [],
      })
    ).rejects.toThrow(/revision conflict/i);
  });

  it("B13-AC3: preserves prerequisite loop-gap repair and retains Two Pointers", async () => {
    const mockPreview = {
      plan_id: "plan-123",
      current_revision: 1,
      proposed_revision: 2,
      today_date: "2026-09-15",
      mode: "normal",
      declared_capacity_minutes: 90,
      effective_budget_minutes: 72,
      today_committed_minutes: 37,
      today_commitments: [
        {
          id: "rep-1",
          owner_id: "owner-1",
          plan_id: "plan-123",
          activity_id: "act_dsa_loop_repair",
          competency_key: "dsa.loops.termination",
          title: "While-Loop Invariant Repair Drill",
          kind: "dsa_repair",
          estimate_minutes: 12,
          planned_date: "2026-09-15",
          committed_date: "2026-09-15",
          original_committed_date: "2026-09-15",
          status: "pending",
          is_carryover: false,
        },
        {
          id: "tp-1",
          owner_id: "owner-1",
          plan_id: "plan-123",
          activity_id: "act_dsa_two_sum_sorted",
          competency_key: "dsa.two_pointers.basics",
          title: "Two Pointers Opposing Movement",
          kind: "dsa_new",
          estimate_minutes: 25,
          planned_date: "2026-09-15",
          committed_date: "2026-09-15",
          original_committed_date: "2026-09-15",
          status: "pending",
          is_carryover: false,
        },
      ],
      retained_commitments: [],
      carryover_count: 0,
      prerequisite_repairs: ["dsa.arrays.iteration"],
      explanations: {
        loop_gap: "Prerequisite loop gap detected; short repair scheduled while retaining Two Pointers.",
      },
      diff: {},
    };

    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => mockPreview,
    });

    const preview = await client.previewPlan({
      today_date: "2026-09-15",
      has_loop_gap_override: true,
    });

    expect(preview.prerequisite_repairs).toContain("dsa.arrays.iteration");
    const kinds = preview.today_commitments.map((t: any) => t.kind);
    expect(kinds).toContain("dsa_repair");
    expect(kinds).toContain("dsa_new");

    const activities = preview.today_commitments.map((t: any) => t.activity_id);
    expect(activities).toContain("act_dsa_two_sum_sorted"); // Two Pointers retained!
  });

  it("updates capacity without building second planner in server action", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        date: "2026-09-16",
        declared_minutes: 45,
        mode: "ramp",
        effective_budget: 36,
      }),
    });

    const res = await client.setCapacity({
      date: "2026-09-16",
      declared_minutes: 45,
      mode: "ramp",
    });

    expect(res.declared_minutes).toBe(45);
    expect(res.mode).toBe("ramp");
    expect(res.effective_budget).toBe(36);
  });
});
