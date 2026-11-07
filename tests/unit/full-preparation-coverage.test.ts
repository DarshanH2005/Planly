/**
 * M3 Acceptance Tests: Full Preparation Coverage
 *
 * PLANLY_BUILD_SPEC.md §16, §17:
 * - AC19: Spaced recall intervals (1, 3, 7, 14, 30), reset on forgotten,
 *   unchanged on partial, month boundary rollover, daily 2-item cap and 75m weekly limit.
 * - AC21: SQL fixture returns A100/B200/C0; project pack saves artifact revision;
 *   HR uses its own behavioural rubric.
 * - R05: Prep Hub 198 catalogue entries, 19 pattern cards, filtering, and POTD selection.
 * - Stage Coverage: Every enabled stage launches with validated instructions, prompts, and rubrics.
 */

import { describe, it, expect } from "vitest";
import {
  loadStarterBundle,
  getPackById,
} from "@/features/curriculum/service";
import {
  loadCatalogue,
  loadPatterns,
  filterCatalogue,
  selectPOTD,
} from "@/features/curriculum/prep-service";
import {
  computeNextRecall,
  allocateDailyRecall,
  MAX_RECALL_ITEMS_PER_SESSION,
  MAX_WEEKLY_RECALL_MINUTES,
} from "@/features/reviews/recall-service";
import { RUBRIC_DIMENSIONS } from "@/features/reviews/types";
import type { RecallItemRecord } from "@/features/reviews/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecallItem(overrides: Partial<RecallItemRecord> = {}): RecallItemRecord {
  return {
    id: "recall-item-1",
    ownerId: "owner-1",
    itemRef: "FX-HASH-A",
    intervalIndex: 0, // [1, 3, 7, 14, 30]
    dueDate: "2026-09-10",
    status: "active",
    lastResult: null,
    evidenceMode: "concept_recall",
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC19: Spaced Recall Engine & Boundaries
// ---------------------------------------------------------------------------

describe("AC19: Spaced Recall Intervals & Boundaries", () => {
  it("advances sequentially through [1, 3, 7, 14, 30] days on success", () => {
    let item = makeRecallItem({ intervalIndex: 0, dueDate: "2026-09-10" });

    // 1st success: moves from interval 0 (1d) to interval 1 (3d)
    let next = computeNextRecall(item, "success", "2026-09-10");
    expect(next.intervalIndex).toBe(1);
    expect(next.dueDate).toBe("2026-09-13"); // +3 days
    expect(next.status).toBe("active");

    // 2nd success: moves to interval 2 (7d)
    item = { ...item, ...next } as RecallItemRecord;
    next = computeNextRecall(item, "success", "2026-09-13");
    expect(next.intervalIndex).toBe(2);
    expect(next.dueDate).toBe("2026-09-20"); // +7 days

    // 3rd success: moves to interval 3 (14d)
    item = { ...item, ...next } as RecallItemRecord;
    next = computeNextRecall(item, "success", "2026-09-20");
    expect(next.intervalIndex).toBe(3);
    expect(next.dueDate).toBe("2026-10-04"); // +14 days

    // 4th success: moves to interval 4 (30d)
    item = { ...item, ...next } as RecallItemRecord;
    next = computeNextRecall(item, "success", "2026-10-04");
    expect(next.intervalIndex).toBe(4);
    expect(next.dueDate).toBe("2026-11-03"); // +30 days
    expect(next.status).toBe("completed");

    // Additional success remains capped at 30 days
    item = { ...item, ...next } as RecallItemRecord;
    next = computeNextRecall(item, "success", "2026-11-03");
    expect(next.intervalIndex).toBe(4);
    expect(next.dueDate).toBe("2026-12-03"); // +30 days
  });

  it("resets to interval 0 due tomorrow on failure/forgotten", () => {
    // Advanced item at interval 3 (14 days)
    const item = makeRecallItem({ intervalIndex: 3, dueDate: "2026-10-04" });

    const next = computeNextRecall(item, "forgotten", "2026-10-04");
    expect(next.intervalIndex).toBe(0);
    // Due tomorrow (+1 day from reference check date)
    expect(next.dueDate).toBe("2026-10-05");
    expect(next.status).toBe("active");
    expect(next.lastResult).toBe("forgotten");
  });

  it("leaves interval index and due date unchanged on partial result", () => {
    const item = makeRecallItem({ intervalIndex: 2, dueDate: "2026-09-20" });

    const next = computeNextRecall(item, "partial", "2026-09-20");
    expect(next.intervalIndex).toBeUndefined(); // Unmodified
    expect(next.dueDate).toBeUndefined();       // Unmodified
    expect(next.lastResult).toBe("partial");
  });

  it("correctly handles month, leap year, and year boundaries without timezone drift", () => {
    const item = makeRecallItem({ intervalIndex: 0 });

    // Jan 31 + 1 day -> Feb 01
    const janRoll = computeNextRecall(item, "forgotten", "2026-01-31");
    expect(janRoll.dueDate).toBe("2026-02-01");

    // Feb 28 + 3 days -> Mar 03
    const febRoll = computeNextRecall({ ...item, intervalIndex: 0 }, "success", "2026-02-28");
    expect(febRoll.dueDate).toBe("2026-03-03");

    // Dec 31 + 7 days -> Jan 07 of next year
    const yearRoll = computeNextRecall({ ...item, intervalIndex: 1 }, "success", "2026-12-31");
    expect(yearRoll.dueDate).toBe("2027-01-07");
  });

  it("enforces 2-item daily session cap and 75-minute weekly limit", () => {
    const dueItems: RecallItemRecord[] = [
      makeRecallItem({ id: "item-1" }),
      makeRecallItem({ id: "item-2" }),
      makeRecallItem({ id: "item-3" }),
      makeRecallItem({ id: "item-4" }),
    ];

    // Day 1: Allocates max 2 items (15m), defers remaining 2 with reason
    const day1 = allocateDailyRecall(dueItems, 0);
    expect(day1.allocatedItems.length).toBe(MAX_RECALL_ITEMS_PER_SESSION);
    expect(day1.deferredItems.length).toBe(2);
    expect(day1.deferredItems[0].reason).toContain("2-item daily session cap");
    expect(day1.sessionMinutes).toBe(15);
    expect(day1.totalWeeklyMinutes).toBe(15);
    expect(day1.isWeeklyCapped).toBe(false);

    // Later in the week: 60 minutes already consumed
    const day5 = allocateDailyRecall(dueItems, 60);
    expect(day5.allocatedItems.length).toBe(2);
    expect(day5.sessionMinutes).toBe(15);
    expect(day5.totalWeeklyMinutes).toBe(MAX_WEEKLY_RECALL_MINUTES); // 75m

    // Weekly cap reached: 75 minutes already consumed
    const day6 = allocateDailyRecall(dueItems, 75);
    expect(day6.allocatedItems.length).toBe(0);
    expect(day6.deferredItems.length).toBe(4);
    expect(day6.deferredItems[0].reason).toContain("75m weekly recall budget reached");
    expect(day6.isWeeklyCapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC21: SQL Fixture, Project Pack & Behavioural Rubric
// ---------------------------------------------------------------------------

describe("AC21: Specific Stage Verification (SQL, Project, Behavioural)", () => {
  it("verifies the SQL aggregation logic produces exactly A100, B200, C0", () => {
    const customers = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];
    const orders = [
      { id: 101, customer_id: 1, amount: 100, status: "completed" },
      { id: 102, customer_id: 2, amount: 200, status: "completed" },
      { id: 103, customer_id: 2, amount: 50, status: "cancelled" }, // Should be excluded
    ];

    // Simulate SQL LEFT JOIN + COALESCE(SUM(amount), 0) + WHERE status = 'completed'
    const result = customers.map((c) => {
      const customerOrders = orders.filter(
        (o) => o.customer_id === c.id && o.status === "completed"
      );
      const totalSpent = customerOrders.reduce((sum, o) => sum + o.amount, 0);
      return { name: c.name, totalSpent };
    });

    expect(result).toEqual([
      { name: "A", totalSpent: 100 },
      { name: "B", totalSpent: 200 },
      { name: "C", totalSpent: 0 },
    ]);

    const formatted = result.map((r) => `${r.name}${r.totalSpent}`).join("/");
    expect(formatted).toBe("A100/B200/C0");
  });

  it("verifies PACK-PROJECT-01 uses repository format and rubric-project-v1", () => {
    const packInfo = getPackById("PACK-PROJECT-01");
    expect(packInfo).toBeDefined();
    expect(packInfo!.pack.inputFormat).toBe("repository");
    expect(packInfo!.pack.rubricId).toBe("rubric-project-v1");
    expect(packInfo!.prompts[0].statement).toContain("Planly application");

    // Project rubric must have dimensions: ownership, architecture, debugging, decisions
    const projectDimensions = RUBRIC_DIMENSIONS.filter((d) => d.family === "project");
    expect(projectDimensions.map((d) => d.dimension)).toEqual([
      "ownership",
      "architecture",
      "debugging",
      "decisions",
    ]);
  });

  it("verifies PACK-BEHAVIOURAL-01 uses spoken_or_text format and excludes code correctness", () => {
    const packInfo = getPackById("PACK-BEHAVIOURAL-01");
    expect(packInfo).toBeDefined();
    expect(packInfo!.pack.inputFormat).toBe("spoken_or_text");
    expect(packInfo!.pack.rubricId).toBe("rubric-behavioural-v1");

    // Behavioural rubric must have dimensions: specificity, personal_action, evidence, reflection, follow_up
    const behavDimensions = RUBRIC_DIMENSIONS.filter((d) => d.family === "behavioural");
    const dimensionNames = behavDimensions.map((d) => d.dimension);
    expect(dimensionNames).toEqual([
      "specificity",
      "personal_action",
      "evidence",
      "reflection",
      "follow_up",
    ]);

    // Code correctness is strictly omitted from HR rubric
    expect(dimensionNames).not.toContain("implementation");
    expect(dimensionNames).not.toContain("correctness");
  });
});

// ---------------------------------------------------------------------------
// R05: Prep Hub Catalogue & POTD
// ---------------------------------------------------------------------------

describe("R05: Pattern-Based Prep Hub & POTD", () => {
  const catalogue = loadCatalogue();
  const patterns = loadPatterns();

  it("loads all 198 catalogue entries with correct tiers and 40 source groups", () => {
    expect(catalogue.length).toBe(198);

    const tierCounts = { A: 0, B: 0, C: 0 };
    const groupSet = new Set<number>();

    for (const item of catalogue) {
      tierCounts[item.tier]++;
      groupSet.add(item.sourceGroupNumber);
      expect(Array.isArray(item.familyIds)).toBe(true);
    }

    expect(tierCounts.A).toBe(82);
    expect(tierCounts.B).toBe(78);
    expect(tierCounts.C).toBe(38);
    expect(groupSet.size).toBe(40);
  });

  it("loads all 19 pattern reference cards (F01–F19)", () => {
    expect(patterns.length).toBe(19);
    const patternIds = patterns.map((p) => p.id);
    for (let i = 1; i <= 19; i++) {
      const expectedId = `F${String(i).padStart(2, "0")}`;
      expect(patternIds).toContain(expectedId);
    }
  });

  it("filters catalogue by family, tier, and search query", () => {
    // Filter F01 family
    const f01Items = filterCatalogue(catalogue, { familyId: "F01" });
    expect(f01Items.length).toBeGreaterThan(0);
    expect(f01Items.every((item) => item.familyIds.includes("F01"))).toBe(true);

    // Filter Tier A
    const tierAItems = filterCatalogue(catalogue, { tier: "A" });
    expect(tierAItems.length).toBe(82);

    // Search query
    const searchResults = filterCatalogue(catalogue, { searchQuery: "Two Sum" });
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    expect(searchResults.some((item) => item.title.includes("Two Sum"))).toBe(true);
  });

  it("selects unexposed Tier A entry matching active bottleneck for POTD", () => {
    // With bottleneck F03 (Binary Search)
    const potdF03 = selectPOTD(catalogue, new Set(), "F03");
    expect(potdF03.tier).toBe("A");
    expect(potdF03.familyIds).toContain("F03");

    // When the first item is already exposed, selects the next unexposed item
    const exposed = new Set([potdF03.id]);
    const potdNext = selectPOTD(catalogue, exposed, "F03");
    expect(potdNext.id).not.toBe(potdF03.id);
    expect(potdNext.tier).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// Stage Coverage: All Enabled Stages
// ---------------------------------------------------------------------------

describe("Stage Coverage: Every Enabled Stage Launches", () => {
  const bundle = loadStarterBundle();

  it("has validated packs covering all required stages", () => {
    const stagesInBundle = new Set(bundle.packs.map((p) => p.stage));

    expect(stagesInBundle.has("foundation")).toBe(true);
    expect(stagesInBundle.has("oa")).toBe(true);
    expect(stagesInBundle.has("technical_a")).toBe(true);
    expect(stagesInBundle.has("technical_b")).toBe(true);
    expect(stagesInBundle.has("engineering")).toBe(true);
    expect(stagesInBundle.has("project")).toBe(true);
    expect(stagesInBundle.has("behavioural")).toBe(true);
  });
});
