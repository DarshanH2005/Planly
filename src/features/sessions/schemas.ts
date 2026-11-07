import { z } from "zod";

export const StageSchema = z.enum([
  "foundation",
  "oa",
  "technical_a",
  "technical_b",
  "engineering",
  "project",
  "behavioural",
]);
export type Stage = z.infer<typeof StageSchema>;

export const ModeSchema = z.enum(["learn", "practice", "strict"]);
export type Mode = z.infer<typeof ModeSchema>;

export const EvaluatorModeSchema = z.enum(["scripted_solo", "peer_led"]);
export type EvaluatorMode = z.infer<typeof EvaluatorModeSchema>;

export const ContentStatusSchema = z.enum(["draft", "validated", "retired"]);
export type ContentStatus = z.infer<typeof ContentStatusSchema>;

export const TierSchema = z.enum(["A", "B", "C"]);
export type Tier = z.infer<typeof TierSchema>;

export const SourceRecordSchema = z.object({
  kind: z.enum(["original", "official", "candidate_report", "custom"]),
  url: z.string().optional(),
  checkedAt: z.string().optional(),
  eventDate: z.string().optional(),
  note: z.string(),
  confidence: z.enum(["confirmed", "illustrative", "unknown"]),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const ResourcePolicySchema = z.object({
  docs: z.boolean(),
  ai: z.boolean(),
  hints: z.boolean(),
  notes: z.boolean(),
});
export type ResourcePolicy = z.infer<typeof ResourcePolicySchema>;

export const ExampleSchema = z.object({
  input: z.string(),
  expected: z.string(),
  explanation: z.string().optional(),
});
export type Example = z.infer<typeof ExampleSchema>;

export const ClarificationBranchSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
});
export type ClarificationBranch = z.infer<typeof ClarificationBranchSchema>;

export const FollowupBranchSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  question: z.string(),
  criterion: z.string(),
});
export type FollowupBranch = z.infer<typeof FollowupBranchSchema>;

export const RepairLinkSchema = z.object({
  competency: z.string(),
  drillId: z.string(),
  retestIds: z.array(z.string()),
});
export type RepairLink = z.infer<typeof RepairLinkSchema>;

export const PrivateReferenceSchema = z.object({
  approach: z.string(),
  checks: z.array(z.string()),
  expectedComplexity: z.string().optional(),
});
export type PrivateReference = z.infer<typeof PrivateReferenceSchema>;

export const TrainingPromptSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  status: ContentStatusSchema,
  familyIds: z.array(z.string()),
  difficulty: z.enum(["foundation", "easy", "medium", "advanced"]),
  statement: z.string(),
  constraints: z.array(z.string()),
  examples: z.array(ExampleSchema),
  clarificationBranches: z.array(ClarificationBranchSchema),
  followups: z.array(FollowupBranchSchema),
  privateReference: PrivateReferenceSchema,
  repairLinks: z.array(RepairLinkSchema),
  reservedForRetest: z.boolean(),
  source: SourceRecordSchema,
});
export type TrainingPrompt = z.infer<typeof TrainingPromptSchema>;

export const SessionPackSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  stage: StageSchema,
  status: ContentStatusSchema,
  title: z.string(),
  instructions: z.string(),
  durationMinutes: z.number().int().positive(),
  debriefMinutes: z.number().int().nonnegative(),
  inputFormat: z.enum(["function", "stdin_stdout", "repository", "spoken_or_text"]),
  resourcePolicy: ResourcePolicySchema,
  promptIds: z.array(z.string()),
  rubricId: z.string(),
  rubricVersion: z.number().int().positive(),
  prerequisites: z.array(z.string()),
  source: SourceRecordSchema,
});
export type SessionPack = z.infer<typeof SessionPackSchema>;
