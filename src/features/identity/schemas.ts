import { z } from "zod";

/**
 * Sprint 07: Onboarding, Profile & Goal Configuration Schemas
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Defines domain contracts and validation schemas for user profile,
 * versioned goals, and 7-day uninterrupted capacity patterns.
 */

export const DEFAULT_PROFILE_VALUES = {
  timezone: "Asia/Kolkata",
  major: "CSE",
  graduationDate: "2026-12-01",
  primaryLanguage: "Python",
} as const;

export const DEFAULT_GOAL_VALUES = {
  targetRoles: ["general SDE/backend"],
  targetCompanies: ["CRED"],
  targetDate: "2026-11-30",
} as const;

export const DEFAULT_WEEKLY_CAPACITY: readonly CapacityPattern[] = [
  { dayOfWeek: 0, totalMinutes: 180, uninterruptedLengths: [120, 60] }, // Sunday
  { dayOfWeek: 1, totalMinutes: 150, uninterruptedLengths: [90, 60] },  // Monday
  { dayOfWeek: 2, totalMinutes: 150, uninterruptedLengths: [90, 60] },  // Tuesday
  { dayOfWeek: 3, totalMinutes: 150, uninterruptedLengths: [90, 60] },  // Wednesday
  { dayOfWeek: 4, totalMinutes: 150, uninterruptedLengths: [90, 60] },  // Thursday
  { dayOfWeek: 5, totalMinutes: 150, uninterruptedLengths: [90, 60] },  // Friday
  { dayOfWeek: 6, totalMinutes: 180, uninterruptedLengths: [120, 60] }, // Saturday
];

export const CapacityPatternSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    totalMinutes: z.number().int().min(0).max(1440),
    uninterruptedLengths: z.array(z.number().int().positive()),
  })
  .refine(
    (val) => {
      const sum = val.uninterruptedLengths.reduce((acc, len) => acc + len, 0);
      return sum <= val.totalMinutes;
    },
    {
      message: "Sum of uninterrupted blocks cannot exceed total minutes for the day",
      path: ["uninterruptedLengths"],
    }
  )
  .refine(
    (val) => val.uninterruptedLengths.every((len) => len <= val.totalMinutes),
    {
      message: "No single uninterrupted block can exceed total minutes",
      path: ["uninterruptedLengths"],
    }
  );

export type CapacityPattern = z.infer<typeof CapacityPatternSchema>;

export const WeeklyCapacitySchema = z
  .array(CapacityPatternSchema)
  .length(7, "Weekly capacity must define exactly 7 days (Sunday through Saturday)")
  .refine(
    (patterns) => {
      const days = new Set(patterns.map((p) => p.dayOfWeek));
      return days.size === 7 && [0, 1, 2, 3, 4, 5, 6].every((d) => days.has(d));
    },
    {
      message: "Weekly capacity must contain unique entries for days 0 through 6",
    }
  );

export type WeeklyCapacity = z.infer<typeof WeeklyCapacitySchema>;

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string(),
  timezone: z.string().min(1).default(DEFAULT_PROFILE_VALUES.timezone),
  major: z.string().min(1).default(DEFAULT_PROFILE_VALUES.major),
  graduationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Graduation date must be formatted YYYY-MM-DD")
    .default(DEFAULT_PROFILE_VALUES.graduationDate),
  primaryLanguage: z.string().min(1).default(DEFAULT_PROFILE_VALUES.primaryLanguage),
  cgpa: z.number().min(0).max(10).optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserGoalSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string(),
  version: z.number().int().min(1).default(1),
  targetRoles: z.array(z.string().min(1)).min(1).default([...DEFAULT_GOAL_VALUES.targetRoles]),
  targetCompanies: z.array(z.string().min(1)).min(1).default([...DEFAULT_GOAL_VALUES.targetCompanies]),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Target date must be formatted YYYY-MM-DD")
    .default(DEFAULT_GOAL_VALUES.targetDate),
});

export type UserGoal = z.infer<typeof UserGoalSchema>;

export const OnboardingInputSchema = z.object({
  timezone: z.string().min(1).default(DEFAULT_PROFILE_VALUES.timezone),
  major: z.string().min(1).default(DEFAULT_PROFILE_VALUES.major),
  graduationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Graduation date must be formatted YYYY-MM-DD")
    .default(DEFAULT_PROFILE_VALUES.graduationDate),
  primaryLanguage: z.string().min(1).default(DEFAULT_PROFILE_VALUES.primaryLanguage),
  cgpa: z.number().min(0).max(10).optional(),
  targetRoles: z.array(z.string().min(1)).min(1).default([...DEFAULT_GOAL_VALUES.targetRoles]),
  targetCompanies: z.array(z.string().min(1)).min(1).default([...DEFAULT_GOAL_VALUES.targetCompanies]),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Target date must be formatted YYYY-MM-DD")
    .default(DEFAULT_GOAL_VALUES.targetDate),
  weeklyCapacity: WeeklyCapacitySchema.default(() => [...DEFAULT_WEEKLY_CAPACITY]),
});

export type OnboardingInput = z.infer<typeof OnboardingInputSchema>;

export const UpdateProfileInputSchema = z.object({
  timezone: z.string().min(1).optional(),
  major: z.string().min(1).optional(),
  graduationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  primaryLanguage: z.string().min(1).optional(),
  cgpa: z.number().min(0).max(10).nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

export const UpdateGoalInputSchema = z.object({
  targetRoles: z.array(z.string().min(1)).min(1),
  targetCompanies: z.array(z.string().min(1)).min(1),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type UpdateGoalInput = z.infer<typeof UpdateGoalInputSchema>;

export const UpdateCapacityInputSchema = z.object({
  capacities: WeeklyCapacitySchema,
});

export type UpdateCapacityInput = z.infer<typeof UpdateCapacityInputSchema>;
