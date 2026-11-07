/**
 * Planning Service — Preview and Commit Sprint Plans
 *
 * PLANLY_BUILD_SPEC.md §11.3: Preview and commit.
 * Creates previews on demand, persists revisions, and guards against stale commits.
 */

import { buildSprint } from "./rules";
import type {
  PlannerInput,
  PlannerOutput,
  DayCapacity,
  EligibleContentItem,
  PreviousAssignment,
  EffectiveEvidence,
} from "./types";
import { getLocalRepairs } from "@/lib/storage/local-store";
import type { RepairRecord } from "@/features/reviews/types";

// ---------------------------------------------------------------------------
// Preview: pure computation, no database mutation
// ---------------------------------------------------------------------------

/**
 * Generate a plan preview. This is NOT a database mutation.
 * The caller displays the result and lets the owner accept or reject.
 */
export function previewSprint(input: PlannerInput): PlannerOutput {
  return buildSprint(input);
}

// ---------------------------------------------------------------------------
// Commit guard: stale detection
// ---------------------------------------------------------------------------

export interface CommitInput {
  ownerId: string;
  sprintId: string;
  preview: PlannerOutput;
  expectedInputHash: string;
  expectedInputRevision: number;
  currentInputHash: string;
  currentInputRevision: number;
}

export interface CommitResult {
  accepted: boolean;
  stale: boolean;
  preview: PlannerOutput;
  message: string;
}

/**
 * Validate a commit before persisting.
 * §11.3: If input revision/hash doesn't match, return STALE_PLAN.
 * §11.4 Fixture "Changed input": Capacity updated after preview → reject stale commit.
 * §11.4 Fixture "Repeated commit": Same request/hash → same stored result.
 */
export function validateCommit(input: CommitInput): CommitResult {
  if (input.expectedInputHash !== input.currentInputHash) {
    return {
      accepted: false,
      stale: true,
      preview: input.preview,
      message: "Input has changed since preview was generated. Recompute the plan.",
    };
  }

  if (input.expectedInputRevision !== input.currentInputRevision) {
    return {
      accepted: false,
      stale: true,
      preview: input.preview,
      message: "Planning revision has changed. Recompute the plan.",
    };
  }

  return {
    accepted: true,
    stale: false,
    preview: input.preview,
    message: "Plan accepted for commit.",
  };
}

/**
 * Compute a canonical hash for planner input.
 * Used for idempotency and stale detection.
 */
export function computeInputHash(input: PlannerInput): string {
  // Deterministic JSON serialization with sorted keys
  const canonical = JSON.stringify(input, (key, value) => {
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].sort());
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
    }
    return value;
  });

  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `plan-${Math.abs(hash).toString(36)}`;
}

export interface SprintOverview {
  sprintId: string;
  title: string;
  goal: string;
  targetRole: string;
  checkpointDate: string;
  window: {
    startDate: string;
    endDate: string;
  };
  bottleneck: string;
  supportingLane: string;
  plan: PlannerOutput;
}

/**
 * Build or load the active 14-day sprint overview (§6.3, R03).
 */
