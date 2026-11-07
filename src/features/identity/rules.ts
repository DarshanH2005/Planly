import { CapacityPattern } from "./schemas";
import { Result, ok, fail } from "@/lib/validation/result";

/**
 * Sprint 07: Capacity & Identity Domain Rules
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Pure domain functions governing 80% burnout guard capacity calculations,
 * contiguous uninterrupted slot fitting, weekly capacity aggregation,
 * and strict prohibition of CGPA readiness gating.
 */

export const BURNOUT_GUARD_RATIO = 0.80; // 80% maximum scheduled load
export const BURNOUT_BUFFER_RATIO = 0.20; // 20% reserved safety buffer

export interface WeeklyCapacitySummary {
  totalDeclaredMinutes: number;
  safeUsableMinutes: number;
  burnoutBufferMinutes: number;
  maxUninterruptedBlock: number;
  averageDailyMinutes: number;
}

export interface SlotFittingResult {
  canFit: boolean;
  reason?: string;
  maxAvailableSlot?: number;
  safeDailyLimit?: number;
}

/**
 * Calculates the safe usable capacity for a day given declared available minutes.
 * Applies the 20% burnout buffer (returns 80% of declared minutes).
 */
export function calculateSafeCapacity(declaredMinutes: number): number {
  if (declaredMinutes <= 0) return 0;
  return Math.floor(declaredMinutes * BURNOUT_GUARD_RATIO);
}

/**
 * Calculates the minimum declared minutes required to schedule a task of given duration
 * without violating the 80% burnout guard.
 *
 * Example from PLANLY_BUILD_SPEC:
 * - 60 min session -> 75 min declared availability required (60 / 0.8 = 75)
 * - 90 min session -> 113 min declared availability required (ceil(90 / 0.8) = 113)
 */
export function calculateRequiredDeclaredCapacity(taskMinutes: number): number {
  if (taskMinutes <= 0) return 0;
  return Math.ceil(taskMinutes / BURNOUT_GUARD_RATIO);
}

/**
 * Validates a single daily capacity pattern for mathematical consistency:
 * - totalMinutes between 0 and 1440
 * - dayOfWeek between 0 (Sun) and 6 (Sat)
 * - individual uninterrupted blocks <= totalMinutes
 * - sum of uninterrupted blocks <= totalMinutes
 */
export function validateCapacityPattern(pattern: CapacityPattern): Result<true> {
  if (!Number.isInteger(pattern.dayOfWeek) || pattern.dayOfWeek < 0 || pattern.dayOfWeek > 6) {
    return fail(
      "VALIDATION_ERROR",
      `Day of week must be an integer between 0 and 6, received ${pattern.dayOfWeek}`,
      { fieldErrors: { dayOfWeek: "Must be between 0 and 6" } }
    );
  }

  if (!Number.isInteger(pattern.totalMinutes) || pattern.totalMinutes < 0 || pattern.totalMinutes > 1440) {
    return fail(
      "VALIDATION_ERROR",
      `Total minutes must be between 0 and 1440, received ${pattern.totalMinutes}`,
      { fieldErrors: { totalMinutes: "Must be between 0 and 1440" } }
    );
  }

  let uninterruptedSum = 0;
  for (const block of pattern.uninterruptedLengths) {
    if (!Number.isInteger(block) || block <= 0) {
      return fail(
        "VALIDATION_ERROR",
        `Uninterrupted block must be a positive integer, received ${block}`,
        { fieldErrors: { uninterruptedLengths: "Blocks must be positive integers" } }
      );
    }
    if (block > pattern.totalMinutes) {
      return fail(
        "CAPACITY_SHORTFALL",
        `Uninterrupted block length (${block}m) exceeds total declared minutes (${pattern.totalMinutes}m)`,
        { fieldErrors: { uninterruptedLengths: "Block exceeds total declared daily minutes" } }
      );
    }
    uninterruptedSum += block;
  }

  if (uninterruptedSum > pattern.totalMinutes) {
    return fail(
      "CAPACITY_SHORTFALL",
      `Sum of uninterrupted blocks (${uninterruptedSum}m) exceeds total declared minutes (${pattern.totalMinutes}m)`,
      { fieldErrors: { uninterruptedLengths: "Sum of blocks exceeds total daily minutes" } }
    );
  }

  return ok(true);
}

