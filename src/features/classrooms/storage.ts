/**
 * Classroom Draft Storage & Reload Recovery.
 * Sprint: B09
 * Authority: planly_architecture.md sections 8, 13
 *
 * Enforces:
 * 1. Unsent learner draft preservation across reloads.
 * 2. Explicit pending/saved code draft tracking with revision parity.
 * 3. Active durable run persistence for reconnectable streaming resume.
 */

export interface CodeDraftState {
  code: string;
  savedRevision: number;
  localRevision: number;
  isDirty: boolean;
  lastSavedAt?: string | null;
}

export interface MessageDraftState {
  text: string;
  isPending: boolean;
  updatedAt: string;
}

export interface ActiveRunState {
  runId: string;
  sessionId: string;
  clientRequestId: string;
  lastSeenSeq: number;
  startedAt: string;
}

const STORAGE_PREFIX = "planly_classroom_";
const _memoryStore = new Map<string, string>();

function safeGetItem(key: string): string | null {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // fallback
    }
  }
  return _memoryStore.get(key) ?? null;
}

function safeSetItem(key: string, value: string): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      // fallback
    }
  }
  _memoryStore.set(key, value);
}

function safeRemoveItem(key: string): void {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
  _memoryStore.delete(key);
}

export function clearAllClassroomStorage(): void {
  _memoryStore.clear();
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.clear();
    } catch {}
  }
}

export function getCodeDraft(sessionId: string): CodeDraftState | null {
  const raw = safeGetItem(`${STORAGE_PREFIX}code_${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CodeDraftState;
  } catch {
    return null;
  }
}

export function saveCodeDraft(
  sessionId: string,
  code: string,
  savedRevision: number,
  isDirty: boolean
): CodeDraftState {
  const state: CodeDraftState = {
    code,
    savedRevision,
    localRevision: isDirty ? savedRevision + 1 : savedRevision,
    isDirty,
    lastSavedAt: new Date().toISOString(),
  };
  safeSetItem(`${STORAGE_PREFIX}code_${sessionId}`, JSON.stringify(state));
  return state;
}

export function clearCodeDraft(sessionId: string): void {
  safeRemoveItem(`${STORAGE_PREFIX}code_${sessionId}`);
}

export function getMessageDraft(sessionId: string): MessageDraftState | null {
  const raw = safeGetItem(`${STORAGE_PREFIX}msg_${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MessageDraftState;
  } catch {
    return null;
  }
}

export function saveMessageDraft(sessionId: string, text: string, isPending: boolean = false): MessageDraftState {
  const state: MessageDraftState = {
    text,
    isPending,
    updatedAt: new Date().toISOString(),
  };
  safeSetItem(`${STORAGE_PREFIX}msg_${sessionId}`, JSON.stringify(state));
  return state;
}

export function clearMessageDraft(sessionId: string): void {
  safeRemoveItem(`${STORAGE_PREFIX}msg_${sessionId}`);
}

export function getActiveRun(sessionId: string): ActiveRunState | null {
  const raw = safeGetItem(`${STORAGE_PREFIX}active_run_${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveRunState;
  } catch {
    return null;
  }
}

export function setActiveRun(
  sessionId: string,
  runId: string,
  clientRequestId: string,
  lastSeenSeq: number = 0
): ActiveRunState {
  const state: ActiveRunState = {
    runId,
    sessionId,
    clientRequestId,
    lastSeenSeq,
    startedAt: new Date().toISOString(),
  };
  safeSetItem(`${STORAGE_PREFIX}active_run_${sessionId}`, JSON.stringify(state));
  return state;
}

export function updateActiveRunSeq(sessionId: string, seq: number): void {
  const current = getActiveRun(sessionId);
  if (current) {
    current.lastSeenSeq = Math.max(current.lastSeenSeq, seq);
    safeSetItem(`${STORAGE_PREFIX}active_run_${sessionId}`, JSON.stringify(current));
  }
}

export function clearActiveRun(sessionId: string): void {
  safeRemoveItem(`${STORAGE_PREFIX}active_run_${sessionId}`);
}
