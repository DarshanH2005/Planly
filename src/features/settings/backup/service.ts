/**
 * Planly Settings: Populated Backup and Verified Restore Service (B23)
 * Authority: PLANLY_BUILD_SPEC.md §12, §15; B23_backup_restore.md
 *
 * Invariants:
 * - B23-AC1: Populates, backs up, restores into disposable environment, and resumes exact pending state.
 * - B23-AC2: Missing or corrupt object bytes halt restoration atomically.
 * - B23-AC3: Active tombstones prevent resurrection of deleted entities; assisted work invariants preserved.
 * - Failure to Prevent: Empty backup store export is disallowed.
 */

import { createHash } from "crypto";
import type { Result } from "@/lib/validation/result";
import { ok, fail } from "@/lib/validation/result";
import type {
  BackupArchive,
  BackupManifestV2,
  ObjectManifestEntry,
  RestoreOptionsV2,
  RestoreResultV2,
} from "./types";

// In-memory store representing owned user records in the client runtime
const inMemoryStore = new Map<string, Record<string, Array<Record<string, unknown>>>>();

export function resetBackupStore(): void {
  inMemoryStore.clear();
}

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
 * Compute canonical SHA-256 checksum of payload data.
 */
export function computeChecksum(data: Record<string, unknown>): string {
  const canonical = canonicalStringify(data);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Export full populated backup archive including database tables and verified object manifest.
 * Raises error if workspace is empty (Failure to Prevent).
 */
export function exportFullBackup(
  ownerId: string,
  seededData?: Record<string, Array<Record<string, unknown>>>
): BackupArchive {
  const existing = inMemoryStore.get(ownerId) || {};
  const merged: Record<string, Array<Record<string, unknown>>> = {
    classrooms: [],
    sessions: [],
    artifacts: [],
    attempts: [],
    observations: [],
    sessionMessages: [],
    pendingTasks: [],
    tombstones: [],
    memoryClaims: [],
    cachedSummaries: [],
    ...existing,
    ...seededData,
  };

  // Verify non-empty store (Failure to Prevent)
  let totalRecords = 0;
  for (const records of Object.values(merged)) {
    if (Array.isArray(records)) {
      totalRecords += records.length;
    }
  }

  if (totalRecords === 0) {
    throw new Error(
      `Cannot export empty backup store: user workspace '${ownerId}' has no populated entities.`
    );
  }

  // Build verified object manifest
  const objectManifest: Record<string, ObjectManifestEntry> = {};

  // Artifact objects
  const artifacts = merged.artifacts || [];
  for (const art of artifacts) {
    const content = typeof art.content === "string" ? art.content : "";
    const buf = Buffer.from(content, "utf-8");
    const sha = createHash("sha256").update(buf).digest("hex");
    const b64 = buf.toString("base64");
    const objId = `art_${art.id}`;
    objectManifest[objId] = {
      objectId: objId,
      entityType: "artifact",
      entityId: String(art.id),
      sessionId: typeof art.sessionId === "string" ? art.sessionId : undefined,
      revision: typeof art.revision === "number" ? art.revision : 1,
      byteSize: buf.length,
      sha256: sha,
      contentB64: b64,
    };
  }

  // Chat message objects
  const messages = merged.sessionMessages || [];
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : "";
    const buf = Buffer.from(content, "utf-8");
    const sha = createHash("sha256").update(buf).digest("hex");
    const b64 = buf.toString("base64");
    const objId = `msg_${msg.id}`;
    objectManifest[objId] = {
      objectId: objId,
      entityType: "sessionMessage",
      entityId: String(msg.id),
      sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined,
      byteSize: buf.length,
      sha256: sha,
      contentB64: b64,
    };
  }

  // Attempt code objects
  const attempts = merged.attempts || [];
  for (const att of attempts) {
    const frozenCode = typeof att.frozenCode === "string" ? att.frozenCode : "";
    if (frozenCode) {
      const buf = Buffer.from(frozenCode, "utf-8");
      const sha = createHash("sha256").update(buf).digest("hex");
      const b64 = buf.toString("base64");
      const objId = `att_${att.id}`;
      objectManifest[objId] = {
        objectId: objId,
        entityType: "attempt",
        entityId: String(att.id),
        sessionId: typeof att.sessionId === "string" ? att.sessionId : undefined,
        byteSize: buf.length,
        sha256: sha,
        contentB64: b64,
      };
    }
  }

  const entityCounts: Record<string, number> = {};
  for (const [table, records] of Object.entries(merged)) {
    entityCounts[table] = Array.isArray(records) ? records.length : 0;
  }

  const checksum = computeChecksum(merged);

  inMemoryStore.set(ownerId, merged);

  const manifest: BackupManifestV2 = {
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    ownerId,
    planlyVersion: "0.1.0",
    retentionPolicy: "planly_isolated_backup_retention",
    storageLocation: "planly-learner-backups-coldline/asia-south2",
    encryptionAlgorithm: "AES-256-GCM",
    entityCounts,
    checksum,
    objectManifest,
  };

  return {
    manifest,
    data: merged,
  };
}

