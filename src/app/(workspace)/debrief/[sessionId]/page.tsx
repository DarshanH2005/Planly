/**
 * Debrief Route — /debrief/[sessionId]
 *
 * Shows frozen attempts and rubric for review submission.
 * PLANLY_BUILD_SPEC.md §9.2, §10
 */

import { redirect } from "next/navigation";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/require-owner";
import DebriefView from "@/features/reviews/components/debrief-view";
import { getPackById, resolvePack } from "@/features/curriculum/service";
import {
  getLocalSession,
  getLocalAttempts,
  getLocalDraft,
  getLocalReviews,
} from "@/lib/storage/local-store";

interface DebriefPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function DebriefPage({ params }: DebriefPageProps) {
  const { sessionId } = await params;
  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  const ownerId = auth.data.ownerId;
  const supabase = await createServerSupabaseClient();

  // Fetch session
  let session: any = null;
  try {
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("owner_id", ownerId)
      .single();
    session = data;
  } catch {
    // Database offline
  }

  if (!session) {
    const localSess = getLocalSession(sessionId);
    if (localSess) {
      session = {
        ...localSess,
        id: sessionId,
        owner_id: ownerId,
      };
    }
  }

  if (!session) {
    const packInfo = resolvePack(sessionId);
    if (packInfo) {
      const now = new Date().toISOString();
      session = {
        id: sessionId,
        owner_id: ownerId,
        task_id: null,
        goal_id: "goal-01",
        stage: packInfo.pack.stage,
        mode: "practice",
        finish_reason: "submitted",
        started_at: now,
        deadline_at: now,
        finalized_at: now,
        pack_id: packInfo.pack.id,
        rubric_id: packInfo.pack.rubricId,
        rubric_version: packInfo.pack.rubricVersion,
        is_interrupted: false,
        is_assisted: false,
        state: "finalized",
      };
    }
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen text-muted text-xs">
        Session not found.
      </div>
    );
  }

  // Fetch prompts and attempts
  let prompts: any[] = [];
  let attempts: any[] = [];
  let reviews: any[] = [];
  let evidence: any[] = [];

  if (isSupabaseConfigured()) {
    try {
      const { data: pData } = await supabase
        .from("session_prompts")
        .select("*")
        .eq("session_id", sessionId)
        .eq("owner_id", ownerId)
        .order("display_order", { ascending: true });
      prompts = pData || [];

      const promptIds = prompts.map((p) => p.id as string);
      const { data: aData } = await supabase
        .from("attempts")
        .select("*")
        .in("session_prompt_id", promptIds)
        .eq("owner_id", ownerId);
      attempts = aData || [];

      const { data: rData } = await supabase
        .from("reviews")
        .select("*")
        .eq("session_id", sessionId)
        .eq("owner_id", ownerId)
        .order("revision", { ascending: true });
      reviews = rData || [];

      const reviewIds = reviews.map((r) => r.id as string);
      const { data: eData } = await supabase
        .from("competency_evidence")
        .select("*")
        .in("review_id", reviewIds)
        .eq("owner_id", ownerId);
      evidence = eData || [];
    } catch {
      // Database offline
    }
  }

  const packInfo = getPackById(session.pack_id) || resolvePack(session.pack_id);
  if (prompts.length === 0 && packInfo) {
    prompts = packInfo.prompts.map((p, idx) => ({
      id: p.id,
      prompt_id: p.id,
      display_order: idx,
      revealed_candidate_snapshot: {
        title: p.id,
        description: p.statement,
      },
    }));
  }

  // Fallback to local store attempts if not in DB
  if (attempts.length === 0) {
    const localAttempts = getLocalAttempts(sessionId);
    if (localAttempts.length > 0) {
      attempts = localAttempts.map((la) => ({
        id: la.id,
        session_prompt_id: la.sessionPromptId,
        frozen_code: la.frozenCode,
        frozen_language: la.frozenLanguage,
        frozen_notes: la.frozenNotes,
        finalized_at: la.finalizedAt,
      }));
    }
  }

  // If still empty, synthesize from local drafts or prompts
  if (attempts.length === 0 && prompts.length > 0) {
    attempts = prompts.map((p) => {
      const draft = getLocalDraft(sessionId, p.id);
      return {
        id: `att-${sessionId}-${p.id}`,
        session_prompt_id: p.id,
        frozen_code: draft?.code || "# No submission recorded",
        frozen_language: draft?.language || "python",
        frozen_notes: draft?.notes || "",
        finalized_at: session.finalized_at || new Date().toISOString(),
      };
    });
  }

  // Fallback to local store reviews
  if (reviews.length === 0) {
    const localRev = getLocalReviews(sessionId);
    if (localRev.length > 0) {
      reviews = localRev;
    }
  }

  return (
    <DebriefView
      sessionId={sessionId}
      session={{
        stage: session.stage as string,
        mode: session.mode as string,
        finishReason: session.finish_reason as string,
        startedAt: session.started_at as string,
        deadlineAt: session.deadline_at as string,
        finalizedAt: session.finalized_at as string,
        packId: session.pack_id as string,
        rubricId: session.rubric_id as string,
        rubricVersion: session.rubric_version as number,
        isInterrupted: session.is_interrupted as boolean,
        isAssisted: session.is_assisted as boolean,
      }}
      prompts={(prompts ?? []).map((p) => ({
        id: p.id as string,
        promptId: p.prompt_id as string,
        displayOrder: p.display_order as number,
        candidateSnapshot: p.revealed_candidate_snapshot as {
          title: string;
          description: string;
        } | null,
      }))}
      attempts={(attempts ?? []).map((a) => ({
        id: a.id as string,
        sessionPromptId: a.session_prompt_id as string,
        frozenCode: a.frozen_code as string,
        frozenLanguage: a.frozen_language as string,
        frozenNotes: a.frozen_notes as string,
        finalizedAt: a.finalized_at as string,
      }))}
      existingReviews={(reviews ?? []).map((r) => ({
        id: r.id as string,
        revision: r.revision as number,
        status: r.status as string,
      }))}
      existingEvidence={(evidence ?? []).map((e) => ({
        id: e.id as string,
        competencyKey: e.competency_key as string,
        dimension: e.dimension as string,
        rating: e.rating as number | null,
        observation: e.observation as string,
      }))}
      isReviewed={session.state === "reviewed"}
    />
  );
}
