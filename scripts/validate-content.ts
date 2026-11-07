import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CatalogueEntrySchema,
  PatternCardSchema,
  TrainingPromptSchema,
  SessionPackSchema,
} from "../src/features/curriculum/schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contentDir = path.resolve(__dirname, "../content");

function runValidation() {
  console.log("=== Planly Content & Curriculum Validation ===");
  let errors: string[] = [];

  // 1. Validate Catalogue
  const cataloguePath = path.join(contentDir, "catalogue.json");
  if (!fs.existsSync(cataloguePath)) {
    console.error("Missing content/catalogue.json");
    process.exit(1);
  }

  const catalogue = JSON.parse(fs.readFileSync(cataloguePath, "utf-8"));
  if (!Array.isArray(catalogue)) {
    console.error("Catalogue is not an array");
    process.exit(1);
  }

  console.log(`Checking ${catalogue.length} catalogue entries...`);
  const uniqueIds = new Set<string>();
  const groupNumbers = new Set<number>();
  const tierCounts: Record<string, number> = { A: 0, B: 0, C: 0 };

  catalogue.forEach((entry, idx) => {
    const parseRes = CatalogueEntrySchema.safeParse(entry);
    if (!parseRes.success) {
      errors.push(`Catalogue entry [${idx}] ${entry.id || "unknown"}: ${parseRes.error.message}`);
    }
    if (uniqueIds.has(entry.id)) {
      errors.push(`Duplicate catalogue ID: ${entry.id}`);
    }
    uniqueIds.add(entry.id);
    groupNumbers.add(entry.sourceGroupNumber);
    if (tierCounts[entry.tier] !== undefined) {
      tierCounts[entry.tier]++;
    }
  });

  if (catalogue.length !== 198) {
    errors.push(`Expected exactly 198 catalogue entries, got ${catalogue.length}`);
  }
  if (groupNumbers.size !== 40) {
    errors.push(`Expected exactly 40 source groups, got ${groupNumbers.size}`);
  }
  if (tierCounts.A !== 82 || tierCounts.B !== 78 || tierCounts.C !== 38) {
    errors.push(
      `Tier mismatch: expected A=82, B=78, C=38; got A=${tierCounts.A}, B=${tierCounts.B}, C=${tierCounts.C}`
    );
  }

  // 2. Validate Pattern Cards
  const patternsPath = path.join(contentDir, "patterns.json");
  if (!fs.existsSync(patternsPath)) {
    errors.push("Missing content/patterns.json");
  } else {
    const patterns = JSON.parse(fs.readFileSync(patternsPath, "utf-8"));
    if (!Array.isArray(patterns)) {
      errors.push("Patterns is not an array");
    } else {
      console.log(`Checking ${patterns.length} pattern cards...`);
      if (patterns.length !== 19) {
        errors.push(`Expected 19 pattern cards, got ${patterns.length}`);
      }
      patterns.forEach((pattern, idx) => {
        const parseRes = PatternCardSchema.safeParse(pattern);
        if (!parseRes.success) {
          errors.push(`Pattern card [${idx}] ${pattern.id}: ${parseRes.error.message}`);
        }
      });
    }
  }

  // 3. Validate Starter Packs & Bundles
  const bundlesDir = path.join(contentDir, "bundles", "v1");
  if (!fs.existsSync(bundlesDir)) {
    errors.push("Missing content/bundles/v1 directory");
  } else {
    const bundleFiles = fs.readdirSync(bundlesDir).filter((f) => f.endsWith(".json"));
    const allPromptsMap = new Map<string, any>();

    for (const bundleFile of bundleFiles) {
      const bundlePath = path.join(bundlesDir, bundleFile);
      const rawContent = fs.readFileSync(bundlePath, "utf-8");
      const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
      const bundleData = JSON.parse(rawContent);

      console.log(`Validating bundle ${bundleFile} (SHA-256: ${sha256.slice(0, 12)}...)...`);

      if (Array.isArray(bundleData.prompts)) {
        for (const prompt of bundleData.prompts) {
          const res = TrainingPromptSchema.safeParse(prompt);
          if (!res.success) {
            errors.push(`Prompt ${prompt.id} invalid: ${res.error.message}`);
          }
          allPromptsMap.set(prompt.id, prompt);
        }
      }

      if (Array.isArray(bundleData.packs)) {
        for (const pack of bundleData.packs) {
          const res = SessionPackSchema.safeParse(pack);
          if (!res.success) {
            errors.push(`Pack ${pack.id} invalid: ${res.error.message}`);
          }
          // Check promptIds exist
          for (const pid of pack.promptIds) {
            if (!bundleData.prompts.some((p: any) => p.id === pid)) {
              errors.push(`Pack ${pack.id} references missing prompt ${pid}`);
            }
          }
        }
      }
    }

    // Verify repair links in prompts
    for (const [pid, prompt] of allPromptsMap) {
      if (prompt.repairLinks) {
        for (const link of prompt.repairLinks) {
          if (link.drillId && !allPromptsMap.has(link.drillId)) {
            errors.push(`Prompt ${pid} drillId '${link.drillId}' not found in registered prompts`);
          }
          for (const retestId of link.retestIds || []) {
            if (!allPromptsMap.has(retestId)) {
              errors.push(`Prompt ${pid} retestId '${retestId}' not found in registered prompts`);
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\nValidation FAILED with ${errors.length} error(s):`);
    errors.forEach((err) => console.error(` - ${err}`));
    process.exit(1);
  }

  console.log("\nALL CURRICULUM AND CONTENT CHECKS PASSED! (AC20, AC08)");
}

runValidation();
