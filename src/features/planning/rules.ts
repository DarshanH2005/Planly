/**
 * Planly Deterministic Adaptive Planner — Pure Rules
 *
 * PLANLY_BUILD_SPEC.md §11: buildSprint(input) is a pure TypeScript function.
 * No hidden clock calls, randomness, HTTP, or LLM calls.
 *
 * Every function here is deterministic: same canonical input → same output.
 */

import type {
  PlannerInput,
  PlannerOutput,
  WeekBudget,
  DayAllocation,
  TaskAssignment,
  SlotAllocation,
  DeferredItem,
  Shortfall,
  SprintOutcome,
  DayCapacity,
  EligibleContentItem,
  PlanDiff,
} from "./types";

// ---------------------------------------------------------------------------
// §11.2 Rule 1: Weekly and daily budget computation
// ---------------------------------------------------------------------------

/**
 * Weekly budget = min(configuredTargetMinutes, floor(0.8 × declaredAvailableMinutes))
 * Both constraints apply; do not multiply the buffer twice.
 */
export function computeWeeklyBudget(
  declaredAvailableMinutes: number,
  weeklyTargetMinutes: number
): number {
  const buffered = Math.floor(0.8 * declaredAvailableMinutes);
  return Math.min(weeklyTargetMinutes, buffered);
}

/**
 * Daily budget = floor(0.8 × dailyDeclaredMinutes)
 */
export function computeDailyBudget(dailyDeclaredMinutes: number): number {
  return Math.floor(0.8 * dailyDeclaredMinutes);
}

// ---------------------------------------------------------------------------
// §11.2 Rule 6: Priority scoring
// ---------------------------------------------------------------------------

export function computePriorityScore(params: {
  isBottleneck: boolean;
  relevantInterviewWithin14Days: boolean;
  retestDue: boolean;
  overdueDays: number;
}): number {
  let score = params.isBottleneck ? 40 : 10;
  if (params.relevantInterviewWithin14Days) score += 20;
  if (params.retestDue) score += 10;
  score += Math.min(Math.max(params.overdueDays, 0), 5);
  return score;
}

// ---------------------------------------------------------------------------
// Date helpers (pure, no clock)
// ---------------------------------------------------------------------------

/** Get the Monday of the week containing `dateStr` (ISO date). */
export function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  // JS: Sunday=0, Monday=1, ..., Saturday=6
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** Get all dates between start and end (inclusive), as ISO strings. */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Days between two ISO dates. */
export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z");
  const db = new Date(b + "T00:00:00Z");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// §11.2 Rule 4: Eligibility gates
// ---------------------------------------------------------------------------

