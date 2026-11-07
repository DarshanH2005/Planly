/**
 * Sprint B23 Unit Tests: Populated Backup and Verified Restore
 * Authority: PLANLY_BUILD_SPEC.md §12, §15; B23_backup_restore.md
 *
 * Invariants:
 * - B23-AC1: Populate, back up, restore into disposable environment and resume exact pending state.
 * - B23-AC2: Missing/corrupt object bytes prevent a false successful restore.
 * - B23-AC3: Restoring older data cannot silently undo an applicable deletion or reclassify assisted work.
 * - Failure to Prevent: Exporting a separate empty backup store is rejected.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  exportFullBackup,
  validateBackupArchive,
  restoreBackupArchive,
  resetBackupStore,
  computeChecksum,
} from "@/features/settings/backup/service";
import type { BackupArchive } from "@/features/settings/backup/types";

describe("Sprint B23: Backup and Restore Engine", () => {
  const ownerId = "test_learner_b23_ts";

  const populatedWorkspaceData = {
    classrooms: [
      {
        id: "cls_01",
        ownerId,
        track: "dsa",
        title: "Two Pointers Masterclass",
      },
    ],
    sessions: [
      {
        id: "sess_01",
        ownerId,
        classroomId: "cls_01",
        stage: "foundation",
        mode: "practice",
        currentRevision: 2,
      },
    ],
    artifacts: [
      {
        id: "art_01",
        ownerId,
        sessionId: "sess_01",
        revision: 1,
        content: "def two_sum_brute(): pass",
        language: "python",
      },
      {
        id: "art_02",
        ownerId,
        sessionId: "sess_01",
        revision: 2,
        content: "def two_sum_optimal(): pass",
        language: "python",
      },
    ],
    sessionMessages: [
      {
        id: "msg_01",
        ownerId,
        sessionId: "sess_01",
        senderRole: "learner",
        content: "How do I optimize space for sorted input?",
      },
    ],
    attempts: [
      {
        id: "att_01",
        ownerId,
        sessionId: "sess_01",
        frozenCode: "def two_sum_optimal(): pass",
        assistanceLevel: "guided",
        mode: "practice",
      },
    ],
    observations: [
      {
        id: "obs_01",
        ownerId,
        sessionId: "sess_01",
        competencyKey: "dsa.arrays.two_sum",
        sourceKind: "execution_evidence",
        assistanceLevel: "independent",
        demonstrated: true,
        evidenceText: "Solved Two Sum independently",
      },
      {
        id: "obs_guided",
        ownerId,
        sessionId: "sess_01",
        competencyKey: "dsa.two_pointers.sorted",
        sourceKind: "learner_work",
        assistanceLevel: "guided",
        demonstrated: false,
        evidenceText: "Required guidance on boundary condition",
      },
    ],
    pendingTasks: [
      {
        id: "task_01",
        ownerId,
        classroomId: "cls_01",
        sessionId: "sess_01",
        taskType: "pending_question",
        title: "Two Pointers Variation",
        promptText: "Can you implement this using two pointers in O(1) space?",
        status: "pending",
      },
    ],
  };

  beforeEach(() => {
    resetBackupStore();
  });

  it("B23-AC1: populates, backs up, restores into disposable environment, and resumes exact pending state", () => {
    // 1. Export populated backup archive
    const archive = exportFullBackup(ownerId, populatedWorkspaceData);

    expect(archive.manifest).toBeDefined();
    expect(archive.manifest.version).toBe("2.0.0");
    expect(archive.manifest.ownerId).toBe(ownerId);
    expect(archive.manifest.retentionPolicy).toBe("planly_isolated_backup_retention");
    expect(archive.manifest.storageLocation).toBe("planly-learner-backups-coldline/asia-south2");

    // Verify object manifest entries
    const objectEntries = Object.values(archive.manifest.objectManifest);
    expect(objectEntries.length).toBeGreaterThanOrEqual(4); // 2 artifacts, 1 message, 1 attempt code

    // 2. Clear store and restore into disposable target
    resetBackupStore();
    const targetOwnerId = "disposable_target_ts";

    const res = restoreBackupArchive(archive, targetOwnerId, {
      targetEnvironment: "disposable",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data;
      expect(data.success).toBe(true);
      expect(data.targetOwnerId).toBe(targetOwnerId);
      expect(data.targetEnvironment).toBe("disposable");
      expect(data.resumableSessionId).toBe("sess_01");
      expect(data.pendingArtifactRevision).toBe(2);
      expect(data.pendingQuestion).toBe(
        "Can you implement this using two pointers in O(1) space?"
      );
      expect(data.objectsRestored).toBeGreaterThanOrEqual(4);
      expect(data.indexesRebuilt).toContain("retrieval_vector_cache");
    }
  });

  it("B23-AC2: missing or corrupt object bytes halt restoration atomically", () => {
    const archive = exportFullBackup(ownerId, populatedWorkspaceData);

    // Case A: Corrupted payload byte (hash mismatch)
    const corruptArchive = JSON.parse(JSON.stringify(archive)) as BackupArchive;
    const firstArtKey = Object.keys(corruptArchive.manifest.objectManifest)[0];
    corruptArchive.manifest.objectManifest[firstArtKey].contentB64 = Buffer.from("corrupted").toString("base64");

    const valA = validateBackupArchive(corruptArchive, ownerId);
    expect(valA.ok).toBe(false);
    if (!valA.ok) {
      expect(valA.message).toContain("B23-AC2");
      expect(valA.message).toContain("corruption detected");
    }

    const restoreA = restoreBackupArchive(corruptArchive, "disposable_user");
    expect(restoreA.ok).toBe(false);

    // Case B: Missing object bytes
    const missingArchive = JSON.parse(JSON.stringify(archive)) as BackupArchive;
    missingArchive.manifest.objectManifest[firstArtKey].contentB64 = "";

    const valB = validateBackupArchive(missingArchive, ownerId);
    expect(valB.ok).toBe(false);
    if (!valB.ok) {
      expect(valB.message).toContain("Missing object bytes");
    }
  });

  it("B23-AC3: active privacy tombstones prevent resurrection of deleted entities and preserve assistance invariants", () => {
    const archive = exportFullBackup(ownerId, populatedWorkspaceData);
    const targetOwner = "learner_with_tombstones";

    // 1. Simulate active tombstone for obs_01 in target environment
    const activeTombstones = [
      {
        id: "tomb_obs_01",
        targetId: "obs_01",
        targetType: "observation",
      },
    ];

    // 2. Tamper with guided observation to attempt illegal reclassification
    const tamperedArchive = JSON.parse(JSON.stringify(archive)) as BackupArchive;
    const guidedObs = tamperedArchive.data.observations.find((o) => o.id === "obs_guided");
    if (guidedObs) {
      guidedObs.demonstrated = true; // Illegal reclassification attempt
    }
    tamperedArchive.manifest.checksum = computeChecksum(tamperedArchive.data);

    // 3. Restore backup
    const res = restoreBackupArchive(tamperedArchive, targetOwner, {
      targetEnvironment: "disposable",
      activeTombstones,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.tombstonesReconciled).toBe(1);
    }

    // Verify obs_01 is NOT restored, and obs_guided remains demonstrated=false
    const restoredArchive = exportFullBackup(targetOwner);
    const restoredObs = restoredArchive.data.observations;
    const restoredIds = restoredObs.map((o) => o.id);

    expect(restoredIds).not.toContain("obs_01"); // Tombstoned entity omitted

    const restoredGuided = restoredObs.find((o) => o.id === "obs_guided");
    expect(restoredGuided).toBeDefined();
    expect(restoredGuided?.demonstrated).toBe(false); // Invariant preserved
  });

  it("target isolation: production environment cannot be overwritten without force flag", () => {
    // Populate target workspace first
    exportFullBackup(ownerId, populatedWorkspaceData);

    const archive = exportFullBackup(ownerId, populatedWorkspaceData);

    // Attempt to restore into production target without forceOverwrite
    const failRes = restoreBackupArchive(archive, ownerId, {
      targetEnvironment: "production",
      forceOverwrite: false,
    });

    expect(failRes.ok).toBe(false);
    if (!failRes.ok) {
      expect(failRes.code).toBe("RESTORE_CONFLICT");
      expect(failRes.message).toContain("production environment is populated");
    }

    // With forceOverwrite: true, succeeds
    const successRes = restoreBackupArchive(archive, ownerId, {
      targetEnvironment: "production",
      forceOverwrite: true,
    });

    expect(successRes.ok).toBe(true);
  });

  it("Failure to Prevent: empty backup store export is rejected", () => {
    resetBackupStore();
    expect(() => exportFullBackup("empty_owner_id")).toThrow(
      "Cannot export empty backup store"
    );
  });
});
