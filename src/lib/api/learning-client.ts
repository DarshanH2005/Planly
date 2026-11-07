/**
 * Learning API Client for Next.js Classroom Frontend.
 * Sprint: B09
 * Authority: planly_architecture.md sections 1, 4, 8, 13
 *
 * Provides typed methods for durable runs, streaming event consumption,
 * classroom/session lifecycle, and artifact revisions.
 */

import {
  LearningApiClient as BaseClient,
  type TurnRunRecord,
  type RunEvent,
  type RunReceipt,
  type RunStatusResponse,
  type RunEventsResponse,
  type SessionMessageInput,
  type ArtifactInput,
  type ArtifactRecord,
  type TeachingDecision,
  type ContextPacket,
  type ErrorEnvelope,
  type ExecutionStatus,
  type TestResult,
  type ExecutionRecord,
  type ExecutionRequestInput,
  type ExecutionResponse,
} from "@contracts/learning-client";

import type {
  ClassroomRecord,
  SessionRecord,
  MessageRecord,
  LessonMicroGoal,
  ActivityDefinition,
  LessonTurnInput,
  LessonTurnResponse,
  MicroGoalInput,
  MicroGoalUpdateInput,
} from "@contracts/learning-types";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";

export type {
  TurnRunRecord,
  RunEvent,
  RunReceipt,
  RunStatusResponse,
  RunEventsResponse,
  SessionMessageInput,
  ArtifactInput,
  ArtifactRecord,
  TeachingDecision,
  ContextPacket,
  ErrorEnvelope,
  ClassroomRecord,
  SessionRecord,
  MessageRecord,
  LessonMicroGoal,
  ActivityDefinition,
  LessonTurnInput,
  LessonTurnResponse,
  MicroGoalInput,
  MicroGoalUpdateInput,
  ExecutionStatus,
  TestResult,
  ExecutionRecord,
  ExecutionRequestInput,
  ExecutionResponse,
};

export interface PlanCommitmentRecord {
  id: string;
  owner_id: string;
  plan_id: string;
  activity_id?: string;
  competency_key: string;
  title: string;
  kind: "dsa_new" | "dsa_review" | "dsa_repair" | "sql" | "cs_recall" | "continuity" | "rotating";
  estimate_minutes: number;
  planned_date: string;
  committed_date: string;
  original_committed_date: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "deferred";
  is_carryover: boolean;
  reason?: string;
  generated_key?: string;
  completed_at?: string;
}

