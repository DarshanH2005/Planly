"use server";

/**
 * Session Server Actions
 *
 * PLANLY_BUILD_SPEC.md §9, §13: Server-side mutation operations
 * for session lifecycle (start, save draft, finalize).
 *
 * Each action:
 * 1. Authenticates the owner
 * 2. Validates input with Zod
 * 3. Delegates to pure domain rules
 * 4. Persists via Supabase
 * 5. Returns Result<T>
 */

import { z } from "zod";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/require-owner";
import { fail } from "@/lib/validation/result";
import type { Result } from "@/lib/validation/result";
import {
  validateStart,
  validateDraftSave,
  validateFinalize,
  validateEvent,
  validateClarification,
  validateFollowup,
  validateConvertToPractice,
} from "@/features/sessions/rules";
import type { SessionRecord, DraftRecord, Familiarity } from "@/features/sessions/types";
import { getPackById, getPromptById, toCandidateSafePrompt, resolvePack } from "@/features/curriculum/service";
import {
  saveLocalDraft,
  getLocalDraft,
  saveLocalAttempts,
  getLocalAttempts,
  saveLocalSession,
  getLocalSession,
  saveLocalEvent,
} from "@/lib/storage/local-store";

// ---------------------------------------------------------------------------
// Zod schemas for action inputs
// ---------------------------------------------------------------------------

const StartSessionSchema = z.object({
  sessionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  requestId: z.string().min(1),
  declarations: z.array(z.object({
    promptId: z.string(),
    familiarity: z.enum(["unseen_declared", "familiar", "unknown"]),
  })).optional(),
});

const RevealClarificationSchema = z.object({
  sessionId: z.string().min(1),
  sessionPromptId: z.string().min(1),
  branchId: z.string(),
});

const RevealFollowupSchema = z.object({
  sessionId: z.string().min(1),
  sessionPromptId: z.string().min(1),
  followupId: z.string(),
  currentCode: z.string(),
  currentNotes: z.string().default(""),
});

const ConvertToPracticeSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().default("Converted from strict attempt to coached practice"),
});

const SaveDraftSchema = z.object({
  sessionId: z.string().min(1),
  sessionPromptId: z.string().min(1),
  code: z.string(),
  language: z.string().default("python"),
  notes: z.string().default(""),
  expectedRevision: z.number().int().min(0),
});

const FinalizeSessionSchema = z.object({
  sessionId: z.string().min(1),
  finishReason: z.enum(["submitted", "timeout", "stopped", "converted_to_practice"]),
  expectedVersion: z.number().int().positive(),
  requestId: z.string().min(1),
  finalDrafts: z.array(z.object({
    sessionPromptId: z.string().min(1),
    code: z.string(),
    language: z.string().default("python"),
    notes: z.string().default(""),
    expectedRevision: z.number().int().min(0),
  })).optional(),
});

const RecordEventSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum([
    "phase_change", "clarification", "follow_up",
    "help_request", "interruption", "hint_given", "conversion",
  ]),
  branchRef: z.string().optional(),
  response: z.string().optional(),
  observation: z.string().optional(),
  currentCode: z.string().optional(),
  currentNotes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// startSession action
// ---------------------------------------------------------------------------

