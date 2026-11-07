"use server";

/**
 * Sprint 07: Identity & Onboarding Server Actions
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Server actions for handling onboarding submissions, profile updates,
 * goal revisions (monotonic version increment), and 7-day capacity adjustments.
 *
 * All actions strictly authenticate via requireOwner() and revalidate cached routes.
 */

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import {
  completeOnboarding,
  updateProfile,
  updateGoal,
  updateWeeklyCapacity,
  getIdentityState,
} from "./service";
import type { IdentityState } from "./service";
import type {
  UserProfile,
  UserGoal,
  CapacityPattern,
  OnboardingInput,
  UpdateProfileInput,
  UpdateGoalInput,
  UpdateCapacityInput,
} from "./schemas";
import type { WeeklyCapacitySummary } from "./rules";

/**
 * Completes user onboarding:
 * Validates baseline inputs, persists profile, initializes goal (version 1),
 * stores 7-day capacity pattern, and revalidates workspace.
 */
export async function submitOnboardingAction(
  input: OnboardingInput
): Promise<Result<IdentityState>> {
  const auth = await requireOwner();
  if (!auth.ok) {
    return fail(auth.code, auth.message);
  }

  const result = await completeOnboarding(auth.data.ownerId, input);
  if (result.ok) {
    revalidatePath("/onboarding");
    revalidatePath("/today");
    revalidatePath("/settings");
    revalidatePath("/targets");
  }

  return result;
}

/**
 * Updates profile attributes (timezone, graduation date, primary language, optional CGPA).
 */
export async function updateProfileAction(
  input: UpdateProfileInput
): Promise<Result<UserProfile>> {
  const auth = await requireOwner();
  if (!auth.ok) {
    return fail(auth.code, auth.message);
  }

  const result = await updateProfile(auth.data.ownerId, input);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/today");
  }

  return result;
}

/**
 * Updates user preparation goals:
 * Enforces AC-03 by inserting a new record with an incremented version number.
 */
export async function updateGoalAction(
  input: UpdateGoalInput
): Promise<Result<UserGoal>> {
  const auth = await requireOwner();
  if (!auth.ok) {
    return fail(auth.code, auth.message);
  }

  const result = await updateGoal(auth.data.ownerId, input);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/targets");
    revalidatePath("/today");
  }

  return result;
}

/**
 * Updates 7-day weekly capacity pattern and recalculates 80% burnout guard buffer.
 */
export async function updateCapacityAction(
  input: UpdateCapacityInput
): Promise<Result<{ capacities: CapacityPattern[]; summary: WeeklyCapacitySummary }>> {
  const auth = await requireOwner();
  if (!auth.ok) {
    return fail(auth.code, auth.message);
  }

  const result = await updateWeeklyCapacity(auth.data.ownerId, input);
  if (result.ok) {
    revalidatePath("/settings");
    revalidatePath("/today");
    revalidatePath("/sprints");
  }

  return result;
}

/**
 * Loads current identity state for the authenticated owner.
 */
export async function loadIdentityStateAction(): Promise<Result<IdentityState>> {
  const auth = await requireOwner();
  if (!auth.ok) {
    return fail(auth.code, auth.message);
  }

  return getIdentityState(auth.data.ownerId);
}
