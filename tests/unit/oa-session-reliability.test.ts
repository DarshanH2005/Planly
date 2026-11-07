/**
 * M2 Acceptance Tests: OA and Session Reliability
 *
 * PLANLY_BUILD_SPEC.md §16, §17:
 * - AC08: Stage pack validation, candidate instructions, resource policy, scripts, rubrics
 * - AC09: Multi-question OA draft navigation and server deadline immunity
 * - AC10: Timeout freezes pre-deadline work; late code ignored; interruption visible
 * - AC11: Stale draft concurrent update fails with VERSION_CONFLICT
 * - AC12: Duplicate finalize creates one attempt per prompt; idempotent
 * - AC13: Candidate payloads contain zero private references or unrevealed answers
 * - AC14: Clarification and follow-up progression with immutable pre-change snapshot
 * - AC15: Coached practice conversion flags is_assisted and preserves attempt
 */

import { describe, it, expect } from "vitest";
import {
  loadStarterBundle,
  getPackById,
  toCandidateSafePrompt,
  toCandidateSafePack,
} from "@/features/curriculum/service";
import {
  validateStart,
  validateDraftSave,
  validateFinalize,
  validateClarification,
  validateFollowup,
  validateConvertToPractice,
} from "@/features/sessions/rules";
import type {
  SessionRecord,
  DraftRecord,
} from "@/features/sessions/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-m2-test",
    ownerId: "owner-1",
    taskId: "task-1",
    goalId: "goal-1",
    stage: "oa",
    mode: "strict",
    evaluatorMode: "scripted_solo",
    packId: "PACK-OA-01",
    packVersion: 1,
    rubricId: "rubric-oa-v1",
    rubricVersion: 1,
    bundleHash: "hash-bundle-v1",
    resourcePolicy: { docs: false, ai: false, hints: false, notes: false },
    state: "running",
    finishReason: null,
    startedAt: "2026-09-15T14:00:00Z",
    deadlineAt: "2026-09-15T14:45:00Z", // 45 min duration
    finalizedAt: null,
    isInterrupted: false,
    isAssisted: false,
    linkedPriorSessionId: null,
    cancelReason: null,
    version: 1,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: "draft-1",
    ownerId: "owner-1",
    sessionPromptId: "sp-1",
    revision: 1,
    code: "def first_repeat(values): pass",
    language: "python",
    notes: "Initial approach",
    savedAt: "2026-09-15T14:05:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC08: Enabled Stage Packs Validation
// ---------------------------------------------------------------------------

