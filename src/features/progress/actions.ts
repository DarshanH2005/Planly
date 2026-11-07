"use server";

/**
 * Progress Server Actions
 *
 * PLANLY_BUILD_SPEC.md §6.2, R04, R15:
 * - Mutates daily capacity state (minimum day, rest day, custom capacity)
 * - Persists growth notes
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail, ok } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import {
  applyDailyAdjustment,
  saveGrowthNotes,
  getTodayState,
} from "./service";
import type { TodayState, GrowthNotes } from "./service";

export async function setDailyMode(
  mode: "full" | "minimum_day" | "rest_day" | "custom",
  declaredMinutes?: number
): Promise<Result<TodayState>> {
  const auth = await requireOwner();
  if (!auth.ok) return fail(auth.code, auth.message);
  const ownerId = auth.data.ownerId;

  const state = applyDailyAdjustment(ownerId, {
    mode,
    declaredMinutes,
  });

  revalidatePath("/today");
  return ok(state);
}

export async function submitGrowthNotes(
  notes: GrowthNotes
): Promise<Result<{ saved: boolean }>> {
  const auth = await requireOwner();
  if (!auth.ok) return fail(auth.code, auth.message);
  const ownerId = auth.data.ownerId;

  saveGrowthNotes(ownerId, notes);
  revalidatePath("/today");
  return ok({ saved: true });
}
