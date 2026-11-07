import { describe, it, expect } from "vitest";
import {
  sanitizeArtifactMetrics,
  verifyFollowUpSourceTracking,
  verifyTrackIsolation,
  verifyOfficialCompanyClaim,
  routeGapsToStudyRecommendations,
  resumeProjectReviewSession,
} from "@/features/assessments/project/service";
import type {
  ProjectMetric,
  ProjectReviewTurn,
  ProjectReviewSessionState,
  ObservedGap,
} from "@/features/assessments/project/types";

describe("Sprint B20: Project, Design and Behavioural Interview Practice", () => {
  it("B20-AC1: verifies missing users, deployment, or impact data remains unknown rather than invented", () => {
    const rawMetrics: Partial<ProjectMetric>[] = [
      { name: "active_users", value: "unknown" },
      { name: "p99_latency", value: "" },
      { name: "throughput", value: "unmeasured" },
      { name: "prototype_requests", value: "50 req/sec", status: "verified" },
    ];

    const sanitized = sanitizeArtifactMetrics(rawMetrics);

    // Unmeasured or empty metrics MUST be unknown with value null
    expect(sanitized[0].status).toBe("unknown");
    expect(sanitized[0].value).toBeNull();
    expect(sanitized[0].source_note).toContain("Not measured");

    expect(sanitized[1].status).toBe("unknown");
    expect(sanitized[1].value).toBeNull();

    expect(sanitized[2].status).toBe("unknown");
    expect(sanitized[2].value).toBeNull();

    // Stated prototype metric is preserved honestly
    expect(sanitized[3].status).toBe("verified");
    expect(sanitized[3].value).toBe("50 req/sec");
  });

  it("B20-AC2: verifies follow-up references actual artifact and preserves source IDs", () => {
    const artifactId = "art-proj-pipeline-01";
    const validTurn: ProjectReviewTurn = {
      id: "turn-interviewer-02",
      role: "interviewer",
      stage: "trade_offs",
      content: "Referring back to your design decisions in art-proj-pipeline-01: why did you choose Kafka over RabbitMQ?",
      source_artifact_id: artifactId,
      source_turn_id: "turn-cand-01",
      referenced_section: "decisions",
      assistance_level: "independent",
      created_at: new Date().toISOString(),
    };

    expect(verifyFollowUpSourceTracking(validTurn, artifactId)).toBe(true);

    const invalidTurn: ProjectReviewTurn = {
      ...validTurn,
      source_artifact_id: "wrong-id",
    };
    expect(verifyFollowUpSourceTracking(invalidTurn, artifactId)).toBe(false);
  });

  it("B20-AC3: verifies project evidence does not alter algorithm (DSA) readiness automatically", () => {
    const initialDsa = ["dsa.arrays.two_sum", "dsa.strings.valid_palindrome"];
    const currentDsa = [...initialDsa];

    // Project observations recorded
    const projectObs = [
      "project.architecture.event_driven_pipeline",
      "project.concurrency.backpressure_control",
      "behavioral.star.conflict_resolution",
    ];

    // DSA competencies remain strictly identical
    expect(verifyTrackIsolation(initialDsa, currentDsa)).toBe(true);

    // If an unintended leak occurred:
    const leakedDsa = [...initialDsa, "dsa.trees.level_order_traversal"];
    expect(verifyTrackIsolation(initialDsa, leakedDsa)).toBe(false);
  });

  it("Failure to Prevent: rejects role-specific interview as official without attributable requirements", () => {
    // 1. Without verified requisition, official claim is declined
    const unverified = verifyOfficialCompanyClaim("Google", false);
    expect(unverified.isOfficial).toBe(false);
    expect(unverified.label).toContain("Unofficial Practice");

    // 2. With verified requisition, officially attributed
    const verified = verifyOfficialCompanyClaim("Google", true);
    expect(verified.isOfficial).toBe(true);
    expect(verified.label).toContain("Official Interview Rehearsal for Google");
  });

  it("routes observed gaps to feasible study activities and preserves state on resume", () => {
    const gaps: ObservedGap[] = [
      {
        dimension: "trade_offs_and_decisions",
        gap_key: "project.trade_off.unjustified",
        description: "Did not evaluate alternatives or CAP theorem trade-offs.",
        candidate_statement: "PostgreSQL is just the best DB.",
        resolved: false,
      },
      {
        dimension: "concurrency_and_scaling",
        gap_key: "project.concurrency.unspecified_backpressure",
        description: "Did not explain how upstream backpressure is handled.",
        candidate_statement: "We just scale up instances.",
        resolved: false,
      },
    ];

    const recommendations = routeGapsToStudyRecommendations(gaps);
    expect(recommendations.length).toBe(2);
    expect(recommendations[0].title).toBe("State Store Consistency Trade-offs");
    expect(recommendations[0].estimated_minutes).toBe(25);
    expect(recommendations[1].title).toBe("Backpressure & Consumer Flow Control");

    // Resumption test
    const dummyState: ProjectReviewSessionState = {
      session_id: "sess-123",
      owner_id: "owner-1",
      classroom_id: "cls-1",
      scenario_id: "proj_pipeline_defense",
      stage: "trade_offs",
      mode: "strict",
      artifact_id: "art-1",
      turns: [],
      rubric: {
        architecture_defended: true,
        concurrency_sound: false,
        trade_offs_justified: false,
        failure_recovery_understood: false,
        metrics_honest_and_verified: false,
        distinguishes_facts_from_proposals: false,
        observed_gaps: gaps,
        study_recommendations: recommendations,
      },
      is_official_company_interview: false,
      is_interrupted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const resumed = resumeProjectReviewSession(dummyState);
    expect(resumed.is_interrupted).toBe(true);
    expect(resumed.stage).toBe("trade_offs");
    expect(resumed.rubric.study_recommendations.length).toBe(2);
  });
});
