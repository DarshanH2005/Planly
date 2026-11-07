/**
 * Spaced Recall Scheduling Service
 *
 * PLANLY_BUILD_SPEC.md §10.3, R13, AC19:
 * - 1, 3, 7, 14, 30 days sequential intervals
 * - Initial scheduling is tomorrow
 * - Success advances interval (capped at 30 days)
 * - Failure/forgotten/hinted resets to interval 1 tomorrow
 * - Partial leaves stage and due date unchanged
 * - Daily cap: 2 items / 15 minutes per session
 * - Weekly cap: 75 minutes maximum
 * - Preserves recall history across month/timezone boundaries
 */

import { computeNextRecall } from "./rules";
import type { RecallItemRecord, RecallResult } from "./types";

export const MAX_RECALL_ITEMS_PER_SESSION = 2;
export const MINUTES_PER_RECALL_SESSION = 15;
export const MAX_WEEKLY_RECALL_MINUTES = 75;

export interface RecallSessionAllocation {
  allocatedItems: RecallItemRecord[];
  deferredItems: Array<{ item: RecallItemRecord; reason: string }>;
  sessionMinutes: number;
  totalWeeklyMinutes: number;
  isWeeklyCapped: boolean;
}

/**
 * Allocate due recall items for a daily session subject to daily and weekly constraints (§10.3).
 *
 * Invariants:
 * - Max 2 items per daily session (15 minutes).
 * - Max 75 minutes weekly across all recall sessions.
 * - If weekly cap is reached, excess items are deferred with an explicit reason without erasing history.
 */
export function allocateDailyRecall(
  dueItems: RecallItemRecord[],
  weeklyMinutesAlreadySpent: number
): RecallSessionAllocation {
  const remainingWeeklyBudget = Math.max(0, MAX_WEEKLY_RECALL_MINUTES - weeklyMinutesAlreadySpent);

  if (remainingWeeklyBudget < MINUTES_PER_RECALL_SESSION) {
    // Cannot fit a 15-min session within remaining weekly budget
    return {
      allocatedItems: [],
      deferredItems: dueItems.map((item) => ({
        item,
        reason: `Deferred: 75m weekly recall budget reached (${weeklyMinutesAlreadySpent}m committed)`,
      })),
      sessionMinutes: 0,
      totalWeeklyMinutes: weeklyMinutesAlreadySpent,
      isWeeklyCapped: true,
    };
  }

  // Allocate up to 2 items
  const allocatedItems = dueItems.slice(0, MAX_RECALL_ITEMS_PER_SESSION);
  const excessItems = dueItems.slice(MAX_RECALL_ITEMS_PER_SESSION);

  const deferredItems = excessItems.map((item) => ({
    item,
    reason: "Deferred to next day: 2-item daily session cap reached",
  }));

  const sessionMinutes = allocatedItems.length > 0 ? MINUTES_PER_RECALL_SESSION : 0;

  return {
    allocatedItems,
    deferredItems,
    sessionMinutes,
    totalWeeklyMinutes: weeklyMinutesAlreadySpent + sessionMinutes,
    isWeeklyCapped: false,
  };
}

/**
 * Filter items due on or before target reference date (YYYY-MM-DD).
 */
export function filterDueItems(
  items: RecallItemRecord[],
  referenceDate: string
): RecallItemRecord[] {
  return items.filter(
    (item) => item.status === "active" && item.dueDate <= referenceDate
  );
}

export { computeNextRecall };
