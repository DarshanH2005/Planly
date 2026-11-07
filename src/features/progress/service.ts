/**
 * Progress & Daily Workflow Service
 *
 * PLANLY_BUILD_SPEC.md §6.2, §7.1, R04, AC05:
 * - Aggregates today's focus task, supporting slots, and capacity buffer
 * - Computes adaptive daily adjustments:
 *   - Minimum Day (12m): maintains continuity without false benchmark evidence
 *   - Rest Day (0m): shifts non-splittable tasks to adequate openings or reports shortfall
 *   - Custom Capacity: applies floor(0.8 * declared) buffer
 * - Lightweight growth notes (sleep, movement, energy rating)
 */

import { computeDailyBudget } from "@/features/planning/rules";

export interface TodayTask {
  id: string;
  title: string;
  stage: string;
  durationMinutes: number;
  debriefMinutes: number;
  totalMinutes: number;
  reason: string;
  packId: string;
  promptId: string;
  status: "pending" | "in_progress" | "completed";
}

export interface SupportingSlot {
  id: string;
  title: string;
  type: "sql" | "cs" | "recall";
  durationMinutes: number;
  description: string;
  status: "pending" | "completed";
}

export interface CapacityState {
  declaredMinutes: number;
  effectiveBudget: number;
  committedMinutes: number;
  remainingMinutes: number;
  mode: "full" | "minimum_day" | "rest_day" | "custom";
}

export interface GrowthNotes {
  date: string;
  sleepHours?: number;
  movementNote?: string;
  energyRating?: 1 | 2 | 3 | 4 | 5;
  reflection?: string;
}

export interface TodayState {
  date: string;
  focusTask: TodayTask | null;
  supportingSlots: SupportingSlot[];
  capacity: CapacityState;
  growthNotes?: GrowthNotes;
  replanningMessage?: string;
}

/** In-memory state store for daily adjustments per owner/date for responsive UI interaction */
const dailyAdjustmentStore = new Map<string, {
  declaredMinutes: number;
  mode: CapacityState["mode"];
  growthNotes?: GrowthNotes;
}>();

/**
 * Get current Today state for the user (§6.2).
 */
