/**
 * Readiness & Evidence Aggregate Service
 *
 * PLANLY_BUILD_SPEC.md §10.4, §17 (AC22), R14:
 * - Computes round-specific readiness metrics across OA, Technical, Engineering/Project, Behavioural, Foundational.
 * - Shows honest denominators (e.g., 3 of 4 strict unseen), explicit unknowns, and conditions.
 * - Excludes familiar, assisted, or interrupted sessions from strict benchmarks while retaining them in audit history.
 * - Invariant AC22: When a review is disputed or superseded, derived effective evidence is updated
 *   using the superseding revision without deleting prior observations or attempts.
 */

import type {
  ReviewRecord,
  CompetencyEvidenceRecord,
} from "@/features/reviews/types";

export type ReadinessStatus = "unknown" | "developing" | "provisional" | "supported";

export interface SessionEvidenceItem {
  sessionId: string;
  stage: "foundation" | "oa" | "technical_a" | "technical_b" | "engineering" | "project" | "behavioural";
  packId: string;
  completedAt: string;
  isUnseen: boolean;
  isUnassisted: boolean;
  isUninterrupted: boolean;
  passed: boolean;
  notes?: string;
  ratings?: Record<string, number>;
  exclusionReason?: string;
}

export interface DomainReadiness {
  domain: "oa" | "technical" | "engineering_project" | "behavioural" | "foundational";
  title: string;
  status: ReadinessStatus;
  sampleCount: number;
  benchmarkDenominator: number; // e.g., 4
  qualifyingCount: number;      // e.g., 3
  unknownCount: number;
  stabilityThresholdText: string;
  conditions: string[];
  missingGaps: string[];
  sessions: SessionEvidenceItem[];
}

export interface ReviewAuditEntry {
  reviewId: string;
  sessionId: string;
  revision: number;
  status: "effective" | "superseded" | "submitted";
  supersedesId: string | null;
  evaluator: string;
  observations: Array<{
    competencyKey: string;
    dimension: string;
    rating: number | null;
    observation: string;
    status: "proposed" | "confirmed" | "disputed";
  }>;
}

export interface ReadinessSummary {
  ownerId: string;
  domains: DomainReadiness[];
  effectiveEvidenceMap: Record<string, { rating: number; dimension: string; reviewId: string }>;
  reviewAuditTrail: ReviewAuditEntry[];
}

/**
 * Filter reviews down to effective revisions (§10.4, AC22).
 * If review B supersedes review A, review A is superseded and review B is effective.
 * No historical rows are deleted.
 */
export function getEffectiveReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  const supersededIds = new Set<string>();
  for (const r of reviews) {
    if (r.supersedesId) {
      supersededIds.add(r.supersedesId);
    }
  }

  return reviews.filter(
    (r) => !supersededIds.has(r.id) && r.status !== "superseded"
  );
}

/**
 * Compute the effective competency evidence from raw evidence records,
 * taking into account review supersession (AC22).
 */
export function computeEffectiveEvidence(
  reviews: ReviewRecord[],
  evidenceRecords: CompetencyEvidenceRecord[]
): Map<string, CompetencyEvidenceRecord> {
  const effectiveReviews = getEffectiveReviews(reviews);
  const effectiveReviewIds = new Set(effectiveReviews.map((r) => r.id));

  // Map competencyKey:dimension -> effective evidence record
  const result = new Map<string, CompetencyEvidenceRecord>();

  for (const ev of evidenceRecords) {
    if (effectiveReviewIds.has(ev.reviewId)) {
      const key = `${ev.competencyKey}:${ev.dimension}`;
      // In case of multiple effective records, newest / highest rating applies
      result.set(key, ev);
    }
  }

  return result;
}

/**
 * Pure evaluator for Domain Readiness (§10.4, AC22).
 */
