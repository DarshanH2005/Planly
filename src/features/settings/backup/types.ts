/**
 * Planly Settings: Populated Backup and Verified Restore Types (B23)
 * Authority: PLANLY_BUILD_SPEC.md §12, §15; B23_backup_restore.md
 */

export type RestoreTargetEnv = "disposable" | "staging" | "production";

export interface ObjectManifestEntry {
  objectId: string;
  entityType: string;
  entityId: string;
  sessionId?: string;
  revision?: number;
  byteSize: number;
  sha256: string;
  contentB64: string;
}

export interface BackupRetentionPolicy {
  version: string;
  policyName: string;
  retention: {
    dailySnapshotsDays: number;
    weeklyArchivesDays: number;
    hardPurgeAfterDays: number;
  };
  storage: {
    primaryRegion: string;
    backupRegion: string;
    isolatedBucket: string;
    requireSeparateStorageLocation: boolean;
  };
  encryption: {
    algorithm: string;
    keyRotationDays: number;
    requireClientSideEnvelope: boolean;
  };
  integrity: {
    checksumAlgorithm: string;
    verifyObjectManifestBytes: boolean;
    disallowEmptyStores: boolean;
  };
  tombstoneReconciliation: {
    reconcileActiveTombstonesOnRestore: boolean;
    prohibitDeletedEntityResurrection: boolean;
    preserveAssistanceLevelInvariants: boolean;
  };
}

export interface BackupManifestV2 {
  version: "2.0.0" | "1.0.0";
  exportedAt: string;
  ownerId: string;
  planlyVersion: string;
  retentionPolicy?: string;
  storageLocation?: string;
  encryptionAlgorithm?: string;
  entityCounts: Record<string, number>;
  checksum: string;
  objectManifest: Record<string, ObjectManifestEntry>;
}

export interface BackupArchive {
  manifest: BackupManifestV2;
  data: Record<string, Array<Record<string, unknown>>>;
}

export interface RestoreOptionsV2 {
  targetEnvironment?: RestoreTargetEnv;
  forceOverwrite?: boolean;
  activeTombstones?: Array<{ id: string; targetId: string; targetType: string }>;
}

export interface RestoreResultV2 {
  success: boolean;
  restoredAt: string;
  targetOwnerId: string;
  targetEnvironment: RestoreTargetEnv;
  totalEntitiesRestored: number;
  entityBreakdown: Record<string, number>;
  objectsRestored: number;
  tombstonesReconciled: number;
  resumableSessionId?: string;
  pendingQuestion?: string;
  pendingArtifactRevision?: number;
  indexesRebuilt: string[];
}
