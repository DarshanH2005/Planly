/**
 * M5 Acceptance Tests: Backup & Restore Engine (AC24, R16)
 *
 * PLANLY_BUILD_SPEC.md §12.2, §16, §17 (AC24), R16:
 * - Versioned user-data backup round-trips into an empty workspace without changing evidence meanings.
 * - Restoring into a non-empty workspace fails atomically unless overwrite is explicitly requested.
 * - Checksum mismatch or malformed JSON fails atomically.
 * - Mixed-owner records or unauthorized target owners are rejected.
 * - Server content bank / private solutions are excluded from backups.
 */

import { describe, it, expect } from "vitest";
import {
  exportUserData,
  validateBackup,
  restoreUserData,
  computeDataChecksum,
} from "@/features/backup/service";
import type { BackupPayload, OwnedUserData } from "@/features/backup/types";

describe("AC24: Backup & Restore Invariants", () => {
  const ownerId = "owner-backup-test-01";

  const sampleSeededData: Partial<OwnedUserData> = {
    profiles: [
      {
        id: "prof-1",
        ownerId,
        name: "Test Candidate",
        language: "python",
        timezone: "Asia/Kolkata",
      },
    ],
    goals: [
      {
        id: "goal-1",
        ownerId,
        role: "SDE-1",
        checkpointDate: "2026-11-30",
        weeklyTargetMinutes: 1080,
      },
    ],
    sprints: [
      {
        id: "sprint-1",
        ownerId,
        startDate: "2026-09-14",
        endDate: "2026-09-27",
        bottleneck: "boundaries",
      },
    ],
    reviews: [
      {
        id: "rev-1",
        ownerId,
        sessionId: "sess-1",
        revision: 1,
        status: "effective",
      },
    ],
    competencyEvidence: [
      {
        id: "ev-1",
        ownerId,
        reviewId: "rev-1",
        competencyKey: "boundaries",
        dimension: "Testing/debugging",
        rating: 2,
        observation: "Handled boundary and duplicate cases correctly.",
      },
    ],
    projects: [
      {
        id: "proj-1",
        ownerId,
        title: "Planly Workbench",
        problemSolved: "Private structured interview preparation.",
      },
    ],
    applications: [
      {
        id: "app-1",
        ownerId,
        company: "CRED",
        role: "SDE-1",
        stage: "applied",
      },
    ],
  };

  it("exports a valid versioned backup with correct manifest, entity counts, and checksum (R16)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    expect(backup.manifest).toBeDefined();
    expect(backup.manifest.version).toBe("1.0.0");
    expect(backup.manifest.ownerId).toBe(ownerId);
    expect(backup.manifest.planlyVersion).toBe("0.1.0");
    expect(backup.manifest.checksum).toBeDefined();
    expect(backup.manifest.checksum.length).toBe(64); // SHA-256 hex length

    // Check entity counts
    expect(backup.manifest.entityCounts.profiles).toBe(1);
    expect(backup.manifest.entityCounts.goals).toBe(1);
    expect(backup.manifest.entityCounts.sprints).toBe(1);
    expect(backup.manifest.entityCounts.competencyEvidence).toBe(1);
    expect(backup.manifest.entityCounts.projects).toBe(1);
    expect(backup.manifest.entityCounts.applications).toBe(1);
  });

  it("round-trips exported backup into an empty workspace preserving all IDs and evidence (AC24)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    // Validate backup
    const val = validateBackup(backup, ownerId);
    expect(val.ok).toBe(true);

    // Restore into empty workspace
    const res = restoreUserData(backup, ownerId, true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ownerId).toBe(ownerId);
      expect(res.data.totalEntitiesRestored).toBe(7);
      expect(res.data.entityBreakdown.competencyEvidence).toBe(1);
    }
  });

  it("fails atomically when restoring into a non-empty workspace without overwrite flag (AC24)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    // Workspace is NOT empty (workspaceIsEmpty = false)
    const res = restoreUserData(backup, ownerId, false);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("RESTORE_CONFLICT");
      expect(res.message).toContain("Workspace already contains user records");
    }
  });

  it("succeeds restoring into a non-empty workspace when overwriteExisting is explicitly set (AC24)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    const res = restoreUserData(backup, ownerId, false, { overwriteExisting: true });
    expect(res.ok).toBe(true);
  });

  it("rejects corrupted backups where data was modified without updating checksum (AC24)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    // Tamper with data without recomputing checksum
    const tampered = JSON.parse(JSON.stringify(backup)) as BackupPayload;
    tampered.data.profiles[0].name = "Tampered Name";

    const val = validateBackup(tampered, ownerId);
    expect(val.ok).toBe(false);
    if (!val.ok) {
      expect(val.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects backups containing mixed-owner records (AC24 single-owner invariant)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);

    // Inject a foreign record
    const maliciousPayload = JSON.parse(JSON.stringify(backup)) as BackupPayload;
    maliciousPayload.data.applications.push({
      id: "app-malicious",
      ownerId: "attacker-foreign-owner-id", // Conflicting owner!
      company: "Foreign Company",
      role: "Hacker",
      stage: "saved",
    });
    // Update checksum to pass basic hash test
    maliciousPayload.manifest.checksum = computeDataChecksum(maliciousPayload.data);

    const val = validateBackup(maliciousPayload, ownerId);
    expect(val.ok).toBe(false);
    if (!val.ok) {
      expect(val.code).toBe("AUTH_ERROR");
      expect(val.message).toContain("conflicting with manifest owner");
    }
  });

  it("rejects backups targeting a different owner account (AC24 cross-owner isolation)", () => {
    const backup = exportUserData("owner-alice", sampleSeededData);

    // Attempt to restore Alice's backup into Bob's workspace
    const val = validateBackup(backup, "owner-bob");
    expect(val.ok).toBe(false);
    if (!val.ok) {
      expect(val.code).toBe("AUTH_ERROR");
      expect(val.message).toContain("Owner mismatch");
    }
  });

  it("rejects backups with malformed JSON or missing required manifest/data sections (AC24)", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup("not-an-object").ok).toBe(false);
    expect(validateBackup({ manifest: {} }).ok).toBe(false);
    expect(validateBackup({ data: {} }).ok).toBe(false);
  });

  it("rejects backups containing prohibited server content bank or private solutions (AC24)", () => {
    const backup = exportUserData(ownerId, sampleSeededData);
    const leakedPayload = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;

    // Sneak in server content bank
    (leakedPayload.data as Record<string, unknown>).trainingPrompts = [
      { promptId: "PRIVATE-01", solution: "secret code" },
    ];
    (leakedPayload.manifest as Record<string, unknown>).checksum = computeDataChecksum(
      leakedPayload.data as OwnedUserData
    );

    const val = validateBackup(leakedPayload, ownerId);
    expect(val.ok).toBe(false);
    if (!val.ok) {
      expect(val.code).toBe("FORBIDDEN");
      expect(val.message).toContain("server content bank key 'trainingPrompts'");
    }
  });
});
