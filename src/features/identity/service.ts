import {
  UserProfile,
  UserGoal,
  CapacityPattern,
  OnboardingInput,
  OnboardingInputSchema,
  UpdateProfileInput,
  UpdateProfileInputSchema,
  UpdateGoalInput,
  UpdateGoalInputSchema,
  UpdateCapacityInput,
  UpdateCapacityInputSchema,
  DEFAULT_PROFILE_VALUES,
  DEFAULT_GOAL_VALUES,
  DEFAULT_WEEKLY_CAPACITY,
} from "./schemas";
import {
  validateWeeklyCapacity,
  calculateWeeklySummary,
  WeeklyCapacitySummary,
  isCgpaGatingEnforced,
} from "./rules";
import {
  findProfileByOwner,
  upsertProfile,
  findLatestGoalByOwner,
  findGoalHistoryByOwner,
  insertGoal,
  findCapacitiesByOwner,
  upsertCapacities,
} from "./repository";
import { Result, ok, fail } from "@/lib/validation/result";

/**
 * Sprint 07: Identity & Onboarding Service
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Orchestrates user onboarding flow, profile management, goal versioning,
 * and 7-day capacity pattern validation.
 */

export interface IdentityState {
  isOnboarded: boolean;
  profile: UserProfile | null;
  currentGoal: UserGoal | null;
  goalHistory: UserGoal[];
  capacities: CapacityPattern[];
  capacitySummary: WeeklyCapacitySummary;
}

export interface PrefilledOnboardingData {
  profile: {
    timezone: string;
    major: string;
    graduationDate: string;
    primaryLanguage: string;
    cgpa?: number;
  };
  goal: {
    targetRoles: readonly string[];
    targetCompanies: readonly string[];
    targetDate: string;
  };
  weeklyCapacity: readonly CapacityPattern[];
}

/**
 * Returns default prefilled values for first-time onboarding (AC-01):
 * CSE, Python, Dec 2026 graduation, Asia/Kolkata, general SDE/backend, CRED + editable big-tech target.
 */
export function getPrefilledOnboardingData(): PrefilledOnboardingData {
  return {
    profile: {
      timezone: DEFAULT_PROFILE_VALUES.timezone,
      major: DEFAULT_PROFILE_VALUES.major,
      graduationDate: DEFAULT_PROFILE_VALUES.graduationDate,
      primaryLanguage: DEFAULT_PROFILE_VALUES.primaryLanguage,
    },
    goal: {
      targetRoles: DEFAULT_GOAL_VALUES.targetRoles,
      targetCompanies: DEFAULT_GOAL_VALUES.targetCompanies,
      targetDate: DEFAULT_GOAL_VALUES.targetDate,
    },
    weeklyCapacity: DEFAULT_WEEKLY_CAPACITY,
  };
}

/**
 * Retrieves the complete identity state for an authenticated owner.
 */
export async function getIdentityState(ownerId: string): Promise<Result<IdentityState>> {
  if (!ownerId) {
    return fail("UNAUTHENTICATED", "Owner ID is required to retrieve identity state");
  }

  try {
    const [profile, currentGoal, goalHistory, rawCapacities] = await Promise.all([
      findProfileByOwner(ownerId),
      findLatestGoalByOwner(ownerId),
      findGoalHistoryByOwner(ownerId),
      findCapacitiesByOwner(ownerId),
    ]);

    const capacities = rawCapacities.length === 7 ? rawCapacities : [...DEFAULT_WEEKLY_CAPACITY];
    const capacitySummary = calculateWeeklySummary(capacities);
    const isOnboarded = Boolean(profile && currentGoal && rawCapacities.length === 7);

    return ok({
      isOnboarded,
      profile,
      currentGoal,
      goalHistory,
      capacities,
      capacitySummary,
    });
  } catch (err: any) {
    return fail("SERVICE_UNAVAILABLE", `Failed to load identity state: ${err.message || "Unknown error"}`);
  }
}

/**
 * Executes initial user onboarding:
 * 1. Validates profile inputs and prefilled defaults.
 * 2. Enforces 7-day capacity pattern validation with uninterrupted block bounds.
 * 3. Persists profile, initial goal (version 1), and 7 capacity records.
 */
