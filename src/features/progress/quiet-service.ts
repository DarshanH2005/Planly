/**
 * Sprint B21: Quiet Progress & Debrief Engine
 * Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md
 */

import type {
  CapabilityDimension,
  ProgressProjection,
  QuietSessionDebrief,
  QuietWeeklyReview,
  WhatImprovedItem,
  WhatRemainsUncertainItem,
  NextLessonRecommendation,
  UserApplicationRecord,
} from "./types";

export interface CanonicalObservation {
  id: string;
  owner_id: string;
  session_id: string;
  competency_key: string;
  source_kind: "learner_work" | "tutor_explanation" | "self_report" | "derived_inference" | "execution_evidence";
  assistance_level: "independent" | "guided" | "tutor_supplied" | "unassessed" | "unknown";
  demonstrated: boolean;
  evidence_text: string;
  created_at?: string;
}

const DIMENSION_CONFIG: Record<
  string,
  { title: string; matcher: (k: string) => boolean }
> = {
  dsa: {
    title: "Algorithms & Data Structures",
    matcher: (k) =>
      k.startsWith("dsa.") ||
      ["two_sum_hash_map", "two_pointers_converge", "prefix_sums", "while_loop_invariant"].includes(k),
  },
  cs: {
    title: "CS Fundamentals & Operating Systems",
    matcher: (k) => k.startsWith("cs."),
  },
  ml_sql: {
    title: "Applied AI/ML & SQL",
    matcher: (k) => k.startsWith("ml.") || k.startsWith("sql."),
  },
  project: {
    title: "System Architecture & Defense",
    matcher: (k) => k.startsWith("project."),
  },
  behavioral: {
    title: "Behavioral & STAR Impact",
    matcher: (k) => k.startsWith("behavioral."),
  },
};

function detectUnsupportedPercentages(text: string): string[] {
  const matches = text.match(/\b\d{1,3}(?:[–-]\d{1,3})?%\s*(?:ready|readiness|progress|chance)?\b/gi);
  return matches ? matches.map((m) => m.trim()) : [];
}

/**
 * B21-AC1: Unsupported percentages and simulated readiness never appear as real metrics.
 */
