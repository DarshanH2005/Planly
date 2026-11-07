/**
 * Planly Deterministic Adaptive Planner — Type Definitions
 *
 * Conforms to PLANLY_BUILD_SPEC.md §11.
 * `buildSprint(input)` is a pure function. No clock, randomness, HTTP, or LLM calls.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PlannerInput {
  /** Goal metadata */
  goal: {
    id: string;
    weeklyTargetMinutes: number;       // e.g. 1080
    rampState: string;
    checkpointDate: string;            // ISO date
    algorithmVersion: string;
  };

  /** Sprint window */
  sprintWindow: {
    startDate: string;                 // ISO date
    endDate: string;                   // ISO date
  };

  /** Current local date and timezone (injected, not read from clock) */
  today: string;                       // ISO date
  timezone: string;                    // IANA timezone

  /** Seven-day capacity pattern with date overrides */
  capacityPattern: DayCapacity[];

  /** Fixed commitments that cannot be moved (e.g. real interviews) */
  fixedCommitments: FixedCommitment[];

  /** Completed prerequisite evidence keyed by competency */
  completedPrerequisites: Map<string, PrerequisiteEvidence>;

  /** Effective review/repair snapshot */
  effectiveEvidence: EffectiveEvidence[];

  /** Recall state */
  recallState: RecallSnapshot[];

  /** Eligible content inventory */
  eligibleContent: EligibleContentItem[];

  /** Upcoming real deadlines (interviews, applications) */
  realDeadlines: RealDeadline[];

  /** Previous assignments from this sprint */
  previousAssignments: PreviousAssignment[];

  /** Committed minutes from adjacent sprints in overlapping weeks */
  adjacentSprintCommitments: AdjacentCommitment[];

  /** Planning input revision (for stale detection) */
  inputRevision: number;
  inputHash: string;
}

export interface DayCapacity {
  date: string;                        // ISO date
  declaredAvailableMinutes: number;
  slots: AvailabilitySlot[];
  isRestDay: boolean;
  isMinimumDay: boolean;               // 12-minute minimum
}

export interface AvailabilitySlot {
  id: string;
  capacityMinutes: number;
  startTime?: string;                  // HH:mm, optional
  endTime?: string;                    // HH:mm, optional
}

export interface FixedCommitment {
  id: string;
  date: string;
  minutes: number;
  description: string;
  isInterview: boolean;
}

export interface PrerequisiteEvidence {
  competencyKey: string;
  demonstrated: boolean;
  evidenceIds: string[];
}

export interface EffectiveEvidence {
  competencyKey: string;
  dimension: string;
  rating: number | null;
  isDisputed: boolean;
  sessionId: string;
  provenance: string;
}

export interface RecallSnapshot {
  itemRef: string;
  intervalIndex: number;
  dueDate: string;
  evidenceMode: "concept_recall" | "full_code";
}

export interface EligibleContentItem {
  promptId: string;
  familyIds: string[];
  difficulty: string;
  packId?: string;
  stage: string;
  isExposed: boolean;
  isReservedForRetest: boolean;
  prerequisitesMet: boolean;
  status: "validated" | "draft" | "retired";
}

export interface RealDeadline {
  id: string;
  date: string;
  description: string;
  relatedCompetencies: string[];
}

export interface PreviousAssignment {
  taskId: string;
  sourceKey: string;
  state: string;
  scheduledDate: string;
  estimateMinutes: number;
  kind: string;
  competencyKey?: string;
}

export interface AdjacentCommitment {
  weekStartDate: string;              // Monday ISO date
  committedMinutes: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface PlannerOutput {
  /** Selected sprint outcomes */
  outcomes: SprintOutcome[];

  /** Ordered task assignments */
  assignments: TaskAssignment[];

  /** Change diff from previous revision */
  diff: PlanDiff;

  /** Items that could not be scheduled */
  deferredItems: DeferredItem[];

  /** Explicit shortfalls */
  shortfalls: Shortfall[];

  /** Per-week budget breakdown */
  weekBudgets: WeekBudget[];

  /** Per-day allocation summary */
  dayAllocations: DayAllocation[];

  /** Input hash for stale detection */
  inputHash: string;

  /** Algorithm version */
  algorithmVersion: string;
}

export interface SprintOutcome {
  id: string;
  description: string;
  competencyKey: string;
  evidenceRequired: string;
  status: "pending" | "met" | "partial" | "untested" | "deferred";
}

export interface TaskAssignment {
  id: string;
  sourceKey: string;
  kind: string;
  title: string;
  competencyKey?: string;
  familyIds: string[];
  packId?: string;
  estimateMinutes: number;
  splittable: boolean;
  slotAllocations: SlotAllocation[];
  dueDate?: string;
  reason: string;                      // Why this task was chosen
  priority: number;
  isBottleneck: boolean;
  isTentative: boolean;                // Prerequisites not yet met
  lane: string;
}

export interface SlotAllocation {
  slotId: string;
  localDate: string;
  assignedMinutes: number;
  startTime?: string;
  endTime?: string;
}

export interface PlanDiff {
  added: string[];                     // task source keys
  removed: string[];
  moved: Array<{ sourceKey: string; fromDate: string; toDate: string }>;
  unchanged: string[];
}

export interface DeferredItem {
  sourceKey: string;
  title: string;
  reason: string;
}

export interface Shortfall {
  kind: "capacity" | "content" | "prerequisite" | "opening";
  description: string;
  affectedCompetency?: string;
  affectedStage?: string;
}

export interface WeekBudget {
  weekStartDate: string;              // Monday
  declaredAvailableMinutes: number;
  bufferBudget: number;               // floor(0.8 × declared)
  targetBudget: number;               // min(weeklyTarget, bufferBudget)
  fixedCommitmentMinutes: number;
  adjacentSprintMinutes: number;
  discretionaryMinutes: number;
  allocatedMinutes: number;
  laneBudgets: Record<string, number>;
}

export interface DayAllocation {
  date: string;
  declaredMinutes: number;
  dailyBudget: number;                // floor(0.8 × declared)
  allocatedMinutes: number;
  isRestDay: boolean;
  isMinimumDay: boolean;
  assignments: string[];              // task source keys
}
