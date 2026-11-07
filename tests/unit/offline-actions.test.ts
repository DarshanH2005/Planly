/**
 * Offline & Local Session Store Tests
 *
 * Verifies that when Supabase is offline or when running local practice
 * sessions without DB rows, drafts, attempts, sessions, and reviews are preserved
 * and server actions succeed smoothly without throwing "Session not found".
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  saveLocalDraft,
  getLocalDraft,
  saveLocalAttempts,
  getLocalAttempts,
  saveLocalSession,
  getLocalSession,
  saveLocalReview,
  getLocalReviews,
  saveLocalEvent,
  resetLocalStore,
} from "@/lib/storage/local-store";
import { resolvePack, getPromptById } from "@/features/curriculum/service";

describe("Local Session Store & Curriculum Resolution", () => {
  const testSessionId = "practice-PACK-FOUNDATION-01";
  const testPromptId = "PROMPT-FOUNDATION-01";

  beforeEach(() => {
    resetLocalStore();
  });

  it("resolves packs robustly from various ID formats", () => {
    const pack1 = resolvePack("PACK-FOUNDATION-01");
    expect(pack1).not.toBeNull();
    expect(pack1?.pack.id).toBe("PACK-FOUNDATION-01");

    const pack2 = resolvePack("practice-PACK-FOUNDATION-01");
    expect(pack2).not.toBeNull();
    expect(pack2?.pack.id).toBe("PACK-FOUNDATION-01");

    const pack3 = resolvePack("SESSION-PACK-FOUNDATION-01");
    expect(pack3).not.toBeNull();
    expect(pack3?.pack.id).toBe("PACK-FOUNDATION-01");

    const pack4 = resolvePack("non-existent-fallback");
    expect(pack4).not.toBeNull();
    expect(pack4?.pack.id).toBe("PACK-FOUNDATION-01");
  });

  it("saves and retrieves local drafts across prompts", () => {
    saveLocalDraft({
      sessionId: testSessionId,
      sessionPromptId: testPromptId,
      code: "def solution(nums): return sum(nums)",
      language: "python",
      notes: "O(n) time complexity",
      revision: 2,
      savedAt: new Date().toISOString(),
    });

    const retrieved = getLocalDraft(testSessionId, testPromptId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.code).toBe("def solution(nums): return sum(nums)");
    expect(retrieved?.revision).toBe(2);
    expect(retrieved?.notes).toBe("O(n) time complexity");
  });

  it("saves and retrieves local attempts after finalization", () => {
    const attempts = [
      {
        id: `att-${testSessionId}-${testPromptId}`,
        sessionId: testSessionId,
        sessionPromptId: testPromptId,
        frozenCode: "def solution(nums): return sum(nums)",
        frozenLanguage: "python",
        frozenNotes: "O(n) time complexity",
        finalizedAt: new Date().toISOString(),
        sourceDraftRevision: 2,
      },
    ];

    saveLocalAttempts(testSessionId, attempts);

    const retrieved = getLocalAttempts(testSessionId);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].frozenCode).toBe("def solution(nums): return sum(nums)");
    expect(retrieved[0].sourceDraftRevision).toBe(2);
  });

  it("saves and updates local session status", () => {
    saveLocalSession(testSessionId, {
      state: "finalized",
      finishReason: "submitted",
      mode: "practice",
      isAssisted: false,
    });

    const sess = getLocalSession(testSessionId);
    expect(sess).not.toBeNull();
    expect(sess?.state).toBe("finalized");
    expect(sess?.finishReason).toBe("submitted");
  });

  it("saves and retrieves local review submissions", () => {
    const testReview = {
      id: "rev-001",
      ownerId: "owner-001",
      sessionId: testSessionId,
      revision: 1,
      status: "submitted",
      rubricId: "RUBRIC-TECHNICAL-FOUNDATION",
      rubricVersion: 1,
      submittedAt: new Date().toISOString(),
      evidence: [
        {
          competencyKey: "pattern_selection",
          dimension: "pattern_selection",
          rating: 2,
          observation: "Selected appropriate hash map pattern",
        },
      ],
      learningCard: {
        attemptId: `att-${testSessionId}-${testPromptId}`,
        initialIdea: "Brute force",
        failure: "O(n^2) TLE",
        correctedInsight: "Hash map lookup",
        lesson: "Always consider dictionary lookup for two sum",
      },
    };

    saveLocalReview(testReview);

    const reviews = getLocalReviews(testSessionId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe("rev-001");
    expect(reviews[0].status).toBe("submitted");
  });

  it("retrieves clarification and followup definitions for prompts", () => {
    const pack = resolvePack("PACK-FOUNDATION-01");
    expect(pack).not.toBeNull();
    const promptId = pack!.prompts[0].id; // "FX-HASH-A"
    const promptDef = getPromptById(promptId);
    expect(promptDef).not.toBeNull();
    expect(promptDef?.clarificationBranches.length).toBeGreaterThan(0);
    expect(promptDef?.followups.length).toBeGreaterThan(0);

    const firstClarification = promptDef?.clarificationBranches[0];
    expect(firstClarification?.question).toBeTruthy();
    expect(firstClarification?.answer).toBeTruthy();

    const firstFollowup = promptDef?.followups[0];
    expect(firstFollowup?.question).toBeTruthy();
  });
});