export async function startSession(
  input: z.infer<typeof StartSessionSchema>
): Promise<Result<{ sessionId: string; startedAt: string; deadlineAt: string }>> {
  // 1. Auth
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  // 2. Validate input
  const parsed = StartSessionSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input", {
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join("."), i.message])
      ),
    });
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  // 3. Fetch current session if Supabase is configured
  let session: any = null;
  if (isSupabaseConfigured()) {
    try {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = data;
    } catch {
      // Database offline
    }
  }

  // If no DB session, synthesize running session via local store
  if (!session) {
    const packInfo = resolvePack(parsed.data.sessionId);
    const durationMinutes = packInfo?.pack.durationMinutes || 45;
    const deadlineAt = new Date(Date.now() + durationMinutes * 60000).toISOString();

    saveLocalSession(parsed.data.sessionId, {
      id: parsed.data.sessionId,
      ownerId: auth.data.ownerId,
      stage: packInfo?.pack.stage || "foundation",
      mode: "practice",
      packId: packInfo?.pack.id || "PACK-FOUNDATION-01",
      rubricId: packInfo?.pack.rubricId || "RUBRIC-TECHNICAL-FOUNDATION",
      rubricVersion: packInfo?.pack.rubricVersion || 1,
      state: "running",
      finishReason: null,
      startedAt: serverNow,
      deadlineAt,
      finalizedAt: null,
      isInterrupted: false,
      isAssisted: false,
      version: parsed.data.expectedVersion + 1,
    });

    return {
      ok: true,
      data: {
        sessionId: parsed.data.sessionId,
        startedAt: serverNow,
        deadlineAt,
      },
    };
  }

  // 4. Check idempotency
  const { data: receipt } = await supabase
    .from("mutation_receipts")
    .select("result_ids, result_summary")
    .eq("owner_id", auth.data.ownerId)
    .eq("operation", "startSession")
    .eq("request_id", parsed.data.requestId)
    .single();

  if (receipt) {
    const summary = receipt.result_summary as Record<string, string>;
    return { ok: true, data: {
      sessionId: parsed.data.sessionId,
      startedAt: summary.startedAt ?? serverNow,
      deadlineAt: summary.deadlineAt ?? serverNow,
    }};
  }

  // 5. Map DB record to domain type
  const sessionRecord = mapDbToSession(session);

  // 6. Run pure domain rules
  const result = validateStart(sessionRecord, {
    sessionId: parsed.data.sessionId,
    ownerId: auth.data.ownerId,
    expectedVersion: parsed.data.expectedVersion,
    serverNow,
  });

  if (!result.ok) return result;

  // 7. Resolve pack configuration and duration
  const packInfo = getPackById(session.pack_id);
  const durationMinutes = packInfo ? packInfo.pack.durationMinutes : 90;
  const deadlineAt = new Date(
    new Date(serverNow).getTime() + durationMinutes * 60000
  ).toISOString();

  // 8. Persist session start
  const { error: updateError } = await supabase
    .from("sessions")
    .update({
      state: "running",
      started_at: serverNow,
      deadline_at: deadlineAt,
      version: sessionRecord.version + 1,
      updated_at: serverNow,
    })
    .eq("id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId)
    .eq("version", parsed.data.expectedVersion);

  if (updateError) {
    return fail("VERSION_CONFLICT", "Session was modified concurrently");
  }

  // 9. Populate session prompts and exposures if pack prompts exist
  if (packInfo && packInfo.prompts.length > 0) {
    const declarationsMap = new Map<string, Familiarity>();
    for (const d of parsed.data.declarations ?? []) {
      declarationsMap.set(d.promptId, d.familiarity);
    }

    for (let order = 0; order < packInfo.prompts.length; order++) {
      const prompt = packInfo.prompts[order];
      const declaration = declarationsMap.get(prompt.id) ?? "unseen_declared";
      const safeSnapshot = toCandidateSafePrompt(prompt);

      // Check if session_prompt row already exists
      const { data: existingSp } = await supabase
        .from("session_prompts")
        .select("id")
        .eq("session_id", parsed.data.sessionId)
        .eq("prompt_id", prompt.id)
        .eq("owner_id", auth.data.ownerId)
        .maybeSingle();

      if (!existingSp) {
        await supabase.from("session_prompts").insert({
          id: crypto.randomUUID(),
          owner_id: auth.data.ownerId,
          session_id: parsed.data.sessionId,
          prompt_id: prompt.id,
          prompt_version: prompt.version,
          prompt_hash: packInfo.bundleHash,
          display_order: order,
          revealed_candidate_snapshot: safeSnapshot,
          exposure_declaration: declaration,
          revealed_at: serverNow,
        });
      } else {
        await supabase.from("session_prompts").update({
          revealed_candidate_snapshot: safeSnapshot,
          exposure_declaration: declaration,
          revealed_at: serverNow,
        }).eq("id", existingSp.id);
      }

      // Record exposure in exposures table (§8.2)
      await supabase.from("exposures").insert({
        id: crypto.randomUUID(),
        owner_id: auth.data.ownerId,
        prompt_id: prompt.id,
        prompt_version: prompt.version,
        kind: "session_reveal",
        session_id: parsed.data.sessionId,
        exposed_at: serverNow,
      });
    }
  }

  // 10. Record receipt
  await supabase.from("mutation_receipts").insert({
    owner_id: auth.data.ownerId,
    operation: "startSession",
    request_id: parsed.data.requestId,
    payload_hash: parsed.data.sessionId,
    result_ids: [parsed.data.sessionId],
    result_summary: { startedAt: serverNow, deadlineAt },
  });

  return { ok: true, data: {
    sessionId: parsed.data.sessionId,
    startedAt: serverNow,
    deadlineAt,
  }};
}