export function getActiveSprintOverview(ownerId: string): SprintOverview {
  const today = new Date();
  const daysUntilMonday = (8 - today.getUTCDay()) % 7;
  const sprintStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysUntilMonday));
  const sprintEnd = new Date(sprintStart);
  sprintEnd.setUTCDate(sprintStart.getUTCDate() + 13);
  const startDate = sprintStart.toISOString().slice(0, 10);
  const endDate = sprintEnd.toISOString().slice(0, 10);

  // Generate 14 days of capacity (75m weekdays, 120m weekends)
  const capacityPattern: DayCapacity[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const minutes = isWeekend ? 120 : 75;

    capacityPattern.push({
      date: dateStr,
      declaredAvailableMinutes: minutes,
      slots: [{ id: `slot-${dateStr}`, capacityMinutes: minutes }],
      isRestDay: false,
      isMinimumDay: false,
    });
  }

  // Prepared content available in starter bundles
  const eligibleContent: EligibleContentItem[] = [
    {
      promptId: "FX-HASH-A",
      familyIds: ["F01"],
      difficulty: "easy",
      packId: "PACK-FOUNDATION-01",
      stage: "foundation",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-SEARCH-A",
      familyIds: ["F03"],
      difficulty: "medium",
      packId: "PACK-OA-01",
      stage: "oa",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-TREE-LCA",
      familyIds: ["F12"],
      difficulty: "medium",
      packId: "PACK-TECHNICAL-B-01",
      stage: "technical_b",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-ENG-RATELIMIT",
      familyIds: ["F10"],
      difficulty: "medium",
      packId: "PACK-ENGINEERING-01",
      stage: "engineering",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-PROJ-PLANLY",
      familyIds: ["F01"],
      difficulty: "medium",
      packId: "PACK-PROJECT-01",
      stage: "project",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-BEHAV-DISAGREE",
      familyIds: [],
      difficulty: "easy",
      packId: "PACK-BEHAVIOURAL-01",
      stage: "behavioural",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
    {
      promptId: "FX-SQL-ORDERS",
      familyIds: [],
      difficulty: "easy",
      packId: "PACK-SQL-01",
      stage: "foundation",
      isExposed: false,
      isReservedForRetest: false,
      prerequisitesMet: true,
      status: "validated",
    },
  ];

  // Empty accounts have no prior assignments. Historical rows are supplied by
  // the durable planning repository when available.
  const previousAssignments: PreviousAssignment[] = [];

  // Build effective evidence from real repairs (§10.2 → §11.1)
  // Improved repairs contribute successful transfer evidence;
  // open repairs contribute negative evidence that drives the planner
  // to schedule drills, retests, or prerequisite work.
  const ownerRepairs = getLocalRepairs(ownerId);
  const repairEvidence: EffectiveEvidence[] = ownerRepairs.map((r: RepairRecord) => ({
    competencyKey: r.competencyKey,
    dimension: r.competencyKey,
    rating: r.state === "improved" ? 2 : (r.state === "still_open" ? 0 : 1),
    isDisputed: false,
    sessionId: r.retestSessionId ?? r.drillTaskId ?? r.id,
    provenance: r.state === "improved" ? "retest_evidence" : "repair_trigger",
  }));
  const effectiveEvidence: EffectiveEvidence[] = repairEvidence;

  const plannerInput: PlannerInput = {
    goal: {
      id: "goal-sde-cred",
      weeklyTargetMinutes: 1080,
      rampState: "active_training",
      checkpointDate: "2026-11-30",
      algorithmVersion: "1.0.0",
    },
    sprintWindow: {
      startDate,
      endDate,
    },
    today: new Date().toISOString().slice(0, 10),
    timezone: "Asia/Kolkata",
    capacityPattern,
    fixedCommitments: [],
    completedPrerequisites: new Map(),
    effectiveEvidence,
    recallState: [
      {
        itemRef: "FX-HASH-A",
        intervalIndex: 0,
        dueDate: "2026-09-15",
        evidenceMode: "concept_recall",
      },
    ],
    eligibleContent,
    realDeadlines: [
      {
        id: "deadline-cred",
        date: "2026-10-05",
        description: "CRED SDE-1 Application Deadline",
        relatedCompetencies: ["implementation", "adaptation"],
      },
    ],
    previousAssignments,
    adjacentSprintCommitments: [],
    inputRevision: 1,
    inputHash: "sprint-hash-v1",
  };

  const plan = previewSprint(plannerInput);

  return {
    sprintId: "sprint-14d-001",
    title: "Sprint 1: Technical Foundations & OA Simulation Baseline",
    goal: "Establish unassisted Python benchmark, boundary debugging transfer, and live technical defense.",
    targetRole: "SDE-1 (Backend / Platform) — CRED / BigTech",
    checkpointDate: "2026-11-30",
    window: {
      startDate,
      endDate,
    },
    bottleneck: "Boundary Condition Identification & Invariant Proof",
    supportingLane: "SQL Core Aggregation & CS Concurrency Defense",
    plan,
  };
}
