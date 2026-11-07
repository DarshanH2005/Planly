/**
 * Planly Backup & Restore Type Definitions
 *
 * PLANLY_BUILD_SPEC.md §12.2, §16, §17 (AC24), R16:
 * - Versioned user-data backup format (1.0.0)
 * - Bundles all owned application tables
 * - Excludes private unrevealed server content bundles and reference solutions
 * - Single-owner integrity and checksum verification
 */

export interface BackupManifest {
  version: "1.0.0";
  exportedAt: string;         // ISO 8601 UTC timestamp
  ownerId: string;
  planlyVersion: string;
  entityCounts: Record<string, number>;
  checksum: string;           // SHA-256 hash of canonical serialized data
}

export interface OwnedUserData {
  profiles: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
  roleTracks: Array<Record<string, unknown>>;
  sprints: Array<Record<string, unknown>>;
  planRevisions: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  taskDependencies: Array<Record<string, unknown>>;
  dailyLogs: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  sessionPrompts: Array<Record<string, unknown>>;
  drafts: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  sessionEvents: Array<Record<string, unknown>>;
  executionEvidence: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  competencyEvidence: Array<Record<string, unknown>>;
  learningCards: Array<Record<string, unknown>>;
  repairs: Array<Record<string, unknown>>;
  recallItems: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  applications: Array<Record<string, unknown>>;
  weeklyReviews: Array<Record<string, unknown>>;
  exposures: Array<Record<string, unknown>>;
}

export interface BackupPayload {
  manifest: BackupManifest;
  data: OwnedUserData;
}

export interface RestoreOptions {
  overwriteExisting?: boolean;
}

export interface RestoreResult {
  success: boolean;
  restoredAt: string;
  ownerId: string;
  totalEntitiesRestored: number;
  entityBreakdown: Record<string, number>;
}
