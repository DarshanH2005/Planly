import { redirect } from "next/navigation";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/require-owner";
import Arena from "@/features/sessions/components/arena";
import Preflight from "@/features/sessions/components/preflight";
import {
  getPackById,
  toCandidateSafePack,
  toCandidateSafePrompt,
  resolvePack,
} from "@/features/curriculum/service";
import type { CandidateSafePromptSnapshot } from "@/features/curriculum/service";
import { getLocalDraft, getLocalSession } from "@/lib/storage/local-store";

interface ArenaPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function ArenaPage({ params }: ArenaPageProps) {
  const { sessionId } = await params;

  // 1. Auth check using requireOwner (supports planly_session cookie & Supabase)
  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  const ownerId = auth.data.ownerId;
  const supabase = await createServerSupabaseClient();
  // 2. Fetch session from database if available and configured
  let session: any = null;
  if (isSupabaseConfigured()) {
    try {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      session = data;
    } catch {
      // Database offline
    }
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

  // 4. If no session exists in DB, synthesize active running practice session
  if (!session) {
    const packInfo = resolvePack(sessionId);
    if (packInfo) {
      const now = new Date();
      const durationMs = (packInfo.pack.durationMinutes || 45) * 60 * 1000;
      session = {
        id: sessionId,
        owner_id: ownerId,
        task_id: null,
        goal_id: "goal-01",
        stage: packInfo.pack.stage,
        mode: "practice",
        evaluator_mode: "scripted_solo",
        pack_id: packInfo.pack.id,
        pack_version: packInfo.pack.version,
        rubric_id: packInfo.pack.rubricId,
        rubric_version: packInfo.pack.rubricVersion,
        bundle_hash: packInfo.bundleHash,
        resource_policy: packInfo.pack.resourcePolicy,
        state: "running", // Immediately enter active practice Arena
        finish_reason: null,
        started_at: now.toISOString(),
        deadline_at: new Date(now.getTime() + durationMs).toISOString(),
        finalized_at: null,
        is_interrupted: false,
        is_assisted: false,
        linked_prior_session_id: null,
        cancel_reason: null,
        version: 1,
      };
    }
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen text-muted text-xs">
        Session pack not found.
      </div>
    );
  }

  // 5. Preflight check for planned sessions (§8.2, §9.1)
  if (session.state === "planned") {
    const packInfo = getPackById(session.pack_id) || resolvePack(session.pack_id);
    if (!packInfo) {
      return (
        <div className="flex items-center justify-center h-screen text-muted text-xs">
          Session pack &apos;{session.pack_id}&apos; not found in curriculum.
        </div>
      );
    }

    const safePack = toCandidateSafePack(packInfo.pack);
    const preflightPrompts = packInfo.prompts.map((p, idx) => ({
      id: p.id,
      promptId: p.id,
      displayOrder: idx,
      familyIds: p.familyIds,
      difficulty: p.difficulty,
    }));

    return (
      <Preflight
        sessionId={sessionId}
        sessionVersion={session.version as number}
        pack={safePack}
        prompts={preflightPrompts}
      />
    );
  }

  if (session.state === "finalized" || session.state === "reviewed") {
    redirect(`/debrief/${sessionId}`);
  }

  // 6. Fetch session prompts
  let prompts: any[] = [];
  if (isSupabaseConfigured()) {
    try {
      const { data } = await supabase
        .from("session_prompts")
        .select("*")
        .eq("session_id", sessionId)
        .eq("owner_id", ownerId)
        .order("display_order", { ascending: true });
      prompts = data || [];
    } catch {
      // Database offline
    }
  }

  const packInfo = getPackById(session.pack_id) || resolvePack(session.pack_id);

  let activePrompts = prompts;
  if (activePrompts.length === 0 && packInfo) {
    // If not yet persisted, construct candidate-safe projections on the fly
    activePrompts = packInfo.prompts.map((p, idx) => ({
      id: p.id,
      session_id: sessionId,
      owner_id: ownerId,
      prompt_id: p.id,
      prompt_version: p.version,
      prompt_hash: packInfo.bundleHash,
      display_order: idx,
      revealed_candidate_snapshot: toCandidateSafePrompt(p),
      exposure_declaration: "unseen_declared",
      revealed_at: session.started_at,
      created_at: session.started_at,
    }));
  }

  if (activePrompts.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen text-muted text-xs">
        No prompts found for this session pack.
      </div>
    );
  }

  // 7. Fetch current drafts
  const promptIds = activePrompts.map((p) => p.id as string);
  const initialDrafts = new Map<string, { code: string; notes: string; revision: number }>();
  if (isSupabaseConfigured()) {
    try {
      const { data: drafts } = await supabase
        .from("drafts")
        .select("*")
        .in("session_prompt_id", promptIds)
        .eq("owner_id", ownerId);

      for (const draft of drafts ?? []) {
        initialDrafts.set(draft.session_prompt_id as string, {
          code: draft.code as string,
          notes: draft.notes as string,
          revision: draft.revision as number,
        });
      }
    } catch {
      // Database offline
    }
  }

  // Check local store for any drafts not in DB
  for (const pId of promptIds) {
    if (!initialDrafts.has(pId)) {
      const localDraft = getLocalDraft(sessionId, pId);
      if (localDraft) {
        initialDrafts.set(pId, {
          code: localDraft.code,
          notes: localDraft.notes,
          revision: localDraft.revision,
        });
      }
    }
  }

  return (
    <Arena
      sessionId={sessionId}
      prompts={activePrompts.map((p) => ({
        id: p.id as string,
        promptId: p.prompt_id as string,
        displayOrder: p.display_order as number,
        candidateSnapshot: (p.revealed_candidate_snapshot as CandidateSafePromptSnapshot) ?? {
          id: p.prompt_id as string,
          version: 1,
          familyIds: [],
          difficulty: "foundation",
          statement: "Loading prompt...",
          constraints: [],
          examples: [],
          availableClarifications: [],
          revealedClarifications: [],
          revealedFollowups: [],
        },
      }))}
      deadline={session.deadline_at as string}
      startedAt={session.started_at as string}
      stage={session.stage as string}
      mode={session.mode as string}
      isAssisted={Boolean(session.is_assisted)}
      language="python"
      initialDrafts={initialDrafts}
      sessionVersion={session.version as number}
      resourcePolicy={(session.resource_policy as {
        docs: boolean;
        ai: boolean;
        hints: boolean;
        notes: boolean;
      }) ?? { docs: false, ai: false, hints: false, notes: true }}
    />
  );
}

