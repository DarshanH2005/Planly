/**
 * Planly Authenticated Backup Restoration CLI Command
 *
 * PLANLY_BUILD_SPEC.md §5, §17 (AC24), line 808:
 * npm run backup:restore -- <file> [--overwrite]
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { restoreUserData } from "../src/features/backup/service";

function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const overwrite = args.includes("--overwrite");

  if (!filePath) {
    console.error("Usage: npm run backup:restore -- <path-to-backup.json> [--overwrite]");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    console.error(`Error: Backup file not found at ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Restoring Planly user workspace from: ${absolutePath}`);

  try {
    const rawText = readFileSync(absolutePath, "utf-8");
    const json = JSON.parse(rawText);

    const ownerId = json?.manifest?.ownerId ?? "dev-owner-001";
    // For CLI restore, empty workspace is simulated unless overwrite is set
    const workspaceEmpty = true;

    const result = restoreUserData(json, ownerId, workspaceEmpty, { overwriteExisting: overwrite });
    if (!result.ok) {
      console.error(`\n❌ Restoration failed [${result.code}]:`);
      console.error(result.message);
      process.exit(1);
    }

    const res = result.data;
    console.log("\n✅ WORKSPACE RESTORATION SUCCEEDED!");
    console.log(`Owner ID:       ${res.ownerId}`);
    console.log(`Restored At:    ${res.restoredAt}`);
    console.log(`Total Entities: ${res.totalEntitiesRestored}`);
    console.log("\nRestored Entity Breakdown:");
    for (const [table, count] of Object.entries(res.entityBreakdown)) {
      if (count > 0) {
        console.log(`  - ${table}: ${count}`);
      }
    }
  } catch (err: unknown) {
    console.error("Error executing restoration:", (err as Error).message);
    process.exit(1);
  }
}

main();
