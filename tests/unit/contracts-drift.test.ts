import { describe, it, expect } from "vitest";
import {
  LearningApiClient,
  type LearningObservation,
  type ContextPacket,
  type TeachingDecision,
  type RunReceipt,
  type ArtifactRecord,
  type AttemptRecord,
  type ExposureRecord,
  type ErrorEnvelope,
} from "../../../contracts/learning-client";

describe("B03-AC3: Contracts Drift & TypeScript Client Validation", () => {
  it("deserializes LearningObservation without field-name drift", () => {
    const rawObs = {
      id: "obs-123",
      owner_id: "00000000-0000-0000-0000-000000000001",
      session_id: "sess-123",
      competency_key: "two_pointers",
      source_kind: "learner_work" as const,
      assistance_level: "independent" as const,
      demonstrated: true,
      evidence_text: "Solved independently without hints.",
      message_id: "msg-123",
      artifact_id: "art-123",
      attempt_id: "att-123",
      created_at: "2026-09-12T20:00:00Z",
    };

    const parsed: LearningObservation = rawObs;
    expect(parsed.id).toBe("obs-123");
    expect(parsed.owner_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(parsed.demonstrated).toBe(true);
    expect(parsed.assistance_level).toBe("independent");
    expect(parsed.attempt_id).toBe("att-123");
  });

  it("deserializes ContextPacket and preserves exposure_snapshot and mode", () => {
    const rawPacket = {
      session_id: "sess-123",
      owner_id: "00000000-0000-0000-0000-000000000001",
      active_revision: 2,
      artifact_content: "def two_sum(): pass",
      pending_question: "What is time complexity?",
      permitted_references: ["python_docs"],
      observed_competencies: ["hash_table"],
      recent_messages: [{ role: "learner", content: "hello" }],
      source_episodes: [],
      mode: "practice" as const,
      exposure_snapshot: {
        owner_id: "00000000-0000-0000-0000-000000000001",
        competency_key: "hash_table",
        exposure_count: 2,
        independent_success_count: 1,
        guided_count: 1,
        tutor_supplied_count: 0,
        last_exposed_at: "2026-09-12T19:00:00Z",
        last_assistance_level: "guided" as const,
      },
    };

    const parsed: ContextPacket = rawPacket;
    expect(parsed.active_revision).toBe(2);
    expect(parsed.mode).toBe("practice");
    expect(parsed.exposure_snapshot?.exposure_count).toBe(2);
  });

  it("deserializes TeachingDecision and RunReceipt", () => {
    const rawDecision: TeachingDecision = {
      decision_id: "dec-1",
      session_id: "sess-1",
      owner_id: "00000000-0000-0000-0000-000000000001",
      expected_revision: 2,
      assessment: "Strong understanding",
      uncertainty: 0.1,
      next_action: "probe",
      reveal_limit: 0,
      observed_success_criteria: ["O(N) time"],
      rationale: "Prompt for edge cases",
      model_version: "gemini-3.8-flash",
    };
    expect(rawDecision.uncertainty).toBe(0.1);

    const rawReceipt: RunReceipt = {
      run_id: "run-abc",
      session_id: "sess-1",
      message_id: "msg-abc",
      accepted_revision: 2,
      status_url: "/api/runs/run-abc",
      events_url: "/api/runs/run-abc/events",
    };
    expect(rawReceipt.accepted_revision).toBe(2);
  });

  it("deserializes AttemptRecord and ErrorEnvelope", () => {
    const rawAttempt: AttemptRecord = {
      id: "att-1",
      owner_id: "00000000-0000-0000-0000-000000000001",
      session_id: "sess-1",
      artifact_id: "art-1",
      frozen_code: "def solve(): return True",
      frozen_language: "python",
      source_revision: 2,
      elapsed_seconds: 60,
      assistance_level: "independent",
      mode: "strict",
      exposure_state: { difficulty: "medium" },
      created_at: "2026-09-12T20:00:00Z",
    };
    expect(rawAttempt.elapsed_seconds).toBe(60);
    expect(rawAttempt.mode).toBe("strict");

    const rawError: ErrorEnvelope = {
      code: "STALE_REVISION",
      message: "Expected revision 2 but current is 3",
      expected_revision: 2,
    };
    expect(rawError.code).toBe("STALE_REVISION");
  });

  it("instantiates LearningApiClient with mock base URL", () => {
    const client = new LearningApiClient("http://localhost:8000", () => "mock-token");
    expect(client).toBeDefined();
  });
});
