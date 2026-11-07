"use server";

/**
 * Review Server Actions
 *
 * PLANLY_BUILD_SPEC.md §9.2, §10: Submit review with evidence,
 * learning card, and repair proposal.
 */

import { z } from "zod";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import { validateSubmitReview } from "@/features/reviews/rules";
import type { ReviewRecord } from "@/features/reviews/types";
import { saveLocalReview, saveLocalRepair } from "@/lib/storage/local-store";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SubmitReviewSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  rubricId: z.string(),
  rubricVersion: z.number().int().positive(),
  evidence: z.array(z.object({
    attemptId: z.string().min(1).nullable(),
    competencyKey: z.string(),
    dimension: z.string(),
    rating: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.null()]),
    observation: z.string(),
    evidenceReference: z.string().optional(),
  })),
  learningCard: z.object({
    attemptId: z.string().min(1),
    initialIdea: z.string(),
    failure: z.string(),
    correctedInsight: z.string(),
    complexityNote: z.string().optional(),
    edgeCases: z.string().optional(),
    lesson: z.string().min(1, "Lesson is required"),
    similarIds: z.array(z.string()).optional(),
  }),
  repairProposal: z.object({
    competencyKey: z.enum([
      "pattern_selection", "implementation", "boundaries",
      "explanation", "adaptation", "project_depth", "behavioural_specificity",
    ]),
    hypothesis: z.string(),
    closureCriterion: z.string(),
  }).optional(),
  noActionReason: z.string().optional(),
  supersedesReviewId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// submitReview action
// ---------------------------------------------------------------------------