// ---------------------------------------------------------------------------
// revealClarification action (§8.3, AC14)
// ---------------------------------------------------------------------------

export async function revealClarification(
  input: z.infer<typeof RevealClarificationSchema>
): Promise<Result<{ question: string; answer: string }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = RevealClarificationSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  let session: any = null;
  let sessionPrompt: any = null;

  if (isSupabaseConfigured()) {
    try {
      const { data: s } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = s;

      const { data: sp } = await supabase
        .from("session_prompts")
        .select("*")
        .eq("id", parsed.data.sessionPromptId)
        .eq("session_id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      sessionPrompt = sp;
    } catch {
      // Database offline
    }
  }

  // Fallback if session or sessionPrompt is not in DB (practice/offline mode)
  if (!session || !sessionPrompt) {
    const promptId = sessionPrompt?.prompt_id || parsed.data.sessionPromptId;
    const promptDef = getPromptById(promptId);
    if (!promptDef) return fail("NOT_FOUND", "Prompt definition not found");

    const branch = promptDef.clarificationBranches.find((b) => b.id === parsed.data.branchId);
    if (!branch) return fail("NOT_FOUND", "Clarification branch not found");

    saveLocalEvent(parsed.data.sessionId, {
      kind: "clarification",
      branchRef: branch.id,
      response: branch.answer,
      observation: branch.question,
      serverTimestamp: serverNow,
    });

    return {
      ok: true,
      data: {
        question: branch.question,
        answer: branch.answer,
      },
    };
  }

  const sessionRecord = mapDbToSession(session);
  const promptDef = getPromptById(sessionPrompt.prompt_id);
  if (!promptDef) return fail("NOT_FOUND", "Prompt definition not found");

  const result = validateClarification(
    sessionRecord,
    promptDef.clarificationBranches,
    parsed.data.branchId,
    auth.data.ownerId,
    serverNow
  );

  if (!result.ok) return result;

  // Insert event
  await supabase.from("session_events").insert({
    id: crypto.randomUUID(),
    owner_id: auth.data.ownerId,
    session_id: parsed.data.sessionId,
    kind: "clarification",
    branch_ref: result.data.event.branchRef,
    response: result.data.event.response,
    observation: result.data.event.observation,
    server_timestamp: serverNow,
    source: "scripted_interviewer",
  });

  // Update revealed snapshot with this answer
  const currentSnapshot = sessionPrompt.revealed_candidate_snapshot as {
    revealedClarifications?: Array<{ id: string; question: string; answer: string }>;
    [key: string]: unknown;
  } || {};

  const existingRevealed = currentSnapshot.revealedClarifications || [];
  if (!existingRevealed.some((c) => c.id === parsed.data.branchId)) {
    const updatedSnapshot = {
      ...currentSnapshot,
      revealedClarifications: [
        ...existingRevealed,
        {
          id: parsed.data.branchId,
          question: result.data.question,
          answer: result.data.answer,
        },
      ],
    };

    await supabase
      .from("session_prompts")
      .update({ revealed_candidate_snapshot: updatedSnapshot })
      .eq("id", parsed.data.sessionPromptId)
      .eq("owner_id", auth.data.ownerId);
  }

  return {
    ok: true,
    data: {
      question: result.data.question,
      answer: result.data.answer,
    },
  };
}

// ---------------------------------------------------------------------------
// revealFollowup action (§9.1, AC14)
// ---------------------------------------------------------------------------