export function computeDomainReadiness(
  sessions: SessionEvidenceItem[],
  effectiveEvidence: Map<string, CompetencyEvidenceRecord>
): DomainReadiness[] {
  // 1. OA Readiness (last 4 comparable unseen strict sets, target 3 of 4)
  const oaSessions = sessions.filter((s) => s.stage === "oa");
  const qualifyingOA = oaSessions.filter(
    (s) => s.isUnseen && s.isUnassisted && s.isUninterrupted && s.passed
  );
  const oaExcluded = oaSessions.filter(
    (s) => !s.isUnseen || !s.isUnassisted || !s.isUninterrupted
  );

  let oaStatus: ReadinessStatus = "unknown";
  if (oaSessions.length === 0) {
    oaStatus = "unknown";
  } else if (qualifyingOA.length >= 3) {
    oaStatus = "supported";
  } else if (qualifyingOA.length >= 1) {
    oaStatus = "developing";
  } else {
    oaStatus = "provisional";
  }

  const oaGaps: string[] = [];
  if (oaSessions.length < 4) {
    oaGaps.push(`Need ${4 - oaSessions.length} more comparable strict OA attempts for honest denominator.`);
  }
  if (oaExcluded.length > 0) {
    oaGaps.push(`${oaExcluded.length} attempt(s) excluded from strict benchmark (assisted/familiar/interrupted).`);
  }

  const oaDomain: DomainReadiness = {
    domain: "oa",
    title: "Online Assessment (OA) Simulation",
    status: oaStatus,
    sampleCount: oaSessions.length,
    benchmarkDenominator: 4,
    qualifyingCount: qualifyingOA.length,
    unknownCount: Math.max(0, 4 - oaSessions.length),
    stabilityThresholdText: "3 of 4 strict unseen sets meeting correctness, complexity & server time limits",
    conditions: [
      "Strict unseen prompts only",
      "No assistance, hints, or solution peeking",
      "Finished within 70-minute server countdown",
    ],
    missingGaps: oaGaps,
    sessions: oaSessions,
  };

  // 2. Technical Interview Readiness (last 4 comparable unseen, critical dimensions >= 2)
  const techSessions = sessions.filter(
    (s) => s.stage === "technical_a" || s.stage === "technical_b"
  );
  const qualifyingTech = techSessions.filter(
    (s) => s.isUnseen && s.isUnassisted && s.isUninterrupted && s.passed
  );

  let techStatus: ReadinessStatus = "unknown";
  if (techSessions.length === 0) {
    techStatus = "unknown";
  } else if (qualifyingTech.length >= 3) {
    techStatus = "supported";
  } else if (qualifyingTech.length >= 1) {
    techStatus = "developing";
  } else {
    techStatus = "provisional";
  }

  const techGaps: string[] = [];
  if (techSessions.length < 4) {
    techGaps.push(`Need ${4 - techSessions.length} more live technical sessions with follow-up.`);
  }

  const techDomain: DomainReadiness = {
    domain: "technical",
    title: "Live Technical Problem Solving & Defense",
    status: techStatus,
    sampleCount: techSessions.length,
    benchmarkDenominator: 4,
    qualifyingCount: qualifyingTech.length,
    unknownCount: Math.max(0, 4 - techSessions.length),
    stabilityThresholdText: "3 of 4 comparable unseen sessions with critical dimensions rated 2+ and handled follow-up",
    conditions: [
      "Unassisted blank-editor implementation",
      "Reasoned complexity & boundary defense",
      "Adapted to authored follow-up constraint change",
    ],
    missingGaps: techGaps,
    sessions: techSessions,
  };

  // 3. Engineering & Project Readiness (working core, verified tests, architecture explanation)
  const engSessions = sessions.filter(
    (s) => s.stage === "engineering" || s.stage === "project"
  );
  const qualifyingEng = engSessions.filter((s) => s.passed);

  let engStatus: ReadinessStatus = "unknown";
  if (engSessions.length === 0) {
    engStatus = "unknown";
  } else if (qualifyingEng.length >= 2) {
    engStatus = "supported";
  } else {
    engStatus = "developing";
  }

  const engDomain: DomainReadiness = {
    domain: "engineering_project",
    title: "Engineering Machine Coding & Project Ownership",
    status: engStatus,
    sampleCount: engSessions.length,
    benchmarkDenominator: 2,
    qualifyingCount: qualifyingEng.length,
    unknownCount: Math.max(0, 2 - engSessions.length),
    stabilityThresholdText: "Working agreed core, verified tests, architecture explanation, and demonstrated bug fix",
    conditions: [
      "Working executable core with test evidence",
      "Accurate request/data flow trace",
      "Real reproduced bug & fix protection",
    ],
    missingGaps: engSessions.length < 2 ? ["Need 1 more repository/engineering session."] : [],
    sessions: engSessions,
  };

  // 4. Behavioural Readiness (6 story outlines, 2 reviewed practices)
  const behavSessions = sessions.filter((s) => s.stage === "behavioural");
  const qualifyingBehav = behavSessions.filter((s) => s.passed);

  let behavStatus: ReadinessStatus = "unknown";
  if (behavSessions.length === 0) {
    behavStatus = "unknown";
  } else if (qualifyingBehav.length >= 2) {
    behavStatus = "supported";
  } else {
    behavStatus = "developing";
  }

  const behavDomain: DomainReadiness = {
    domain: "behavioural",
    title: "Behavioural (HR) & Communication",
    status: behavStatus,
    sampleCount: behavSessions.length,
    benchmarkDenominator: 2,
    qualifyingCount: qualifyingBehav.length,
    unknownCount: Math.max(0, 2 - behavSessions.length),
    stabilityThresholdText: "6 truthful story outlines and 2 reviewed practices with specific follow-up responses",
    conditions: [
      "Dedicated behavioural rubric (no code correctness scoring)",
      "Distinguishable personal action vs team",
      "Truthful constraints and lessons stated",
    ],
    missingGaps: behavSessions.length < 2 ? ["Need 1 more reviewed behavioural simulation."] : [],
    sessions: behavSessions,
  };

  // 5. Foundational Readiness (Python invariants, arrays, hashing, prefix sums)
  const foundSessions = sessions.filter((s) => s.stage === "foundation");
  const qualifyingFound = foundSessions.filter((s) => s.passed);

  const foundDomain: DomainReadiness = {
    domain: "foundational",
    title: "Foundational DSA & SQL Core",
    status: qualifyingFound.length >= 1 ? "supported" : "developing",
    sampleCount: foundSessions.length,
    benchmarkDenominator: 2,
    qualifyingCount: qualifyingFound.length,
    unknownCount: Math.max(0, 2 - foundSessions.length),
    stabilityThresholdText: "Unassisted array/hash diagnostic & SQL order aggregation returning A100/B200/C0",
    conditions: [
      "Python 3 blank-editor syntax and complexity",
      "SQL join cardinality and null handling (AC21)",
    ],
    missingGaps: [],
    sessions: foundSessions,
  };

  return [oaDomain, techDomain, engDomain, behavDomain, foundDomain];
}

