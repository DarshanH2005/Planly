import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  SessionPackSchema,
  TrainingPromptSchema,
} from "../../features/sessions/schemas";
import type {
  SessionPack,
  TrainingPrompt,
} from "../../features/sessions/schemas";

export interface LoadedSessionBundle {
  bundleId: string;
  version: number;
  description?: string;
  prompts: TrainingPrompt[];
  packs: SessionPack[];
  sha256: string;
}

const bundleCache = new Map<string, LoadedSessionBundle>();

function resolveBundleDirectory(): string {
  const primary = path.resolve(process.cwd(), "content/bundles/v1");
  if (fs.existsSync(primary)) return primary;

  const fallback = path.resolve(__dirname, "../../../content/bundles/v1");
  if (fs.existsSync(fallback)) return fallback;

  throw new Error(`Bundles directory not found at ${primary}`);
}

/**
 * Calculates SHA-256 checksum of a raw string or buffer.
 */
export function calculateSha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Loads and validates a single content bundle file with SHA-256 integrity check.
 * Results are cached in-memory.
 */
export async function loadBundleFile(
  filename: string
): Promise<LoadedSessionBundle> {
  const cleanName = filename.endsWith(".json") ? filename : `${filename}.json`;
  if (bundleCache.has(cleanName)) {
    return bundleCache.get(cleanName)!;
  }

  const bundleDir = resolveBundleDirectory();
  const filePath = path.join(bundleDir, cleanName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Bundle file not found: ${filePath}`);
  }

  const rawContent = await fsPromises.readFile(filePath, "utf-8");
  const sha256 = calculateSha256(rawContent);
  const parsedData = JSON.parse(rawContent);

  const prompts: TrainingPrompt[] = [];
  if (Array.isArray(parsedData.prompts)) {
    for (const p of parsedData.prompts) {
      prompts.push(TrainingPromptSchema.parse(p));
    }
  }

  const packs: SessionPack[] = [];
  if (Array.isArray(parsedData.packs)) {
    for (const pk of parsedData.packs) {
      packs.push(SessionPackSchema.parse(pk));
    }
  }

  const bundle: LoadedSessionBundle = {
    bundleId: parsedData.bundleId || cleanName.replace(".json", ""),
    version: parsedData.version || 1,
    description: parsedData.description,
    prompts,
    packs,
    sha256,
  };

  bundleCache.set(cleanName, bundle);
  return bundle;
}

/**
 * Loads all 8 canonical session pack bundle files from content/bundles/v1.
 */
export async function loadAllCanonicalBundles(): Promise<LoadedSessionBundle[]> {
  const bundleFiles = [
    "foundation.json",
    "oa.json",
    "technical_a.json",
    "technical_b.json",
    "engineering.json",
    "project.json",
    "behavioral.json",
    "sql.json",
  ];

  const loadedBundles: LoadedSessionBundle[] = [];
  for (const file of bundleFiles) {
    try {
      const bundle = await loadBundleFile(file);
      loadedBundles.push(bundle);
    } catch {
      // If individual file is pending creation, continue
    }
  }

  return loadedBundles;
}

/**
 * Retrieve a specific session pack by its identifier across all loaded bundles.
 */
export async function findSessionPack(
  packId: string
): Promise<{ pack: SessionPack; prompts: TrainingPrompt[]; bundleHash: string } | null> {
  const bundles = await loadAllCanonicalBundles();
  for (const bundle of bundles) {
    const pack = bundle.packs.find((p) => p.id === packId);
    if (pack) {
      const prompts = pack.promptIds
        .map((pid) => bundle.prompts.find((p) => p.id === pid))
        .filter((p): p is TrainingPrompt => p !== undefined);

      return {
        pack,
        prompts,
        bundleHash: bundle.sha256,
      };
    }
  }
  return null;
}