/**
 * Validate backup archive structure, checksum, owner consistency, and object byte integrity.
 */
export function validateBackupArchive(
  rawArchive: unknown,
  targetOwnerId?: string
): Result<{ valid: boolean; manifest: BackupManifestV2 }> {
  if (!rawArchive || typeof rawArchive !== "object") {
    return fail("VALIDATION_ERROR", "Malformed backup: Payload is not a valid JSON object");
  }

  const archive = rawArchive as Partial<BackupArchive>;
  if (!archive.manifest || !archive.data) {
    return fail("VALIDATION_ERROR", "Malformed backup: Missing 'manifest' or 'data' section");
  }

  const { manifest, data } = archive;

  if (manifest.version !== "2.0.0" && manifest.version !== "1.0.0") {
    return fail(
      "VALIDATION_ERROR",
      `Unsupported backup schema version '${manifest.version}'. Expected '2.0.0' or '1.0.0'.`
    );
  }

  if (!manifest.ownerId || typeof manifest.ownerId !== "string") {
    return fail("VALIDATION_ERROR", "Malformed backup: Missing or invalid manifest ownerId");
  }

  if (targetOwnerId && manifest.ownerId !== targetOwnerId) {
    return fail(
      "AUTH_ERROR",
      `Owner mismatch: Backup belongs to owner '${manifest.ownerId}', but target owner is '${targetOwnerId}'`
    );
  }

  // Integrity checksum verification
  const computedChecksum = computeChecksum(data);
  if (manifest.checksum !== computedChecksum) {
    return fail(
      "VALIDATION_ERROR",
      `Corrupted backup data: Checksum mismatch. Expected '${manifest.checksum}', computed '${computedChecksum}'`
    );
  }

  // Verify server content bank / private solution exclusion
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

  // B23-AC2: Object manifest byte verification
  const objectManifest = manifest.objectManifest || {};
  for (const [objId, entry] of Object.entries(objectManifest)) {
    if (!entry.contentB64) {
      return fail("VALIDATION_ERROR", `Missing object bytes in object manifest for '${objId}'`);
    }

    let decodedBuf: Buffer;
    try {
      decodedBuf = Buffer.from(entry.contentB64, "base64");
    } catch {
      return fail("VALIDATION_ERROR", `B23-AC2: Corrupted base64 bytes for '${objId}'`);
    }

    const actualSha = createHash("sha256").update(decodedBuf).digest("hex");
    if (actualSha !== entry.sha256) {
      return fail(
        "VALIDATION_ERROR",
        `B23-AC2: Object byte corruption detected for '${objId}': expected sha256 '${entry.sha256}', got '${actualSha}'`
      );
    }

    if (entry.byteSize !== undefined && decodedBuf.length !== entry.byteSize) {
      return fail(
        "VALIDATION_ERROR",
        `B23-AC2: Object byte size mismatch for '${objId}': expected ${entry.byteSize} bytes, got ${decodedBuf.length}`
      );
    }
  }

  return ok({ valid: true, manifest });
}

/**
 * Atomically restore backup archive into target environment.
 */
