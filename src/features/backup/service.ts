/**
 * Planly Backup & Restore Service
 *
 * PLANLY_BUILD_SPEC.md §12.2, §16, §17 (AC24), R16:
 * - Versioned user-data export and atomic restore engine
 * - Single-owner validation: rejects mixed-owner records or unauthorized target owners
 * - Empty workspace guard: refuses to overwrite non-empty workspaces without explicit flag
 * - Checksum verification (SHA-256)
 * - Excludes private unrevealed server content bundles and reference solutions
 */

import { createHash } from "crypto";
import type { Result } from "@/lib/validation/result";
import { ok, fail } from "@/lib/validation/result";
import type {
  BackupManifest,
  BackupPayload,
  OwnedUserData,
  RestoreOptions,
  RestoreResult,
} from "./types";

// In-memory global store representing owned user data across sessions
const inMemoryOwnedStore = new Map<string, OwnedUserData>();

/**
 * Deterministically stringify any JSON value with sorted keys at all levels.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Compute canonical SHA-256 checksum of user data payload.
 */
export function computeDataChecksum(data: OwnedUserData): string {
  const canonical = canonicalStringify(data);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Initialize an empty owned data container.
 */
export function createEmptyUserData(): OwnedUserData {
  return {
    profiles: [],
    goals: [],
    roleTracks: [],
    sprints: [],
    planRevisions: [],
    tasks: [],
    taskDependencies: [],
    dailyLogs: [],
    sessions: [],
    sessionPrompts: [],
    drafts: [],
    attempts: [],
    sessionEvents: [],
    executionEvidence: [],
    reviews: [],
    competencyEvidence: [],
    learningCards: [],
    repairs: [],
    recallItems: [],
    projects: [],
    applications: [],
    weeklyReviews: [],
    exposures: [],
  };
}

/**
 * Export all owned data for a user (§16, R16).
 * Excludes private content bank / solutions per AC24.
 */
export function exportUserData(
  ownerId: string,
  seededData?: Partial<OwnedUserData>
): BackupPayload {
  const existing = inMemoryOwnedStore.get(ownerId) ?? createEmptyUserData();
  const merged: OwnedUserData = {
    ...existing,
    ...seededData,
  };

  // Compute entity counts
  const entityCounts: Record<string, number> = {};
  for (const [table, records] of Object.entries(merged)) {
    entityCounts[table] = Array.isArray(records) ? records.length : 0;
  }

  const checksum = computeDataChecksum(merged);

  const manifest: BackupManifest = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    ownerId,
    planlyVersion: "0.1.0",
    entityCounts,
    checksum,
  };

  return {
    manifest,
    data: merged,
  };
}

/**
 * Validate a backup payload structure, checksum, and owner consistency (AC24).
 */
export function validateBackup(
  rawPayload: unknown,
  targetOwnerId?: string
): Result<{ valid: boolean; manifest: BackupManifest }> {
  if (!rawPayload || typeof rawPayload !== "object") {
    return fail("VALIDATION_ERROR", "Malformed backup: Payload is not a valid JSON object");
  }

  const payload = rawPayload as Partial<BackupPayload>;

  if (!payload.manifest || !payload.data) {
    return fail("VALIDATION_ERROR", "Malformed backup: Missing 'manifest' or 'data' section");
  }

  const { manifest, data } = payload;

  if (manifest.version !== "1.0.0") {
    return fail(
      "VALIDATION_ERROR",
      `Unsupported backup schema version '${manifest.version}'. Expected '1.0.0'.`
    );
  }

  if (!manifest.ownerId || typeof manifest.ownerId !== "string") {
    return fail("VALIDATION_ERROR", "Malformed backup: Missing or invalid manifest ownerId");
  }

  // Cross-owner target check (AC24)
  if (targetOwnerId && manifest.ownerId !== targetOwnerId) {
    return fail(
      "AUTH_ERROR",
      `Owner mismatch: Backup belongs to owner '${manifest.ownerId}', but target owner is '${targetOwnerId}'`
    );
  }

  // Integrity checksum verification (AC24)
  const computedChecksum = computeDataChecksum(data as OwnedUserData);
  if (manifest.checksum !== computedChecksum) {
    return fail(
      "VALIDATION_ERROR",
      `Corrupted backup data: Checksum mismatch. Expected '${manifest.checksum}', computed '${computedChecksum}'`
    );
  }

  // Single-owner invariant verification: every record in every table must match manifest ownerId (AC24)
  for (const [table, records] of Object.entries(data)) {
    if (Array.isArray(records)) {
      for (const record of records) {
        if (record && typeof record === "object") {
          const recOwner = (record as Record<string, unknown>).ownerId ??
            (record as Record<string, unknown>).owner_id;
          if (recOwner && recOwner !== manifest.ownerId) {
            return fail(
              "AUTH_ERROR",
              `Integrity violation in table '${table}': Record belongs to owner '${recOwner}', conflicting with manifest owner '${manifest.ownerId}'`
            );
          }
        }
      }
    }
  }

  // Verify server content bank / private solution exclusion (AC24)
  const dataKeys = Object.keys(data);
  const prohibitedKeys = ["trainingPrompts", "privateReference", "testSuites", "rubricBundles"];
  for (const key of prohibitedKeys) {
    if (dataKeys.includes(key)) {
      return fail(
        "FORBIDDEN",
        `Security violation: Backup payload contains server content bank key '${key}' which must remain server-side.`
      );
    }
  }

  return ok({ valid: true, manifest });
}

/**
 * Atomically restore user data into an empty workspace (R16, AC24).
 * Refuses to overwrite a non-empty workspace unless explicitly requested.
 */
export function restoreUserData(
  rawPayload: unknown,
  targetOwnerId: string,
  workspaceIsEmpty: boolean,
  options?: RestoreOptions
): Result<RestoreResult> {
  const validation = validateBackup(rawPayload, targetOwnerId);
  if (!validation.ok) {
    return validation; // Fails atomically
  }

  // Non-empty workspace guard (AC24)
  if (!workspaceIsEmpty && !options?.overwriteExisting) {
    return fail(
      "RESTORE_CONFLICT",
      "Restoration failed: Workspace already contains user records. Set 'overwriteExisting: true' to confirm replacement."
    );
  }

  const payload = rawPayload as BackupPayload;
  const { manifest, data } = payload;

  // Persist restored records
  inMemoryOwnedStore.set(targetOwnerId, data);

  let totalCount = 0;
  const breakdown: Record<string, number> = {};
  for (const [table, records] of Object.entries(data)) {
    const count = Array.isArray(records) ? records.length : 0;
    breakdown[table] = count;
    totalCount += count;
  }

  return ok({
    success: true,
    restoredAt: new Date().toISOString(),
    ownerId: targetOwnerId,
    totalEntitiesRestored: totalCount,
    entityBreakdown: breakdown,
  });
}