export function computeCanonicalProgressProjection(
  ownerId: string,
  observations: CanonicalObservation[]
): ProgressProjection {
  const dimensions: Record<string, CapabilityDimension> = {};
  for (const [key, cfg] of Object.entries(DIMENSION_CONFIG)) {
    dimensions[key] = {
      dimension_key: key as CapabilityDimension["dimension_key"],
      title: cfg.title,
      verified_competencies: [],
      uncertain_competencies: [],
      evidence_count: 0,
      assistance_breakdown: {
        independent: 0,
        guided: 0,
        tutor_supplied: 0,
      },
      unsupported_claims_rejected: [],
    };
  }

  const disclaimedPercentages: string[] = [];
  const statusMap = new Map<
    string,
    {
      demonstrated: boolean;
      assistance_level: string;
      evidence_count: number;
      unsupported_claims: string[];
    }
  >();

  for (const obs of observations) {
    if (obs.owner_id !== ownerId) continue;

    // Reject unsupported percentage claims
    const claims = detectUnsupportedPercentages(obs.evidence_text);
    if (claims.length > 0) {
      disclaimedPercentages.push(...claims);
    }

    const isIndependentSuccess =
      obs.demonstrated === true &&
      obs.assistance_level === "independent" &&
      obs.source_kind === "learner_work";

    const existing = statusMap.get(obs.competency_key);
    if (!existing) {
      statusMap.set(obs.competency_key, {
        demonstrated: isIndependentSuccess,
        assistance_level: obs.assistance_level,
        evidence_count: 1,
        unsupported_claims: claims,
      });
    } else {
      existing.evidence_count += 1;
      if (claims.length > 0) {
        existing.unsupported_claims.push(...claims);
      }
      // B21-AC2: Superseding evidence
      if (obs.demonstrated === false) {
        existing.demonstrated = false;
      } else if (isIndependentSuccess) {
        existing.demonstrated = true;
      }
      existing.assistance_level = obs.assistance_level;
    }
  }

  let totalVerified = 0;
  let totalUncertain = 0;

  for (const [key, status] of statusMap.entries()) {
    let targetDim = "dsa";
    for (const [dimKey, cfg] of Object.entries(DIMENSION_CONFIG)) {
      if (cfg.matcher(key)) {
        targetDim = dimKey;
        break;
      }
    }

    const dimObj = dimensions[targetDim];
    dimObj.evidence_count += status.evidence_count;

    if (status.assistance_level in dimObj.assistance_breakdown) {
      dimObj.assistance_breakdown[status.assistance_level as keyof typeof dimObj.assistance_breakdown] +=
        status.evidence_count;
    }

    if (status.demonstrated) {
      dimObj.verified_competencies.push(key);
      totalVerified += 1;
    } else {
      dimObj.uncertain_competencies.push(key);
      totalUncertain += 1;
    }

    if (status.unsupported_claims.length > 0) {
      dimObj.unsupported_claims_rejected.push(...status.unsupported_claims);
    }
  }

  for (const dim of Object.values(dimensions)) {
    dim.verified_competencies = Array.from(new Set(dim.verified_competencies)).sort();
    dim.uncertain_competencies = Array.from(new Set(dim.uncertain_competencies)).sort();
    dim.unsupported_claims_rejected = Array.from(new Set(dim.unsupported_claims_rejected)).sort();
  }

  return {
    owner_id: ownerId,
    dimensions,
    total_verified_competencies: totalVerified,
    total_uncertain_competencies: totalUncertain,
    disclaimed_percentages: Array.from(new Set(disclaimedPercentages)).sort(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * B21-AC2: Changing/superseding evidence updates the read projection consistently.
 */
export function recalculateProjectionOnEvidenceChange(
  ownerId: string,
  allObservations: CanonicalObservation[]
): ProgressProjection {
  return computeCanonicalProgressProjection(ownerId, allObservations);
}

/**
 * B21-AC3: User can reach the next lesson without navigating a dashboard wall.
 */
export function buildQuietSessionDebrief(params: {
  ownerId: string;
  sessionId: string;
  classroomId: string;
  observations: CanonicalObservation[];
  track?: string;
  specificGaps?: Array<{ gap_key: string; description: string }>;
}): QuietSessionDebrief {
  const { ownerId, sessionId, classroomId, observations, track = "dsa", specificGaps = [] } = params;

  const whatImproved: WhatImprovedItem[] = [];
  const whatRemainsUncertain: WhatRemainsUncertainItem[] = [];
  let hasAssisted = false;

  for (const obs of observations) {
    if (obs.assistance_level === "guided" || obs.assistance_level === "tutor_supplied") {
      hasAssisted = true;
    }

    if (obs.demonstrated && obs.assistance_level === "independent") {
      whatImproved.push({
        competency_key: obs.competency_key,
        status: "verified",
        evidence_text: obs.evidence_text,
      });
    } else {
      whatRemainsUncertain.push({
        competency_key: obs.competency_key,
        status: "requires_unassisted_transfer",
        assistance_level: obs.assistance_level,
        evidence_text: obs.evidence_text,
      });
    }
  }

  for (const gap of specificGaps) {
    whatRemainsUncertain.push({
      competency_key: gap.gap_key,
      status: "specific_gap",
      evidence_text: gap.description,
    });
  }

  // Direct next action
  let nextStep: NextLessonRecommendation;
  if (whatRemainsUncertain.length > 0) {
    const firstUncertain = whatRemainsUncertain[0].competency_key;
    nextStep = {
      activity_id: `act_transfer_${firstUncertain.replace(/\./g, "_")}`,
      title: `Practice Unassisted Transfer: ${firstUncertain}`,
      track,
      reason: `Solidify ${firstUncertain} with an independent transfer activity.`,
      route: `/classrooms/${classroomId}`,
      action_label: "Start Independent Transfer",
    };
  } else {
    nextStep = {
      activity_id: "act_next_lesson",
      title: "Continue Curriculum: Next Lesson",
      track,
      reason: "All session targets verified independently; advance to the next micro-skill.",
      route: `/classrooms/${classroomId}`,
      action_label: "Start Next Lesson",
    };
  }

  return {
    session_id: sessionId,
    owner_id: ownerId,
    classroom_id: classroomId,
    what_improved: whatImproved,
    what_remains_uncertain: whatRemainsUncertain,
    next_step: nextStep,
    is_assisted: hasAssisted,
    unsupported_percentages_excluded: true,
    created_at: new Date().toISOString(),
  };
}

/**
 * Validates user-entered application record (Implement 4: no speculative hiring probability).
 */
export function validateUserApplicationRecord(record: {
  company_name: string;
  role_title: string;
  speculative_hiring_probability?: number | null;
  hiring_odds?: number | null;
}): void {
  if (
    record.speculative_hiring_probability !== undefined &&
    record.speculative_hiring_probability !== null
  ) {
    throw new Error(
      "Speculative hiring probabilities are strictly prohibited (B21-AC1)."
    );
  }
  if (record.hiring_odds !== undefined && record.hiring_odds !== null) {
    throw new Error(
      "Simulated hiring odds are strictly prohibited (B21-AC1)."
    );
  }
}