export async function revealFollowup(
  input: z.infer<typeof RevealFollowupSchema>
): Promise<Result<{ question: string }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = RevealFollowupSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  let session: any = null;
  let sessionPrompt: any = null;

  if (isSupabaseConfigured()) {
    try {
      const { data: s } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = s;

      const { data: sp } = await supabase
        .from("session_prompts")
        .select("*")
        .eq("id", parsed.data.sessionPromptId)
        .eq("session_id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      sessionPrompt = sp;
    } catch {
      // Database offline
    }
  }

  // Fallback if session or sessionPrompt is not in DB
  if (!session || !sessionPrompt) {
    const promptId = sessionPrompt?.prompt_id || parsed.data.sessionPromptId;
    const promptDef = getPromptById(promptId);
    if (!promptDef) return fail("NOT_FOUND", "Prompt definition not found");

    const followup = promptDef.followups.find((f) => f.id === parsed.data.followupId);
    if (!followup) return fail("NOT_FOUND", "Follow-up not found");

    saveLocalEvent(parsed.data.sessionId, {
      kind: "follow_up",
      branchRef: followup.id,
      observation: followup.question,
      preChangeSnapshot: {
        code: parsed.data.currentCode,
        notes: parsed.data.currentNotes,
      },
      serverTimestamp: serverNow,
    });

    return {
      ok: true,
      data: {
        question: followup.question,
      },
    };
  }

  const sessionRecord = mapDbToSession(session);
  const promptDef = getPromptById(sessionPrompt.prompt_id);
  if (!promptDef) return fail("NOT_FOUND", "Prompt definition not found");

  const result = validateFollowup(
    sessionRecord,
    promptDef.followups,
    parsed.data.followupId,
    auth.data.ownerId,
    parsed.data.currentCode,
    parsed.data.currentNotes,
    serverNow
  );

  if (!result.ok) return result;

  // Insert event with pre-change snapshot
  await supabase.from("session_events").insert({
    id: crypto.randomUUID(),
    owner_id: auth.data.ownerId,
    session_id: parsed.data.sessionId,
    kind: "follow_up",
    branch_ref: result.data.event.branchRef,
    response: result.data.event.response,
    observation: result.data.event.observation,
    pre_change_snapshot: result.data.event.preChangeSnapshot,
    server_timestamp: serverNow,
    source: "scripted_interviewer",
  });

  // Update revealed snapshot with this follow-up
  const currentSnapshot = sessionPrompt.revealed_candidate_snapshot as {
    revealedFollowups?: Array<{ id: string; question: string }>;
    [key: string]: unknown;
  } || {};

  const existingFollowups = currentSnapshot.revealedFollowups || [];
  if (!existingFollowups.some((f) => f.id === parsed.data.followupId)) {
    const updatedSnapshot = {
      ...currentSnapshot,
      revealedFollowups: [
        ...existingFollowups,
        {
          id: parsed.data.followupId,
          question: result.data.question,
        },
      ],
    };

    await supabase
      .from("session_prompts")
      .update({ revealed_candidate_snapshot: updatedSnapshot })
      .eq("id", parsed.data.sessionPromptId)
      .eq("owner_id", auth.data.ownerId);
  }

  return {
    ok: true,
    data: {
      question: result.data.question,
    },
  };
}

// ---------------------------------------------------------------------------
// convertToPractice action (§9.1, AC15)
// ---------------------------------------------------------------------------

export async function convertToPractice(
  input: z.infer<typeof ConvertToPracticeSchema>
): Promise<Result<{ mode: string; isAssisted: boolean }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = ConvertToPracticeSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  let session: any = null;
  if (isSupabaseConfigured()) {
    try {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = data;
    } catch {
      // DB offline
    }
  }

  if (!session) {
    saveLocalSession(parsed.data.sessionId, {
      mode: "practice",
      isAssisted: true,
    });
    return {
      ok: true,
      data: {
        mode: "practice",
        isAssisted: true,
      },
    };
  }

  const sessionRecord = mapDbToSession(session);

  const result = validateConvertToPractice(
    sessionRecord,
    auth.data.ownerId,
    parsed.data.reason,
    serverNow
  );

  if (!result.ok) return result;

  // Update session
  await supabase
    .from("sessions")
    .update({
      mode: result.data.sessionUpdates.mode,
      is_assisted: result.data.sessionUpdates.isAssisted,
      version: result.data.sessionUpdates.version,
      updated_at: serverNow,
    })
    .eq("id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId)
    .eq("version", sessionRecord.version);

  // Record conversion event
  await supabase.from("session_events").insert({
    id: crypto.randomUUID(),
    owner_id: auth.data.ownerId,
    session_id: parsed.data.sessionId,
    kind: "conversion",
    response: result.data.event.response,
    server_timestamp: serverNow,
    source: "owner",
  });

  return {
    ok: true,
    data: {
      mode: "practice",
      isAssisted: true,
    },
  };
}


