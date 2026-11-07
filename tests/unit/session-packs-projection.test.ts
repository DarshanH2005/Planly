import { describe, it, expect } from "vitest";
import { projectPrompt, projectSessionPack } from "../../src/server/content/projection";
import {
  loadBundleFile,
  loadAllCanonicalBundles,
  findSessionPack,
} from "../../src/server/content/loader";
import type { TrainingPrompt, SessionPack } from "../../src/features/sessions/schemas";

const samplePrompt: TrainingPrompt = {
  id: "TEST-PROMPT-01",
  version: 1,
  status: "validated",
  familyIds: ["F01"],
  difficulty: "medium",
  statement: "Sample problem statement.",
  constraints: ["1 <= n <= 100"],
  examples: [{ input: "[1, 2]", expected: "3" }],
  clarificationBranches: [
    {
      id: "clarify-01",
      question: "Can input be negative?",
      answer: "No, strictly positive.",
    },
  ],
  followups: [
    {
      id: "fup-01",
      trigger: "optimized_solution",
      question: "Can you do it in O(1) auxiliary space?",
      criterion: "Identifies mathematical formula rather than hash map.",
    },
  ],
  privateReference: {
    approach: "Secret internal reference solution using Gauss formula.",
    checks: ["Check bounds", "Check overflow"],
    expectedComplexity: "O(1) space",
  },
  repairLinks: [
    {
      competency: "time_complexity",
      drillId: "DRILL-01",
      retestIds: ["RETEST-01"],
    },
  ],
  reservedForRetest: false,
  source: {
    kind: "official",
    note: "Internal benchmark",
    confidence: "confirmed",
  },
};

const samplePack: SessionPack = {
  id: "PACK-TEST-01",
  version: 1,
  stage: "technical_a",
  status: "validated",
  title: "Test Session Pack",
  instructions: "Complete the test session.",
  durationMinutes: 45,
  debriefMinutes: 15,
  inputFormat: "function",
  resourcePolicy: { docs: false, ai: false, hints: false, notes: true },
  promptIds: ["TEST-PROMPT-01"],
  rubricId: "rubric-test-v1",
  rubricVersion: 1,
  prerequisites: [],
  source: {
    kind: "official",
    note: "Test pack metadata",
    confidence: "confirmed",
  },
};

describe("Sprint 05: Session Packs & Candidate Projection (AC-01, [C11])", () => {
  it("AC-01 & [C11]: strictly removes privateReference and internal rubrics in candidate projection", () => {
    const candidatePrompt = projectPrompt(samplePrompt) as any;

    expect(candidatePrompt.id).toBe("TEST-PROMPT-01");
    expect(candidatePrompt.statement).toBe("Sample problem statement.");
    expect(candidatePrompt.privateReference).toBeUndefined();
    expect(candidatePrompt.repairLinks).toBeUndefined();
    expect(candidatePrompt.source).toBeUndefined();
  });

  it("strips evaluation criteria from follow-ups in candidate projection", () => {
    const candidatePrompt = projectPrompt(samplePrompt, {
      revealedFollowupIds: ["fup-01"],
    }) as any;

    expect(candidatePrompt.revealedFollowups.length).toBe(1);
    expect(candidatePrompt.revealedFollowups[0].question).toBe(
      "Can you do it in O(1) auxiliary space?"
    );
    expect(candidatePrompt.revealedFollowups[0].criterion).toBeUndefined();
  });

  it("hides clarification answers until explicitly revealed", () => {
    // Unrevealed state: questions visible, answers hidden
    const unrevealed = projectPrompt(samplePrompt) as any;
    expect(unrevealed.availableClarifications.length).toBe(1);
    expect(unrevealed.availableClarifications[0].question).toBe("Can input be negative?");
    expect(unrevealed.availableClarifications[0].answer).toBeUndefined();
    expect(unrevealed.revealedClarifications.length).toBe(0);

    // Revealed state: answer included only for revealed ID
    const revealed = projectPrompt(samplePrompt, {
      revealedClarificationIds: ["clarify-01"],
    }) as any;
    expect(revealed.revealedClarifications.length).toBe(1);
    expect(revealed.revealedClarifications[0].answer).toBe("No, strictly positive.");
  });

  it("preserves privateReference and full metadata when isEvaluator is true", () => {
    const evaluatorPrompt = projectPrompt(samplePrompt, { isEvaluator: true }) as any;
    expect(evaluatorPrompt.privateReference).toBeDefined();
    expect(evaluatorPrompt.privateReference.approach).toContain("Secret internal reference");
    expect(evaluatorPrompt.repairLinks).toBeDefined();
    expect(evaluatorPrompt.source).toBeDefined();
  });

  it("sanitizes session pack authoring metadata for candidate projection", () => {
    const candidatePack = projectSessionPack(samplePack) as any;
    expect(candidatePack.id).toBe("PACK-TEST-01");
    expect(candidatePack.title).toBe("Test Session Pack");
    expect(candidatePack.source).toBeUndefined();
  });
});

describe("Sprint 05: Content Bundles & SHA-256 Verification (AC-02, AC-03)", () => {
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

  it("AC-03: all 8 canonical session pack bundles load and validate successfully", async () => {
    for (const filename of bundleFiles) {
      const bundle = await loadBundleFile(filename);
      expect(bundle).toBeDefined();
      expect(bundle.bundleId).toBeTruthy();
      expect(bundle.packs.length).toBeGreaterThanOrEqual(1);
      expect(bundle.prompts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("AC-02: attaches valid 64-character SHA-256 hash to each loaded bundle", async () => {
    for (const filename of bundleFiles) {
      const bundle = await loadBundleFile(filename);
      expect(bundle.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("loads all canonical bundles through loadAllCanonicalBundles", async () => {
    const allBundles = await loadAllCanonicalBundles();
    expect(allBundles.length).toBe(8);
  });

  it("locates specific session packs across bundles using findSessionPack", async () => {
    const found = await findSessionPack("PACK-FOUNDATION-01");
    expect(found).not.toBeNull();
    expect(found?.pack.title).toContain("Foundation Drill");
    expect(found?.prompts.length).toBe(1);
    expect(found?.bundleHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