export interface PlanRecord {
  id: string;
  owner_id: string;
  goal_id: string;
  start_date: string;
  end_date: string;
  status: string;
  revision_number: number;
  declared_capacity_minutes: number;
  effective_budget_minutes: number;
  commitments: PlanCommitmentRecord[];
  is_skipped_day: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanPreviewResponse {
  plan_id: string;
  current_revision: number;
  proposed_revision: number;
  today_date: string;
  mode: "rest" | "minimum" | "ramp" | "normal" | "bonus" | "custom";
  declared_capacity_minutes: number;
  effective_budget_minutes: number;
  today_committed_minutes: number;
  today_commitments: PlanCommitmentRecord[];
  retained_commitments: PlanCommitmentRecord[];
  carryover_count: number;
  prerequisite_repairs: string[];
  explanations: Record<string, string>;
  diff: Record<string, any>;
}

export interface TodayPlanResponse {
  plan_id: string;
  today_date: string;
  mode: "rest" | "minimum" | "ramp" | "normal" | "bonus" | "custom";
  declared_capacity_minutes: number;
  effective_budget_minutes: number;
  today_committed_minutes: number;
  today_commitments: PlanCommitmentRecord[];
  retained_commitments: PlanCommitmentRecord[];
  carryover_count: number;
  prerequisite_repairs: string[];
  explanations: Record<string, string>;
  diff: Record<string, any>;
}

export interface QuietWeeklyReview {
  owner_id: string;
  verified_this_week: string[];
  uncertain_this_week: string[];
  next_recommended_activities: Array<{
    activity_id: string;
    title: string;
    track: string;
    reason: string;
    route: string;
    action_label: string;
  }>;
  clutter_free: boolean;
  created_at: string;
}

export interface ProgressProjectionResponse {
  owner_id: string;
  dimensions: Record<string, {
    dimension_key: string;
    title: string;
    verified_competencies: string[];
    uncertain_competencies: string[];
    evidence_count: number;
    assistance_breakdown: { independent: number; guided: number; tutor_supplied: number };
    unsupported_claims_rejected: string[];
  }>;
  total_verified_competencies: number;
  total_uncertain_competencies: number;
  disclaimed_percentages: string[];
  updated_at: string;
}

export interface ClassroomInput {
  id?: string;
  track?: string;
  title: string;
}

export interface SessionCreateInput {
  stage?: string;
  mode?: string;
  parent_session_id?: string;
  title?: string;
}

export interface LessonHandoff {
  id: string;
  child_session_id: string;
  title: string;
  status: string;
  summary: string;
  demonstrated_skills: string[];
  misconceptions: string[];
  next_recommendation?: string | null;
  created_at: string;
}

export interface CoachMemory {
  id: string;
  filename: string;
  track: string;
  turn_count: number;
  summary: string;
  source_turn_indices: number[];
}

export interface ModelCatalogEntry {
  key: string;
  provider: string;
  model_name: string;
  display_name: string;
  enabled: boolean;
  input_cost_per_m: number;
  output_cost_per_m: number;
}

export interface ModelRouteSetting {
  primary: string;
  fallbacks: string[];
}

export interface ModelRoutingResponse {
  models: ModelCatalogEntry[];
  routes: Record<string, ModelRouteSetting>;
  protected_tasks: string[];
}

export interface ProviderCredentialStatus {
  configured: boolean;
  updated_at: string | null;
}

export interface ProviderCredentialsResponse {
  providers: Record<string, ProviderCredentialStatus>;
  supported_providers: string[];
}

/**
 * Creates a deterministic dev token for local dev / tests when Supabase is unconfigured.
 */
export function createDevToken(ownerId: string = "dev-owner-001", email: string = "dev@localhost"): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: ownerId,
    email,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  };
  const b64 = (obj: object) => {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    }
    return btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };
  return `${b64(header)}.${b64(payload)}.dummy_sig_planly_dev`;
}

export class ClassroomApiClient extends BaseClient {
  private base: string;
  private tokenProvider: () => Promise<string | null> | string | null;