// ---------------------------------------------------------------------------
// saveDraft action
// ---------------------------------------------------------------------------

export async function saveDraft(
  input: z.infer<typeof SaveDraftSchema>
): Promise<Result<{ revision: number; savedAt: string }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = SaveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  let sessionPrompt: any = null;
  let session: any = null;
  let currentDraft: any = null;

  if (isSupabaseConfigured()) {
    try {
      const { data: sp } = await supabase
        .from("session_prompts")
        .select("session_id")
        .eq("id", parsed.data.sessionPromptId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      sessionPrompt = sp;

      const { data: s } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", parsed.data.sessionId)
        .eq("owner_id", auth.data.ownerId)
        .single();
      session = s;

      if (sessionPrompt) {
        const { data: cd } = await supabase
          .from("drafts")
          .select("*")
          .eq("session_prompt_id", parsed.data.sessionPromptId)
          .eq("owner_id", auth.data.ownerId)
          .single();
        currentDraft = cd;
      }
    } catch {
      // DB offline
    }
  }

  // If session or sessionPrompt is not in DB (practice / offline mode)
  if (!session || !sessionPrompt) {
    const existingLocalDraft = getLocalDraft(parsed.data.sessionId, parsed.data.sessionPromptId);
    const newRevision = (parsed.data.expectedRevision ?? existingLocalDraft?.revision ?? 0) + 1;

    saveLocalDraft({
      sessionId: parsed.data.sessionId,
      sessionPromptId: parsed.data.sessionPromptId,
      code: parsed.data.code,
      language: parsed.data.language,
      notes: parsed.data.notes,
      revision: newRevision,
      savedAt: serverNow,
    });

    return { ok: true, data: { revision: newRevision, savedAt: serverNow } };
  }

  const sessionRecord = mapDbToSession(session);
  const draftRecord = currentDraft ? mapDbToDraft(currentDraft) : null;

  // Run domain rules
  const result = validateDraftSave(sessionRecord, draftRecord, {
    sessionId: parsed.data.sessionId,
    sessionPromptId: parsed.data.sessionPromptId,
    ownerId: auth.data.ownerId,
    code: parsed.data.code,
    language: parsed.data.language,
    notes: parsed.data.notes,
    expectedRevision: parsed.data.expectedRevision,
    serverNow,
  });

  if (!result.ok) return result;

  // Upsert draft
  const newRevision = result.data.draft.revision!;
  const { error: upsertError } = await supabase
    .from("drafts")
    .upsert({
      id: currentDraft?.id ?? crypto.randomUUID(),
      owner_id: auth.data.ownerId,
      session_prompt_id: parsed.data.sessionPromptId,
      revision: newRevision,
      code: parsed.data.code,
      language: parsed.data.language,
      notes: parsed.data.notes,
      saved_at: serverNow,
    }, {
      onConflict: "owner_id,session_prompt_id",
    });

  if (upsertError) {
    return fail("VERSION_CONFLICT", "Draft was modified concurrently");
  }

  // Also mirror to local store
  saveLocalDraft({
    sessionId: parsed.data.sessionId,
    sessionPromptId: parsed.data.sessionPromptId,
    code: parsed.data.code,
    language: parsed.data.language,
    notes: parsed.data.notes,
    revision: newRevision,
    savedAt: serverNow,
  });

  return { ok: true, data: { revision: newRevision, savedAt: serverNow } };
}

// ---------------------------------------------------------------------------
// finalizeSession action
// ---------------------------------------------------------------------------