/**
 * Validates that a 7-day weekly capacity pattern covers all days 0..6 uniquely
 * and each daily pattern is valid.
 */
export function validateWeeklyCapacity(capacities: readonly CapacityPattern[]): Result<true> {
  if (!capacities || capacities.length !== 7) {
    return fail(
      "VALIDATION_ERROR",
      `Weekly capacity must contain exactly 7 days, received ${capacities?.length ?? 0}`,
      { fieldErrors: { weeklyCapacity: "Must specify all 7 days" } }
    );
  }

  const seenDays = new Set<number>();
  for (const cap of capacities) {
    const dailyValidation = validateCapacityPattern(cap);
    if (!dailyValidation.ok) {
      return dailyValidation;
    }
    if (seenDays.has(cap.dayOfWeek)) {
      return fail(
        "VALIDATION_ERROR",
        `Duplicate capacity pattern for day of week ${cap.dayOfWeek}`,
        { fieldErrors: { dayOfWeek: `Duplicate day index ${cap.dayOfWeek}` } }
      );
    }
    seenDays.add(cap.dayOfWeek);
  }

  for (let day = 0; day <= 6; day++) {
    if (!seenDays.has(day)) {
      return fail(
        "VALIDATION_ERROR",
        `Missing capacity pattern for day of week ${day}`,
        { fieldErrors: { dayOfWeek: `Missing day index ${day}` } }
      );
    }
  }

  return ok(true);
}

/**
 * Aggregates a 7-day capacity pattern into a summary of declared, safe usable,
 * and safety buffer minutes.
 */
export function calculateWeeklySummary(capacities: readonly CapacityPattern[]): WeeklyCapacitySummary {
  let totalDeclaredMinutes = 0;
  let maxUninterruptedBlock = 0;

  for (const day of capacities) {
    totalDeclaredMinutes += day.totalMinutes;
    for (const len of day.uninterruptedLengths) {
      if (len > maxUninterruptedBlock) {
        maxUninterruptedBlock = len;
      }
    }
  }

  const safeUsableMinutes = calculateSafeCapacity(totalDeclaredMinutes);
  const burnoutBufferMinutes = totalDeclaredMinutes - safeUsableMinutes;
  const averageDailyMinutes = Math.round(totalDeclaredMinutes / 7);

  return {
    totalDeclaredMinutes,
    safeUsableMinutes,
    burnoutBufferMinutes,
    maxUninterruptedBlock,
    averageDailyMinutes,
  };
}

/**
 * Checks whether a task of given duration can fit into a specific day:
 * 1. The task must not exceed the 80% safe daily capacity limit.
 * 2. If requiresUninterrupted is true, at least one uninterrupted opening on that day must be >= task duration.
 *
 * Invariant: A 70-minute OA cannot be silently divided into seven 10-minute slots.
 */
export function canFitTaskOnDay(
  day: CapacityPattern,
  taskDurationMinutes: number,
  requiresUninterrupted = true
): SlotFittingResult {
  const safeDailyLimit = calculateSafeCapacity(day.totalMinutes);

  if (taskDurationMinutes > safeDailyLimit) {
    return {
      canFit: false,
      reason: `Task duration (${taskDurationMinutes}m) exceeds 80% daily burnout guard capacity (${safeDailyLimit}m of ${day.totalMinutes}m declared)`,
      safeDailyLimit,
    };
  }

  const maxSlot = day.uninterruptedLengths.length > 0
    ? Math.max(...day.uninterruptedLengths)
    : 0;

  if (requiresUninterrupted) {
    const hasFittingSlot = day.uninterruptedLengths.some((len) => len >= taskDurationMinutes);
    if (!hasFittingSlot) {
      return {
        canFit: false,
        reason: `Task requires an uninterrupted ${taskDurationMinutes}m block, but longest available opening is ${maxSlot}m`,
        maxAvailableSlot: maxSlot,
        safeDailyLimit,
      };
    }
  }

  return {
    canFit: true,
    maxAvailableSlot: maxSlot,
    safeDailyLimit,
  };
}

/**
 * Invariant AC-04: CGPA is an optional informational field and strictly NOT used
 * as a scoring input or readiness gating condition.
 *
 * Always returns false to enforce that no gate or engine rule may check CGPA.
 */
export function isCgpaGatingEnforced(): boolean {
  return false;
}
