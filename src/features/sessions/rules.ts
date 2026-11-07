/**
 * Session Lifecycle Rules — Pure Domain Logic
 *
 * PLANLY_BUILD_SPEC.md §9: Session lifecycle and durable writes.
 *
 * All functions are pure: given the current state and an input, they return
 * either the resulting state transition or an error. No database, no clock.
 */

import type { Result } from "@/lib/validation/result";
import { ok, fail } from "@/lib/validation/result";
import type {
  SessionRecord,
  SessionState,
  StartSessionInput,
  SaveDraftInput,
  FinalizeSessionInput,
  RecordEventInput,
  DraftRecord,
  AttemptRecord,
  SessionEventRecord,
} from "./types";

// ---------------------------------------------------------------------------
// §9.1 State machine: valid transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  planned: ["running"],           // cancel handled separately
  running: ["finalized"],
  finalized: ["reviewed"],
  reviewed: ["reviewed"],          // superseding review
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// §9.1 Start transaction
// ---------------------------------------------------------------------------

export interface StartResult {
  session: Partial<SessionRecord>;
  exposurePromptIds: string[];       // Prompts to mark as exposed
}

export function validateStart(
  session: SessionRecord,
  input: StartSessionInput
): Result<StartResult> {
  // Auth check
  if (session.ownerId !== input.ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }

  // Version check
  if (session.version !== input.expectedVersion) {
    return fail("VERSION_CONFLICT", `Expected version ${input.expectedVersion}, got ${session.version}`);
  }

  // State check
  if (session.state !== "planned") {
    return fail("INVALID_STATE", `Cannot start session in state '${session.state}'`);
  }

  // Cancelled check
  if (session.cancelReason !== null) {
    return fail("INVALID_STATE", "Session has been cancelled");
  }

  // Compute deadline from pack duration (injected via server time)
  // The service layer handles setting the actual deadline based on pack config.
  // Here we just validate the transition is legal.

  return ok({
    session: {
      state: "running" as const,
      startedAt: input.serverNow,
      // deadlineAt is computed by the service layer based on pack duration
      version: session.version + 1,
    },
    exposurePromptIds: [], // Populated by service after checking pack
  });
}

// ---------------------------------------------------------------------------
// §9.1 Drafts: revision-locked saves
// ---------------------------------------------------------------------------

export interface SaveDraftResult {
  draft: Partial<DraftRecord>;
}

export function validateDraftSave(
  session: SessionRecord,
  currentDraft: DraftRecord | null,
  input: SaveDraftInput
): Result<SaveDraftResult> {
  // Auth check
  if (session.ownerId !== input.ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }

  // Must be running
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot save draft for session in state '${session.state}'`);
  }

  // Deadline check (§9.1: server clock controls eligibility)
  if (session.deadlineAt && input.serverNow > session.deadlineAt) {
    return fail("DEADLINE_PASSED", "Session deadline has passed; draft rejected");
  }

  // Optimistic revision lock (§9.1: reject stale revisions)
  const expectedRevision = currentDraft ? currentDraft.revision : 0;
  if (input.expectedRevision !== expectedRevision) {
    return fail("VERSION_CONFLICT",
      `Draft revision conflict: expected ${input.expectedRevision}, current is ${expectedRevision}`,
      { currentVersion: expectedRevision }
    );
  }

  return ok({
    draft: {
      sessionPromptId: input.sessionPromptId,
      code: input.code,
      language: input.language,
      notes: input.notes,
      revision: expectedRevision + 1,
      savedAt: input.serverNow,
    },
  });
}

// ---------------------------------------------------------------------------
// §9.1 Finalize transaction
// ---------------------------------------------------------------------------

export interface FinalizeResult {
  session: Partial<SessionRecord>;
  attempts: AttemptRecord[];
}

export function validateFinalize(
  session: SessionRecord,
  promptIds: string[],              // All session prompt IDs
  drafts: Map<string, DraftRecord>, // Current drafts keyed by session_prompt_id
  input: FinalizeSessionInput
): Result<FinalizeResult> {
  // Auth check
  if (session.ownerId !== input.ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }

  // Version check
  if (session.version !== input.expectedVersion) {
    return fail("VERSION_CONFLICT", `Expected version ${input.expectedVersion}, got ${session.version}`);
  }

  // State check
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot finalize session in state '${session.state}'`);
  }

  // Deadline logic (§9.1):
  // If deadline passed, freeze last server-saved drafts (no new code for strict attempt)
  const deadlinePassed = session.deadlineAt !== null && input.serverNow > session.deadlineAt;

  // §9.1: Freeze exactly one attempt for each session prompt (including blank answers)
  const attempts: AttemptRecord[] = [];

  for (const promptId of promptIds) {
    const draft = drafts.get(promptId);

    let code = "";
    let language = "python";
    let notes = "";
    let sourceDraftRevision: number | null = null;

    if (deadlinePassed) {
      // Use last server-saved draft; ignore any new code in finalDrafts
      if (draft) {
        code = draft.code;
        language = draft.language;
        notes = draft.notes;
        sourceDraftRevision = draft.revision;
      }
    } else {
      // On-time submission may include final drafts
      const finalDraft = input.finalDrafts?.find(
        (fd) => fd.sessionPromptId === promptId
      );
      if (finalDraft) {
        code = finalDraft.code;
        language = finalDraft.language;
        notes = finalDraft.notes;
        // Final draft revision check
        const expectedRev = draft ? draft.revision : 0;
        if (finalDraft.expectedRevision !== expectedRev) {
          return fail("VERSION_CONFLICT",
            `Final draft revision conflict for prompt ${promptId}`
          );
        }
        sourceDraftRevision = expectedRev + 1;
      } else if (draft) {
        code = draft.code;
        language = draft.language;
        notes = draft.notes;
        sourceDraftRevision = draft.revision;
      }
    }

    attempts.push({
      id: crypto.randomUUID(),
      ownerId: session.ownerId,
      sessionPromptId: promptId,
      frozenCode: code,
      frozenLanguage: language,
      frozenNotes: notes,
      finalizedAt: input.serverNow,
      sourceDraftRevision,
      elapsedSeconds: null,  // Computed by service from started_at
      assistanceSnapshot: {},
      exposureSnapshot: {},
    });
  }

  const finishReason = deadlinePassed ? "timeout" as const : input.finishReason;

  return ok({
    session: {
      state: "finalized" as const,
      finishReason,
      finalizedAt: input.serverNow,
      version: session.version + 1,
    },
    attempts,
  });
}