export async function submitReview(
  input: z.infer<typeof SubmitReviewSchema>
): Promise<Result<{ reviewId: string; learningCardId: string; repairId: string | null }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = SubmitReviewSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid review input", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join("."), i.message])
      ),
    });
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  // Idempotency check
  if (isSupabaseConfigured()) {
    try {
      const { data: receipt } = await supabase
        .from("mutation_receipts")
        .select("result_ids, result_summary")
        .eq("owner_id", auth.data.ownerId)
        .eq("operation", "submitReview")
        .eq("request_id", parsed.data.requestId)
        .single();

      if (receipt) {
        const summary = receipt.result_summary as Record<string, string | null>;
        return { ok: true, data: {
          reviewId: (receipt.result_ids as string[])[0] ?? "",
          learningCardId: summary.learningCardId ?? "",
          repairId: summary.repairId ?? null,
        }};
      }
    } catch {
      // DB offline
    }
  }

  // Fetch session
  let session: any = null;
  if (isSupabaseConfigured()) {
    try {
      const { data: s } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = s;
    } catch {
      // DB offline
    }
  }

  if (!session) {
    const reviewId = crypto.randomUUID();
    const learningCardId = crypto.randomUUID();
    const repairId = parsed.data.repairProposal ? crypto.randomUUID() : null;

    saveLocalReview({
      id: reviewId,
      ownerId: auth.data.ownerId,
      sessionId: parsed.data.sessionId,
      revision: 1,
      status: "submitted",
      rubricId: parsed.data.rubricId,
      rubricVersion: parsed.data.rubricVersion,
      submittedAt: serverNow,
      evidence: parsed.data.evidence,
      learningCard: parsed.data.learningCard,
      repairProposal: parsed.data.repairProposal,
    });
    if (parsed.data.repairProposal) {
      saveLocalRepair({
        id: repairId!,
        ownerId: auth.data.ownerId,
        goalId: "",
        competencyKey: parsed.data.repairProposal.competencyKey,
        triggerEvidenceIds: parsed.data.evidence
          .filter(e => e.competencyKey === parsed.data.repairProposal!.competencyKey && e.rating !== null && e.rating <= 1)
          .map(e => e.attemptId)
          .filter(Boolean) as string[],
        hypothesis: parsed.data.repairProposal.hypothesis,
        drillTaskId: null,
        retestSessionId: null,
        state: "proposed",
        closureCriterion: parsed.data.repairProposal.closureCriterion,
        closureResult: null,
        version: 1,
      });
    }

    return {
      ok: true,
      data: {
        reviewId,
        learningCardId,
        repairId,
      },
    };
  }

  // Fetch existing reviews
  const { data: existingReviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("session_id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId)
    .order("revision", { ascending: true });

  const sessionRecord = mapDbToSession(session);
  const reviewRecords: ReviewRecord[] = (existingReviews ?? []).map((r: any) => ({
    id: r.id,
    ownerId: r.owner_id,
    sessionId: r.session_id,
    revision: r.revision,
    supersedesId: r.supersedes_id,
    rubricId: r.rubric_id,
    rubricVersion: r.rubric_version,
    evaluator: r.evaluator,
    source: r.source,
    status: r.status,
    noActionReason: r.no_action_reason,
  }));

  // Run domain rules
  const result = validateSubmitReview(sessionRecord, reviewRecords, {
    sessionId: parsed.data.sessionId,
    ownerId: auth.data.ownerId,
    rubricId: parsed.data.rubricId,
    rubricVersion: parsed.data.rubricVersion,
    evidence: parsed.data.evidence,
    learningCard: parsed.data.learningCard,
    repairProposal: parsed.data.repairProposal,
    noActionReason: parsed.data.noActionReason,
    supersedesReviewId: parsed.data.supersedesReviewId,
    serverNow,
  });

  if (!result.ok) return result;

  // Persist review
  const reviewId = crypto.randomUUID();
  await supabase.from("reviews").insert({
    id: reviewId,
    owner_id: auth.data.ownerId,
    session_id: parsed.data.sessionId,
    revision: result.data.review.revision,
    supersedes_id: result.data.review.supersedesId,
    rubric_id: parsed.data.rubricId,
    rubric_version: parsed.data.rubricVersion,
    evaluator: "owner",
    source: "self",
    status: "submitted",
    no_action_reason: result.data.review.noActionReason,
  });

  // Persist competency evidence
  for (const ev of result.data.evidence) {
    await supabase.from("competency_evidence").insert({
      id: crypto.randomUUID(),
      owner_id: auth.data.ownerId,
      review_id: reviewId,
      attempt_id: ev.attemptId,
      competency_key: ev.competencyKey,
      dimension: ev.dimension,
      rating: ev.rating,
      observation: ev.observation,
      evidence_reference: ev.evidenceReference,
      provenance: ev.provenance,
      confidence: ev.confidence,
      status: ev.status,
    });
  }

  // Persist learning card
  const learningCardId = crypto.randomUUID();
  await supabase.from("learning_cards").insert({
    id: learningCardId,
    owner_id: auth.data.ownerId,
    attempt_id: parsed.data.learningCard.attemptId,
    review_id: reviewId,
    initial_idea: parsed.data.learningCard.initialIdea,
    failure: parsed.data.learningCard.failure,
    corrected_insight: parsed.data.learningCard.correctedInsight,
    complexity_note: parsed.data.learningCard.complexityNote ?? null,
    edge_cases: parsed.data.learningCard.edgeCases ?? null,
    lesson: parsed.data.learningCard.lesson,
    similar_ids: parsed.data.learningCard.similarIds ?? [],
  });

  // Persist repair proposal (if any)
  let repairId: string | null = null;
  if (result.data.repairProposal) {
    repairId = crypto.randomUUID();
    await supabase.from("repairs").insert({
      id: repairId,
      owner_id: auth.data.ownerId,
      goal_id: session.goal_id,
      competency_key: result.data.repairProposal.competencyKey,
      trigger_evidence_ids: parsed.data.evidence
        .filter(e => e.competencyKey === result.data.repairProposal!.competencyKey && e.rating !== null && e.rating <= 1)
        .map(e => e.attemptId)
        .filter(Boolean) as string[],
      hypothesis: result.data.repairProposal.hypothesis,
      state: "proposed",
      closure_criterion: result.data.repairProposal.closureCriterion,
    });
  }

  // Update session state to reviewed
  await supabase
    .from("sessions")
    .update({ state: "reviewed", updated_at: serverNow })
    .eq("id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId);

  // Mark superseded review
  if (parsed.data.supersedesReviewId) {
    await supabase
      .from("reviews")
      .update({ status: "superseded" })
      .eq("id", parsed.data.supersedesReviewId)
      .eq("owner_id", auth.data.ownerId);
  }

  // Record receipt
  await supabase.from("mutation_receipts").insert({
    owner_id: auth.data.ownerId,
    operation: "submitReview",
    request_id: parsed.data.requestId,
    payload_hash: parsed.data.sessionId,
    result_ids: [reviewId],
    result_summary: { reviewId, learningCardId, repairId },
  });

  return { ok: true, data: { reviewId, learningCardId, repairId } };
}

// ---------------------------------------------------------------------------
// DB mapper
// ---------------------------------------------------------------------------

function mapDbToSession(row: any) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    taskId: row.task_id,
    goalId: row.goal_id,
    stage: row.stage,
    mode: row.mode,
    evaluatorMode: row.evaluator_mode,
    packId: row.pack_id,
    packVersion: row.pack_version,
    rubricId: row.rubric_id,
    rubricVersion: row.rubric_version,
    bundleHash: row.bundle_hash,
    resourcePolicy: row.resource_policy,
    state: row.state,
    finishReason: row.finish_reason,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    finalizedAt: row.finalized_at,
    isInterrupted: row.is_interrupted,
    isAssisted: row.is_assisted,
    linkedPriorSessionId: row.linked_prior_session_id,
    cancelReason: row.cancel_reason,
    version: row.version,
  };
}