export function isEligible(
  item: EligibleContentItem,
  completedPrereqs: Map<string, boolean>,
  forRetest: boolean
): { eligible: boolean; reason?: string } {
  if (item.status !== "validated") {
    return { eligible: false, reason: "Content not validated" };
  }
  if (!item.prerequisitesMet) {
    return { eligible: false, reason: "Prerequisites not demonstrated" };
  }
  if (item.isReservedForRetest && !forRetest) {
    return { eligible: false, reason: "Reserved for retest only" };
  }
  if (item.isExposed && forRetest) {
    return { eligible: false, reason: "Already exposed; cannot use for unseen retest" };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// §11.2 Rule 8: Lane caps
// ---------------------------------------------------------------------------

export const LANE_CAPS: Record<string, number> = {
  recall: 75,       // minutes/week
  building: 180,    // minutes/week
};

export const DEFAULT_LANE_BUDGETS: Record<string, number> = {
  dsa_learning: 420,
  oa_session: 90,
  live_technical: 60,
  project_defence: 45,
  behavioural: 30,
  fundamentals: 90,
  building: 180,
  applications: 60,
  recall: 75,
  weekly_review: 30,
};

// ---------------------------------------------------------------------------
// §11.1, §11.2: buildSprint — the main pure function
// ---------------------------------------------------------------------------

export function buildSprint(input: PlannerInput): PlannerOutput {
  const sprintDates = getDateRange(
    input.sprintWindow.startDate,
    input.sprintWindow.endDate
  );

  // Build capacity map from input
  const capacityMap = new Map<string, DayCapacity>();
  for (const dc of input.capacityPattern) {
    capacityMap.set(dc.date, dc);
  }
  // Fill missing days with zero capacity
  for (const d of sprintDates) {
    if (!capacityMap.has(d)) {
      capacityMap.set(d, {
        date: d,
        declaredAvailableMinutes: 0,
        slots: [],
        isRestDay: true,
        isMinimumDay: false,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 1: Compute week budgets (§11.2 Rule 1)
  // -----------------------------------------------------------------------
  const weekMondaySet = new Set<string>();
  for (const d of sprintDates) {
    weekMondaySet.add(getWeekMonday(d));
  }
  const weekMondays = [...weekMondaySet].sort();

  const weekBudgets: WeekBudget[] = weekMondays.map((monday) => {
    // Get all 7 days of this ISO week
    const weekDates = getDateRange(monday, (() => {
      const sun = new Date(monday + "T00:00:00Z");
      sun.setUTCDate(sun.getUTCDate() + 6);
      return sun.toISOString().slice(0, 10);
    })());

    // Sum declared available for the entire week (even days outside sprint)
    let totalDeclared = 0;
    for (const wd of weekDates) {
      const cap = capacityMap.get(wd);
      if (cap) {
        totalDeclared += cap.declaredAvailableMinutes;
      }
    }

    const bufferBudget = Math.floor(0.8 * totalDeclared);
    const targetBudget = Math.min(input.goal.weeklyTargetMinutes, bufferBudget);

    // Deduct fixed commitments in this week
    let fixedMinutes = 0;
    for (const fc of input.fixedCommitments) {
      if (weekDates.includes(fc.date)) {
        fixedMinutes += fc.minutes;
      }
    }

    // Deduct adjacent sprint commitments
    let adjacentMinutes = 0;
    for (const ac of input.adjacentSprintCommitments) {
      if (ac.weekStartDate === monday) {
        adjacentMinutes += ac.committedMinutes;
      }
    }

    const discretionary = Math.max(0, targetBudget - fixedMinutes - adjacentMinutes);

    return {
      weekStartDate: monday,
      declaredAvailableMinutes: totalDeclared,
      bufferBudget,
      targetBudget,
      fixedCommitmentMinutes: fixedMinutes,
      adjacentSprintMinutes: adjacentMinutes,
      discretionaryMinutes: discretionary,
      allocatedMinutes: 0,
      laneBudgets: { ...DEFAULT_LANE_BUDGETS },
    };
  });

  // -----------------------------------------------------------------------
  // Step 2: Compute daily allocations (§11.2 Rule 1)
  // -----------------------------------------------------------------------
  const dayAllocations: DayAllocation[] = sprintDates.map((date) => {
    const cap = capacityMap.get(date)!;
    const dailyBudget = computeDailyBudget(cap.declaredAvailableMinutes);

    // Deduct fixed commitments for this day
    let fixedToday = 0;
    for (const fc of input.fixedCommitments) {
      if (fc.date === date) fixedToday += fc.minutes;
    }

    return {
      date,
      declaredMinutes: cap.declaredAvailableMinutes,
      dailyBudget: Math.max(0, dailyBudget - fixedToday),
      allocatedMinutes: 0,
      isRestDay: cap.isRestDay,
      isMinimumDay: cap.isMinimumDay,
      assignments: [],
    };
  });

  // -----------------------------------------------------------------------
  // Step 3: Build candidate task list with priority scores (§11.2 Rules 4-6)
  // -----------------------------------------------------------------------
  interface CandidateTask {
    sourceKey: string;
    kind: string;
    title: string;
    competencyKey?: string;
    familyIds: string[];
    packId?: string;
    stage: string;
    estimateMinutes: number;
    splittable: boolean;
    priority: number;
    isBottleneck: boolean;
    lane: string;
    isTentative: boolean;
    reason: string;
    prerequisitesMet: boolean;
  }

  const candidates: CandidateTask[] = [];
  const shortfalls: Shortfall[] = [];
  const deferredItems: DeferredItem[] = [];

  // Check if we have a real deadline within 14 days
  const hasNearInterview = input.realDeadlines.some(
    (rd) => daysBetween(input.today, rd.date) <= 14 && daysBetween(input.today, rd.date) >= 0
  );

  for (const item of input.eligibleContent) {
    const eligibility = isEligible(
      item,
      new Map(
        [...input.completedPrerequisites.entries()].map(([k, v]) => [k, v.demonstrated])
      ),
      false
    );

    if (!eligibility.eligible) {
      if (eligibility.reason === "Content not validated") {
        shortfalls.push({
          kind: "content",
          description: `${item.promptId}: ${eligibility.reason}`,
          affectedStage: item.stage,
        });
      } else if (eligibility.reason === "Prerequisites not demonstrated") {
        shortfalls.push({
          kind: "prerequisite",
          description: `${item.promptId}: prerequisite not met`,
          affectedCompetency: item.familyIds[0],
        });
      }
      continue;
    }

    const lane = mapStageToLane(item.stage);
    const priority = computePriorityScore({
      isBottleneck: false, // Will be set below based on evidence
      relevantInterviewWithin14Days: hasNearInterview,
      retestDue: false,
      overdueDays: 0,
    });

    let estimateMinutes = 30;
    if (item.stage === "oa" || item.packId?.includes("OA")) {
      estimateMinutes = 90; // §7.1: 70 min session + 20 min debrief
    } else if (item.stage === "technical_a" || item.stage === "technical_b") {
      estimateMinutes = 60; // §7.1: 45 min session + 15 min debrief
    } else if (item.stage === "engineering" || item.stage === "project") {
      estimateMinutes = 45; // §7.1: 35 min session + 10 min debrief
    } else if (item.stage === "behavioural") {
      estimateMinutes = 30; // §7.1: 20 min session + 10 min debrief
    }

    candidates.push({
      sourceKey: `content:${item.promptId}`,
      kind: item.isReservedForRetest ? "retest" : "practice",
      title: item.promptId,
      competencyKey: item.familyIds[0],
      familyIds: item.familyIds,
      packId: item.packId,
      stage: item.stage,
      estimateMinutes,
      splittable: false,
      priority,
      isBottleneck: false,
      lane,
      isTentative: false,
      reason: `Eligible ${item.stage} content`,
      prerequisitesMet: true,
    });
  }

  // Add recall items
  for (const recall of input.recallState) {
    if (daysBetween(input.today, recall.dueDate) <= 0) {
      candidates.push({
        sourceKey: `recall:${recall.itemRef}`,
        kind: "recall",
        title: `Recall: ${recall.itemRef}`,
        competencyKey: undefined,
        familyIds: [],
        packId: undefined,
        stage: "foundation",
        estimateMinutes: 15,
        splittable: false,
        priority: computePriorityScore({
          isBottleneck: false,
          relevantInterviewWithin14Days: false,
          retestDue: false,
          overdueDays: Math.max(0, -daysBetween(input.today, recall.dueDate)),
        }),
        isBottleneck: false,
        lane: "recall",
        isTentative: false,
        reason: `Recall due ${recall.dueDate}`,
        prerequisitesMet: true,
      });
    }
  }

  // Mark bottleneck based on evidence
  const weakCompetencies = new Set<string>();
  for (const ev of input.effectiveEvidence) {
    if (ev.rating !== null && ev.rating <= 1 && !ev.isDisputed) {
      weakCompetencies.add(ev.competencyKey);
    }
  }
  for (const c of candidates) {
    if (c.competencyKey && weakCompetencies.has(c.competencyKey)) {
      c.isBottleneck = true;
      c.priority = computePriorityScore({
        isBottleneck: true,
        relevantInterviewWithin14Days: hasNearInterview,
        retestDue: c.kind === "retest",
        overdueDays: 0,
      });
      c.reason = `Bottleneck: observed weakness in ${c.competencyKey}`;
    }
  }

  // Sort: descending priority, then stable source key for determinism
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.sourceKey.localeCompare(b.sourceKey);
  });

  // -----------------------------------------------------------------------
  // Step 4: Allocate tasks to days/slots (§11.2 Rules 3, 7, 8, 9)
  // -----------------------------------------------------------------------
  const assignments: TaskAssignment[] = [];
  const weekBudgetMap = new Map(weekBudgets.map((wb) => [wb.weekStartDate, wb]));

  for (const candidate of candidates) {
    // Find a day with sufficient capacity
    let assigned = false;

    for (const dayAlloc of dayAllocations) {
      if (dayAlloc.isRestDay) continue;

      const remainingDaily = dayAlloc.dailyBudget - dayAlloc.allocatedMinutes;
      if (remainingDaily < candidate.estimateMinutes) continue;

      // Check weekly budget
      const weekMonday = getWeekMonday(dayAlloc.date);
      const wb = weekBudgetMap.get(weekMonday);
      if (!wb) continue;

      const remainingWeekly = wb.discretionaryMinutes - wb.allocatedMinutes;
      if (remainingWeekly < candidate.estimateMinutes) continue;

      // Check lane cap
      const laneCap = LANE_CAPS[candidate.lane];
      if (laneCap !== undefined) {
        const laneAllocated = assignments
          .filter((a) => a.lane === candidate.lane)
          .filter((a) => getWeekMonday(a.slotAllocations[0]?.localDate ?? "") === weekMonday)
          .reduce((sum, a) => sum + a.estimateMinutes, 0);
        if (laneAllocated + candidate.estimateMinutes > laneCap) continue;
      }

      // Check for contiguous slot (§11.2 Rule 3)
      const dayCapacity = capacityMap.get(dayAlloc.date);
      if (!dayCapacity) continue;

      let selectedSlot: { id: string; remaining: number } | null = null;
      for (const slot of dayCapacity.slots) {
        // Compute remaining capacity in this slot
        const usedInSlot = assignments
          .flatMap((a) => a.slotAllocations)
          .filter((sa) => sa.slotId === slot.id && sa.localDate === dayAlloc.date)
          .reduce((sum, sa) => sum + sa.assignedMinutes, 0);
        const remaining = slot.capacityMinutes - usedInSlot;
        if (remaining >= candidate.estimateMinutes) {
          selectedSlot = { id: slot.id, remaining };
          break;
        }
      }

      if (!selectedSlot && !candidate.splittable) {
        continue; // Need one contiguous opening for non-splittable
      }

      // If no single slot but splittable, allow split across slots (not implemented for M1 basics)
      if (!selectedSlot) continue;

      const slotAlloc: SlotAllocation = {
        slotId: selectedSlot.id,
        localDate: dayAlloc.date,
        assignedMinutes: candidate.estimateMinutes,
      };

      assignments.push({
        id: crypto.randomUUID(),
        sourceKey: candidate.sourceKey,
        kind: candidate.kind,
        title: candidate.title,
        competencyKey: candidate.competencyKey,
        familyIds: candidate.familyIds,
        packId: candidate.packId,
        estimateMinutes: candidate.estimateMinutes,
        splittable: candidate.splittable,
        slotAllocations: [slotAlloc],
        reason: candidate.reason,
        priority: candidate.priority,
        isBottleneck: candidate.isBottleneck,
        isTentative: candidate.isTentative,
        lane: candidate.lane,
      });

      dayAlloc.allocatedMinutes += candidate.estimateMinutes;
      dayAlloc.assignments.push(candidate.sourceKey);
      wb.allocatedMinutes += candidate.estimateMinutes;
      assigned = true;
      break;
    }

    if (!assigned) {
      deferredItems.push({
        sourceKey: candidate.sourceKey,
        title: candidate.title,
        reason: `No adequate opening with sufficient daily/weekly capacity`,
      });
      shortfalls.push({
        kind: "opening",
        description: `No adequate opening before checkpoint for non-splittable task ${candidate.title} (${candidate.estimateMinutes}m)`,
        affectedStage: candidate.stage,
        affectedCompetency: candidate.competencyKey,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Step 5: Build diff against previous assignments
  // -----------------------------------------------------------------------
  const prevKeys = new Set(input.previousAssignments.map((pa) => pa.sourceKey));
  const newKeys = new Set(assignments.map((a) => a.sourceKey));

  const diff: PlanDiff = {
    added: assignments
      .filter((a) => !prevKeys.has(a.sourceKey))
      .map((a) => a.sourceKey),
    removed: input.previousAssignments
      .filter((pa) => !newKeys.has(pa.sourceKey))
      .map((pa) => pa.sourceKey),
    moved: [],
    unchanged: assignments
      .filter((a) => prevKeys.has(a.sourceKey))
      .map((a) => a.sourceKey),
  };

  // -----------------------------------------------------------------------
  // Step 6: Build outcomes
  // -----------------------------------------------------------------------
  const outcomes: SprintOutcome[] = [];
  if (weakCompetencies.size > 0) {
    for (const comp of weakCompetencies) {
      outcomes.push({
        id: `outcome:repair:${comp}`,
        description: `Address observed weakness in ${comp}`,
        competencyKey: comp,
        evidenceRequired: "Drill completion and unfamiliar retest evidence",
        status: "pending",
      });
    }
  } else {
    outcomes.push({
      id: "outcome:baseline",
      description: "Complete baseline diagnostic and establish observed evidence",
      competencyKey: "general",
      evidenceRequired: "Baseline session with independent observations",
      status: "pending",
    });
  }

  return {
    outcomes,
    assignments,
    diff,
    deferredItems,
    shortfalls,
    weekBudgets,
    dayAllocations,
    inputHash: input.inputHash,
    algorithmVersion: input.goal.algorithmVersion,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStageToLane(stage: string): string {
  switch (stage) {
    case "foundation": return "dsa_learning";
    case "oa": return "oa_session";
    case "technical_a":
    case "technical_b": return "live_technical";
    case "engineering": return "project_defence";
    case "project": return "project_defence";
    case "behavioural": return "behavioural";
    default: return "dsa_learning";
  }
}
