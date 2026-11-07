"use server";

/**
 * Repairs Server Actions
 *
 * PLANLY_BUILD_SPEC.md §10.2, §17 (AC17, AC18)
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail, ok } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import type { RepairState } from "@/features/reviews/types";
import type { RetestSessionSummary } from "@/features/reviews/rules";
import { progressRepair } from "./service";
import type { EnrichedRepair } from "./service";
import { getLocalSession, getLocalReviews } from "@/lib/storage/local-store";

/**
 * Build a session lookup function from local storage.
 * Returns a RetestSessionSummary if the session exists, or null otherwise.
 */
function buildSessionLookup(ownerId: string): (sessionId: string) => RetestSessionSummary | null {
  return (sessionId: string) => {
    const session = getLocalSession(sessionId);
    if (!session || session.ownerId !== ownerId) return null;

    // Check if the session has a linked review with an outcome
    const reviews = getLocalReviews(sessionId);
    const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

    return {
      id: session.id,
      ownerId: session.ownerId,
      state: session.state,
      familiarity: (session as Record<string, unknown>).familiarity as string ?? "unknown",
      isAssisted: session.isAssisted,
      outcome: latestReview?.status ?? undefined,
    };
  };
}

export async function transitionRepairAction(
  repairId: string,
  newState: RepairState,
  params?: { drillTaskId?: string; retestSessionId?: string; closureResult?: string }
): Promise<Result<EnrichedRepair>> {
  const auth = await requireOwner();
  if (!auth.ok) return fail(auth.code, auth.message);
  const ownerId = auth.data.ownerId;

  const sessionLookup = buildSessionLookup(ownerId);
  const res = progressRepair(ownerId, repairId, newState, params, sessionLookup);
  if (res.ok) {
    revalidatePath("/repairs");
  }
  return res;
}