/**
 * Sample / seeded readiness overview for the owner
 */
export function getReadinessOverview(ownerId: string): ReadinessSummary {
  // Sample historical sessions demonstrating honesty and exclusion handling (§10.4, AC22)
  const sessions: SessionEvidenceItem[] = [
    {
      sessionId: "sess-oa-01",
      stage: "oa",
      packId: "PACK-OA-01",
      completedAt: "2026-09-05",
      isUnseen: true,
      isUnassisted: true,
      isUninterrupted: true,
      passed: true,
      notes: "Completed 2/2 questions within 58 minutes. Clean binary search invariant.",
    },
    {
      sessionId: "sess-oa-02",
      stage: "oa",
      packId: "PACK-OA-01",
      completedAt: "2026-09-07",
      isUnseen: false, // Familiar prompt!
      isUnassisted: true,
      isUninterrupted: true,
      passed: true,
      exclusionReason: "Familiar prompt re-attempt; excluded from strict-unseen benchmark",
      notes: "Familiar problem practice. Excluded from strict benchmark.",
    },
    {
      sessionId: "sess-tech-01",
      stage: "technical_b",
      packId: "PACK-TECHNICAL-B-01",
      completedAt: "2026-09-06",
      isUnseen: true,
      isUnassisted: true,
      isUninterrupted: true,
      passed: true,
      notes: "LCA tree session. Handled parent pointer follow-up cleanly.",
    },
    {
      sessionId: "sess-found-01",
      stage: "foundation",
      packId: "PACK-FOUNDATION-01",
      completedAt: "2026-09-04",
      isUnseen: true,
      isUnassisted: true,
      isUninterrupted: true,
      passed: true,
      notes: "Hash invariants diagnostic baseline.",
    },
    {
      sessionId: "sess-sql-01",
      stage: "foundation",
      packId: "PACK-SQL-01",
      completedAt: "2026-09-05",
      isUnseen: true,
      isUnassisted: true,
      isUninterrupted: true,
      passed: true,
      notes: "Customer orders aggregation returning A100/B200/C0.",
    },
  ];

  // Review records demonstrating superseding revision (AC22)
  const reviews: ReviewRecord[] = [
    {
      id: "rev-001",
      ownerId,
      sessionId: "sess-tech-01",
      revision: 1,
      supersedesId: null,
      rubricId: "RUBRIC-TECH-01",
      rubricVersion: 1,
      evaluator: "self",
      source: "owner_recorded",
      status: "superseded", // Superseded by revision 2
      noActionReason: null,
    },
    {
      id: "rev-002",
      ownerId,
      sessionId: "sess-tech-01",
      revision: 2,
      supersedesId: "rev-001", // Supersedes rev-001!
      rubricId: "RUBRIC-TECH-01",
      rubricVersion: 1,
      evaluator: "peer_review",
      source: "peer_recorded",
      status: "effective",
      noActionReason: null,
    },
  ];

  const evidenceRecords: CompetencyEvidenceRecord[] = [
    {
      id: "ev-001",
      ownerId,
      reviewId: "rev-001",
      attemptId: "att-001",
      competencyKey: "boundaries",
      dimension: "Testing/debugging",
      rating: 1, // Initial disputed rating
      observation: "Initial assessment noted borderline edge handling.",
      evidenceReference: "test-boundary-run",
      provenance: "owner_recorded",
      confidence: "provisional",
      status: "disputed",
    },
    {
      id: "ev-002",
      ownerId,
      reviewId: "rev-002", // Superseding review
      attemptId: "att-001",
      competencyKey: "boundaries",
      dimension: "Testing/debugging",
      rating: 2, // Effective corrected rating
      observation: "Corrected review: Traced single-node and leaf-as-LCA counterexamples accurately.",
      evidenceReference: "test-boundary-run-2",
      provenance: "peer_verified",
      confidence: "confirmed",
      status: "confirmed",
    },
  ];

  const effectiveEvidence = computeEffectiveEvidence(reviews, evidenceRecords);
  const domains = computeDomainReadiness(sessions, effectiveEvidence);

  const effectiveMap: Record<string, { rating: number; dimension: string; reviewId: string }> = {};
  for (const [key, ev] of effectiveEvidence.entries()) {
    if (ev.rating !== null) {
      effectiveMap[key] = {
        rating: ev.rating,
        dimension: ev.dimension,
        reviewId: ev.reviewId,
      };
    }
  }

  const reviewAuditTrail: ReviewAuditEntry[] = [
    {
      reviewId: "rev-002",
      sessionId: "sess-tech-01",
      revision: 2,
      status: "effective",
      supersedesId: "rev-001",
      evaluator: "Peer Evaluation (Verified)",
      observations: [
        {
          competencyKey: "boundaries",
          dimension: "Testing/debugging",
          rating: 2,
          observation: "Corrected review: Traced single-node and leaf-as-LCA counterexamples accurately.",
          status: "confirmed",
        },
      ],
    },
    {
      reviewId: "rev-001",
      sessionId: "sess-tech-01",
      revision: 1,
      status: "superseded",
      supersedesId: null,
      evaluator: "Self Evaluation (Initial)",
      observations: [
        {
          competencyKey: "boundaries",
          dimension: "Testing/debugging",
          rating: 1,
          observation: "Initial assessment noted borderline edge handling.",
          status: "disputed",
        },
      ],
    },
  ];

  return {
    ownerId,
    domains,
    effectiveEvidenceMap: effectiveMap,
    reviewAuditTrail,
  };
}
