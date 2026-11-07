"use client";

import React, { useState } from "react";
import {
  exportFullBackup,
  validateBackupArchive,
  restoreBackupArchive,
} from "./service";
import type {
  RestoreTargetEnv,
  RestoreResultV2,
  BackupArchive,
} from "./types";

interface BackupPanelProps {
  ownerId: string;
}

export function BackupPanel({ ownerId }: BackupPanelProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [targetEnv, setTargetEnv] = useState<RestoreTargetEnv>("disposable");
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResultV2 | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      // Trigger authenticated backup export via API or client service
      const res = await fetch("/api/backup/export");
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `planly-backup-${ownerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage("Backup archive downloaded successfully.");
      } else {
        // Fallback to client service
        const archive = exportFullBackup(ownerId);
        const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `planly-backup-${ownerId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage("Backup archive downloaded successfully.");
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setRestoreResult(null);

    try {
      const text = await file.text();
      const archive = JSON.parse(text) as BackupArchive;

      // Validate archive and object manifest bytes
      const val = validateBackupArchive(archive, ownerId);
      if (!val.ok) {
        setErrorMessage(`Validation error [${val.code}]: ${val.message}`);
        setIsRestoring(false);
        return;
      }

      // Execute restoration
      const res = restoreBackupArchive(archive, ownerId, {
        targetEnvironment: targetEnv,
        forceOverwrite,
      });

      if (!res.ok) {
        setErrorMessage(`Restoration failed [${res.code}]: ${res.message}`);
      } else {
        setRestoreResult(res.data);
        setStatusMessage(`Restoration succeeded into '${targetEnv}'!`);
      }
    } catch (err: unknown) {
      setErrorMessage(`Error reading file: ${(err as Error).message}`);
    } finally {
      setIsRestoring(false);
      // Reset input
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Populated Backup & Verified Restore</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Recover real study history, uploaded bytes, and pending work across isolated environments.
        </p>
      </div>

      {/* Retention Policy Card */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-medium text-foreground">Coldline Storage & Retention Policy</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-muted sm:grid-cols-3">
          <div className="rounded border border-border bg-background p-2.5">
            <span className="font-semibold text-foreground">Differential Retention:</span>
            <p className="mt-1">30 days differential / 90 days weekly archives</p>
          </div>
          <div className="rounded border border-border bg-background p-2.5">
            <span className="font-semibold text-foreground">Storage Target:</span>
            <p className="mt-1">planly-learner-backups-coldline (asia-south2)</p>
          </div>
          <div className="rounded border border-border bg-background p-2.5">
            <span className="font-semibold text-foreground">Encryption & Checksum:</span>
            <p className="mt-1">AES-256-GCM + SHA-256 Object Byte Manifest</p>
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="flex items-center justify-between border-t border-zinc-800/80 pt-5">
        <div>
          <h4 className="text-sm font-medium text-zinc-200">Full Archive Export</h4>
          <p className="text-xs text-zinc-400">
            Bundles canonical tables, chat logs, artifact revisions, and an explicit object manifest.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="pressable rounded-lg bg-success px-4 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {isExporting ? "Exporting..." : "Export Full Backup"}
        </button>
      </div>

      {/* Restore Section */}
      <div className="border-t border-zinc-800/80 pt-5 space-y-4">
        <div>
          <h4 className="text-sm font-medium text-zinc-200">Verified Restore</h4>
          <p className="text-xs text-zinc-400">
            Validates hashes, ownership, and object bytes. Reconciles active privacy tombstones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="text-xs text-muted">
            Target Environment:
            <select
              value={targetEnv}
              onChange={(e) => setTargetEnv(e.target.value as RestoreTargetEnv)}
              className="ml-2 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground"
            >
              <option value="disposable">Disposable (Safe Sandboxed)</option>
              <option value="staging">Staging</option>
              <option value="production">Production (Guarded)</option>
            </select>
          </label>

          {targetEnv === "production" && (
            <label className="flex items-center gap-1.5 text-xs text-warning">
              <input
                type="checkbox"
                checked={forceOverwrite}
                onChange={(e) => setForceOverwrite(e.target.checked)}
                className="rounded border-border"
              />
              Confirm Production Overwrite
            </label>
          )}

          <label className="pressable cursor-pointer rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90">
            {isRestoring ? "Restoring..." : "Select & Restore Archive"}
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              disabled={isRestoring}
              className="hidden"
            />
          </label>
        </div>

        {/* Status and Error Messages */}
        {statusMessage && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            {errorMessage}
          </div>
        )}

        {/* Restore Result Card */}
        {restoreResult && (
          <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-xs">
            <h5 className="font-semibold text-foreground">Restoration Summary:</h5>
            <div className="grid grid-cols-2 gap-2 text-muted">
              <div>Total Entities Restored: <span className="text-foreground">{restoreResult.totalEntitiesRestored}</span></div>
              <div>Object Payloads Verified: <span className="text-foreground">{restoreResult.objectsRestored}</span></div>
              <div>Tombstones Reconciled: <span className="text-foreground">{restoreResult.tombstonesReconciled}</span></div>
              <div>Environment Target: <span className="text-foreground">{restoreResult.targetEnvironment}</span></div>
            </div>

            {restoreResult.resumableSessionId && (
              <div className="mt-3 rounded-lg border border-success/30 bg-success/5 p-2.5">
                <span className="font-medium text-success">Resumed Pending State:</span>
                <p className="mt-1 text-muted-strong">Session ID: {restoreResult.resumableSessionId}</p>
                <p className="text-muted-strong">Artifact Revision: {restoreResult.pendingArtifactRevision}</p>
                {restoreResult.pendingQuestion && (
                  <p className="mt-1 italic text-muted">Pending: &quot;{restoreResult.pendingQuestion}&quot;</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
