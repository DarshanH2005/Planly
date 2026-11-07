"use server";

/**
 * Curriculum Server Actions
 *
 * PLANLY_BUILD_SPEC.md §6.5:
 * - Track problem completion status in the prep hub
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail, ok } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import type { ProblemStatus } from "@/lib/storage/local-store";
import { saveLocalPrepStatus } from "@/lib/storage/local-store";

export async function updateProblemStatus(
  problemId: string,
  status: ProblemStatus
): Promise<Result<{ problemId: string; status: ProblemStatus }>> {
  const auth = await requireOwner();
  if (!auth.ok) return fail(auth.code, auth.message);

  saveLocalPrepStatus(auth.data.ownerId, problemId, status);
  revalidatePath("/prep");

  return ok({ problemId, status });
}
