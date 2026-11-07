import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  UserProfile,
  UserGoal,
  CapacityPattern,
  DEFAULT_PROFILE_VALUES,
  DEFAULT_GOAL_VALUES,
  DEFAULT_WEEKLY_CAPACITY,
} from "./schemas";

/**
 * Sprint 07: Identity Repository
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Multi-tenant PostgreSQL database queries with RLS and owner_id scoping.
 *
 * CRITICAL CONSTRAINTS:
 * - MUST NOT use SELECT * in DB queries (strictly list explicit columns).
 * - Composite key scoping by owner_id.
 * - Supports local dev in-memory fallback when Supabase is not configured.
 */

// Explicit column lists per table (enforcing no SELECT * constraint)
const PROFILE_COLUMNS = "id, owner_id, timezone, major, graduation_date, primary_language, cgpa, created_at, updated_at";
const GOAL_COLUMNS = "id, owner_id, version, target_roles, target_companies, target_date, created_at";
const CAPACITY_COLUMNS = "id, owner_id, day_of_week, total_minutes, uninterrupted_lengths, created_at";

// In-memory fallback for local development / testing without live Supabase
interface DevIdentityStore {
  profiles: Map<string, UserProfile>;
  goals: Map<string, UserGoal[]>;
  capacities: Map<string, CapacityPattern[]>;
}

const devStore: DevIdentityStore = {
  profiles: new Map(),
  goals: new Map(),
  capacities: new Map(),
};

/**
 * Retrieves the user profile for a given owner.
 */
export async function findProfileByOwner(ownerId: string): Promise<UserProfile | null> {
  if (!isSupabaseConfigured()) {
    return devStore.profiles.get(ownerId) ?? null;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    timezone: data.timezone as string,
    major: data.major as string,
    graduationDate: data.graduation_date as string,
    primaryLanguage: data.primary_language as string,
    cgpa: data.cgpa != null ? Number(data.cgpa) : undefined,
  };
}

/**
 * Upserts a user profile for the given owner.
 */
