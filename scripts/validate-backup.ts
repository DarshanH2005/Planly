/**
 * Planly Backup Validation CLI Command
 *
 * PLANLY_BUILD_SPEC.md §17 (AC24), line 807:
 * npm run backup:validate -- <file>
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { validateBackup } from "../src/features/backup/service";

function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];

  if (!filePath) {
    console.error("Usage: npm run backup:validate -- <path-to-backup.json>");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    console.error(`Error: Backup file not found at ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Validating Planly backup file: ${absolutePath}`);

  try {
    const rawText = readFileSync(absolutePath, "utf-8");
    const json = JSON.parse(rawText);

    const result = validateBackup(json);
    if (!result.ok) {
      console.error(`\n❌ Backup validation failed [${result.code}]:`);
      console.error(result.message);
      process.exit(1);
    }

    const { manifest } = result.data;
    console.log("\n✅ BACKUP VALIDATION SUCCEEDED!");
    console.log(`Schema Version: ${manifest.version}`);
    console.log(`Owner ID:       ${manifest.ownerId}`);
    console.log(`Exported At:    ${manifest.exportedAt}`);
    console.log(`Checksum:       ${manifest.checksum.slice(0, 16)}...`);
    console.log("\nEntity Counts:");
    for (const [table, count] of Object.entries(manifest.entityCounts)) {
      if (count > 0) {
        console.log(`  - ${table}: ${count}`);
      }
    }
  } catch (err: unknown) {
    console.error("Error reading or parsing JSON backup:", (err as Error).message);
    process.exit(1);
  }
}

main();