  constructor(
    baseUrl: string = typeof window === "undefined"
      ? process.env.LEARNING_API_INTERNAL_URL || process.env.NEXT_PUBLIC_LEARNING_API_URL || "http://127.0.0.1:8000"
      : process.env.NEXT_PUBLIC_LEARNING_API_URL || "http://127.0.0.1:8000",
    tokenProvider?: () => Promise<string | null> | string | null
  ) {
    const defaultTokenProvider = () => {
      // Prefer the real Supabase access token.  The login flow stores the
      // session in cookies, not in planly_auth_token localStorage.
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("planly_auth_token");
        if (stored) return stored;
        const configured = Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
          !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") &&
          !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("dummy")
        );
        if (configured) {
          return createSupabaseBrowserClient().auth.getSession().then(({ data }) =>
            data.session?.access_token ?? null
          );
        }
      }
      return typeof window === "undefined" ? null : createDevToken();
    };

    const activeTokenProvider = tokenProvider || defaultTokenProvider;
    super(baseUrl, activeTokenProvider);
    this.base = baseUrl === "/api" || baseUrl.endsWith("/api")
      ? baseUrl.slice(0, -4).replace(/\/+$/, "")
      : baseUrl.replace(/\/+$/, "");
    this.tokenProvider = activeTokenProvider;
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    expectedStatus: number = 200
  ): Promise<T> {
    const token = await Promise.resolve(this.tokenProvider());
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${this.base}${path}`, {
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
      const msg = errBody.message || (errBody as any).detail || `HTTP ${res.status}`;
      const err = new Error(msg);
      (err as any).status = res.status;
      (err as any).envelope = errBody;
      throw err;
    }

    return (await res.json()) as T;
  }

  // --- Classrooms & Sessions ---

  public async listClassrooms(): Promise<ClassroomRecord[]> {
    return this.makeRequest<ClassroomRecord[]>("GET", "/api/classrooms", undefined, 200);
  }

  public async getClassroom(classroomId: string): Promise<ClassroomRecord> {
    return this.makeRequest<ClassroomRecord>("GET", `/api/classrooms/${classroomId}`, undefined, 200);
  }

  public override async createClassroom(
    body: ClassroomInput | string,
    title?: string
  ): Promise<ClassroomRecord> {
    const payload =
      typeof body === "string"
        ? { track: body, title: title || `${body.toUpperCase()} Classroom` }
        : body;
    return this.makeRequest<ClassroomRecord>("POST", "/api/classrooms", payload, 201);
  }

  public async listSessions(classroomId: string): Promise<SessionRecord[]> {
    return this.makeRequest<SessionRecord[]>("GET", `/api/classrooms/${classroomId}/sessions`, undefined, 200);
  }

  public async createSession(classroomId: string, body?: SessionCreateInput): Promise<SessionRecord> {
    return this.makeRequest<SessionRecord>(
      "POST",
      `/api/classrooms/${classroomId}/sessions`,
      body || { stage: "foundation", mode: "learn" },
      201
    );
  }

  public async getSession(sessionId: string): Promise<SessionRecord> {
    return this.makeRequest<SessionRecord>("GET", `/api/sessions/${sessionId}`, undefined, 200);
  }

  public async openCoachLesson(sessionId: string, topic: string): Promise<SessionRecord> {
    return this.makeRequest("POST", `/api/sessions/${sessionId}/open-lesson`, { content: topic }, 200);
  }

  public async dismissCoachLesson(sessionId: string): Promise<void> {
    await this.makeRequest("DELETE", `/api/sessions/${sessionId}/coach-recommendation`, undefined, 200);
  }

  public async getLessonHandoffs(sessionId: string): Promise<LessonHandoff[]> {
    return this.makeRequest<LessonHandoff[]>("GET", `/api/sessions/${sessionId}/handoffs`, undefined, 200);
  }

  public async postCoachMessage(sessionId: string, content: string): Promise<MessageRecord[]> {
    return this.makeRequest<MessageRecord[]>("POST", `/api/sessions/${sessionId}/coach-message`, { content }, 200);
  }

  public async postCoachTurn(sessionId: string, content: string): Promise<{ messages: MessageRecord[]; recommended_lesson: string | null }> {
    return this.makeRequest("POST", `/api/sessions/${sessionId}/coach-turn`, { content }, 200);
  }

  public async getCoachMemory(): Promise<CoachMemory[]> {
    return this.makeRequest("GET", "/api/coach/memory", undefined, 200);
  }

  public async getCoachRecommendation(sessionId: string): Promise<{ recommended_lesson: string | null }> {
    return this.makeRequest("GET", `/api/sessions/${sessionId}/coach-recommendation`, undefined, 200);
  }

  public async completeLesson(sessionId: string, handoff: Omit<LessonHandoff, "id" | "child_session_id" | "created_at">): Promise<LessonHandoff> {
    return this.makeRequest<LessonHandoff>("POST", `/api/sessions/${sessionId}/complete`, handoff, 200);
  }

  public async getSessionArtifact(sessionId: string, revision?: number): Promise<ArtifactRecord | null> {
    const query = revision ? `?revision=${revision}` : "";
    try {
      return await this.makeRequest<ArtifactRecord>("GET", `/api/sessions/${sessionId}/artifact${query}`, undefined, 200);
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  public async getSessionMessages(sessionId: string): Promise<MessageRecord[]> {
    try {
      return await this.makeRequest<MessageRecord[]>("GET", `/api/sessions/${sessionId}/messages`, undefined, 200);
    } catch (e: any) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  // --- Pedagogical Decisions & Micro-Goals ---

  public async getSessionDecisions(sessionId: string): Promise<TeachingDecision[]> {
    return this.makeRequest<TeachingDecision[]>("GET", `/api/sessions/${sessionId}/decisions`, undefined, 200);
  }

  public async getMicroGoals(sessionId: string): Promise<LessonMicroGoal[]> {
    return this.makeRequest<LessonMicroGoal[]>("GET", `/api/sessions/${sessionId}/micro-goals`, undefined, 200);
  }

  public async createMicroGoal(sessionId: string, body: MicroGoalInput): Promise<LessonMicroGoal> {
    return this.makeRequest<LessonMicroGoal>("POST", `/api/sessions/${sessionId}/micro-goals`, body, 201);
  }

  public async updateMicroGoal(sessionId: string, goalId: string, body: MicroGoalUpdateInput): Promise<LessonMicroGoal> {
    return this.makeRequest<LessonMicroGoal>("PUT", `/api/sessions/${sessionId}/micro-goals/${goalId}`, body, 200);
  }

  public async getActivity(activityId: string): Promise<ActivityDefinition> {
    return this.makeRequest<ActivityDefinition>("GET", `/api/activities/${activityId}`, undefined, 200);
  }

  public async getTopicActivity(topic: string): Promise<ActivityDefinition> {
    return this.makeRequest("GET", `/api/coach/activity?topic=${encodeURIComponent(topic)}`, undefined, 200);
  }

  public async getSessionActivity(sessionId: string): Promise<ActivityDefinition> {
    return this.makeRequest("GET", `/api/sessions/${sessionId}/activity`, undefined, 200);
  }

  public async executeLessonTurn(sessionId: string, body: LessonTurnInput): Promise<LessonTurnResponse> {
    return this.makeRequest<LessonTurnResponse>("POST", `/api/sessions/${sessionId}/lesson-turn`, body, 200);
  }

  // --- Sprint B10: Verified Code Execution ---

  public async executeSessionCode(sessionId: string, body?: ExecutionRequestInput): Promise<ExecutionResponse> {
    return this.makeRequest<ExecutionResponse>("POST", `/api/sessions/${sessionId}/execute`, body || {}, 200);
  }

  public async getSessionExecutions(sessionId: string): Promise<ExecutionRecord[]> {
    return this.makeRequest<ExecutionRecord[]>("GET", `/api/sessions/${sessionId}/executions`, undefined, 200);
  }

  public async getWeeklyReview(): Promise<QuietWeeklyReview> {
    return this.makeRequest<QuietWeeklyReview>("GET", "/api/progress/weekly", undefined, 200);
  }

  public async getProgressProjection(): Promise<ProgressProjectionResponse> {
    return this.makeRequest<ProgressProjectionResponse>("GET", "/api/progress/projection", undefined, 200);
  }

  public async getModelRouting(): Promise<ModelRoutingResponse> {
    return this.makeRequest<ModelRoutingResponse>("GET", "/api/model-routing", undefined, 200);
  }

  public async updateModelRouting(
    routes: Record<string, ModelRouteSetting>
  ): Promise<ModelRoutingResponse> {
    return this.makeRequest<ModelRoutingResponse>("PUT", "/api/model-routing", { routes }, 200);
  }

  public async getProviderCredentials(): Promise<ProviderCredentialsResponse> {
    return this.makeRequest<ProviderCredentialsResponse>("GET", "/api/provider-credentials", undefined, 200);
  }

  public async saveProviderCredential(provider: string, apiKey: string): Promise<ProviderCredentialsResponse> {
    return this.makeRequest<ProviderCredentialsResponse>(
      "PUT",
      `/api/provider-credentials/${provider}`,
      { api_key: apiKey },
      200
    );
  }

  public async deleteProviderCredential(provider: string): Promise<ProviderCredentialsResponse> {
    return this.makeRequest<ProviderCredentialsResponse>(
      "DELETE",
      `/api/provider-credentials/${provider}`,
      undefined,
      200
    );
  }

  public async getExecution(sessionId: string, executionId: string): Promise<ExecutionRecord> {
    return this.makeRequest<ExecutionRecord>("GET", `/api/sessions/${sessionId}/executions/${executionId}`, undefined, 200);
  }

  // --- Sprint B13: Adaptive Plans & Capacity ---

  public async getTodayPlan(date?: string, sessionId?: string): Promise<TodayPlanResponse> {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (sessionId) params.set("session_id", sessionId);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.makeRequest<TodayPlanResponse>("GET", `/api/plans/today${qs}`, undefined, 200);
  }

  public async previewPlan(body: {
    today_date?: string;
    declared_minutes_override?: number;
    declared_mode?: string;
    has_loop_gap_override?: boolean;
    session_id?: string;
  }): Promise<PlanPreviewResponse> {
    return this.makeRequest<PlanPreviewResponse>("POST", "/api/plans/preview", body, 200);
  }

  public async commitPlan(body: {
    plan_id: string;
    expected_revision: number;
    commitments: PlanCommitmentRecord[];
    request_key?: string;
  }): Promise<PlanRecord> {
    return this.makeRequest<PlanRecord>("POST", "/api/plans/commit", body, 200);
  }

  public async setCapacity(body: {
    date: string;
    declared_minutes: number;
    mode?: string;
  }): Promise<any> {
    return this.makeRequest<any>("PUT", "/api/plans/capacity", body, 200);
  }

  public async completeCommitment(commitmentId: string): Promise<{ commitment_id: string; status: string }> {
    return this.makeRequest<{ commitment_id: string; status: string }>(
      "POST",
      `/api/plans/commitments/${commitmentId}/complete`,
      undefined,
      200
    );
  }

  public async recordSkippedDay(date?: string): Promise<PlanRecord> {
    return this.makeRequest<PlanRecord>("POST", "/api/plans/skipped-day", { date }, 200);
  }

  // --- Reconnectable Durable Run Streaming (B04 & B09) ---

  /**
   * Submits a message to the durable worker queue and auto-executes in background.
   */
  public async submitMessageWithAutoExecute(
    sessionId: string,
    content: string,
    expectedRevision: number,
    clientRequestId?: string
  ): Promise<RunReceipt> {
    return this.makeRequest<RunReceipt>(
      "POST",
      `/api/sessions/${sessionId}/messages`,
      {
        content,
        expected_revision: expectedRevision,
        client_request_id: clientRequestId,
        auto_execute: true,
      },
      202
    );
  }

  /**
   * Subscribes to streaming events from a durable run with reconnect support.
   * Polls `GET /api/runs/{runId}/events?after_seq={seq}` until run completion.
   */
  public subscribeToRunEvents(
    runId: string,
    initialSeq: number = 0,
    callbacks: {
      onEvent: (event: RunEvent) => void;
      onComplete: (status: RunStatusResponse) => void;
      onError: (err: Error) => void;
    },
    pollIntervalMs: number = 300
  ): () => void {
    let cancelled = false;
    let currentSeq = initialSeq;

    const poll = async () => {
      if (cancelled) return;

      try {
        const eventsRes = await this.getRunEvents(runId, currentSeq);

        for (const evt of eventsRes.events) {
          if (evt.seq > currentSeq) {
            currentSeq = evt.seq;
            callbacks.onEvent(evt);
          }
        }

        if (eventsRes.is_complete) {
          const statusRes = await this.getRunStatus(runId);
          callbacks.onComplete(statusRes);
          return;
        }

        if (!cancelled) {
          setTimeout(poll, pollIntervalMs);
        }
      } catch (err: any) {
        if (!cancelled) {
          callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    poll();

    // Return cleanup function to cancel polling
    return () => {
      cancelled = true;
    };
  }
}

// Export singleton instance for app-wide use
export const learningApi = new ClassroomApiClient();
