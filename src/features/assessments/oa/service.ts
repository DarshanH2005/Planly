/**
 * Sprint B18: Strict OA Assessment Service
 * Authority: PLANLY_BUILD_SPEC.md §16-17; B18_strict_oa.md
 */

import type {
  CandidateSafeOASession,
  StartOAInput,
  DraftSaveInput,
  ClarificationInput,
  FinalizeOAInput,
  FinalizeOAResult,
  CandidateSafePrompt,
} from "./types";

const LEARNING_SERVICE_URL =
  process.env.NEXT_PUBLIC_LEARNING_SERVICE_URL || "http://127.0.0.1:8000";

function getHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function startOASession(
  input: StartOAInput,
  ownerToken?: string
): Promise<CandidateSafeOASession> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/start`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to start OA session: ${res.statusText}`);
  }

  return res.json();
}

export async function getOASession(
  sessionId: string,
  ownerToken?: string
): Promise<CandidateSafeOASession> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}`, {
    method: "GET",
    headers: getHeaders(ownerToken),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch OA session: ${res.statusText}`);
  }

  return res.json();
}

export async function saveOADraft(
  sessionId: string,
  input: DraftSaveInput,
  ownerToken?: string
): Promise<{ status: string; prompt_id: string; revision: number; saved_at: string }> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}/draft`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err.detail?.code || (res.status === 409 ? "VERSION_CONFLICT" : "SAVE_ERROR");
    const error = new Error(err.detail?.message || err.detail || `Draft save failed: ${res.statusText}`);
    (error as any).code = code;
    throw error;
  }

  return res.json();
}

export async function requestOAClarification(
  sessionId: string,
  input: ClarificationInput,
  ownerToken?: string
): Promise<{ prompt_id: string; branch_id: string; question: string; answer: string }> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}/clarify`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Clarification failed: ${res.statusText}`);
  }

  return res.json();
}

export async function finalizeOASession(
  sessionId: string,
  input: FinalizeOAInput = {},
  ownerToken?: string
): Promise<FinalizeOAResult> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}/finalize`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Finalize failed: ${res.statusText}`);
  }

  return res.json();
}

export async function convertOAToPractice(
  sessionId: string,
  reason: string = "Learner requested coaching/hints",
  ownerToken?: string
): Promise<{ status: string; session_id: string; mode: string; is_assisted: boolean }> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}/convert-practice`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Practice conversion failed: ${res.statusText}`);
  }

  return res.json();
}

export async function recordOAInterruption(
  sessionId: string,
  reason: string = "Client disconnection detected",
  ownerToken?: string
): Promise<{ status: string; session_id: string; is_interrupted: boolean }> {
  const res = await fetch(`${LEARNING_SERVICE_URL}/api/assessments/oa/${sessionId}/interruption`, {
    method: "POST",
    headers: getHeaders(ownerToken),
    body: JSON.stringify({ reason }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Record interruption failed: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Pure client-side helper to ensure candidate prompts have zero private leak.
 */
export function sanitizeCandidatePrompt(rawPrompt: any): CandidateSafePrompt {
  return {
    prompt_id: rawPrompt.prompt_id || rawPrompt.id,
    title: rawPrompt.title || "Assessment Prompt",
    statement: rawPrompt.statement || "",
    starter_code: rawPrompt.starter_code || "",
    public_tests: rawPrompt.public_tests || [],
    available_clarifications: (rawPrompt.available_clarifications || []).map((c: any) => ({
      id: c.id,
      question: c.question,
    })),
    revealed_clarifications: rawPrompt.revealed_clarifications || [],
  };
}

/**
 * Validates remaining time strictly against server deadline.
 */
export function computeRemainingSeconds(deadlineAt: string, serverNow: string): number {
  const deadlineMs = new Date(deadlineAt).getTime();
  const serverNowMs = new Date(serverNow).getTime();
  return Math.max(0, Math.floor((deadlineMs - serverNowMs) / 1000));
}
