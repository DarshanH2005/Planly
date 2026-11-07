import fs from "node:fs";
import path from "node:path";
import type { RepairRecord } from "@/features/reviews/types";

export interface LocalDraft {
  sessionId: string;
  sessionPromptId: string;
  code: string;
  language: string;
  notes: string;
  revision: number;
  savedAt: string;
}

export interface LocalAttempt {
  id: string;
  sessionId: string;
  sessionPromptId: string;
  frozenCode: string;
  frozenLanguage: string;
  frozenNotes: string;
  finalizedAt: string;
  sourceDraftRevision: number | null;
}

export interface LocalSession {
  id: string;
  ownerId: string;
  stage: string;
  mode: string;
  packId: string;
  rubricId: string;
  rubricVersion: number;
  state: string;
  finishReason: string | null;
  startedAt: string;
  deadlineAt: string;
  finalizedAt: string | null;
  isInterrupted: boolean;
  isAssisted: boolean;
  version: number;
  [key: string]: unknown;
}

export interface LocalReview {
  id: string;
  ownerId: string;
  sessionId: string;
  revision: number;
  status: string;
  rubricId: string;
  rubricVersion: number;
  submittedAt: string;
  evidence: unknown[];
  learningCard: unknown;
  repairProposal?: unknown;
}

export type ProblemStatus = "untouched" | "attempted" | "confident";

interface LocalStoreState {
  sessions: Record<string, LocalSession>;
  drafts: Record<string, LocalDraft>; // key: `${sessionId}:${sessionPromptId}`
  attempts: Record<string, LocalAttempt[]>; // key: sessionId
  reviews: Record<string, LocalReview[]>; // key: sessionId
  events: Record<string, unknown[]>; // key: sessionId
  repairs: Record<string, RepairRecord[]>; // key: ownerId
  prepStatuses: Record<string, Record<string, ProblemStatus>>; // key: ownerId → problemId → status
}

declare global {
  var __planlyStoreState: LocalStoreState | undefined;
}

function getStoreFilePath(): string {
  return path.resolve(process.cwd(), ".planly-local-store.json");
}

function loadInitialState(): LocalStoreState {
  try {
    const file = getStoreFilePath();
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore read errors
  }
  return {
    sessions: {},
    drafts: {},
    attempts: {},
    reviews: {},
    events: {},
    repairs: {},
    prepStatuses: {},
  };
}

function persistState(state: LocalStoreState) {
  try {
    const file = getStoreFilePath();
    fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Ignore write errors (e.g. read-only env)
  }
}

function getState(): LocalStoreState {
  if (!globalThis.__planlyStoreState) {
    globalThis.__planlyStoreState = loadInitialState();
  }
  return globalThis.__planlyStoreState;
}

// Session operations
export function saveLocalSession(sessionId: string, session: Partial<LocalSession>) {
  const state = getState();
  const existing = state.sessions[sessionId] || {};
  state.sessions[sessionId] = {
    ...existing,
    ...session,
    id: sessionId,
  } as LocalSession;
  persistState(state);
}

export function getLocalSession(sessionId: string): LocalSession | null {
  const state = getState();
  return state.sessions[sessionId] || null;
}

// Draft operations
export function saveLocalDraft(draft: LocalDraft) {
  const state = getState();
  const key = `${draft.sessionId}:${draft.sessionPromptId}`;
  state.drafts[key] = draft;
  persistState(state);
}

export function getLocalDraft(sessionId: string, sessionPromptId: string): LocalDraft | null {
  const state = getState();
  const key = `${sessionId}:${sessionPromptId}`;
  return state.drafts[key] || null;
}

export function getLocalDraftsForSession(sessionId: string): LocalDraft[] {
  const state = getState();
  return Object.values(state.drafts).filter((d) => d.sessionId === sessionId);
}

// Attempt operations
export function saveLocalAttempts(sessionId: string, attempts: LocalAttempt[]) {
  const state = getState();
  state.attempts[sessionId] = attempts;
  persistState(state);
}

export function getLocalAttempts(sessionId: string): LocalAttempt[] {
  const state = getState();
  return state.attempts[sessionId] || [];
}

// Review operations
export function saveLocalReview(review: LocalReview) {
  const state = getState();
  const existing = state.reviews[review.sessionId] || [];
  const idx = existing.findIndex((r) => r.id === review.id);
  if (idx >= 0) {
    existing[idx] = review;
  } else {
    existing.push(review);
  }
  state.reviews[review.sessionId] = existing;
  persistState(state);
}

export function getLocalReviews(sessionId: string): LocalReview[] {
  const state = getState();
  return state.reviews[sessionId] || [];
}

export function saveLocalRepair(repair: RepairRecord) {
  const state = getState();
  const repairs = state.repairs ?? (state.repairs = {});
  const existing = repairs[repair.ownerId] ?? [];
  const index = existing.findIndex((item) => item.id === repair.id);
  if (index >= 0) existing[index] = repair;
  else existing.push(repair);
  repairs[repair.ownerId] = existing;
  persistState(state);
}

export function getLocalRepairs(ownerId: string): RepairRecord[] {
  return getState().repairs?.[ownerId] ?? [];
}

// Event operations
export function saveLocalEvent(sessionId: string, event: unknown) {
  const state = getState();
  const existing = state.events[sessionId] || [];
  state.events[sessionId] = [...existing, event];
  persistState(state);
}

// Reset store (useful for tests)
export function resetLocalStore() {
  globalThis.__planlyStoreState = {
    sessions: {},
    drafts: {},
    attempts: {},
    reviews: {},
    events: {},
    repairs: {},
    prepStatuses: {},
  };
  persistState(globalThis.__planlyStoreState);
}

// Prep status operations
export function saveLocalPrepStatus(ownerId: string, problemId: string, status: ProblemStatus) {
  const state = getState();
  const statuses = state.prepStatuses ?? (state.prepStatuses = {});
  const ownerStatuses = statuses[ownerId] ?? {};
  if (status === "untouched") {
    delete ownerStatuses[problemId]; // Don't store default state
  } else {
    ownerStatuses[problemId] = status;
  }
  statuses[ownerId] = ownerStatuses;
  persistState(state);
}

export function getLocalPrepStatuses(ownerId: string): Record<string, ProblemStatus> {
  return getState().prepStatuses?.[ownerId] ?? {};
}