export async function finalizeSession(
  input: z.infer<typeof FinalizeSessionSchema>
): Promise<Result<{ sessionId: string; attemptIds: string[] }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = FinalizeSessionSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

  // Idempotency check if configured
  if (isSupabaseConfigured()) {
    try {
      const { data: receipt } = await supabase
        .from("mutation_receipts")
        .select("result_ids")
        .eq("owner_id", auth.data.ownerId)
        .eq("operation", "finalizeSession")
        .eq("request_id", parsed.data.requestId)
        .single();

      if (receipt) {
        return { ok: true, data: {
          sessionId: parsed.data.sessionId,
          attemptIds: (receipt.result_ids as string[]) ?? [],
        }};
      }
    } catch {
      // DB offline
    }
  }

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

  // If no DB session (practice / offline mode)
  if (!session) {
    const attemptIds: string[] = [];
    const attempts = (parsed.data.finalDrafts || []).map((fd) => {
      const attId = `att-${parsed.data.sessionId}-${fd.sessionPromptId}`;
      attemptIds.push(attId);
      return {
        id: attId,
        sessionId: parsed.data.sessionId,
        sessionPromptId: fd.sessionPromptId,
        frozenCode: fd.code,
        frozenLanguage: fd.language,
        frozenNotes: fd.notes,
        finalizedAt: serverNow,
        sourceDraftRevision: fd.expectedRevision,
      };
    });

    if (attempts.length === 0) {
      const packInfo = resolvePack(parsed.data.sessionId);
      if (packInfo) {
        for (const p of packInfo.prompts) {
          const draft = getLocalDraft(parsed.data.sessionId, p.id);
          const attId = `att-${parsed.data.sessionId}-${p.id}`;
          attemptIds.push(attId);
          attempts.push({
            id: attId,
            sessionId: parsed.data.sessionId,
            sessionPromptId: p.id,
            frozenCode: draft?.code || "",
            frozenLanguage: draft?.language || "python",
            frozenNotes: draft?.notes || "",
            finalizedAt: serverNow,
            sourceDraftRevision: draft?.revision || 0,
          });
        }
      }
    }

    saveLocalAttempts(parsed.data.sessionId, attempts);
    saveLocalSession(parsed.data.sessionId, {
      id: parsed.data.sessionId,
      ownerId: auth.data.ownerId,
      state: "finalized",
      finishReason: parsed.data.finishReason,
      finalizedAt: serverNow,
      version: parsed.data.expectedVersion + 1,
    });

    return { ok: true, data: { sessionId: parsed.data.sessionId, attemptIds } };
  }

  // Fetch all session prompts
  const { data: prompts } = await supabase
    .from("session_prompts")
    .select("id")
    .eq("session_id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId)
    .order("display_order", { ascending: true });

  const promptIds = (prompts ?? []).map((p) => p.id as string);

  // Fetch current drafts
  const { data: drafts } = await supabase
    .from("drafts")
    .select("*")
    .in("session_prompt_id", promptIds)
    .eq("owner_id", auth.data.ownerId);

  const draftMap = new Map(
    (drafts ?? []).map((d) => [d.session_prompt_id as string, mapDbToDraft(d)])
  );

  const sessionRecord = mapDbToSession(session);

  // Run domain rules
  const result = validateFinalize(sessionRecord, promptIds, draftMap, {
    sessionId: parsed.data.sessionId,
    ownerId: auth.data.ownerId,
    finishReason: parsed.data.finishReason,
    expectedVersion: parsed.data.expectedVersion,
    serverNow,
    finalDrafts: parsed.data.finalDrafts,
  });

  if (!result.ok) return result;

  // Persist: update session
  const { error: sessionError } = await supabase
    .from("sessions")
    .update({
      state: result.data.session.state,
      finish_reason: result.data.session.finishReason,
      finalized_at: result.data.session.finalizedAt,
      version: result.data.session.version,
      updated_at: serverNow,
    })
    .eq("id", parsed.data.sessionId)
    .eq("owner_id", auth.data.ownerId)
    .eq("version", parsed.data.expectedVersion);

  if (sessionError) {
    return fail("VERSION_CONFLICT", "Session was modified concurrently");
  }

  // Insert attempts
  const attemptIds: string[] = [];
  for (const attempt of result.data.attempts) {
    const { error: attemptError } = await supabase
      .from("attempts")
      .insert({
        id: attempt.id,
        owner_id: auth.data.ownerId,
        session_prompt_id: attempt.sessionPromptId,
        frozen_code: attempt.frozenCode,
        frozen_language: attempt.frozenLanguage,
        frozen_notes: attempt.frozenNotes,
        finalized_at: attempt.finalizedAt,
        source_draft_revision: attempt.sourceDraftRevision,
        assistance_snapshot: attempt.assistanceSnapshot,
        exposure_snapshot: attempt.exposureSnapshot,
      });

    if (attemptError) {
      // Attempt already exists (idempotent — finalize already ran)
      continue;
    }
    attemptIds.push(attempt.id);
  }

  // Record receipt
  await supabase.from("mutation_receipts").insert({
    owner_id: auth.data.ownerId,
    operation: "finalizeSession",
    request_id: parsed.data.requestId,
    payload_hash: parsed.data.sessionId,
    result_ids: attemptIds,
    result_summary: { finishReason: result.data.session.finishReason },
  });

  // Mirror attempts to local store for offline consistency
  const localAttempts = result.data.attempts.map((a) => ({
    id: a.id,
    sessionId: parsed.data.sessionId,
    sessionPromptId: a.sessionPromptId,
    frozenCode: a.frozenCode,
    frozenLanguage: a.frozenLanguage,
    frozenNotes: a.frozenNotes,
    finalizedAt: a.finalizedAt,
    sourceDraftRevision: a.sourceDraftRevision,
  }));
  saveLocalAttempts(parsed.data.sessionId, localAttempts);

  return { ok: true, data: { sessionId: parsed.data.sessionId, attemptIds } };
}

