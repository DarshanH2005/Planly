/**
 * Sprint 07: Identity, Capacity Rules & Goal Versioning Unit Tests
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Verifies AC-01 (prefilled defaults), AC-02 (7-day capacity bounds & slot fitting),
 * AC-03 (monotonic goal versioning), and AC-04 (CGPA gating isolation).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CapacityPattern,
  DEFAULT_PROFILE_VALUES,
  DEFAULT_GOAL_VALUES,
  DEFAULT_WEEKLY_CAPACITY,
  OnboardingInputSchema,
  WeeklyCapacitySchema,
} from "@/features/identity/schemas";
import {
  validateCapacityPattern,
  validateWeeklyCapacity,
  calculateSafeCapacity,
  calculateRequiredDeclaredCapacity,
  calculateWeeklySummary,
  canFitTaskOnDay,
  isCgpaGatingEnforced,
  BURNOUT_GUARD_RATIO,
  BURNOUT_BUFFER_RATIO,
} from "@/features/identity/rules";
import {
  getPrefilledOnboardingData,
  completeOnboarding,
  updateProfile,
  updateGoal,
  updateWeeklyCapacity,
  getIdentityState,
} from "@/features/identity/service";
import { resetDevIdentityStore } from "@/features/identity/repository";

describe("Sprint 07: Capacity Pattern Bounds & Validation (AC-02)", () => {
  it("accepts valid daily capacity patterns where uninterrupted sum <= total minutes", () => {
    const valid: CapacityPattern = {
      dayOfWeek: 1, // Monday
      totalMinutes: 150,
      uninterruptedLengths: [90, 60],
    };
    const res = validateCapacityPattern(valid);
    expect(res.ok).toBe(true);
  });

  it("accepts a day with zero minutes (rest day)", () => {
    const restDay: CapacityPattern = {
      dayOfWeek: 0,
      totalMinutes: 0,
      uninterruptedLengths: [],
    };
    const res = validateCapacityPattern(restDay);
    expect(res.ok).toBe(true);
  });

  it("rejects invalid dayOfWeek (< 0 or > 6 or non-integer)", () => {
    expect(validateCapacityPattern({ dayOfWeek: -1, totalMinutes: 60, uninterruptedLengths: [60] }).ok).toBe(false);
    expect(validateCapacityPattern({ dayOfWeek: 7, totalMinutes: 60, uninterruptedLengths: [60] }).ok).toBe(false);
    expect(validateCapacityPattern({ dayOfWeek: 2.5, totalMinutes: 60, uninterruptedLengths: [60] }).ok).toBe(false);
  });

  it("rejects totalMinutes exceeding 1440 or negative", () => {
    expect(validateCapacityPattern({ dayOfWeek: 1, totalMinutes: -10, uninterruptedLengths: [] }).ok).toBe(false);
    expect(validateCapacityPattern({ dayOfWeek: 1, totalMinutes: 1441, uninterruptedLengths: [60] }).ok).toBe(false);
  });

  it("rejects when a single uninterrupted block exceeds total declared daily minutes", () => {
    const invalid: CapacityPattern = {
      dayOfWeek: 2,
      totalMinutes: 60,
      uninterruptedLengths: [90],
    };
    const res = validateCapacityPattern(invalid);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CAPACITY_SHORTFALL");
      expect(res.message).toContain("exceeds total declared minutes");
    }
  });

  it("rejects when the sum of uninterrupted blocks exceeds total declared daily minutes", () => {
    const invalid: CapacityPattern = {
      dayOfWeek: 3,
      totalMinutes: 120,
      uninterruptedLengths: [60, 50, 40], // 150 > 120
    };
    const res = validateCapacityPattern(invalid);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CAPACITY_SHORTFALL");
      expect(res.message).toContain("exceeds total declared minutes");
    }
  });

  it("rejects non-positive uninterrupted block lengths", () => {
    expect(validateCapacityPattern({ dayOfWeek: 1, totalMinutes: 60, uninterruptedLengths: [0] }).ok).toBe(false);
    expect(validateCapacityPattern({ dayOfWeek: 1, totalMinutes: 60, uninterruptedLengths: [-30] }).ok).toBe(false);
    expect(validateCapacityPattern({ dayOfWeek: 1, totalMinutes: 60, uninterruptedLengths: [30.5] }).ok).toBe(false);
  });
});

describe("Sprint 07: Weekly Capacity Coverage (7 Days)", () => {
  it("accepts default weekly capacity covering all 7 days uniquely", () => {
    const res = validateWeeklyCapacity(DEFAULT_WEEKLY_CAPACITY);
    expect(res.ok).toBe(true);
  });

  it("rejects weekly pattern with fewer or more than 7 days", () => {
    const incomplete = DEFAULT_WEEKLY_CAPACITY.slice(0, 6);
    expect(validateWeeklyCapacity(incomplete).ok).toBe(false);

    const overfull = [...DEFAULT_WEEKLY_CAPACITY, DEFAULT_WEEKLY_CAPACITY[0]];
    expect(validateWeeklyCapacity(overfull).ok).toBe(false);
  });

  it("rejects duplicate day indices within 7 days", () => {
    const duplicate = [
      { dayOfWeek: 0, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 0, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 2, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 3, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 4, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 5, totalMinutes: 60, uninterruptedLengths: [60] },
      { dayOfWeek: 6, totalMinutes: 60, uninterruptedLengths: [60] },
    ];
    const res = validateWeeklyCapacity(duplicate);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain("Duplicate capacity pattern");
    }
  });
});

describe("Sprint 07: 80% Burnout Guard & Buffer Calculations", () => {
  it("applies 80% multiplier for safe usable capacity", () => {
    expect(calculateSafeCapacity(100)).toBe(80);
    expect(calculateSafeCapacity(150)).toBe(120);
    expect(calculateSafeCapacity(180)).toBe(144);
    expect(calculateSafeCapacity(0)).toBe(0);
    expect(calculateSafeCapacity(-50)).toBe(0);
  });

  it("computes minimum required declared capacity for a session without buffer violation", () => {
    // 60m session requires 75m declared availability (60 / 0.80 = 75)
    expect(calculateRequiredDeclaredCapacity(60)).toBe(75);
    // 90m session requires 113m declared availability (ceil(90 / 0.80) = 113)
    expect(calculateRequiredDeclaredCapacity(90)).toBe(113);
    // 45m session requires 57m declared availability (ceil(45 / 0.80) = 57)
    expect(calculateRequiredDeclaredCapacity(45)).toBe(57);
  });

  it("calculates weekly summary metrics accurately", () => {
    const summary = calculateWeeklySummary(DEFAULT_WEEKLY_CAPACITY);
    // 5 weekdays * 150 + 2 weekend days * 180 = 750 + 360 = 1110 minutes
    expect(summary.totalDeclaredMinutes).toBe(1110);
    expect(summary.safeUsableMinutes).toBe(Math.floor(1110 * BURNOUT_GUARD_RATIO)); // 888
    expect(summary.burnoutBufferMinutes).toBe(1110 - 888); // 222
    expect(summary.maxUninterruptedBlock).toBe(120);
    expect(summary.averageDailyMinutes).toBe(Math.round(1110 / 7)); // 159
  });
});

describe("Sprint 07: Contiguous Slot Fitting Rules", () => {
  const sampleDay: CapacityPattern = {
    dayOfWeek: 1,
    totalMinutes: 180, // Safe limit = 144m
    uninterruptedLengths: [60, 60, 40],
  };

  it("rejects task exceeding daily 80% burnout guard limit", () => {
    // 150m exceeds 144m safe limit even though total declared is 180m
    const res = canFitTaskOnDay(sampleDay, 150, true);
    expect(res.canFit).toBe(false);
    expect(res.reason).toContain("exceeds 80% daily burnout guard capacity");
  });

  it("rejects contiguous task when no single uninterrupted block is large enough", () => {
    // A 70m OA cannot be split into [60, 10]; longest available opening is 60m
    const res = canFitTaskOnDay(sampleDay, 70, true);
    expect(res.canFit).toBe(false);
    expect(res.reason).toContain("longest available opening is 60m");
    expect(res.maxAvailableSlot).toBe(60);
  });

  it("permits contiguous task when an uninterrupted opening is sufficient", () => {
    const dayWithLongSlot: CapacityPattern = {
      dayOfWeek: 6,
      totalMinutes: 180, // Safe limit = 144m
      uninterruptedLengths: [90, 60],
    };
    const res = canFitTaskOnDay(dayWithLongSlot, 70, true);
    expect(res.canFit).toBe(true);
    expect(res.maxAvailableSlot).toBe(90);
  });

  it("permits non-contiguous task as long as safe daily capacity accommodates it", () => {
    // When requiresUninterrupted is false, a 100m total task fits within 144m safe limit
    const res = canFitTaskOnDay(sampleDay, 100, false);
    expect(res.canFit).toBe(true);
  });
});

describe("Sprint 07: AC-04 CGPA Gating Invariant", () => {
  it("guarantees CGPA gating is strictly not enforced", () => {
    expect(isCgpaGatingEnforced()).toBe(false);
  });

  it("allows CGPA to be omitted, valid float, or zero without impacting schemas", () => {
    const base = {
      timezone: "Asia/Kolkata",
      major: "CSE",
      graduationDate: "2026-12-01",
      primaryLanguage: "Python",
      targetRoles: ["general SDE/backend"],
      targetCompanies: ["CRED"],
      targetDate: "2026-11-30",
      weeklyCapacity: [...DEFAULT_WEEKLY_CAPACITY],
    };

    expect(OnboardingInputSchema.safeParse(base).success).toBe(true);
    expect(OnboardingInputSchema.safeParse({ ...base, cgpa: 8.75 }).success).toBe(true);
    expect(OnboardingInputSchema.safeParse({ ...base, cgpa: 0 }).success).toBe(true);
    expect(OnboardingInputSchema.safeParse({ ...base, cgpa: 10 }).success).toBe(true);
    expect(OnboardingInputSchema.safeParse({ ...base, cgpa: 11 }).success).toBe(false); // max 10
  });
});

describe("Sprint 07: Prefilled Onboarding Data (AC-01)", () => {
  it("provides expected defaults for first-time candidate setup", () => {
    const defaults = getPrefilledOnboardingData();

    expect(defaults.profile.major).toBe("CSE");
    expect(defaults.profile.primaryLanguage).toBe("Python");
    expect(defaults.profile.graduationDate).toBe("2026-12-01");
    expect(defaults.profile.timezone).toBe("Asia/Kolkata");
    expect(defaults.goal.targetRoles).toContain("general SDE/backend");
    expect(defaults.goal.targetCompanies).toContain("CRED");
    expect(defaults.goal.targetDate).toBe("2026-11-30");
    expect(defaults.weeklyCapacity.length).toBe(7);
  });
});

describe("Sprint 07: Identity Service Lifecycle & Goal Versioning (AC-03)", () => {
  const TEST_OWNER = "test-owner-sprint07";

  beforeEach(() => {
    resetDevIdentityStore();
  });

  it("initializes complete identity state on onboarding completion", async () => {
    const prefill = getPrefilledOnboardingData();
    const result = await completeOnboarding(TEST_OWNER, {
      ...prefill.profile,
      ...prefill.goal,
      weeklyCapacity: prefill.weeklyCapacity,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isOnboarded).toBe(true);
      expect(result.data.profile?.major).toBe("CSE");
      expect(result.data.currentGoal?.version).toBe(1);
      expect(result.data.currentGoal?.targetCompanies).toContain("CRED");
      expect(result.data.capacities.length).toBe(7);
      expect(result.data.capacitySummary.totalDeclaredMinutes).toBe(1110);
    }
  });

  it("increments goal version monotonically on updates (AC-03)", async () => {
    const prefill = getPrefilledOnboardingData();
    await completeOnboarding(TEST_OWNER, {
      ...prefill.profile,
      ...prefill.goal,
      weeklyCapacity: prefill.weeklyCapacity,
    });

    // Update goal: revision v2
    const v2Res = await updateGoal(TEST_OWNER, {
      targetRoles: ["general SDE/backend", "distributed systems"],
      targetCompanies: ["CRED", "Google"],
      targetDate: "2026-12-15",
    });

    expect(v2Res.ok).toBe(true);
    if (v2Res.ok) {
      expect(v2Res.data.version).toBe(2);
      expect(v2Res.data.targetCompanies).toEqual(["CRED", "Google"]);
    }

    // Update goal: revision v3
    const v3Res = await updateGoal(TEST_OWNER, {
      targetRoles: ["backend infra"],
      targetCompanies: ["CRED", "Uber"],
      targetDate: "2026-12-31",
    });

    expect(v3Res.ok).toBe(true);
    if (v3Res.ok) {
      expect(v3Res.data.version).toBe(3);
    }

    // Verify history retained in identity state
    const stateRes = await getIdentityState(TEST_OWNER);
    expect(stateRes.ok).toBe(true);
    if (stateRes.ok) {
      expect(stateRes.data.currentGoal?.version).toBe(3);
      expect(stateRes.data.goalHistory.length).toBe(3);
      expect(stateRes.data.goalHistory.map((g) => g.version)).toEqual([3, 2, 1]);
    }
  });

  it("updates profile attributes while preserving existing unedited values", async () => {
    const prefill = getPrefilledOnboardingData();
    await completeOnboarding(TEST_OWNER, {
      ...prefill.profile,
      ...prefill.goal,
      weeklyCapacity: prefill.weeklyCapacity,
    });

    const updateRes = await updateProfile(TEST_OWNER, {
      primaryLanguage: "Go",
      cgpa: 8.45,
    });

    expect(updateRes.ok).toBe(true);
    if (updateRes.ok) {
      expect(updateRes.data.primaryLanguage).toBe("Go");
      expect(updateRes.data.cgpa).toBe(8.45);
      expect(updateRes.data.major).toBe("CSE"); // preserved
      expect(updateRes.data.timezone).toBe("Asia/Kolkata"); // preserved
    }
  });

  it("updates 7-day capacity and recalculates weekly summary", async () => {
    const prefill = getPrefilledOnboardingData();
    await completeOnboarding(TEST_OWNER, {
      ...prefill.profile,
      ...prefill.goal,
      weeklyCapacity: prefill.weeklyCapacity,
    });

    const newCapacities: CapacityPattern[] = DEFAULT_WEEKLY_CAPACITY.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      totalMinutes: 120,
      uninterruptedLengths: [90],
    }));

    const updateRes = await updateWeeklyCapacity(TEST_OWNER, {
      capacities: newCapacities,
    });

    expect(updateRes.ok).toBe(true);
    if (updateRes.ok) {
      expect(updateRes.data.summary.totalDeclaredMinutes).toBe(840); // 7 * 120
      expect(updateRes.data.summary.safeUsableMinutes).toBe(Math.floor(840 * 0.8)); // 672
      expect(updateRes.data.summary.burnoutBufferMinutes).toBe(168);
    }
  });
});