// ---------------------------------------------------------------------------
// §9.1 Event recording (clarification, follow-up, etc.)
// ---------------------------------------------------------------------------

export function validateEvent(
  session: SessionRecord,
  input: RecordEventInput
): Result<Partial<SessionEventRecord>> {
  // Auth check
  if (session.ownerId !== input.ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }

  // Most events require running state
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot record events for session in state '${session.state}'`);
  }

  const event: Partial<SessionEventRecord> = {
    sessionId: input.sessionId,
    ownerId: input.ownerId,
    kind: input.kind,
    branchRef: input.branchRef ?? null,
    response: input.response ?? null,
    observation: input.observation ?? null,
    preChangeSnapshot: ((input.kind === "follow_up" || input.kind === "conversion") && input.currentCode !== undefined)
      ? { code: input.currentCode, notes: input.currentNotes ?? "" }
      : null,
    serverTimestamp: input.serverNow,
    source: "owner",
  };

  return ok(event);
}

// ---------------------------------------------------------------------------
// §9.1 Cancel (planned → cancelled)
// ---------------------------------------------------------------------------

export function validateCancel(
  session: SessionRecord,
  ownerId: string,
  reason: string
): Result<Partial<SessionRecord>> {
  if (session.ownerId !== ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }
  if (session.state !== "planned") {
    return fail("INVALID_STATE", `Can only cancel planned sessions, not '${session.state}'`);
  }

  return ok({
    cancelReason: reason,
    version: session.version + 1,
  });
}

// ---------------------------------------------------------------------------
// §8.3 & AC14: Authored Clarification Progression
// ---------------------------------------------------------------------------

export interface ClarificationBranchDef {
  id: string;
  question: string;
  answer: string;
}

export function validateClarification(
  session: SessionRecord,
  authoredBranches: ClarificationBranchDef[],
  branchId: string,
  ownerId: string,
  serverNow: string
): Result<{
  event: Partial<SessionEventRecord>;
  question: string;
  answer: string;
}> {
  if (session.ownerId !== ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot ask clarification in state '${session.state}'`);
  }

  const branch = authoredBranches.find((b) => b.id === branchId);
  if (!branch) {
    return fail("VALIDATION_ERROR", `Unknown clarification branch '${branchId}'`);
  }

  return ok({
    event: {
      sessionId: session.id,
      ownerId,
      kind: "clarification",
      branchRef: branch.id,
      response: branch.answer,
      observation: branch.question,
      serverTimestamp: serverNow,
      source: "scripted_interviewer",
    },
    question: branch.question,
    answer: branch.answer,
  });
}

// ---------------------------------------------------------------------------
// §9.1 & AC14: Changed-Constraint Follow-Up with Code Snapshot
// ---------------------------------------------------------------------------

export interface FollowupDef {
  id: string;
  trigger: string;
  question: string;
  criterion: string;
}

export function validateFollowup(
  session: SessionRecord,
  authoredFollowups: FollowupDef[],
  followupId: string,
  ownerId: string,
  currentCode: string,
  currentNotes: string,
  serverNow: string
): Result<{
  event: Partial<SessionEventRecord>;
  question: string;
}> {
  if (session.ownerId !== ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot reveal follow-up in state '${session.state}'`);
  }

  const followup = authoredFollowups.find((f) => f.id === followupId);
  if (!followup) {
    return fail("VALIDATION_ERROR", `Unknown follow-up '${followupId}'`);
  }

  return ok({
    event: {
      sessionId: session.id,
      ownerId,
      kind: "follow_up",
      branchRef: followup.id,
      response: followup.question,
      observation: followup.criterion,
      preChangeSnapshot: {
        code: currentCode,
        notes: currentNotes,
      },
      serverTimestamp: serverNow,
      source: "scripted_interviewer",
    },
    question: followup.question,
  });
}

// ---------------------------------------------------------------------------
// §9.1 & AC15: Convert to Coached Practice
// ---------------------------------------------------------------------------

export function validateConvertToPractice(
  session: SessionRecord,
  ownerId: string,
  reason: string,
  serverNow: string
): Result<{
  sessionUpdates: Partial<SessionRecord>;
  event: Partial<SessionEventRecord>;
}> {
  if (session.ownerId !== ownerId) {
    return fail("AUTH_ERROR", "Session does not belong to this owner");
  }
  if (session.state !== "running") {
    return fail("INVALID_STATE", `Cannot convert session in state '${session.state}'`);
  }
  if (session.isAssisted && session.mode === "practice") {
    return fail("INVALID_STATE", "Session is already in assisted practice mode");
  }

  return ok({
    sessionUpdates: {
      mode: "practice",
      isAssisted: true,
      version: session.version + 1,
    },
    event: {
      sessionId: session.id,
      ownerId,
      kind: "conversion",
      response: reason || "Converted from strict attempt to coached practice",
      serverTimestamp: serverNow,
      source: "owner",
    },
  });
}