export async function completeOnboarding(
  ownerId: string,
  rawInput: unknown
): Promise<Result<IdentityState>> {
  if (!ownerId) {
    return fail("UNAUTHENTICATED", "Owner ID is required to complete onboarding");
  }

  const parsed = OnboardingInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return fail("VALIDATION_ERROR", "Invalid onboarding input", { fieldErrors });
  }

  const input: OnboardingInput = parsed.data;

  // Validate 7-day weekly capacity
  const capacityValidation = validateWeeklyCapacity(input.weeklyCapacity);
  if (!capacityValidation.ok) {
    return capacityValidation;
  }

  // Enforce invariant AC-04: CGPA cannot be used as a readiness or gating input
  isCgpaGatingEnforced();

  try {
    const [profile, goal, capacities] = await Promise.all([
      upsertProfile(ownerId, {
        timezone: input.timezone,
        major: input.major,
        graduationDate: input.graduationDate,
        primaryLanguage: input.primaryLanguage,
        cgpa: input.cgpa,
      }),
      insertGoal(ownerId, {
        version: 1,
        targetRoles: input.targetRoles,
        targetCompanies: input.targetCompanies,
        targetDate: input.targetDate,
      }),
      upsertCapacities(ownerId, input.weeklyCapacity),
    ]);

    const capacitySummary = calculateWeeklySummary(capacities);

    return ok({
      isOnboarded: true,
      profile,
      currentGoal: goal,
      goalHistory: [goal],
      capacities,
      capacitySummary,
    });
  } catch (err: any) {
    return fail("SERVICE_UNAVAILABLE", `Failed to complete onboarding: ${err.message || "Unknown error"}`);
  }
}

/**
 * Updates user profile attributes (timezone, graduation date, language, optional CGPA).
 */
export async function updateProfile(
  ownerId: string,
  rawInput: unknown
): Promise<Result<UserProfile>> {
  if (!ownerId) {
    return fail("UNAUTHENTICATED", "Owner ID is required to update profile");
  }

  const parsed = UpdateProfileInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return fail("VALIDATION_ERROR", "Invalid profile update input", { fieldErrors });
  }

  const input: UpdateProfileInput = parsed.data;

  try {
    const current = await findProfileByOwner(ownerId);
    const updated = await upsertProfile(ownerId, {
      timezone: input.timezone ?? current?.timezone ?? DEFAULT_PROFILE_VALUES.timezone,
      major: input.major ?? current?.major ?? DEFAULT_PROFILE_VALUES.major,
      graduationDate: input.graduationDate ?? current?.graduationDate ?? DEFAULT_PROFILE_VALUES.graduationDate,
      primaryLanguage: input.primaryLanguage ?? current?.primaryLanguage ?? DEFAULT_PROFILE_VALUES.primaryLanguage,
      cgpa: input.cgpa !== undefined ? input.cgpa : current?.cgpa,
    });

    return ok(updated);
  } catch (err: any) {
    return fail("SERVICE_UNAVAILABLE", `Failed to update profile: ${err.message || "Unknown error"}`);
  }
}

/**
 * Updates user goals:
 * Enforces AC-03 by inserting a new record with an incremented version number,
 * preserving complete historical comparison.
 */
export async function updateGoal(
  ownerId: string,
  rawInput: unknown
): Promise<Result<UserGoal>> {
  if (!ownerId) {
    return fail("UNAUTHENTICATED", "Owner ID is required to update goals");
  }

  const parsed = UpdateGoalInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return fail("VALIDATION_ERROR", "Invalid goal update input", { fieldErrors });
  }

  const input: UpdateGoalInput = parsed.data;

  try {
    const currentLatest = await findLatestGoalByOwner(ownerId);
    const nextVersion = (currentLatest?.version ?? 0) + 1;

    const newGoal = await insertGoal(ownerId, {
      version: nextVersion,
      targetRoles: input.targetRoles,
      targetCompanies: input.targetCompanies,
      targetDate: input.targetDate,
    });

    return ok(newGoal);
  } catch (err: any) {
    return fail("SERVICE_UNAVAILABLE", `Failed to update goal: ${err.message || "Unknown error"}`);
  }
}

/**
 * Updates 7-day weekly preparation capacity patterns.
 */
export async function updateWeeklyCapacity(
  ownerId: string,
  rawInput: unknown
): Promise<Result<{ capacities: CapacityPattern[]; summary: WeeklyCapacitySummary }>> {
  if (!ownerId) {
    return fail("UNAUTHENTICATED", "Owner ID is required to update capacity");
  }

  const parsed = UpdateCapacityInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return fail("VALIDATION_ERROR", "Invalid capacity update input", { fieldErrors });
  }

  const input: UpdateCapacityInput = parsed.data;

  const validation = validateWeeklyCapacity(input.capacities);
  if (!validation.ok) {
    return validation;
  }

  try {
    const updated = await upsertCapacities(ownerId, input.capacities);
    const summary = calculateWeeklySummary(updated);
    return ok({ capacities: updated, summary });
  } catch (err: any) {
    return fail("SERVICE_UNAVAILABLE", `Failed to update weekly capacity: ${err.message || "Unknown error"}`);
  }
}