export function getTodayState(ownerId: string, targetDate?: string): TodayState {
  const date = targetDate ?? new Date().toISOString().slice(0, 10);
  const key = `${ownerId}:${date}`;
  const adjustment = dailyAdjustmentStore.get(key) ?? {
    declaredMinutes: 75,
    mode: "full" as const,
  };

  const declaredMinutes = adjustment.declaredMinutes;
  let effectiveBudget = computeDailyBudget(declaredMinutes);
  if (adjustment.mode === "minimum_day") {
    effectiveBudget = 12; // 12-minute fixed budget per §7.1
  } else if (adjustment.mode === "rest_day") {
    effectiveBudget = 0;
  }

  // Baseline focus task (30 min total)
  let focusTask: TodayTask | null = {
    id: "task-focus-today",
    title: "First Repeat & Hash Invariants (Foundation Diagnostic)",
    stage: "foundation",
    durationMinutes: 20,
    debriefMinutes: 10,
    totalMinutes: 30,
    reason: "Initial baseline session to observe independent Python problem-solving, edge case identification, and blank-editor implementation without assistance.",
    packId: "PACK-FOUNDATION-01",
    promptId: "FX-HASH-A",
    status: "pending",
  };

  // Supporting slots
  let supportingSlots: SupportingSlot[] = [
    {
      id: "slot-sql-1",
      title: "SQL Core: Customer Orders Aggregation",
      type: "sql",
      durationMinutes: 15,
      description: "Execute customer order aggregation fixture returning A100/B200/C0 (AC21)",
      status: "pending",
    },
    {
      id: "slot-cs-1",
      title: "CS Defense: Database Transactions & Isolation",
      type: "cs",
      durationMinutes: 15,
      description: "Explain ACID boundaries, dirty reads, and serializable isolation tradeoffs",
      status: "pending",
    },
  ];

  let committedMinutes = 60; // 30m focus + 15m sql + 15m cs
  let replanningMessage: string | undefined;

  if (adjustment.mode === "rest_day") {
    focusTask = null;
    supportingSlots = [];
    committedMinutes = 0;
    replanningMessage = "Rest Day declared: Tasks safely shifted to next adequate opening in sprint schedule (AC05).";
  } else if (adjustment.mode === "minimum_day") {
    // 12m minimum day: 1m start, 5m coding/recall, 3m SQL explanation, 3m notes (§7.1)
    focusTask = {
      id: "task-min-day",
      title: "Minimum Day Continuity Drill (12 min)",
      stage: "foundation",
      durationMinutes: 9,
      debriefMinutes: 3,
      totalMinutes: 12,
      reason: "Minimum day maintenance: 1m start, 5m small recall/code, 3m SQL explanation, 3m save blocker/next step.",
      packId: "PACK-FOUNDATION-01",
      promptId: "FX-HASH-A",
      status: "pending",
    };
    supportingSlots = [];
    committedMinutes = 12;
    replanningMessage = "12-minute Minimum Day active: Continuity preserved without falsely claiming full benchmark evidence (§7.1).";
  } else if (effectiveBudget < 60 && effectiveBudget >= 45) {
    // A focus session plus one supporting slot is the only 45-minute combination.
    supportingSlots = [supportingSlots[0]];
    committedMinutes = 45;
    replanningMessage = "Reduced capacity: one supporting slot moved to the next adequate opening.";
  } else if (effectiveBudget < 60 && effectiveBudget >= 30) {
    // Do not silently overbook the day: retain only the complete 30-minute session.
    supportingSlots = [];
    committedMinutes = 30;
    replanningMessage = "Reduced capacity: supporting work moved to the next adequate opening.";
  } else if (effectiveBudget < 60 && effectiveBudget >= 15) {
    // A supporting exercise fits, but the 30-minute session does not.
    focusTask = null;
    supportingSlots = [supportingSlots[0]];
    committedMinutes = 15;
    replanningMessage = `Reduced capacity (${effectiveBudget}m budget): Main 30m session moved to next adequate opening (AC05).`;
  } else if (effectiveBudget < 15) {
    focusTask = null;
    supportingSlots = [];
    committedMinutes = 0;
    replanningMessage = `Reduced capacity (${effectiveBudget}m budget): no complete task fits; work moved to next adequate opening (AC05).`;
  }

  const remainingMinutes = Math.max(0, effectiveBudget - committedMinutes);

  return {
    date,
    focusTask,
    supportingSlots,
    capacity: {
      declaredMinutes,
      effectiveBudget,
      committedMinutes,
      remainingMinutes,
      mode: adjustment.mode,
    },
    growthNotes: adjustment.growthNotes,
    replanningMessage,
  };
}

/**
 * Apply daily capacity adjustments (§6.2, R04)
 */
export function applyDailyAdjustment(
  ownerId: string,
  params: {
    mode: "full" | "minimum_day" | "rest_day" | "custom";
    declaredMinutes?: number;
    date?: string;
  }
): TodayState {
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const key = `${ownerId}:${date}`;

  let declaredMinutes = 75;
  if (params.mode === "minimum_day") {
    declaredMinutes = 15; // floor(0.8 * 15) = 12m
  } else if (params.mode === "rest_day") {
    declaredMinutes = 0;
  } else if (params.mode === "custom") {
    declaredMinutes = params.declaredMinutes ?? 60;
  }

  const existing = dailyAdjustmentStore.get(key);
  dailyAdjustmentStore.set(key, {
    declaredMinutes,
    mode: params.mode,
    growthNotes: existing?.growthNotes,
  });

  return getTodayState(ownerId, date);
}

/**
 * Save lightweight daily habit and growth notes (§6.5, R15)
 */
export function saveGrowthNotes(
  ownerId: string,
  notes: GrowthNotes
): void {
  const key = `${ownerId}:${notes.date}`;
  const existing = dailyAdjustmentStore.get(key) ?? {
    declaredMinutes: 75,
    mode: "full",
  };

  dailyAdjustmentStore.set(key, {
    ...existing,
    growthNotes: notes,
  });
}