export async function upsertProfile(
  ownerId: string,
  profileData: {
    timezone: string;
    major: string;
    graduationDate: string;
    primaryLanguage: string;
    cgpa?: number | null;
  }
): Promise<UserProfile> {
  const profileId = crypto.randomUUID();

  if (!isSupabaseConfigured()) {
    const existing = devStore.profiles.get(ownerId);
    const updated: UserProfile = {
      id: existing?.id ?? profileId,
      ownerId,
      timezone: profileData.timezone,
      major: profileData.major,
      graduationDate: profileData.graduationDate,
      primaryLanguage: profileData.primaryLanguage,
      cgpa: profileData.cgpa ?? undefined,
    };
    devStore.profiles.set(ownerId, updated);
    return updated;
  }

  const supabase = await createServerSupabaseClient();
  const existing = await findProfileByOwner(ownerId);

  const payload = {
    id: existing?.id ?? profileId,
    owner_id: ownerId,
    timezone: profileData.timezone,
    major: profileData.major,
    graduation_date: profileData.graduationDate,
    primary_language: profileData.primaryLanguage,
    cgpa: profileData.cgpa ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(payload, { onConflict: "owner_id, id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert user profile: ${error?.message || "Unknown error"}`);
  }

  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    timezone: data.timezone as string,
    major: data.major as string,
    graduationDate: data.graduation_date as string,
    primaryLanguage: data.primary_language as string,
    cgpa: data.cgpa != null ? Number(data.cgpa) : undefined,
  };
}

/**
 * Retrieves the latest goal (highest version number) for a given owner.
 */
export async function findLatestGoalByOwner(ownerId: string): Promise<UserGoal | null> {
  if (!isSupabaseConfigured()) {
    const goals = devStore.goals.get(ownerId) ?? [];
    if (goals.length === 0) return null;
    return goals.reduce((latest, current) => (current.version > latest.version ? current : latest), goals[0]);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_goals")
    .select(GOAL_COLUMNS)
    .eq("owner_id", ownerId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    version: data.version as number,
    targetRoles: data.target_roles as string[],
    targetCompanies: data.target_companies as string[],
    targetDate: data.target_date as string,
  };
}

/**
 * Retrieves all versions of user goals for audit and calibration history.
 */
export async function findGoalHistoryByOwner(ownerId: string): Promise<UserGoal[]> {
  if (!isSupabaseConfigured()) {
    const goals = devStore.goals.get(ownerId) ?? [];
    return [...goals].sort((a, b) => b.version - a.version);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_goals")
    .select(GOAL_COLUMNS)
    .eq("owner_id", ownerId)
    .order("version", { ascending: false });

  if (error || !data) return [];

  return data.map((d: any) => ({
    id: d.id as string,
    ownerId: d.owner_id as string,
    version: d.version as number,
    targetRoles: d.target_roles as string[],
    targetCompanies: d.target_companies as string[],
    targetDate: d.target_date as string,
  }));
}

/**
 * Inserts a new user goal record (AC-03: incrementing version rather than overwriting).
 */
export async function insertGoal(
  ownerId: string,
  goalData: {
    version: number;
    targetRoles: string[];
    targetCompanies: string[];
    targetDate: string;
  }
): Promise<UserGoal> {
  const goalId = crypto.randomUUID();

  if (!isSupabaseConfigured()) {
    const goals = devStore.goals.get(ownerId) ?? [];
    const newGoal: UserGoal = {
      id: goalId,
      ownerId,
      version: goalData.version,
      targetRoles: [...goalData.targetRoles],
      targetCompanies: [...goalData.targetCompanies],
      targetDate: goalData.targetDate,
    };
    devStore.goals.set(ownerId, [...goals, newGoal]);
    return newGoal;
  }

  const supabase = await createServerSupabaseClient();
  const payload = {
    id: goalId,
    owner_id: ownerId,
    version: goalData.version,
    target_roles: goalData.targetRoles,
    target_companies: goalData.targetCompanies,
    target_date: goalData.targetDate,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("user_goals")
    .insert(payload)
    .select(GOAL_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert user goal: ${error?.message || "Unknown error"}`);
  }

  return {
    id: data.id as string,
    ownerId: data.owner_id as string,
    version: data.version as number,
    targetRoles: data.target_roles as string[],
    targetCompanies: data.target_companies as string[],
    targetDate: data.target_date as string,
  };
}

/**
 * Retrieves the 7-day capacity patterns for an owner.
 */
export async function findCapacitiesByOwner(ownerId: string): Promise<CapacityPattern[]> {
  if (!isSupabaseConfigured()) {
    const capacities = devStore.capacities.get(ownerId);
    if (!capacities || capacities.length === 0) return [];
    return [...capacities].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_capacities")
    .select(CAPACITY_COLUMNS)
    .eq("owner_id", ownerId)
    .order("day_of_week", { ascending: true });

  if (error || !data) return [];

  return data.map((d: any) => ({
    dayOfWeek: d.day_of_week as number,
    totalMinutes: d.total_minutes as number,
    uninterruptedLengths: d.uninterrupted_lengths as number[],
  }));
}

/**
 * Saves or updates all 7 daily capacity patterns for an owner.
 */
export async function upsertCapacities(
  ownerId: string,
  capacities: readonly CapacityPattern[]
): Promise<CapacityPattern[]> {
  if (!isSupabaseConfigured()) {
    devStore.capacities.set(ownerId, [...capacities]);
    return [...capacities].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  const supabase = await createServerSupabaseClient();
  const payload = capacities.map((c) => ({
    owner_id: ownerId,
    day_of_week: c.dayOfWeek,
    total_minutes: c.totalMinutes,
    uninterrupted_lengths: c.uninterruptedLengths,
    created_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("user_capacities")
    .upsert(payload, { onConflict: "owner_id, day_of_week" })
    .select(CAPACITY_COLUMNS)
    .order("day_of_week", { ascending: true });

  if (error || !data) {
    throw new Error(`Failed to upsert weekly capacities: ${error?.message || "Unknown error"}`);
  }

  return data.map((d: any) => ({
    dayOfWeek: d.day_of_week as number,
    totalMinutes: d.total_minutes as number,
    uninterruptedLengths: d.uninterrupted_lengths as number[],
  }));
}

/**
 * Resets local development store for testing isolation.
 */
export function resetDevIdentityStore(): void {
  devStore.profiles.clear();
  devStore.goals.clear();
  devStore.capacities.clear();
}
