import fs from "node:fs";
import path from "node:path";
import {
  CatalogueEntrySchema,
  PatternCardSchema,
} from "./schemas";
import type {
  CatalogueEntry,
  PatternCard,
  Tier,
} from "./schemas";

let cachedCatalogue: CatalogueEntry[] | null = null;
let cachedPatterns: PatternCard[] | null = null;

function getFilePath(filename: string): string {
  const primary = path.resolve(process.cwd(), "content", filename);
  if (fs.existsSync(primary)) return primary;

  const fallback = path.resolve(__dirname, "../../../content", filename);
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`Content file ${filename} not found at ${primary}`);
}

/**
 * Load all 198 catalogue entries.
 * Caches in memory for fast retrieval.
 */
export function loadCatalogue(): CatalogueEntry[] {
  if (cachedCatalogue) return cachedCatalogue;

  const filePath = getFilePath("catalogue.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  cachedCatalogue = parsed.map((item: unknown) => CatalogueEntrySchema.parse(item));
  return cachedCatalogue!;
}

/**
 * Load all 19 pattern reference cards (F01–F19).
 */
export function loadPatterns(): PatternCard[] {
  if (cachedPatterns) return cachedPatterns;

  const filePath = getFilePath("patterns.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  cachedPatterns = parsed.map((item: unknown) => PatternCardSchema.parse(item));
  return cachedPatterns!;
}

export interface CatalogueFilterOptions {
  familyId?: string;
  tier?: Tier;
  sourceGroupNumber?: number;
  searchQuery?: string;
}

/**
 * Search and filter catalogue entries by family, tier, group, or search term.
 */
export function filterCatalogue(
  entries: CatalogueEntry[],
  options: CatalogueFilterOptions
): CatalogueEntry[] {
  return entries.filter((entry) => {
    if (options.familyId && !entry.familyIds.includes(options.familyId)) {
      return false;
    }
    if (options.tier && entry.tier !== options.tier) {
      return false;
    }
    if (options.sourceGroupNumber && entry.sourceGroupNumber !== options.sourceGroupNumber) {
      return false;
    }
    if (options.searchQuery && options.searchQuery.trim().length > 0) {
      const q = options.searchQuery.toLowerCase();
      const matchId = entry.id.toLowerCase().includes(q);
      const matchTitle = entry.title.toLowerCase().includes(q);
      const matchGroup = entry.sourceGroupName.toLowerCase().includes(q);
      const matchNote = entry.patternNote.toLowerCase().includes(q);
      if (!matchId && !matchTitle && !matchGroup && !matchNote) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Deterministic Problem of the Day (POTD) selector (§7.1, R05)
 *
 * Selects a needed problem inside a committed learning/repair slot:
 * 1. Unexposed Tier A entry matching active bottleneck family
 * 2. Any unexposed Tier A entry (first in curriculum order)
 * 3. Any unexposed Tier B entry
 * 4. Fallback to first Tier A entry
 */
export function selectPOTD(
  catalogue: CatalogueEntry[],
  exposedIds: Set<string>,
  activeBottleneckFamilyId?: string
): CatalogueEntry {
  // 1. Bottleneck Tier A
  if (activeBottleneckFamilyId) {
    const candidate = catalogue.find(
      (e) =>
        e.tier === "A" &&
        e.familyIds.includes(activeBottleneckFamilyId) &&
        !exposedIds.has(e.id)
    );
    if (candidate) return candidate;
  }

  // 2. Next unexposed Tier A
  const tierACandidate = catalogue.find((e) => e.tier === "A" && !exposedIds.has(e.id));
  if (tierACandidate) return tierACandidate;

  // 3. Next unexposed Tier B
  const tierBCandidate = catalogue.find((e) => e.tier === "B" && !exposedIds.has(e.id));
  if (tierBCandidate) return tierBCandidate;

  // 4. Default fallback: first Tier A problem
  return catalogue.find((e) => e.tier === "A") ?? catalogue[0];
}
