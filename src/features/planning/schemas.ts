import { z } from "zod";

/**
 * Sprint 08: Deterministic Sprint Planning Engine — Schemas & IO Contracts
 *
 * PLANLY_BUILD_SPEC.md §11 & sprint_08_planning_engine.md:
 * Zod schemas and runtime validation contracts for buildSprint(input).
 * Pure deterministic engine inputs, budget constraints, candidate scoring,
 * contiguous slot allocations, and plan diffing outputs.
 */

export const ALGORITHM_VERSION = "1.0.0";

export const DEFAULT_LANE_TARGETS: Record<string, number> = {
  dsa: 420,
  oa: 90,
  technical: 60,
  project: 45,
  behavioural: 30,
  foundation: 90,
  project_build: 180,
  application: 60,
  recall: 75,
  review: 30,
};

export const PRIORITY_WEIGHTS = {
  BOTTLENECK: 40,
  BASELINE: 10,
  INTERVIEW_SOON: 20, // interview within 14 days
  RETEST_DUE: 10,
  MAX_OVERDUE_BONUS: 5,
} as const;

export const TIER_LIMITS = {
  minimum: 12,
  ramp_min: 36,
  ramp_max: 72,
  normal: 120,
  bonus: 144,
} as const;

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

export const GoalConfigSchema = z.object({
  id: z.string(),
  weeklyTargetMinutes: z.number().int().positive().default(1080),
  rampState: z.string().default("baseline"),
  checkpointDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  algorithmVersion: z.string().default(ALGORITHM_VERSION),
});
export type GoalConfig = z.infer<typeof GoalConfigSchema>;

export const SprintWindowSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});
export type SprintWindow = z.infer<typeof SprintWindowSchema>;

export const AvailabilitySlotSchema = z.object({
  id: z.string(),
  capacityMinutes: z.number().int().nonnegative(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export const DayCapacitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  declaredAvailableMinutes: z.number().int().nonnegative(),
  slots: z.array(AvailabilitySlotSchema),
  isRestDay: z.boolean().default(false),
  isMinimumDay: z.boolean().default(false),
});
export type DayCapacity = z.infer<typeof DayCapacitySchema>;

export const FixedCommitmentSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  minutes: z.number().int().positive(),
  description: z.string(),
  isInterview: z.boolean().default(false),
});
export type FixedCommitment = z.infer<typeof FixedCommitmentSchema>;

export const PrerequisiteEvidenceSchema = z.object({
  competencyKey: z.string(),
  demonstrated: z.boolean(),
  evidenceIds: z.array(z.string()),
});
export type PrerequisiteEvidence = z.infer<typeof PrerequisiteEvidenceSchema>;

export const EffectiveEvidenceSchema = z.object({
  competencyKey: z.string(),
  dimension: z.string(),
  rating: z.number().nullable(),
  isDisputed: z.boolean(),
  sessionId: z.string(),
  provenance: z.string(),
});
export type EffectiveEvidence = z.infer<typeof EffectiveEvidenceSchema>;

export const RecallSnapshotSchema = z.object({
  itemRef: z.string(),
  intervalIndex: z.number().int().nonnegative(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  evidenceMode: z.enum(["concept_recall", "full_code"]),
});
export type RecallSnapshot = z.infer<typeof RecallSnapshotSchema>;

export const EligibleContentItemSchema = z.object({
  promptId: z.string(),
  familyIds: z.array(z.string()),
  difficulty: z.string(),
  packId: z.string().optional(),
  stage: z.string(),
  isExposed: z.boolean(),
  isReservedForRetest: z.boolean(),
  prerequisitesMet: z.boolean(),
  status: z.enum(["validated", "draft", "retired"]),
});
export type EligibleContentItem = z.infer<typeof EligibleContentItemSchema>;

export const RealDeadlineSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  description: z.string(),
  relatedCompetencies: z.array(z.string()),
});
export type RealDeadline = z.infer<typeof RealDeadlineSchema>;

export const PreviousAssignmentSchema = z.object({
  taskId: z.string(),
  sourceKey: z.string(),
  state: z.string(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  estimateMinutes: z.number().int().positive(),
  kind: z.string(),
  competencyKey: z.string().optional(),
});
export type PreviousAssignment = z.infer<typeof PreviousAssignmentSchema>;

export const AdjacentCommitmentSchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  committedMinutes: z.number().int().nonnegative(),
});
export type AdjacentCommitment = z.infer<typeof AdjacentCommitmentSchema>;