// ---------------------------------------------------------------------------
// recordEvent action
// ---------------------------------------------------------------------------

export async function recordSessionEvent(
  input: z.infer<typeof RecordEventSchema>
): Promise<Result<{ eventId: string }>> {
  const auth = await requireOwner();
  if (!auth.ok) return auth;

  const parsed = RecordEventSchema.safeParse(input);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Invalid input");
  }

  const supabase = await createServerSupabaseClient();
  const serverNow = new Date().toISOString();

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

  const eventId = crypto.randomUUID();

  if (!session) {
    saveLocalEvent(parsed.data.sessionId, {
      id: eventId,
      ownerId: auth.data.ownerId,
      sessionId: parsed.data.sessionId,
      kind: parsed.data.kind,
      branchRef: parsed.data.branchRef,
      response: parsed.data.response,
      observation: parsed.data.observation,
      serverTimestamp: serverNow,
    });
    return { ok: true, data: { eventId } };
  }

  const sessionRecord = mapDbToSession(session);

  const result = validateEvent(sessionRecord, {
    sessionId: parsed.data.sessionId,
    ownerId: auth.data.ownerId,
    kind: parsed.data.kind,
    branchRef: parsed.data.branchRef,
    response: parsed.data.response,
    observation: parsed.data.observation,
    currentCode: parsed.data.currentCode,
    currentNotes: parsed.data.currentNotes,
    serverNow,
  });

  if (!result.ok) return result;

  const { error } = await supabase.from("session_events").insert({
    id: eventId,
    owner_id: auth.data.ownerId,
    session_id: parsed.data.sessionId,
    kind: result.data.kind,
    branch_ref: result.data.branchRef,
    response: result.data.response,
    observation: result.data.observation,
    pre_change_snapshot: result.data.preChangeSnapshot,
    server_timestamp: serverNow,
    source: "owner",
  });

  if (error) {
    return fail("SERVICE_UNAVAILABLE", "Failed to record event");
  }

  return { ok: true, data: { eventId } };
}

// ---------------------------------------------------------------------------
// DB record mappers
// ---------------------------------------------------------------------------

function mapDbToSession(row: any): SessionRecord {
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

function mapDbToDraft(row: any): DraftRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionPromptId: row.session_prompt_id,
    revision: row.revision,
    code: row.code,
    language: row.language,
    notes: row.notes,
    savedAt: row.saved_at,
  };
}
