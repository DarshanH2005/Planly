import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  CatalogueEntrySchema,
  PatternFamilySchema,
  PatternCardSchema,
  SessionPackSchema,
  TrainingPromptSchema,
} from "./schemas";
import type {
  CatalogueEntry,
  PatternFamily,
  PatternCard,
  SessionPack,
  TrainingPrompt,
  Example,
} from "./schemas";

export interface CandidateSafePromptSnapshot {
  id: string;
  version: number;
  familyIds: string[];
  difficulty: string;
  statement: string;
  constraints: string[];
  examples: Example[];
  /** Available clarification questions without answers revealed */
  availableClarifications: Array<{ id: string; question: string }>;
  /** Clarifications that have been explicitly asked and answered */
  revealedClarifications: Array<{ id: string; question: string; answer: string }>;
  /** Follow-up prompts revealed to the candidate */
  revealedFollowups: Array<{ id: string; question: string }>;
}

export interface CandidateSafePackSnapshot {
  id: string;
  version: number;
  stage: SessionPack["stage"];
  title: string;
  instructions: string;
  durationMinutes: number;
  debriefMinutes: number;
  inputFormat: SessionPack["inputFormat"];
  resourcePolicy: SessionPack["resourcePolicy"];
  promptIds: string[];
  rubricId: string;
  rubricVersion: number;
}

export interface LoadedBundle {
  bundleId: string;
  version: number;
  prompts: TrainingPrompt[];
  packs: SessionPack[];
  sha256: string;
}

let cachedBundle: LoadedBundle | null = null;
let cachedCatalogue: CatalogueEntry[] | null = null;
let cachedPatterns: PatternFamily[] | null = null;

function resolveBundlePath(): string {
  const primary = path.resolve(process.cwd(), "content/bundles/v1/starter-packs.json");
  if (fs.existsSync(primary)) return primary;

  const fallback = path.resolve(__dirname, "../../../content/bundles/v1/starter-packs.json");
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`Content bundle starter-packs.json not found at ${primary}`);
}

function resolveContentPath(filename: string): string {
  const primary = path.resolve(process.cwd(), "content", filename);
  if (fs.existsSync(primary)) return primary;

  const fallback = path.resolve(__dirname, "../../../content", filename);
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`Content file ${filename} not found at ${primary}`);
}

/**
 * Load and validate all 198 catalogue entries asynchronously using fs.promises.
 * Caches in memory for fast retrieval.
 */
export async function loadCatalogueAsync(): Promise<CatalogueEntry[]> {
  if (cachedCatalogue) return cachedCatalogue;

  const filePath = resolveContentPath("catalogue.json");
  const raw = await fsPromises.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid catalogue.json: expected array");
  }

  cachedCatalogue = parsed.map((item: unknown) => CatalogueEntrySchema.parse(item));
  return cachedCatalogue;
}

/**
 * Load and validate all 198 catalogue entries synchronously.
 * Caches in memory for fast retrieval.
 */
export function loadCatalogue(): CatalogueEntry[] {
  if (cachedCatalogue) return cachedCatalogue;

  const filePath = resolveContentPath("catalogue.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid catalogue.json: expected array");
  }

  cachedCatalogue = parsed.map((item: unknown) => CatalogueEntrySchema.parse(item));
  return cachedCatalogue;
}

/**
 * Load and validate all 19 pattern families asynchronously using fs.promises.
 * Caches in memory for fast retrieval.
 */
export async function loadPatternsAsync(): Promise<PatternFamily[]> {
  if (cachedPatterns) return cachedPatterns;

  const filePath = resolveContentPath("patterns.json");
  const raw = await fsPromises.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid patterns.json: expected array");
  }

  cachedPatterns = parsed.map((item: unknown) => PatternFamilySchema.parse(item));
  return cachedPatterns;
}

/**
 * Load and validate all 19 pattern families synchronously.
 * Caches in memory for fast retrieval.
 */
export function loadPatterns(): PatternFamily[] {
  if (cachedPatterns) return cachedPatterns;

  const filePath = resolveContentPath("patterns.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid patterns.json: expected array");
  }

  cachedPatterns = parsed.map((item: unknown) => PatternFamilySchema.parse(item));
  return cachedPatterns;
}

/**
 * Load and validate starter content bundle.
 * Caches in memory for fast synchronous access in server components and actions.
 */
