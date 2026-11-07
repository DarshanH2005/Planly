/**
 * Planly Learning Wire Contracts — Generated from FastAPI OpenAPI Specification
 * Schema Version: 0.1.0
 * Verified by B03-AC3 (Zero field-name drift)
 *
 * To regenerate: python services/learning/scripts/export_contracts.py
 */

export type SourceKind =
  | "learner_work"
  | "tutor_explanation"
  | "self_report"
  | "derived_inference"
  | "execution_evidence";

export type AssistanceLevel =
  | "independent"
  | "guided"
  | "tutor_supplied"
  | "unassessed"
  | "unknown";

export type SessionStage =
  | "foundation"
  | "oa"
  | "technical_a"
  | "technical_b"
  | "engineering"
  | "project"
  | "behavioural";

export type SessionMode = "learn" | "practice" | "strict";

export type RunState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RunLane = "foreground" | "background";

export type EventType =
  | "queued"
  | "thinking"
  | "decision"
  | "chunk"
  | "done"
  | "error"
  | "cancelled";

export type ExternalCallStatus = "started" | "succeeded" | "failed" | "uncertain";

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface OwnerResponse {
  owner_id: string;
  email?: string | null;
  role: string;
  authorized: boolean;
}

export interface MessageInput {
  content: string;
  expected_revision: number;
}

export interface ArtifactInput {
  content: string;
  expected_revision: number;
  language?: string;
}

export interface ObservationInput {
  competency_key: string;
  source_kind: SourceKind;
  assistance_level: AssistanceLevel;
  demonstrated?: boolean;
  evidence_text: string;
  message_id?: string | null;
  artifact_id?: string | null;
  attempt_id?: string | null;
}

export interface LearningObservation {
  id: string;
  owner_id: string;
  session_id: string;
  competency_key: string;
  source_kind: SourceKind;
  assistance_level: AssistanceLevel;
  demonstrated: boolean;
  evidence_text: string;
  message_id?: string | null;
  artifact_id?: string | null;
  attempt_id?: string | null;
  created_at?: string | null;
}

export interface ArtifactRecord {
  id: string;
  owner_id: string;
  session_id: string;
  revision: number;
  content: string;
  language: string;
  created_at?: string | null;
}

export interface MessageRecord {
  id: string;
  owner_id: string;
  session_id: string;
  sender_role: "learner" | "tutor" | "system";
  content: string;
  artifact_revision_snapshot?: number | null;
  created_at?: string | null;
}

