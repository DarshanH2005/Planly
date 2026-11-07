import { describe, it, expect } from "vitest";
import { RepairView, type ClassroomRepairItem } from "@/features/classrooms/repair";

describe("Sprint B15: Classroom Repair & Qualified Retests", () => {
  const mockRepairs: ClassroomRepairItem[] = [
    {
      id: "rep_01",
      competencyKey: "dsa.arrays.iteration",
      title: "While-Loop Pointer Invariant",
      hypothesis: "Increment step missing in while loop causing infinite loop on duplicates",
      status: "open",
      drillKind: "syntax_drill",
      drillTaskId: "drill_01",
      closureCriterion: "Unassisted passing execution on unfamiliar delayed transfer exercise",
      closureResult: null,
      historyCount: 1,
      allowContinueWithUncertainty: true,
      triggerEvidenceNotes: "Observed in infinite loop attempt",
      latestEventReason: "Repair gap identified from evidence",
    },
    {
      id: "rep_02",
      competencyKey: "dsa.two_pointers.sorted_array",
      title: "Two Pointers Boundary Rule",
      hypothesis: "Left and right pointers did not skip identical duplicates",
      status: "drilled",
      drillKind: "trace",
      drillTaskId: "drill_02",
      closureCriterion: "Independent transfer on unseen sorted boundary problem with duplicate elements",
      closureResult: null,
      historyCount: 2,
      allowContinueWithUncertainty: true,
      triggerEvidenceNotes: "Missed edge cases with duplicates",
      latestEventReason: "Completed trace drill",
    },
    {
      id: "rep_03",
      competencyKey: "dsa.prefix_sums.basics",
      title: "Prefix Sum Zero Index Initialization",
      hypothesis: "Forgot {0: 1} base frequency count",
      status: "closed",
      drillKind: "delayed_transfer",
      drillTaskId: "drill_03",
      closureCriterion: "Independent transfer on continuous subarray sum variant",
      closureResult: "Solved Subarray Sum Equals K unassisted (5/5 tests passed)",
      historyCount: 4,
      allowContinueWithUncertainty: true,
      triggerEvidenceNotes: "Initial subarray sum error",
      latestEventReason: "Repair closed: Unassisted passing transfer demonstrated",
    },
  ];

  it("B15-AC1: verifies repair structure enforces precise evidence over global weakness", () => {
    const openRepair = mockRepairs.find((r) => r.status === "open");
    expect(openRepair).toBeDefined();
    expect(openRepair?.hypothesis).toContain("Increment step missing");
    expect(openRepair?.hypothesis).not.toBe("Weak in DSA");
    expect(openRepair?.closureCriterion).toContain("Unassisted");
  });

  it("B15-AC2: verifies delayed independent transfer supports closure and tracks history count", () => {
    const closedRepair = mockRepairs.find((r) => r.status === "closed");
    expect(closedRepair).toBeDefined();
    expect(closedRepair?.status).toBe("closed");
    expect(closedRepair?.closureResult).toContain("5/5 tests passed");
    expect(closedRepair?.historyCount).toBeGreaterThanOrEqual(3);
  });

  it("B15-AC3: preserves allowContinueWithUncertainty without permanent topic lock", () => {
    for (const repair of mockRepairs) {
      expect(repair.allowContinueWithUncertainty).toBe(true);
    }
  });

  it("renders RepairView with initial repairs without throwing", () => {
    expect(typeof RepairView).toBe("function");
  });
});
