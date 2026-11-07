/**
 * Sprint B18: Strict OA Assessment Types
 * Authority: PLANLY_BUILD_SPEC.md §16-17; B18_strict_oa.md
 */

import type { SessionStage, SessionMode, SessionState, ResourcePolicy } from "@/features/sessions/types";

export interface CandidateSafePrompt {
  prompt_id: string;
  title: string;
  statement: string;
  starter_code: string;
  public_tests: Array<{ input: Record<string, unknown>; expected: unknown }>;
  available_clarifications: Array<{ id: string; question: string }>;
  revealed_clarifications: Array<{ id: string; question: string; answer: string }>;
}

export interface CandidateDraft {
  prompt_id: string;
  revision: number;
  code: string;
  language: string;
  notes: string;
  saved_at: string;
}

export interface CandidateSafeOASession {
  session_id: string;
  classroom_id: string;
  pack_id: string;
  stage: SessionStage;
  mode: SessionMode;
  state: SessionState;
  started_at: string;
  deadline_at: string;
  server_now: string;
  remaining_seconds: number;
  is_expired: boolean;
  resource_policy: ResourcePolicy;
  exercises: CandidateSafePrompt[];
  drafts: Record<string, CandidateDraft>;
  is_interrupted: boolean;
  is_assisted: boolean;
  finish_reason: string | null;
}

export interface StartOAInput {
  classroom_id: string;
  pack_id?: string;
  pack_version?: number;
  duration_minutes?: number;
  prompt_ids?: string[];
}

export interface DraftSaveInput {
  prompt_id: string;
  code: string;
  language?: string;
  notes?: string;
  expected_revision: number;
}

export interface ClarificationInput {
  prompt_id: string;
  branch_id: string;
}

export interface FinalizeOAInput {
  finish_reason?: "submitted" | "timeout" | "stopped";
  final_drafts?: Array<{
    prompt_id: string;
    code: string;
    language?: string;
    notes?: string;
    expected_revision?: number;
  }>;
}

export interface FrozenAttemptSummary {
  id: string;
  prompt_id: string;
  source_revision: number;
  assistance_level: string;
  mode: string;
  elapsed_seconds: number;
}

export interface FinalizeOAResult {
  status: "finalized";
  session_id: string;
  finish_reason: string;
  finalized_at: string | null;
  attempts_count: number;
  attempts: FrozenAttemptSummary[];
}