export const PlannerInputSchema = z.object({
  goal: GoalConfigSchema,
  sprintWindow: SprintWindowSchema,
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  timezone: z.string().min(1).default("Asia/Kolkata"),
  capacityPattern: z.array(DayCapacitySchema),
  fixedCommitments: z.array(FixedCommitmentSchema).default([]),
  completedPrerequisites: z.union([
    z.instanceof(Map),
    z.record(z.string(), PrerequisiteEvidenceSchema),
    z.array(PrerequisiteEvidenceSchema),
  ]),
  effectiveEvidence: z.array(EffectiveEvidenceSchema).default([]),
  recallState: z.array(RecallSnapshotSchema).default([]),
  eligibleContent: z.array(EligibleContentItemSchema).default([]),
  realDeadlines: z.array(RealDeadlineSchema).default([]),
  previousAssignments: z.array(PreviousAssignmentSchema).default([]),
  adjacentSprintCommitments: z.array(AdjacentCommitmentSchema).default([]),
  inputRevision: z.number().int().nonnegative().default(1),
  inputHash: z.string(),
});
export type PlannerInputValidated = z.infer<typeof PlannerInputSchema>;

// ---------------------------------------------------------------------------
// Output Schemas
// ---------------------------------------------------------------------------

export const SprintOutcomeSchema = z.object({
  id: z.string(),
  description: z.string(),
  competencyKey: z.string(),
  evidenceRequired: z.string(),
  status: z.enum(["pending", "met", "partial", "untested", "deferred"]),
});
export type SprintOutcome = z.infer<typeof SprintOutcomeSchema>;

export const SlotAllocationSchema = z.object({
  slotId: z.string(),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  assignedMinutes: z.number().int().positive(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});
export type SlotAllocation = z.infer<typeof SlotAllocationSchema>;

export const TaskAssignmentSchema = z.object({
  id: z.string(),
  sourceKey: z.string(),
  kind: z.string(),
  title: z.string(),
  competencyKey: z.string().optional(),
  familyIds: z.array(z.string()),
  packId: z.string().optional(),
  estimateMinutes: z.number().int().positive(),
  splittable: z.boolean(),
  slotAllocations: z.array(SlotAllocationSchema),
  dueDate: z.string().optional(),
  reason: z.string(),
  priority: z.number(),
  isBottleneck: z.boolean(),
  isTentative: z.boolean(),
  lane: z.string(),
});
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;

export const PlanDiffSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  moved: z.array(
    z.object({
      sourceKey: z.string(),
      fromDate: z.string(),
      toDate: z.string(),
    })
  ),
  unchanged: z.array(z.string()),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export const DeferredItemSchema = z.object({
  sourceKey: z.string(),
  title: z.string(),
  reason: z.string(),
});
export type DeferredItem = z.infer<typeof DeferredItemSchema>;

export const ShortfallSchema = z.object({
  kind: z.enum(["capacity", "content", "prerequisite", "opening"]),
  description: z.string(),
  affectedCompetency: z.string().optional(),
  affectedStage: z.string().optional(),
});
export type Shortfall = z.infer<typeof ShortfallSchema>;

export const WeekBudgetSchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  declaredAvailableMinutes: z.number().int().nonnegative(),
  bufferBudget: z.number().int().nonnegative(),
  targetBudget: z.number().int().nonnegative(),
  fixedCommitmentMinutes: z.number().int().nonnegative(),
  adjacentSprintMinutes: z.number().int().nonnegative(),
  discretionaryMinutes: z.number().int().nonnegative(),
  allocatedMinutes: z.number().int().nonnegative(),
  laneBudgets: z.record(z.string(), z.number().int().nonnegative()),
});
export type WeekBudget = z.infer<typeof WeekBudgetSchema>;

export const DayAllocationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  declaredMinutes: z.number().int().nonnegative(),
  dailyBudget: z.number().int().nonnegative(),
  allocatedMinutes: z.number().int().nonnegative(),
  isRestDay: z.boolean(),
  isMinimumDay: z.boolean(),
  assignments: z.array(z.string()),
});
export type DayAllocation = z.infer<typeof DayAllocationSchema>;

export const PlannerOutputSchema = z.object({
  outcomes: z.array(SprintOutcomeSchema),
  assignments: z.array(TaskAssignmentSchema),
  diff: PlanDiffSchema,
  deferredItems: z.array(DeferredItemSchema),
  shortfalls: z.array(ShortfallSchema),
  weekBudgets: z.array(WeekBudgetSchema),
  dayAllocations: z.array(DayAllocationSchema),
  inputHash: z.string(),
  algorithmVersion: z.string().default(ALGORITHM_VERSION),
});
export type PlannerOutputValidated = z.infer<typeof PlannerOutputSchema>;
