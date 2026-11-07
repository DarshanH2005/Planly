import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CatalogueEntrySchema,
  PatternCardSchema,
  TrainingPromptSchema,
  SessionPackSchema,
} from "../../src/features/curriculum/schemas.js";

const contentDir = path.resolve(__dirname, "../../content");

describe("Curriculum & Content Verification (AC20, AC08)", () => {
  const catalogue = JSON.parse(
    fs.readFileSync(path.join(contentDir, "catalogue.json"), "utf-8")
  );
  const patterns = JSON.parse(
    fs.readFileSync(path.join(contentDir, "patterns.json"), "utf-8")
  );

  it("retains exactly 198 unique canonical catalogue entries", () => {
    expect(catalogue.length).toBe(198);
    const uniqueIds = new Set(catalogue.map((c: any) => c.id));
    expect(uniqueIds.size).toBe(198);
  });

  it("spans exactly 40 source groups", () => {
    const groups = new Set(catalogue.map((c: any) => c.sourceGroupNumber));
    expect(groups.size).toBe(40);
  });

  it("matches revised tier totals: A:82, B:78, C:38", () => {
    const tiers = { A: 0, B: 0, C: 0 };
    for (const c of catalogue) {
      if (c.tier in tiers) {
        tiers[c.tier as keyof typeof tiers]++;
      }
    }
    expect(tiers.A).toBe(82);
    expect(tiers.B).toBe(78);
    expect(tiers.C).toBe(38);
  });

  it("contains exactly 19 pattern cards with F01-F19 IDs", () => {
    expect(patterns.length).toBe(19);
    for (let i = 1; i <= 19; i++) {
      const expectedId = `F${i.toString().padStart(2, "0")}`;
      expect(patterns.some((p: any) => p.id === expectedId)).toBe(true);
    }
  });

  it("validates all starter pack prompts and session packs in bundle v1", () => {
    const bundle = JSON.parse(
      fs.readFileSync(
        path.join(contentDir, "bundles", "v1", "starter-packs.json"),
        "utf-8"
      )
    );

    expect(bundle.prompts.length).toBeGreaterThan(0);
    expect(bundle.packs.length).toBeGreaterThan(0);

    for (const prompt of bundle.prompts) {
      const parseRes = TrainingPromptSchema.safeParse(prompt);
      expect(parseRes.success).toBe(true);
    }

    for (const pack of bundle.packs) {
      const parseRes = SessionPackSchema.safeParse(pack);
      expect(parseRes.success).toBe(true);
    }
  });

  it("rejects an invalid catalogue entry with wrong tier or ID format", () => {
    const invalidEntry = {
      id: "invalid_id",
      title: "Test Problem",
      tier: "X",
      sourceGroupNumber: 99,
      sourceGroupName: "Fake Group",
      patternNote: "note",
      familyIds: [],
    };
    const parseRes = CatalogueEntrySchema.safeParse(invalidEntry);
    expect(parseRes.success).toBe(false);
  });
});
