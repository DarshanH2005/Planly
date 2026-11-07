/**
 * Session Domain Type Definitions
 *
 * Conforms to PLANLY_BUILD_SPEC.md §9 (Session lifecycle and durable writes).
 */

// ---------------------------------------------------------------------------
// Session state machine
// ---------------------------------------------------------------------------

export type SessionState = "planned" | "running" | "finalized" | "reviewed";

export type FinishReason = "submitted" | "timeout" | "stopped" | "converted_to_practice";

export type SessionStage =
  | "foundation" | "oa" | "technical_a" | "technical_b"
  | "engineering" | "project" | "behavioural";

export type SessionMode = "learn" | "practice" | "strict";

export type EvaluatorMode = "scripted_solo" | "peer_led";

export type Familiarity = "unseen_declared" | "familiar" | "unknown";

// ---------------------------------------------------------------------------
// Session records
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  ownerId: string;
  taskId: string | null;
  goalId: string;
  stage: SessionStage;
  mode: SessionMode;
  evaluatorMode: EvaluatorMode;
  packId: string;
  packVersion: number;
  rubricId: string;
  rubricVersion: number;
  bundleHash: string;
  resourcePolicy: ResourcePolicy;
  state: SessionState;
  finishReason: FinishReason | null;
  startedAt: string | null;
  deadlineAt: string | null;
  finalizedAt: string | null;
  isInterrupted: boolean;
  isAssisted: boolean;
  linkedPriorSessionId: string | null;
  cancelReason: string | null;
  version: number;
}

export interface ResourcePolicy {
  docs: boolean;
  ai: boolean;
  hints: boolean;
  notes: boolean;
}

export interface SessionPromptRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  promptId: string;
  promptVersion: number;
  promptHash: string;
  displayOrder: number;
  revealedCandidateSnapshot: unknown | null;
  exposureDeclaration: Familiarity;
  revealedAt: string | null;
}

export interface DraftRecord {
  id: string;
  ownerId: string;
  sessionPromptId: string;
  revision: number;
  code: string;
  language: string;
  notes: string;
  savedAt: string;
}

export interface AttemptRecord {
  id: string;
  ownerId: string;
  sessionPromptId: string;
  frozenCode: string;
  frozenLanguage: string;
  frozenNotes: string;
  finalizedAt: string;
  sourceDraftRevision: number | null;
  elapsedSeconds: number | null;
  assistanceSnapshot: Record<string, unknown>;
  exposureSnapshot: Record<string, unknown>;
}

export interface SessionEventRecord {
  id: string;
  ownerId: string;
  sessionId: string;
  kind: "phase_change" | "clarification" | "follow_up" | "help_request" | "interruption" | "hint_given" | "conversion";
  branchRef: string | null;
  response: string | null;
  observation: string | null;
  preChangeSnapshot: { code: string; notes: string } | null;
  serverTimestamp: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Transition inputs
// ---------------------------------------------------------------------------

export interface StartSessionInput {
  sessionId: string;
  ownerId: string;
  expectedVersion: number;
  serverNow: string;               // ISO timestamp — injected, not from clock
  durationMinutes?: number;        // Overridden by pack duration
  declarations?: Array<{
    promptId: string;
    familiarity: Familiarity;
  }>;
}

export interface SaveDraftInput {
  sessionId: string;
  sessionPromptId: string;
  ownerId: string;
  code: string;
  language: string;
  notes: string;
  expectedRevision: number;
  serverNow: string;
}

export interface FinalizeSessionInput {
  sessionId: string;
  ownerId: string;
  finishReason: FinishReason;
  expectedVersion: number;
  serverNow: string;
  /** Final draft updates to apply atomically with finalization */
  finalDrafts?: Array<{
    sessionPromptId: string;
    code: string;
    language: string;
    notes: string;
    expectedRevision: number;
  }>;
}

export interface RecordEventInput {
  sessionId: string;
  ownerId: string;
  kind: SessionEventRecord["kind"];
  branchRef?: string;
  response?: string;
  observation?: string;
  currentCode?: string;
  currentNotes?: string;
  serverNow: string;
}

export interface RevealClarificationInput {
  sessionId: string;
  sessionPromptId: string;
  ownerId: string;
  branchId: string;
  customQuestion?: string;
  serverNow: string;
}

export interface RevealFollowupInput {
  sessionId: string;
  sessionPromptId: string;
  ownerId: string;
  followupId: string;
  currentCode: string;
  currentNotes?: string;
  serverNow: string;
}

export interface ConvertToPracticeInput {
  sessionId: string;
  ownerId: string;
  reason?: string;
  serverNow: string;
}

export interface DraftConflictData {
  localCode: string;
  localNotes: string;
  localRevision: number;
  serverCode: string;
  serverNotes: string;
  serverRevision: number;
  serverSavedAt: string;
}