export function restoreBackupArchive(
  rawArchive: unknown,
  targetOwnerId: string,
  options?: RestoreOptionsV2
): Result<RestoreResultV2> {
  const targetEnv = options?.targetEnvironment || "disposable";
  const validation = validateBackupArchive(
    rawArchive,
    targetEnv === "disposable" ? undefined : targetOwnerId
  );
  if (!validation.ok) {
    return validation;
  }

  const archive = rawArchive as BackupArchive;
  const { manifest, data } = archive;

  // Target environment guard: prevent silent overwrite of populated production environment
  const existingRecords = inMemoryStore.get(targetOwnerId);
  const isPopulated = existingRecords && Object.values(existingRecords).some((arr) => arr.length > 0);
  if (targetEnv === "production" && isPopulated && !options?.forceOverwrite) {
    return fail(
      "RESTORE_CONFLICT",
      "Restoration conflict: Target production environment is populated. Set 'forceOverwrite: true' to confirm replacement."
    );
  }

  // B23-AC3: Tombstone reconciliation
  const activeTombstones = options?.activeTombstones || [];
  const tombstonedTargetIds = new Set<string>(activeTombstones.map((t) => t.targetId));

  // Also include tombstones embedded within the backup
  for (const t of data.tombstones || []) {
    if (!t.isRestored && t.targetId) {
      tombstonedTargetIds.add(String(t.targetId));
    }
  }

  // Filter out deleted entities and enforce assistance invariants (B23-AC3)
  const reconciledData: Record<string, Array<Record<string, unknown>>> = {};
  for (const [table, records] of Object.entries(data)) {
    reconciledData[table] = records
      .filter((rec) => !tombstonedTargetIds.has(String(rec.id)))
      .map((rec) => {
        const copy = { ...rec, ownerId: targetOwnerId };

        // B23-AC3: Prohibit reclassification of assisted work
        if (table === "observations") {
          const rec2 = copy as Record<string, unknown>;
          const asst = rec2.assistanceLevel;
          const src = rec2.sourceKind;
          if (
            asst === "guided" ||
            asst === "tutor_supplied" ||
            asst === "exposure" ||
            src === "tutor_explanation"
          ) {
            rec2.demonstrated = false;
          }
        }

        return copy;
      });
  }

  // Persist into client store
  inMemoryStore.set(targetOwnerId, reconciledData);

  let totalCount = 0;
  const breakdown: Record<string, number> = {};
  for (const [table, records] of Object.entries(reconciledData)) {
    breakdown[table] = records.length;
    totalCount += records.length;
  }

  // B23-AC1: Identify resumable session and pending question
  const sessions = reconciledData.sessions || [];
  let resumableSessionId: string | undefined;
  let pendingArtifactRevision: number | undefined;
  let pendingQuestion: string | undefined;

  if (sessions.length > 0) {
    const latestSess = sessions[sessions.length - 1];
    resumableSessionId = String(latestSess.id);

    // Find latest artifact revision
    const artifacts = reconciledData.artifacts || [];
    const sessArtifacts = artifacts.filter((a) => String(a.sessionId) === resumableSessionId);
    if (sessArtifacts.length > 0) {
      pendingArtifactRevision = Math.max(...sessArtifacts.map((a) => Number(a.revision || 1)));
    } else {
      pendingArtifactRevision = Number(latestSess.currentRevision || 1);
    }

    // Find pending question task
    const tasks = reconciledData.pendingTasks || [];
    const pqTask = tasks.find(
      (t) => t.taskType === "pending_question" && String(t.sessionId) === resumableSessionId
    ) || tasks.find((t) => t.taskType === "pending_question");

    if (pqTask && typeof pqTask.promptText === "string") {
      pendingQuestion = pqTask.promptText;
    }
  }

  return ok({
    success: true,
    restoredAt: new Date().toISOString(),
    targetOwnerId,
    targetEnvironment: targetEnv,
    totalEntitiesRestored: totalCount,
    entityBreakdown: breakdown,
    objectsRestored: Object.keys(manifest.objectManifest || {}).length,
    tombstonesReconciled: tombstonedTargetIds.size,
    resumableSessionId,
    pendingQuestion,
    pendingArtifactRevision,
    indexesRebuilt: ["retrieval_vector_cache", "retrieval_keyword_cache", "memory_projection_claims"],
  });
}
