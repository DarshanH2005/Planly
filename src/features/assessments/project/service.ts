/**
 * Sprint B20: Project Review Client Service
 * Authority: PLANLY_BUILD_SPEC.md §8; B20_project_behavioral.md
 */

import type {
  ProjectArtifact,
  ProjectMetric,
  ProjectReviewTurn,
  ProjectReviewSessionState,
  ObservedGap,
  StudyActivityRecommendation,
} from "./types";

/**
 * B20-AC1: Ensures missing users, deployment, or impact metrics are strictly
 * recorded as UNKNOWN and never fabricated.
 */
export function sanitizeArtifactMetrics(
  rawMetrics: Partial<ProjectMetric>[]
): ProjectMetric[] {
  return rawMetrics.map((m) => {
    const val = m.value?.trim();
    if (!val || ["unknown", "none", "n/a", "unmeasured"].includes(val.toLowerCase())) {
      return {
        name: m.name || "metric",
        value: null,
        status: "unknown",
        source_note: m.source_note || "Not measured in production / prototype only",
      };
    }
    return {
      name: m.name || "metric",
      value: val,
      status: m.status || "proposed",
      source_note: m.source_note,
    };
  });
}

/**
 * B20-AC2: Validates that follow-up turns reference actual artifacts and preserve source IDs.
 */
export function verifyFollowUpSourceTracking(
  turn: ProjectReviewTurn,
  expectedArtifactId: string
): boolean {
  if (turn.role !== "interviewer") return true;
  // Interviewer follow-up must link back to source artifact
  const hasArtifactId = turn.source_artifact_id === expectedArtifactId;
  const referencesSection = Boolean(turn.referenced_section);
  return hasArtifactId && referencesSection;
}

/**
 * B20-AC3: Verifies that project or behavioral competencies do not leak
 * into or alter the algorithm (DSA) readiness state.
 */
export function verifyTrackIsolation(
  initialDsaCompetencies: string[],
  postReviewDsaCompetencies: string[]
): boolean {
  if (initialDsaCompetencies.length !== postReviewDsaCompetencies.length) {
    return false;
  }
  const setA = new Set(initialDsaCompetencies);
  return postReviewDsaCompetencies.every((key) => setA.has(key));
}

/**
 * Failure to Prevent:
 * Role-specific practice is NOT an official company interview unless supported
 * by attributable current requirements.
 */
export function verifyOfficialCompanyClaim(
  companyName?: string,
  hasVerifiedRequisition: boolean = false
): { isOfficial: boolean; label: string } {
  if (!companyName) {
    return { isOfficial: false, label: "General Project Architecture Practice" };
  }
  if (!hasVerifiedRequisition) {
    return {
      isOfficial: false,
      label: `Targeted Preparation (${companyName} Pattern) — Unofficial Practice`,
    };
  }
  return {
    isOfficial: true,
    label: `Official Interview Rehearsal for ${companyName}`,
  };
}

/**
 * Routes diagnosed gaps to actionable study recommendations.
 */
export function routeGapsToStudyRecommendations(
  gaps: ObservedGap[]
): StudyActivityRecommendation[] {
  const catalog: Record<string, StudyActivityRecommendation> = {
    "project.concurrency.unspecified_backpressure": {
      gap_key: "project.concurrency.unspecified_backpressure",
      title: "Backpressure & Consumer Flow Control",
      description: "Implement reactive stream throttling, Kafka consumer lag metrics, and HTTP 429 backoff.",
      estimated_minutes: 25,
    },
    "project.trade_off.unjustified": {
      gap_key: "project.trade_off.unjustified",
      title: "State Store Consistency Trade-offs",
      description: "Analyze CAP theorem compromises, write-ahead logs, and ACID vs eventual consistency.",
      estimated_minutes: 25,
    },
    "project.failure_mode.unhandled_poison_pill": {
      gap_key: "project.failure_mode.unhandled_poison_pill",
      title: "Dead-Letter Queue (DLQ) & Poison Pill Isolation",
      description: "Design dead-letter routing, backoff strategies, and idempotency key retention.",
      estimated_minutes: 30,
    },
    "project.telemetry.fabricated_claims": {
      gap_key: "project.telemetry.fabricated_claims",
      title: "Production Observability & SLA Measurement",
      description: "Frame honest prototype metrics and synthetic benchmarking without fabricated numbers.",
      estimated_minutes: 20,
    },
  };

  return gaps.map((g) => {
    return (
      catalog[g.gap_key] || {
        gap_key: g.gap_key,
        title: `Study: ${g.gap_key}`,
        description: g.description,
        estimated_minutes: 20,
      }
    );
  });
}

/**
 * Resumes an interrupted project review session, preserving all state.
 */
export function resumeProjectReviewSession(
  state: ProjectReviewSessionState
): ProjectReviewSessionState {
  return {
    ...state,
    is_interrupted: true,
    updated_at: new Date().toISOString(),
  };
}