export interface ClassroomRecord {
  id: string;
  owner_id: string;
  track: string;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SessionRecord {
  id: string;
  owner_id: string;
  classroom_id: string;
  stage: SessionStage;
  mode: SessionMode;
  status: string;
  current_revision: number;
  parent_session_id?: string | null;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AttemptRecord {
  id: string;
  owner_id: string;
  session_id: string;
  artifact_id?: string | null;
  frozen_code: string;
  frozen_language: string;
  source_revision: number;
  elapsed_seconds?: number | null;
  assistance_level: AssistanceLevel;
  mode: SessionMode;
  exposure_state: Record<string, unknown>;
  created_at?: string | null;
}

export interface ModeRecord {
  mode: SessionMode;
  coaching_permitted: boolean;
  strict_deadline_seconds?: number | null;
  hints_enabled: boolean;
  reveal_limit: number;
  requires_clean_submission: boolean;
}

export interface ExposureRecord {
  owner_id: string;
  competency_key: string;
  exposure_count: number;
  independent_success_count: number;
  guided_count: number;
  tutor_supplied_count: number;
  last_exposed_at?: string | null;
  last_assistance_level?: AssistanceLevel | null;
}

export interface ContextPacket {
  session_id: string;
  owner_id: string;
  active_revision: number;
  artifact_content: string;
  pending_question?: string | null;
  permitted_references: string[];
  observed_competencies: string[];
  recent_messages: Record<string, unknown>[];
  parent_context?: Record<string, unknown> | null;
  source_episodes: Record<string, unknown>[];
  source_coverage?: string[];
  superseded_evidence?: Record<string, unknown>[];
  mode?: SessionMode;
  exposure_snapshot?: ExposureRecord | null;
}

export interface TeachingDecision {
  decision_id: string;
  session_id: string;
  owner_id: string;
  expected_revision: number;
  assessment: string;
  uncertainty: number;
  next_action: string;
  reveal_limit: number;
  observed_success_criteria: string[];
  rationale: string;
  model_version: string;
  candidate_explanations?: string[];
  discriminating_probe?: string | null;
  uncertainty_reason?: string | null;
  transition?: string;
  policy_version?: string;
  goal_id?: string | null;
  step_id?: string | null;
  assistance_event?: string | null;
}

export interface LessonMicroGoal {
  goal_id: string;
  session_id: string;
  owner_id: string;
  description: string;
  competency_key: string;
  status: string;
  is_editable: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ActivityDefinition {
  id: string;
  track: string;
  title: string;
  competency_key: string;
  prerequisites: string[];
  micro_goal: string;
  statement: string;
  examples: Record<string, unknown>[];
  reference_checks: Record<string, unknown>[];
  evaluator_context?: Record<string, unknown> | null;
  visibility: string;
  starter_code?: string;
}

export interface MicroGoalInput {
  description: string;
  competency_key: string;
  is_editable?: boolean;
}

export interface MicroGoalUpdateInput {
  description?: string | null;
  status?: string | null;
}

export interface LessonTurnInput {
  message: string;
  expected_revision: number;
  run_id?: string | null;
  consecutive_correct_count?: number;
}

export interface LessonTurnResponse {
  run_id: string;
  session_id: string;
  reply: string;
  teaching_decision: TeachingDecision;
  observations_committed: string[];
  status: string;
}


export interface RunReceipt {
  run_id: string;
  session_id: string;
  message_id: string;
  accepted_revision: number;
  status_url: string;
  events_url: string;
}

export interface SessionMessageInput {
  content: string;
  expected_revision: number;
  client_request_id?: string | null;
}

export interface RunEvent {
  id: string;
  owner_id: string;
  run_id: string;
  seq: number;
  event_type: EventType;
  payload: Record<string, unknown>;
  created_at?: string | null;
}

export interface TurnRunRecord {
  id: string;
  owner_id: string;
  classroom_id: string;
  session_id: string;
  client_request_id: string;
  expected_revision: number;
  state: RunState;
  lane: RunLane;
  message_id?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  fence: number;
  decision?: TeachingDecision | null;
  error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ExternalCallReceipt {
  id: string;
  owner_id: string;
  idempotency_key: string;
  call_type: string;
  status: ExternalCallStatus;
  request_hash: string;
  response_payload?: Record<string, unknown> | null;
  cost_cents: number;
  run_id?: string | null;
  created_at?: string | null;
}

export interface RunStatusResponse {
  run_id: string;
  session_id: string;
  state: RunState;
  expected_revision: number;
  decision?: TeachingDecision | null;
  error?: string | null;
  events_count: number;
  events_url: string;
}

export interface RunEventsResponse {
  run_id: string;
  events: RunEvent[];
  latest_seq: number;
  is_complete: boolean;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  field_errors?: Record<string, string> | null;
  expected_revision?: number | null;
}

export type PendingTaskType =
  | "pending_question"
  | "unsubmitted_exercise"
  | "deferred_topic"
  | "unanswered_followup";

export type PendingTaskStatus = "pending" | "resolved" | "cancelled";

export interface PendingTaskRecord {
  id: string;
  owner_id: string;
  classroom_id: string;
  session_id: string;
  task_type: PendingTaskType;
  title: string;
  prompt_text: string;
  context_json: Record<string, unknown>;
  status: PendingTaskStatus;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SourceDocumentRecord {
  id: string;
  owner_id: string;
  track: string;
  filename: string;
  sha256_hash: string;
  turn_count: number;
  extraction_quality: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ImportSummaryResponse {
  owner_id: string;
  tracks_imported: string[];
  documents_ingested: number;
  turns_extracted: number;
  artifacts_created: number;
  observations_staged: number;
  pending_tasks_created: number;
  warnings: string[];
}

export interface ImportRequestInput {
  downloads_dir?: string | null;
}

export interface BudgetPoolStatus {
  allocation_usd: number;
  settled_usd: number;
  reserved_usd: number;
  uncertain_usd: number;
  remaining_usd: number;
}

export interface BudgetStatusReport {
  monthly_ceiling_usd: number;
  internal_dispatch_limit_usd: number;
  total_settled_usd: number;
  total_reserved_usd: number;
  total_uncertain_usd: number;
  remaining_dispatch_usd: number;
  pools: Record<string, BudgetPoolStatus>;
}

export interface EpisodeRecord {
  id: string;
  owner_id?: string | null;
  session_id?: string | null;
  source_document_id?: string | null;
  kind: string;
  speaker: string;
  title: string;
  content: string;
  code_snippet?: string | null;
  turn_index?: number | null;
  visibility: string;
  created_at?: string | null;
}

export interface LearningLinkRecord {
  id: string;
  owner_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  confidence: number;
  provenance: string;
  created_at?: string | null;
}

export interface RetrievalCandidate {
  episode: EpisodeRecord;
  score: number;
  lexical_rank?: number | null;
  vector_rank?: number | null;
  rrf_score: number;
}