export function loadStarterBundle(): LoadedBundle {
  if (cachedBundle) {
    return cachedBundle;
  }

  const bundlePath = resolveBundlePath();
  const rawContent = fs.readFileSync(bundlePath, "utf-8");
  const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
  const bundleData = JSON.parse(rawContent);

  const prompts: TrainingPrompt[] = [];
  if (Array.isArray(bundleData.prompts)) {
    for (const p of bundleData.prompts) {
      prompts.push(TrainingPromptSchema.parse(p));
    }
  }

  const packs: SessionPack[] = [];
  if (Array.isArray(bundleData.packs)) {
    for (const pk of bundleData.packs) {
      packs.push(SessionPackSchema.parse(pk));
    }
  }

  cachedBundle = {
    bundleId: bundleData.bundleId || "bundle-v1-starter",
    version: bundleData.version || 1,
    prompts,
    packs,
    sha256,
  };

  return cachedBundle;
}

/**
 * Retrieve session pack and prompt models by ID.
 */
export function getPackById(packId: string): {
  pack: SessionPack;
  prompts: TrainingPrompt[];
  bundleHash: string;
} | null {
  const bundle = loadStarterBundle();
  const pack = bundle.packs.find((p) => p.id === packId);
  if (!pack) return null;

  const prompts = pack.promptIds
    .map((pid) => bundle.prompts.find((p) => p.id === pid))
    .filter((p): p is TrainingPrompt => p !== undefined);

  return {
    pack,
    prompts,
    bundleHash: bundle.sha256,
  };
}

/**
 * Retrieve a specific training prompt by ID.
 */
export function getPromptById(promptId: string): TrainingPrompt | null {
  const bundle = loadStarterBundle();
  return bundle.prompts.find((p) => p.id === promptId) ?? null;
}

/**
 * Transform a full TrainingPrompt into a candidate-safe projection (§8.2, AC13).
 */
export function toCandidateSafePrompt(
  prompt: TrainingPrompt,
  options?: {
    revealedClarificationIds?: string[];
    revealedFollowupIds?: string[];
  }
): CandidateSafePromptSnapshot {
  const revealedClarificationIds = new Set(options?.revealedClarificationIds ?? []);
  const revealedFollowupIds = new Set(options?.revealedFollowupIds ?? []);

  const availableClarifications = prompt.clarificationBranches.map((cb) => ({
    id: cb.id,
    question: cb.question,
  }));

  const revealedClarifications = prompt.clarificationBranches
    .filter((cb) => revealedClarificationIds.has(cb.id))
    .map((cb) => ({
      id: cb.id,
      question: cb.question,
      answer: cb.answer,
    }));

  const revealedFollowups = prompt.followups
    .filter((f) => revealedFollowupIds.has(f.id))
    .map((f) => ({
      id: f.id,
      question: f.question,
    }));

  return {
    id: prompt.id,
    version: prompt.version,
    familyIds: prompt.familyIds,
    difficulty: prompt.difficulty,
    statement: prompt.statement,
    constraints: prompt.constraints,
    examples: prompt.examples,
    availableClarifications,
    revealedClarifications,
    revealedFollowups,
  };
}

/**
 * Transform a SessionPack into a candidate-safe configuration snapshot.
 */
export function toCandidateSafePack(pack: SessionPack): CandidateSafePackSnapshot {
  return {
    id: pack.id,
    version: pack.version,
    stage: pack.stage,
    title: pack.title,
    instructions: pack.instructions,
    durationMinutes: pack.durationMinutes,
    debriefMinutes: pack.debriefMinutes,
    inputFormat: pack.inputFormat,
    resourcePolicy: pack.resourcePolicy,
    promptIds: pack.promptIds,
    rubricId: pack.rubricId,
    rubricVersion: pack.rubricVersion,
  };
}

/**
 * Resolves a SessionPack from any sessionId or pack identifier format.
 */
export function resolvePack(
  id: string
): { pack: SessionPack; prompts: TrainingPrompt[]; bundleHash: string } | null {
  if (!id) return null;
  const upper = id.toUpperCase();
  let p = getPackById(upper);
  if (p) return p;

  if (upper.startsWith("SESSION-")) {
    p = getPackById("PACK-" + upper.slice("SESSION-".length));
    if (p) return p;
    p = getPackById(upper.slice("SESSION-".length));
    if (p) return p;
  }

  if (upper.startsWith("PRACTICE-")) {
    p = getPackById(upper.slice("PRACTICE-".length));
    if (p) return p;
    p = getPackById("PACK-" + upper.slice("PRACTICE-".length));
    if (p) return p;
  }

  if (!upper.startsWith("PACK-")) {
    p = getPackById("PACK-" + upper);
    if (p) return p;
  }

  try {
    const bundle = loadStarterBundle();
    const match = bundle.packs.find(
      (pk) =>
        pk.id.toLowerCase() === id.toLowerCase() ||
        pk.id.toLowerCase().includes(id.toLowerCase()) ||
        id.toLowerCase().includes(pk.id.toLowerCase())
    );
    if (match) return getPackById(match.id);
  } catch {
    // Ignore
  }

  return getPackById("PACK-FOUNDATION-01");
}
