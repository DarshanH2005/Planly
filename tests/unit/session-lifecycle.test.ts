/**
 * Session Lifecycle Tests
 *
 * PLANLY_BUILD_SPEC.md §9: Validate the session state machine,
 * draft revision locking, deadline enforcement, and finalization.
 */

import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateStart,
  validateDraftSave,
  validateFinalize,
  validateEvent,
  validateCancel,
} from "@/features/sessions/rules";
import type { SessionRecord, DraftRecord } from "@/features/sessions/types";

// ---------------------------------------------------------------------------
// Helper: create a minimal session record
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    ownerId: "owner-1",
    taskId: "task-1",
    goalId: "goal-1",
    stage: "foundation",
    mode: "practice",
    evaluatorMode: "scripted_solo",
    packId: "pack-foundation-1",
    packVersion: 1,
    rubricId: "rubric-technical-1",
    rubricVersion: 1,
    bundleHash: "abc123",
    resourcePolicy: { docs: false, ai: false, hints: false, notes: true },
    state: "planned",
    finishReason: null,
    startedAt: null,
    deadlineAt: null,
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
    code: "def solution(arr): pass",
    language: "python",
    notes: "",
    savedAt: "2026-09-14T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State machine transitions
// ---------------------------------------------------------------------------

describe("canTransition", () => {
  it("allows planned → running", () => {
    expect(canTransition("planned", "running")).toBe(true);
  });
  it("allows running → finalized", () => {
    expect(canTransition("running", "finalized")).toBe(true);
  });
  it("allows finalized → reviewed", () => {
    expect(canTransition("finalized", "reviewed")).toBe(true);
  });
  it("allows reviewed → reviewed (superseding)", () => {
    expect(canTransition("reviewed", "reviewed")).toBe(true);
  });
  it("rejects finalized → running (no going back)", () => {
    expect(canTransition("finalized", "running")).toBe(false);
  });
  it("rejects planned → finalized (must go through running)", () => {
    expect(canTransition("planned", "finalized")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Start session
// ---------------------------------------------------------------------------

describe("validateStart", () => {
  it("succeeds for a planned session with correct owner/version", () => {
    const session = makeSession({ state: "planned", version: 1 });
    const result = validateStart(session, {
      sessionId: "session-1",
      ownerId: "owner-1",
      expectedVersion: 1,
      serverNow: "2026-09-14T10:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.session.state).toBe("running");
      expect(result.data.session.startedAt).toBe("2026-09-14T10:00:00Z");
    }
  });

  it("rejects wrong owner", () => {
    const session = makeSession();
    const result = validateStart(session, {
      sessionId: "session-1",
      ownerId: "other-owner",
      expectedVersion: 1,
      serverNow: "2026-09-14T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AUTH_ERROR");
  });

  it("rejects stale version", () => {
    const session = makeSession({ version: 2 });
    const result = validateStart(session, {
      sessionId: "session-1",
      ownerId: "owner-1",
      expectedVersion: 1,
      serverNow: "2026-09-14T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VERSION_CONFLICT");
  });

  it("rejects if session is not planned", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T09:00:00Z",
      deadlineAt: "2026-09-14T10:30:00Z",
    });
    const result = validateStart(session, {
      sessionId: "session-1",
      ownerId: "owner-1",
      expectedVersion: 1,
      serverNow: "2026-09-14T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_STATE");
  });
});

// ---------------------------------------------------------------------------
// Draft saves with optimistic revision lock
// ---------------------------------------------------------------------------

describe("validateDraftSave", () => {
  it("succeeds with correct revision", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });
    const draft = makeDraft({ revision: 1 });

    const result = validateDraftSave(session, draft, {
      sessionId: "session-1",
      sessionPromptId: "sp-1",
      ownerId: "owner-1",
      code: "def solution(arr): return sorted(arr)",
      language: "python",
      notes: "Using sorted",
      expectedRevision: 1,
      serverNow: "2026-09-14T10:05:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.draft.revision).toBe(2);
    }
  });

  it("rejects stale revision (concurrent tab)", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });
    const draft = makeDraft({ revision: 3 });

    const result = validateDraftSave(session, draft, {
      sessionId: "session-1",
      sessionPromptId: "sp-1",
      ownerId: "owner-1",
      code: "new code",
      language: "python",
      notes: "",
      expectedRevision: 1, // stale!
      serverNow: "2026-09-14T10:05:00Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VERSION_CONFLICT");
  });

  it("rejects save after deadline", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:00:00Z",
    });

    const result = validateDraftSave(session, null, {
      sessionId: "session-1",
      sessionPromptId: "sp-1",
      ownerId: "owner-1",
      code: "late code",
      language: "python",
      notes: "",
      expectedRevision: 0,
      serverNow: "2026-09-14T11:30:00Z", // after deadline
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DEADLINE_PASSED");
  });

  it("rejects save on finalized session", () => {
    const session = makeSession({
      state: "finalized",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:00:00Z",
      finalizedAt: "2026-09-14T10:50:00Z",
      finishReason: "submitted",
    });

    const result = validateDraftSave(session, null, {
      sessionId: "session-1",
      sessionPromptId: "sp-1",
      ownerId: "owner-1",
      code: "post-finalize code",
      language: "python",
      notes: "",
      expectedRevision: 0,
      serverNow: "2026-09-14T10:55:00Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_STATE");
  });
});

// ---------------------------------------------------------------------------
// Finalize session
// ---------------------------------------------------------------------------

describe("validateFinalize", () => {
  it("creates one attempt per prompt on on-time submission", () => {
    const session = makeSession({
      state: "running",
      version: 2,
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });

    const promptIds = ["sp-1", "sp-2"];
    const drafts = new Map([
      ["sp-1", makeDraft({ sessionPromptId: "sp-1", code: "code1", revision: 2 })],
      ["sp-2", makeDraft({ sessionPromptId: "sp-2", code: "code2", revision: 1 })],
    ]);

    const result = validateFinalize(session, promptIds, drafts, {
      sessionId: "session-1",
      ownerId: "owner-1",
      finishReason: "submitted",
      expectedVersion: 2,
      serverNow: "2026-09-14T11:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attempts.length).toBe(2);
      expect(result.data.session.state).toBe("finalized");
      expect(result.data.session.finishReason).toBe("submitted");
      expect(result.data.attempts[0].frozenCode).toBe("code1");
      expect(result.data.attempts[1].frozenCode).toBe("code2");
    }
  });

  it("creates blank attempt for prompts without drafts", () => {
    const session = makeSession({
      state: "running",
      version: 2,
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });

    const result = validateFinalize(session, ["sp-1"], new Map(), {
      sessionId: "session-1",
      ownerId: "owner-1",
      finishReason: "submitted",
      expectedVersion: 2,
      serverNow: "2026-09-14T11:00:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.attempts[0].frozenCode).toBe("");
    }
  });

  it("uses server-saved draft on timeout, ignoring new code", () => {
    const session = makeSession({
      state: "running",
      version: 2,
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:00:00Z",
    });

    const drafts = new Map([
      ["sp-1", makeDraft({ sessionPromptId: "sp-1", code: "server-saved", revision: 3 })],
    ]);

    const result = validateFinalize(session, ["sp-1"], drafts, {
      sessionId: "session-1",
      ownerId: "owner-1",
      finishReason: "submitted",
      expectedVersion: 2,
      serverNow: "2026-09-14T11:30:00Z", // After deadline
      finalDrafts: [
        { sessionPromptId: "sp-1", code: "late-code", language: "python", notes: "", expectedRevision: 3 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should use server-saved code, not the late submission
      expect(result.data.attempts[0].frozenCode).toBe("server-saved");
      expect(result.data.session.finishReason).toBe("timeout");
    }
  });

  it("rejects stale version", () => {
    const session = makeSession({ state: "running", version: 3 });
    const result = validateFinalize(session, [], new Map(), {
      sessionId: "session-1",
      ownerId: "owner-1",
      finishReason: "submitted",
      expectedVersion: 2,
      serverNow: "2026-09-14T11:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VERSION_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// Event recording
// ---------------------------------------------------------------------------

describe("validateEvent", () => {
  it("records follow-up with code snapshot", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });

    const result = validateEvent(session, {
      sessionId: "session-1",
      ownerId: "owner-1",
      kind: "follow_up",
      branchRef: "followup-1",
      response: "Changed constraint: support negative numbers",
      currentCode: "def solution(arr): return sorted(arr)",
      currentNotes: "Initial approach",
      serverNow: "2026-09-14T10:30:00Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.kind).toBe("follow_up");
      expect(result.data.preChangeSnapshot).toEqual({
        code: "def solution(arr): return sorted(arr)",
        notes: "Initial approach",
      });
    }
  });

  it("rejects event on finalized session", () => {
    const session = makeSession({
      state: "finalized",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:00:00Z",
      finalizedAt: "2026-09-14T10:50:00Z",
      finishReason: "submitted",
    });

    const result = validateEvent(session, {
      sessionId: "session-1",
      ownerId: "owner-1",
      kind: "clarification",
      serverNow: "2026-09-14T11:00:00Z",
    });

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("validateCancel", () => {
  it("allows cancelling a planned session", () => {
    const session = makeSession({ state: "planned" });
    const result = validateCancel(session, "owner-1", "Not ready");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cancelReason).toBe("Not ready");
    }
  });

  it("rejects cancelling a running session", () => {
    const session = makeSession({
      state: "running",
      startedAt: "2026-09-14T10:00:00Z",
      deadlineAt: "2026-09-14T11:30:00Z",
    });
    const result = validateCancel(session, "owner-1", "Changed mind");
    expect(result.ok).toBe(false);
  });
});
