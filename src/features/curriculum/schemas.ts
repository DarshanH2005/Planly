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

export const FollowupBranchSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  question: z.string(),
  criterion: z.string(),
});

export const RepairLinkSchema = z.object({
  competency: z.string(),
  drillId: z.string(),
  retestIds: z.array(z.string()),
});

export const PrivateReferenceSchema = z.object({
  approach: z.string(),
  checks: z.array(z.string()),
  expectedComplexity: z.string().optional(),
});

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

export const CatalogueEntrySchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9]*-\d{2}$/),
    title: z.string().min(1),
    tier: TierSchema,
    pattern: z.string().optional(),
    sourceGroupNumber: z.number().int().min(1).max(40),
    sourceGroupName: z.string().min(1),
    patternNote: z.string(),
    familyIds: z.array(z.string()),
  })
  .passthrough();
export type CatalogueEntry = z.infer<typeof CatalogueEntrySchema>;

export const PatternCardSchema = z.object({
  id: z.string().regex(/^F\d{2}$/),
  title: z.string().min(1),
  conceptCue: z.string().min(1),
  representatives: z.array(z.string()),
  pitfalls: z.string().min(1),
  cost: z.string().min(1),
  say: z.string().min(1),
  review: z.string().min(1),
});
export type PatternCard = z.infer<typeof PatternCardSchema>;

export const PatternFamilySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    conceptCue: z.string(),
    pitfalls: z.string(),
    representatives: z.array(z.string()).optional(),
    cost: z.string().optional(),
    say: z.string().optional(),
    review: z.string().optional(),
  })
  .passthrough();
export type PatternFamily = z.infer<typeof PatternFamilySchema>;