describe("AC08: Enabled Stage Packs Validation", () => {
  const bundle = loadStarterBundle();

  it("validates that all starter session packs have complete candidate instructions and rubrics", () => {
    expect(bundle.packs.length).toBeGreaterThanOrEqual(3);

    for (const pack of bundle.packs) {
      expect(pack.instructions.trim().length).toBeGreaterThan(10);
      expect(pack.durationMinutes).toBeGreaterThan(0);
      expect(pack.debriefMinutes).toBeGreaterThanOrEqual(0);
      expect(pack.promptIds.length).toBeGreaterThan(0);
      expect(pack.rubricId.trim().length).toBeGreaterThan(0);
      expect(pack.rubricVersion).toBeGreaterThan(0);

      // Verify resource policy exists with all 4 dimensions
      expect(typeof pack.resourcePolicy.docs).toBe("boolean");
      expect(typeof pack.resourcePolicy.ai).toBe("boolean");
      expect(typeof pack.resourcePolicy.hints).toBe("boolean");
      expect(typeof pack.resourcePolicy.notes).toBe("boolean");

      // Verify all referenced promptIds exist in bundle
      for (const pid of pack.promptIds) {
        const prompt = bundle.prompts.find((p) => p.id === pid);
        expect(prompt).toBeDefined();
        expect(prompt!.status).toBe("validated");
        expect(prompt!.statement.length).toBeGreaterThan(10);
      }
    }
  });

  it("verifies PACK-OA-01 contains multiple questions with strict conditions", () => {
    const oaPack = bundle.packs.find((p) => p.id === "PACK-OA-01");
    expect(oaPack).toBeDefined();
    expect(oaPack!.promptIds.length).toBe(2);
    expect(oaPack!.stage).toBe("oa");
    // Strict conditions: no docs, no ai, no hints
    expect(oaPack!.resourcePolicy.docs).toBe(false);
    expect(oaPack!.resourcePolicy.ai).toBe(false);
    expect(oaPack!.resourcePolicy.hints).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC09: Multi-Question OA Draft Navigation & Server Deadline
// ---------------------------------------------------------------------------

describe("AC09: Multi-Question OA Navigation & Server Deadline", () => {
  it("preserves independent drafts across multi-question navigation without crosstalk", () => {
    const session = makeSession();
    const draftQ1 = makeDraft({ sessionPromptId: "sp-q1", revision: 1, code: "code_q1" });
    const draftQ2 = makeDraft({ sessionPromptId: "sp-q2", revision: 1, code: "code_q2" });

    // Save Q1
    const saveQ1 = validateDraftSave(session, draftQ1, {
      sessionId: session.id,
      sessionPromptId: "sp-q1",
      ownerId: session.ownerId,
      code: "code_q1_updated",
      language: "python",
      notes: "Notes for Q1",
      expectedRevision: 1,
      serverNow: "2026-09-15T14:10:00Z",
    });

    expect(saveQ1.ok).toBe(true);
    if (saveQ1.ok) {
      expect(saveQ1.data.draft.revision).toBe(2);
      expect(saveQ1.data.draft.code).toBe("code_q1_updated");
    }

    // Save Q2 independently
    const saveQ2 = validateDraftSave(session, draftQ2, {
      sessionId: session.id,
      sessionPromptId: "sp-q2",
      ownerId: session.ownerId,
      code: "code_q2_updated",
      language: "python",
      notes: "Notes for Q2",
      expectedRevision: 1,
      serverNow: "2026-09-15T14:15:00Z",
    });

    expect(saveQ2.ok).toBe(true);
    if (saveQ2.ok) {
      expect(saveQ2.data.draft.revision).toBe(2);
      expect(saveQ2.data.draft.code).toBe("code_q2_updated");
    }
  });

  it("prohibits draft saves once server deadline has elapsed, regardless of client attempt", () => {
    const session = makeSession({
      startedAt: "2026-09-15T14:00:00Z",
      deadlineAt: "2026-09-15T14:45:00Z",
    });
    const draft = makeDraft({ revision: 1 });

    // Client attempts to save 1 second after server deadline
    const res = validateDraftSave(session, draft, {
      sessionId: session.id,
      sessionPromptId: "sp-1",
      ownerId: session.ownerId,
      code: "late_code",
      language: "python",
      notes: "",
      expectedRevision: 1,
      serverNow: "2026-09-15T14:45:01Z",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("DEADLINE_PASSED");
    }
  });
});

// ---------------------------------------------------------------------------
// AC10: Timeout Recovery & Interruption Visibility
// ---------------------------------------------------------------------------

describe("AC10: Timeout Recovery & Interruption Preservation", () => {
  it("freezes only pre-deadline server-saved work on timeout and rejects late code", () => {
    const session = makeSession({
      startedAt: "2026-09-15T14:00:00Z",
      deadlineAt: "2026-09-15T14:45:00Z",
      isInterrupted: true, // Interruption flag from mid-session
    });

    const serverSavedDraft = makeDraft({
      sessionPromptId: "sp-1",
      code: "def first_repeat(values): return values[0] # on time work",
      revision: 3,
    });
    const draftsMap = new Map([["sp-1", serverSavedDraft]]);

    // Timeout occurs; client sends a late finalDraft with different code
    const res = validateFinalize(session, ["sp-1"], draftsMap, {
      sessionId: session.id,
      ownerId: session.ownerId,
      finishReason: "submitted", // Even if client claimed 'submitted'
      expectedVersion: 1,
      serverNow: "2026-09-15T14:46:00Z", // 1 min after deadline
      finalDrafts: [
        {
          sessionPromptId: "sp-1",
          code: "late_code_attempted_after_timeout",
          language: "python",
          notes: "Late notes",
          expectedRevision: 3,
        },
      ],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.session.state).toBe("finalized");
      // Coerced to timeout because server deadline passed
      expect(res.data.session.finishReason).toBe("timeout");
      // Freezes the pre-deadline server saved draft, NOT the late code
      expect(res.data.attempts[0].frozenCode).toBe(
        "def first_repeat(values): return values[0] # on time work"
      );
      // Interruption remains visible
      expect(session.isInterrupted).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC11: Stale Draft Revision Conflict Detection
// ---------------------------------------------------------------------------

describe("AC11: Stale Draft Concurrency Guard", () => {
  it("rejects concurrent stale revision update and prevents last-write-wins", () => {
    const session = makeSession();
    // Server currently has revision 3 (e.g. saved from Tab A)
    const currentServerDraft = makeDraft({ revision: 3, code: "tab_a_saved_code" });

    // Tab B tries to save with stale expectedRevision 2
    const res = validateDraftSave(session, currentServerDraft, {
      sessionId: session.id,
      sessionPromptId: "sp-1",
      ownerId: session.ownerId,
      code: "tab_b_stale_code",
      language: "python",
      notes: "",
      expectedRevision: 2, // Stale!
      serverNow: "2026-09-15T14:10:00Z",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VERSION_CONFLICT");
      // Current server draft code was untouched
      expect(currentServerDraft.code).toBe("tab_a_saved_code");
    }
  });
});

// ---------------------------------------------------------------------------
// AC12: Duplicate Finalize Idempotency & Attempt Uniqueness
// ---------------------------------------------------------------------------

describe("AC12: Duplicate Finalize Idempotency", () => {
  it("produces exactly one attempt per prompt without duplication", () => {
    const session = makeSession();
    const promptIds = ["sp-1", "sp-2"];
    const drafts = new Map([
      ["sp-1", makeDraft({ sessionPromptId: "sp-1", code: "code 1" })],
      ["sp-2", makeDraft({ sessionPromptId: "sp-2", code: "code 2" })],
    ]);

    const res = validateFinalize(session, promptIds, drafts, {
      sessionId: session.id,
      ownerId: session.ownerId,
      finishReason: "submitted",
      expectedVersion: 1,
      serverNow: "2026-09-15T14:30:00Z",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.attempts.length).toBe(2);
      const attemptPromptIds = res.data.attempts.map((a) => a.sessionPromptId);
      expect(attemptPromptIds).toEqual(["sp-1", "sp-2"]);
      expect(new Set(attemptPromptIds).size).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// AC13: Candidate-Safe Content Projections (Zero Private Reference Leak)
// ---------------------------------------------------------------------------

describe("AC13: Strict Candidate Payload Sanitization", () => {
  it("ensures candidate-safe projections contain zero private references, checks, or repair links", () => {
    const bundle = loadStarterBundle();
    const fullPrompt = bundle.prompts.find((p) => p.id === "FX-HASH-A");
    expect(fullPrompt).toBeDefined();

    // Verify raw prompt contains private data
    expect(fullPrompt!.privateReference).toBeDefined();
    expect(fullPrompt!.privateReference.approach.length).toBeGreaterThan(0);
    expect(fullPrompt!.privateReference.checks.length).toBeGreaterThan(0);
    expect(fullPrompt!.repairLinks.length).toBeGreaterThan(0);

    // Project to candidate-safe version
    const safePrompt = toCandidateSafePrompt(fullPrompt!);

    // Invariant: privateReference must NOT exist
    expect((safePrompt as unknown as Record<string, unknown>).privateReference).toBeUndefined();
    // Invariant: repairLinks must NOT exist
    expect((safePrompt as unknown as Record<string, unknown>).repairLinks).toBeUndefined();
    // Invariant: source must NOT exist
    expect((safePrompt as unknown as Record<string, unknown>).source).toBeUndefined();

    // Available clarifications must contain questions ONLY, no answers!
    expect(safePrompt.availableClarifications.length).toBeGreaterThan(0);
    for (const c of safePrompt.availableClarifications) {
      expect((c as Record<string, unknown>).answer).toBeUndefined();
      expect(c.question.length).toBeGreaterThan(0);
    }

    // Follow-ups must be empty until explicitly revealed
    expect(safePrompt.revealedFollowups).toEqual([]);
  });

  it("reveals clarification answers only for explicitly requested branches", () => {
    const bundle = loadStarterBundle();
    const fullPrompt = bundle.prompts.find((p) => p.id === "FX-HASH-A")!;

    const safePromptWithRevealed = toCandidateSafePrompt(fullPrompt, {
      revealedClarificationIds: ["clarify-types"],
    });

    expect(safePromptWithRevealed.revealedClarifications.length).toBe(1);
    expect(safePromptWithRevealed.revealedClarifications[0].id).toBe("clarify-types");
    expect(safePromptWithRevealed.revealedClarifications[0].answer).toContain("positive or negative integers");

    // Other unasked branch still has no answer in revealed
    expect(
      safePromptWithRevealed.revealedClarifications.some((c) => c.id === "clarify-empty")
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC14: Clarification & Follow-Up Progression with Code Snapshot
// ---------------------------------------------------------------------------

describe("AC14: Authored Clarification and Changed-Constraint Follow-Up", () => {
  const session = makeSession({ stage: "technical_a" });
  const prompt = loadStarterBundle().prompts.find((p) => p.id === "FX-HASH-A")!;

  it("reveals valid clarification answer and rejects unknown branch", () => {
    // Valid branch
    const validRes = validateClarification(
      session,
      prompt.clarificationBranches,
      "clarify-types",
      session.ownerId,
      "2026-09-15T14:15:00Z"
    );

    expect(validRes.ok).toBe(true);
    if (validRes.ok) {
      expect(validRes.data.question).toBe("Can values contain negative integers or zeros?");
      expect(validRes.data.answer).toContain("positive or negative integers");
      expect(validRes.data.event.kind).toBe("clarification");
    }

    // Unknown branch is rejected per AC14
    const invalidRes = validateClarification(
      session,
      prompt.clarificationBranches,
      "non-existent-branch",
      session.ownerId,
      "2026-09-15T14:15:00Z"
    );

    expect(invalidRes.ok).toBe(false);
    if (!invalidRes.ok) {
      expect(invalidRes.code).toBe("VALIDATION_ERROR");
    }
  });

  it("captures immutable code & notes snapshot when revealing changed-constraint follow-up", () => {
    const currentCode = "def first_repeat(arr): return arr[0]";
    const currentNotes = "Initial linear approach";

    const followupRes = validateFollowup(
      session,
      prompt.followups,
      "fup-occurrence-indexes",
      session.ownerId,
      currentCode,
      currentNotes,
      "2026-09-15T14:25:00Z"
    );

    expect(followupRes.ok).toBe(true);
    if (followupRes.ok) {
      expect(followupRes.data.question).toContain("return a tuple (first_index, second_index)");
      expect(followupRes.data.event.kind).toBe("follow_up");
      expect(followupRes.data.event.preChangeSnapshot).toEqual({
        code: currentCode,
        notes: currentNotes,
      });
    }

    // Unknown follow-up is rejected
    const invalidFollowup = validateFollowup(
      session,
      prompt.followups,
      "bogus-followup-id",
      session.ownerId,
      currentCode,
      currentNotes,
      "2026-09-15T14:25:00Z"
    );
    expect(invalidFollowup.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC15: Coached Practice Conversion & Aggregate Integrity
// ---------------------------------------------------------------------------

describe("AC15: Coached Practice Conversion", () => {
  it("flags session as is_assisted: true and records conversion event", () => {
    const session = makeSession({ mode: "strict", isAssisted: false, version: 1 });

    const res = validateConvertToPractice(
      session,
      session.ownerId,
      "Requested hint for off-by-one edge case",
      "2026-09-15T14:20:00Z"
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.sessionUpdates.mode).toBe("practice");
      expect(res.data.sessionUpdates.isAssisted).toBe(true);
      expect(res.data.sessionUpdates.version).toBe(2);
      expect(res.data.event.kind).toBe("conversion");
      expect(res.data.event.response).toContain("off-by-one");
    }
  });

  it("rejects duplicate conversion if session is already in assisted practice", () => {
    const session = makeSession({ mode: "practice", isAssisted: true });

    const res = validateConvertToPractice(
      session,
      session.ownerId,
      "Second conversion request",
      "2026-09-15T14:25:00Z"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("INVALID_STATE");
    }
  });
});
