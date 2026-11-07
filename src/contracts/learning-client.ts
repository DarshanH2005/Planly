/**
 * Auto-generated wire contracts and API client for Planly Learning Service.
 * Generated from OpenAPI schema version: 0.2.0 (B04)
 *
 * DO NOT EDIT MANUALLY. Regenerate with:
 *   python contracts/generate_contracts.py
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

export type RunState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type RunLane = "foreground" | "background";

export type EventType =
  | "queued"
  | "thinking"
  | "decision"
  | "chunk"
  | "done"
  | "error"
  | "cancelled";

export type ExternalCallStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "uncertain";

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

export interface SessionMessageInput {
  content: string;
  expected_revision: number;
  client_request_id?: string | null;
  auto_execute?: boolean;
}

export type MessageInput = SessionMessageInput;

export interface ArtifactInput {
  content: string;
  expected_revision: number;
  language?: string;
}

export interface AttemptInput {
  source_revision: number;
  assistance_level: AssistanceLevel;
  artifact_id?: string | null;
  frozen_code?: string;
  frozen_language?: string;
  elapsed_seconds?: number | null;
  mode?: SessionMode;
  exposure_state?: Record<string, unknown>;
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
  created_at?: string | null;
  updated_at?: string | null;
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

export type ExecutionStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "error"
  | "static_review_only";

export interface TestResult {
  name: string;
  passed: boolean;
  expected?: string | null;
  actual?: string | null;
  error?: string | null;
  execution_time_ms: number;
}

export interface ExecutionRecord {
  id: string;
  session_id: string;
  owner_id: string;
  artifact_id?: string | null;
  artifact_revision: number;
  artifact_hash: string;
  test_suite_hash: string;
  status: ExecutionStatus;
  passed: boolean;
  tests_total: number;
  tests_passed: number;
  results: TestResult[];
  stdout: string;
  stderr: string;
  stdout_truncated?: boolean;
  duration_ms: number;
  sandbox_provider: string;
  is_stale: boolean;
  created_at: string;
}

export interface ExecutionRequestInput {
  session_id?: string | null;
  revision?: number | null;
  test_suite_id?: string | null;
  code_override?: string | null;
}

export interface ExecutionResponse {
  execution: ExecutionRecord;
  is_stale: boolean;
  observation_recorded?: boolean | null;
  finite_test_pass?: boolean;
  independent_mastery?: boolean;
  pedagogical_note?: string;
  stale_warning?: string | null;
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

export interface ModeRecord {
  mode: SessionMode;
  coaching_permitted: boolean;
  strict_deadline_seconds?: number | null;
  hints_enabled?: boolean;
  reveal_limit?: number;
  requires_clean_submission?: boolean;
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
  source_episodes: Record<string, unknown>[];
  mode: SessionMode;
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

export interface RunReceipt {
  run_id: string;
  session_id: string;
  message_id: string;
  accepted_revision: number;
  status_url: string;
  events_url: string;
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

export class LearningApiClient {
  private baseUrl: string;
  private getAuthToken: () => Promise<string | null> | string | null;

  constructor(
    baseUrl: string = "http://localhost:8000",
    getAuthToken: () => Promise<string | null> | string | null = () => null
  ) {
    // The browser deployment exposes the learning service at the same-origin
    // /api prefix; endpoint methods already include /api, so avoid /api/api.
    this.baseUrl = baseUrl === "/api" || baseUrl.endsWith("/api")
      ? baseUrl.slice(0, -4).replace(/\/+$/, "")
      : baseUrl.replace(/\/+$/, "");
    this.getAuthToken = getAuthToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expectedStatus: number = 200
  ): Promise<T> {
    const token = await Promise.resolve(this.getAuthToken());
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status !== expectedStatus) {
      let errBody: ErrorEnvelope;
      try {
        errBody = (await res.json()) as ErrorEnvelope;
      } catch {
        errBody = { code: "HTTP_ERROR", message: `HTTP ${res.status}: ${res.statusText}` };
      }
      throw new Error(`API Error [${res.status}]: ${errBody.message || JSON.stringify(errBody)}`);
    }

    return (await res.json()) as T;
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/api/health", undefined, 200);
  }

  public async getCurrentUser(): Promise<OwnerResponse> {
    return this.request<OwnerResponse>("GET", "/api/auth/me", undefined, 200);
  }

  public async postSessionMessage(sessionId: string, body: SessionMessageInput): Promise<RunReceipt> {
    return this.request<RunReceipt>("POST", `/api/sessions/${sessionId}/messages`, body, 202);
  }

  public async putSessionArtifact(sessionId: string, body: ArtifactInput): Promise<ArtifactRecord> {
    return this.request<ArtifactRecord>("PUT", `/api/sessions/${sessionId}/artifact`, body, 200);
  }

  public async postSessionAttempt(sessionId: string, body: AttemptInput): Promise<AttemptRecord> {
    return this.request<AttemptRecord>("POST", `/api/sessions/${sessionId}/attempts`, body, 201);
  }

  public async getSessionAttempts(sessionId: string): Promise<AttemptRecord[]> {
    return this.request<AttemptRecord[]>("GET", `/api/sessions/${sessionId}/attempts`, undefined, 200);
  }

  public async postLearningObservation(sessionId: string, body: ObservationInput): Promise<LearningObservation> {
    return this.request<LearningObservation>("POST", `/api/sessions/${sessionId}/observations`, body, 201);
  }

  public async getSessionObservations(sessionId: string): Promise<LearningObservation[]> {
    return this.request<LearningObservation[]>("GET", `/api/sessions/${sessionId}/observations`, undefined, 200);
  }

  public async getSessionContext(sessionId: string): Promise<ContextPacket> {
    return this.request<ContextPacket>("GET", `/api/sessions/${sessionId}/context`, undefined, 200);
  }

  public async getRunStatus(runId: string): Promise<RunStatusResponse> {
    return this.request<RunStatusResponse>("GET", `/api/runs/${runId}`, undefined, 200);
  }

  public async getRunEvents(runId: string, afterSeq: number = 0): Promise<RunEventsResponse> {
    return this.request<RunEventsResponse>("GET", `/api/runs/${runId}/events?after_seq=${afterSeq}`, undefined, 200);
  }

  public async cancelRun(runId: string): Promise<RunStatusResponse> {
    return this.request<RunStatusResponse>("POST", `/api/runs/${runId}/cancel`, undefined, 200);
  }

  public async listClassrooms(): Promise<ClassroomRecord[]> {
    return this.request<ClassroomRecord[]>("GET", "/api/classrooms", undefined, 200);
  }

  public async getClassrooms(): Promise<ClassroomRecord[]> {
    return this.listClassrooms();
  }

  public async getClassroom(classroomId: string): Promise<ClassroomRecord> {
    return this.request<ClassroomRecord>("GET", `/api/classrooms/${classroomId}`, undefined, 200);
  }

  public async createClassroom(body: { track: string; title: string } | string, title?: string): Promise<ClassroomRecord> {
    const payload = typeof body === "string" ? { track: body, title: title || `${body.toUpperCase()} Classroom` } : body;
    return this.request<ClassroomRecord>("POST", "/api/classrooms", payload, 201);
  }

  public async listSessions(classroomId: string): Promise<SessionRecord[]> {
    return this.request<SessionRecord[]>("GET", `/api/classrooms/${classroomId}/sessions`, undefined, 200);
  }

  public async getClassroomSessions(classroomId: string): Promise<SessionRecord[]> {
    return this.listSessions(classroomId);
  }

  public async createSession(classroomId: string, body?: { stage?: string; mode?: string }): Promise<SessionRecord> {
    return this.request<SessionRecord>(
      "POST",
      `/api/classrooms/${classroomId}/sessions`,
      body || { stage: "foundation", mode: "learn" },
      201
    );
  }

  public async createClassroomSession(classroomId: string, stage: string = "foundation", mode: string = "learn"): Promise<SessionRecord> {
    return this.createSession(classroomId, { stage, mode });
  }

  public async getSession(sessionId: string): Promise<SessionRecord> {
    return this.request<SessionRecord>("GET", `/api/sessions/${sessionId}`, undefined, 200);
  }

  public async getSessionArtifact(sessionId: string, revision?: number): Promise<ArtifactRecord | null> {
    const query = revision ? `?revision=${revision}` : "";
    try {
      return await this.request<ArtifactRecord>("GET", `/api/sessions/${sessionId}/artifact${query}`, undefined, 200);
    } catch (e) {
      return null;
    }
  }

  public async getSessionMessages(sessionId: string): Promise<MessageRecord[]> {
    try {
      return await this.request<MessageRecord[]>("GET", `/api/sessions/${sessionId}/messages`, undefined, 200);
    } catch (e) {
      return [];
    }
  }

  public async getSessionDecisions(sessionId: string): Promise<TeachingDecision[]> {
    return this.request<TeachingDecision[]>("GET", `/api/sessions/${sessionId}/decisions`, undefined, 200);
  }

  public async getMicroGoals(sessionId: string): Promise<LessonMicroGoal[]> {
    return this.request<LessonMicroGoal[]>("GET", `/api/sessions/${sessionId}/micro-goals`, undefined, 200);
  }

  public async createMicroGoal(sessionId: string, body: MicroGoalInput): Promise<LessonMicroGoal> {
    return this.request<LessonMicroGoal>("POST", `/api/sessions/${sessionId}/micro-goals`, body, 201);
  }

  public async updateMicroGoal(sessionId: string, goalId: string, body: MicroGoalUpdateInput): Promise<LessonMicroGoal> {
    return this.request<LessonMicroGoal>("PUT", `/api/sessions/${sessionId}/micro-goals/${goalId}`, body, 200);
  }

  public async getActivity(activityId: string): Promise<ActivityDefinition> {
    return this.request<ActivityDefinition>("GET", `/api/activities/${activityId}`, undefined, 200);
  }

  public async executeLessonTurn(sessionId: string, body: LessonTurnInput): Promise<LessonTurnResponse> {
    return this.request<LessonTurnResponse>("POST", `/api/sessions/${sessionId}/lesson-turn`, body, 200);
  }

  public async postLessonTurn(sessionId: string, body: LessonTurnInput): Promise<LessonTurnResponse> {
    return this.executeLessonTurn(sessionId, body);
  }

  public async executeSessionCode(sessionId: string, body?: ExecutionRequestInput): Promise<ExecutionResponse> {
    return this.request<ExecutionResponse>("POST", `/api/sessions/${sessionId}/execute`, body || {}, 200);
  }

  public async getSessionExecutions(sessionId: string): Promise<ExecutionRecord[]> {
    return this.request<ExecutionRecord[]>("GET", `/api/sessions/${sessionId}/executions`, undefined, 200);
  }

  public async getExecution(sessionId: string, executionId: string): Promise<ExecutionRecord> {
    return this.request<ExecutionRecord>("GET", `/api/sessions/${sessionId}/executions/${executionId}`, undefined, 200);
  }
}
