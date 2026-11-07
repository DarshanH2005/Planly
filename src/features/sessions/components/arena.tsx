"use client";

/**
 * Arena Coding Workspace
 *
 * PLANLY_BUILD_SPEC.md §9: Session lifecycle and durable writes.
 * - Multi-question OA navigation and triage status
 * - CodeMirror 6 editor (lazy loaded)
 * - Server-sourced timer with deadline enforcement (AC10)
 * - Debounced autosave with conflict resolution modal (AC11)
 * - Authored clarification questions and follow-up branch snapshots (AC14)
 * - Coached practice conversion (AC15)
 */

import { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  HelpCircle,
  GitBranch,
  AlertTriangle,
  CheckCircle2,
  Bookmark,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  saveDraft,
  finalizeSession,
  revealClarification,
  revealFollowup,
  convertToPractice,
} from "@/features/sessions/actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { CandidateSafePromptSnapshot } from "@/features/curriculum/service";

// Lazy load CodeEditor
const CodeEditor = lazy(() => import("./code-editor"));

export interface ArenaPromptItem {
  id: string;
  promptId: string;
  displayOrder: number;
  candidateSnapshot: CandidateSafePromptSnapshot;
}

interface ArenaProps {
  sessionId: string;
  prompts: ArenaPromptItem[];
  deadline: string;           // ISO timestamp
  startedAt: string;
  stage: string;
  mode: string;
  isAssisted: boolean;
  language: string;
  initialDrafts: Map<string, { code: string; notes: string; revision: number }>;
  sessionVersion: number;
  resourcePolicy: { docs: boolean; ai: boolean; hints: boolean; notes: boolean };
}

type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

export default function Arena({
  sessionId,
  prompts,
  deadline,
  startedAt,
  stage,
  mode: initialMode,
  isAssisted: initialIsAssisted,
  language,
  initialDrafts,
  sessionVersion,
  resourcePolicy,
}: ArenaProps) {
  const router = useRouter();

  // Active prompt
  const [activePromptIndex, setActivePromptIndex] = useState(0);
  const activePrompt = prompts[activePromptIndex];

  // Drafts state per prompt ID
  const [drafts, setDrafts] = useState<Map<string, { code: string; notes: string; revision: number }>>(
    () => new Map(initialDrafts)
  );

  // Question flags / triage (e.g. for review in OA)
  const [flaggedPrompts, setFlaggedPrompts] = useState<Set<string>>(new Set());

  // Timer state
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    const deadlineMs = new Date(deadline).getTime();
    const now = Date.now();
    return Math.max(0, Math.floor((deadlineMs - now) / 1000));
  });
  const [isExpired, setIsExpired] = useState(false);

  // Assistance / mode state
  const [mode, setMode] = useState(initialMode);
  const [isAssisted, setIsAssisted] = useState(initialIsAssisted);
  const [showConvertModal, setShowConvertModal] = useState(false);

  // Clarifications and Follow-ups state
  const [revealedClarifications, setRevealedClarifications] = useState<
    Map<string, Array<{ id: string; question: string; answer: string }>>
  >(() => {
    const initial = new Map<string, Array<{ id: string; question: string; answer: string }>>();
    for (const p of prompts) {
      initial.set(p.id, p.candidateSnapshot.revealedClarifications || []);
    }
    return initial;
  });

  const [revealedFollowups, setRevealedFollowups] = useState<
    Map<string, Array<{ id: string; question: string }>>
  >(() => {
    const initial = new Map<string, Array<{ id: string; question: string }>>();
    for (const p of prompts) {
      initial.set(p.id, p.candidateSnapshot.revealedFollowups || []);
    }
    return initial;
  });

  // Save status & conflict management
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [showConflictModal, setShowConflictModal] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSavedRef = useRef<Map<string, string>>(new Map());

  // Finalization state
  const [isFinishing, setIsFinishing] = useState(false);

  // ---------------------------------------------------------------------------
  // Timer: counts down from server deadline (AC10)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const deadlineMs = new Date(deadline).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((deadlineMs - now) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        setIsExpired(true);
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  // ---------------------------------------------------------------------------
  // Debounced autosave (~1s after last keystroke) (AC09, AC11)
  // ---------------------------------------------------------------------------
  const scheduleSave = useCallback((promptId: string, code: string, notes: string, revision: number) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      const key = `${promptId}:${revision}`;
      const contentHash = `${code}|${notes}`;
      if (lastSavedRef.current.get(key) === contentHash) return;

      setSaveStatus("saving");
      const result = await saveDraft({
        sessionId,
        sessionPromptId: promptId,
        code,
        language,
        notes,
        expectedRevision: revision,
      });

      if (result.ok) {
        setSaveStatus("saved");
        lastSavedRef.current.set(`${promptId}:${result.data.revision}`, contentHash);
        setDrafts((prev) => {
          const next = new Map(prev);
          next.set(promptId, { code, notes, revision: result.data.revision });
          return next;
        });
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else if (!result.ok && result.code === "VERSION_CONFLICT") {
        setSaveStatus("conflict");
        setShowConflictModal(true);
      } else if (!result.ok && result.code === "DEADLINE_PASSED") {
        setIsExpired(true);
        setSaveStatus("error");
      } else {
        setSaveStatus("error");
      }
    }, 1000);
  }, [sessionId, language]);

  // ---------------------------------------------------------------------------
  // Code and Notes change handlers
  // ---------------------------------------------------------------------------
  const handleCodeChange = useCallback((code: string) => {
    if (isExpired || isFinishing) return;

    const promptId = activePrompt.id;
    const currentDraft = drafts.get(promptId);
    const revision = currentDraft?.revision ?? 0;
    const notes = currentDraft?.notes ?? "";

    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(promptId, { code, notes, revision });
      return next;
    });

    scheduleSave(promptId, code, notes, revision);
  }, [activePrompt, drafts, isExpired, isFinishing, scheduleSave]);

  const handleNotesChange = useCallback((notes: string) => {
    if (isExpired || isFinishing) return;

    const promptId = activePrompt.id;
    const currentDraft = drafts.get(promptId);
    const revision = currentDraft?.revision ?? 0;
    const code = currentDraft?.code ?? "";

    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(promptId, { code, notes, revision });
      return next;
    });

    scheduleSave(promptId, code, notes, revision);
  }, [activePrompt, drafts, isExpired, isFinishing, scheduleSave]);

  // ---------------------------------------------------------------------------
  // Navigation: save draft before switching tabs (AC09)
  // ---------------------------------------------------------------------------
  const switchPrompt = useCallback(async (index: number) => {
    if (index === activePromptIndex) return;

    const currentPromptId = activePrompt.id;
    const currentDraft = drafts.get(currentPromptId);
    if (currentDraft) {
      setSaveStatus("saving");
      const result = await saveDraft({
        sessionId,
        sessionPromptId: currentPromptId,
        code: currentDraft.code,
        language,
        notes: currentDraft.notes,
        expectedRevision: currentDraft.revision,
      });
      if (result.ok) {
        setDrafts((prev) => {
          const next = new Map(prev);
          next.set(currentPromptId, { ...currentDraft, revision: result.data.revision });
          return next;
        });
        setSaveStatus("saved");
      }
    }

    setActivePromptIndex(index);
  }, [activePromptIndex, activePrompt, drafts, sessionId, language]);

  // Toggle flag for review
  const toggleFlag = useCallback((promptId: string) => {
    setFlaggedPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Clarification reveal (AC14)
  // ---------------------------------------------------------------------------
  const handleAskClarification = useCallback(async (branchId: string) => {
    const res = await revealClarification({
      sessionId,
      sessionPromptId: activePrompt.id,
      branchId,
    });

    if (res.ok) {
      setRevealedClarifications((prev) => {
        const next = new Map(prev);
        const list = next.get(activePrompt.id) || [];
        if (!list.some((c) => c.id === branchId)) {
          next.set(activePrompt.id, [...list, { id: branchId, question: res.data.question, answer: res.data.answer }]);
        }
        return next;
      });
    }
  }, [sessionId, activePrompt]);

  // ---------------------------------------------------------------------------
  // Follow-up reveal with immutable code snapshot (AC14)
  // ---------------------------------------------------------------------------
  const handleRevealFollowup = useCallback(async (followupId: string) => {
    const currentDraft = drafts.get(activePrompt.id);
    const code = currentDraft?.code || "";
    const notes = currentDraft?.notes || "";

    const res = await revealFollowup({
      sessionId,
      sessionPromptId: activePrompt.id,
      followupId,
      currentCode: code,
      currentNotes: notes,
    });

    if (res.ok) {
      setRevealedFollowups((prev) => {
        const next = new Map(prev);
        const list = next.get(activePrompt.id) || [];
        if (!list.some((f) => f.id === followupId)) {
          next.set(activePrompt.id, [...list, { id: followupId, question: res.data.question }]);
        }
        return next;
      });
    }
  }, [sessionId, activePrompt, drafts]);

  // ---------------------------------------------------------------------------
  // Coached practice conversion (AC15)
  // ---------------------------------------------------------------------------
  const handleConvert = useCallback(async () => {
    const res = await convertToPractice({
      sessionId,
      reason: "Candidate converted to coached practice for hints/review",
    });

    if (res.ok) {
      setMode("practice");
      setIsAssisted(true);
      setShowConvertModal(false);
      toast.success("Converted — now coached, flagged assisted.");
    } else {
      toast.error("Conversion failed.");
    }
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Finalize / Submit (AC10, AC12)
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(async (finishReason: "submitted" | "timeout" = "submitted") => {
    if (isFinishing) return;
    setIsFinishing(true);

    const finalDrafts = prompts.map((p) => {
      const draft = drafts.get(p.id);
      return {
        sessionPromptId: p.id,
        code: draft?.code ?? "",
        language,
        notes: draft?.notes ?? "",
        expectedRevision: draft?.revision ?? 0,
      };
    });

    const result = await finalizeSession({
      sessionId,
      finishReason,
      expectedVersion: sessionVersion,
      requestId: crypto.randomUUID(),
      finalDrafts,
    });

    if (result.ok) {
      toast.success("Attempt finalized — opening debrief.");
      router.push(`/debrief/${sessionId}`);
    } else {
      setIsFinishing(false);
      toast.error("Finalize failed — retry.");
      alert(`Finalization failed: ${!result.ok ? result.message : "Unknown error"}`);
    }
  }, [isFinishing, prompts, drafts, sessionId, sessionVersion, language, router]);

  // Timer values
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timerColor = remainingSeconds <= 300
    ? "text-danger timer-urgent"
    : remainingSeconds <= 600
    ? "text-warning"
    : "text-foreground";
  const isStrict = mode !== "practice" && !isAssisted;

  const currentDraft = drafts.get(activePrompt?.id ?? "");
  const activeClarifications = revealedClarifications.get(activePrompt?.id) || [];
  const activeFollowups = revealedFollowups.get(activePrompt?.id) || [];

  return (
    <div className="animate-rise flex min-h-[620px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm md:h-[calc(100vh-170px)] md:flex-row">
      {/* Left Sidebar: Multi-Question Navigation (AC09) */}
      <aside className="flex shrink-0 flex-col border-b border-border bg-surface-muted/40 md:w-64 md:border-b-0 md:border-r xl:w-72">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-xs uppercase tracking-wider text-muted">
              {stage.replace(/_/g, " ")} Set
            </h2>
            <span className="text-[11px] text-foreground/70">
              {prompts.length} {prompts.length === 1 ? "Question" : "Questions"}
            </span>
          </div>
          {isAssisted && (
            <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
              Assisted
            </span>
          )}
        </div>

        {/* Question List */}
        <nav className="flex flex-row gap-1.5 overflow-x-auto p-3 md:flex-1 md:flex-col md:space-y-1.5 md:overflow-y-auto md:overflow-x-hidden" aria-label="Questions">
          {prompts.map((p, i) => {
            const hasDraft = (drafts.get(p.id)?.code || "").trim().length > 0;
            const isFlagged = flaggedPrompts.has(p.id);

            return (
              <button
                key={p.id}
                onClick={() => switchPrompt(i)}
                aria-current={i === activePromptIndex ? "true" : undefined}
                className={`pressable w-full rounded-xl border p-3 text-left text-xs transition-[border-color,background-color,box-shadow] duration-160 ease-out ${
                  i === activePromptIndex
                    ? "border-primary/40 bg-primary/[0.07] shadow-xs"
                    : "border-transparent hover:border-border hover:bg-surface"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-bold">Q{p.displayOrder + 1}</span>
                  <div className="flex items-center gap-1.5">
                    {isFlagged && (
                      <Bookmark className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      hasDraft ? "bg-success/10 text-success" : "bg-muted/10 text-muted"
                    }`}>
                      {hasDraft ? "Drafting" : "Unattempted"}
                    </span>
                  </div>
                </div>
                <div className="truncate text-foreground/80 font-medium">
                  {p.candidateSnapshot.statement.slice(0, 45)}...
                </div>
              </button>
            );
          })}
        </nav>

        {/* Actions & Policy */}
        <div className="p-4 border-t border-border space-y-3 bg-surface/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">Conditions</span>
            {!isAssisted && (
              <button
                onClick={() => setShowConvertModal(true)}
                className="text-[11px] text-primary hover:underline"
              >
                Need hint?
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px] text-muted">
            <span className={resourcePolicy.docs ? "text-success" : "text-danger"}>
              {resourcePolicy.docs ? "✓" : "✗"} Docs
            </span>
            <span className={resourcePolicy.ai && !isAssisted ? "text-success" : isAssisted ? "text-warning" : "text-danger"}>
              {isAssisted ? "🤝 AI Allowed" : resourcePolicy.ai ? "✓ AI" : "✗ AI"}
            </span>
            <span className={isAssisted || resourcePolicy.hints ? "text-success" : "text-danger"}>
              {isAssisted || resourcePolicy.hints ? "✓ Hints" : "✗ Hints"}
            </span>
            <span className="text-success">✓ Notes</span>
          </div>
          {isStrict && (
            <p className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10.5px] leading-relaxed text-muted">
              Strict#{prompts.length > 1 ? " — each question" : ""} timed by the server clock. Refreshing never
              resets the deadline; late edits are ignored at finalize.
            </p>
          )}
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex min-w-0 flex-1 flex-col bg-background/60">
        {/* Top Header */}
        <header className="glass flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5">
              <Clock className="h-4 w-4 text-muted" />
              <span className={`font-mono text-[15px] font-semibold tabular-nums ${timerColor}`} role="timer" aria-live="off">
                {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
              </span>
            </div>

            <SaveStatusIndicator status={saveStatus} />

            {isExpired && (
              <span className="rounded border border-danger/20 bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                Deadline Reached (Server Locked)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => toggleFlag(activePrompt.id)}
              className={`pressable inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${
                flaggedPrompts.has(activePrompt.id)
                  ? "bg-warning/10 border-warning/30 text-warning"
                  : "border-border bg-surface hover:bg-surface-hover text-muted"
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${flaggedPrompts.has(activePrompt.id) ? "fill-warning" : ""}`} />
              <span>{flaggedPrompts.has(activePrompt.id) ? "Flagged" : "Flag for Review"}</span>
            </button>

            <button
              onClick={() => handleSubmit(isExpired ? "timeout" : "submitted")}
              disabled={isFinishing}
              className="pressable rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:brightness-110 disabled:opacity-50"
            >
              {isFinishing ? "Submitting…" : isExpired ? "Submit final attempt" : "Finish & submit"}
            </button>
          </div>
        </header>

        {/* Strict-conditions lockdown strip (UI-only; server enforces deadline/resources) */}
        {isStrict ? (
          <div className="flex items-center gap-2 border-b border-border bg-surface-muted/50 px-4 py-1.5 text-[11px] text-muted" role="status">
            <Clock className="h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              <span className="font-semibold text-foreground">Strict {stage.replace(/_/g, " ")} conditions</span>
              {" — hints & AI disabled · refresh-safe · deadline enforced by server clock"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-4 py-1.5 text-[11px] text-warning" role="status">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>Coached practice — assisted. This attempt is excluded from strict unseen benchmarks.</span>
          </div>
        )}

        {/* Split: Prompt & Authoring Panel | Editor */}
        <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* Prompt Panel */}
          <div className="w-full shrink-0 space-y-5 border-b border-border bg-surface/60 p-5 lg:w-[400px] lg:overflow-y-auto lg:border-b-0 lg:border-r xl:w-[440px]">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs font-bold text-primary">
                  Question {activePrompt.displayOrder + 1}
                </span>
                <span className="text-xs text-muted">({activePrompt.promptId})</span>
              </div>
              <h1 className="text-base font-semibold leading-snug">
                {activePrompt.candidateSnapshot.statement}
              </h1>
            </div>

            {/* Constraints */}
            {activePrompt.candidateSnapshot.constraints && activePrompt.candidateSnapshot.constraints.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  Constraints
                </h3>
                <ul className="space-y-1 text-xs text-foreground/80 list-disc list-inside">
                  {activePrompt.candidateSnapshot.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Examples */}
            {activePrompt.candidateSnapshot.examples && activePrompt.candidateSnapshot.examples.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  Examples
                </h3>
                <div className="space-y-2">
                  {activePrompt.candidateSnapshot.examples.map((ex, i) => (
                    <div key={i} className="p-3 bg-surface rounded-lg border border-border text-xs space-y-1">
                      <div><span className="text-muted">Input: </span><code className="font-mono font-semibold">{ex.input}</code></div>
                      <div><span className="text-muted">Expected: </span><code className="font-mono font-semibold">{ex.expected}</code></div>
                      {ex.explanation && (
                        <div className="text-[11px] text-muted pt-0.5">{ex.explanation}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Authored Clarification Branches (§8.3, AC14) */}
            {activePrompt.candidateSnapshot.availableClarifications &&
             activePrompt.candidateSnapshot.availableClarifications.length > 0 && (
              <div className="p-4 rounded-xl border border-primary/25 bg-primary/[0.06] space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <HelpCircle className="w-4 h-4" />
                  <span>Clarification Questions (Interviewer Script)</span>
                </div>
                <div className="space-y-2">
                  {activePrompt.candidateSnapshot.availableClarifications.map((cl) => {
                    const revealed = activeClarifications.find((c) => c.id === cl.id);

                    return (
                      <div key={cl.id} className="p-2.5 rounded-lg border border-border bg-surface text-xs space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-foreground">{cl.question}</span>
                          {!revealed ? (
                            <button
                              onClick={() => handleAskClarification(cl.id)}
                              className="pressable px-2 py-0.5 text-[10px] font-semibold rounded bg-primary text-primary-foreground hover:brightness-110 shrink-0"
                            >
                              Ask
                            </button>
                          ) : (
                            <span className="text-[10px] text-success font-semibold shrink-0">Answered</span>
                          )}
                        </div>
                        {revealed && (
                          <div className="text-[11px] text-foreground/80 bg-background/80 p-2 rounded border border-border/50">
                            {revealed.answer}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Follow-Up / Changed Constraint (§9.1, AC14) */}
            <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-warning">
                <GitBranch className="w-4 h-4" />
                <span>Changed-Constraint Follow-Up</span>
              </div>

              {activeFollowups.length > 0 ? (
                <div className="space-y-2">
                  {activeFollowups.map((f) => (
                    <div key={f.id} className="space-y-1 rounded-lg border border-warning/30 bg-surface p-3 text-xs">
                      <div className="font-semibold text-warning">Adapted Requirement:</div>
                      <p className="text-foreground">{f.question}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted">
                    When you have completed your core solution, reveal the interviewer&apos;s changed constraint.
                    A permanent code snapshot of your baseline will be captured automatically.
                  </p>
                  <button
                    onClick={() => handleRevealFollowup("fup-occurrence-indexes")}
                    className="pressable flex w-full items-center justify-center gap-2 rounded-lg border border-warning/30 bg-surface px-3 py-2 text-xs font-medium text-warning hover:bg-surface-hover"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Snapshot Code & Reveal Follow-Up</span>
                  </button>
                </div>
              )}
            </div>

            {/* Scratchpad Notes */}
            {resourcePolicy.notes && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                  Scratchpad & Approach Notes
                </h3>
                <textarea
                  value={currentDraft?.notes ?? ""}
                  onChange={(e) => handleNotesChange(e.target.value)}
                  disabled={isExpired || isFinishing}
                  placeholder="Record edge cases, algorithmic complexity, invariants..."
                  className="w-full h-32 p-3 bg-surface border border-border rounded-lg text-xs resize-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
              </div>
            )}
          </div>

          {/* Editor Area */}
          <div className="relative min-h-[480px] flex-1 bg-[#131311] p-3 lg:overflow-hidden">
            <Suspense fallback={
              <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-xs text-muted">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
                Loading workspace…
              </div>
            }>
              <CodeEditor
                value={currentDraft?.code ?? ""}
                language={language}
                onChange={handleCodeChange}
                disabled={isExpired || isFinishing}
              />
            </Suspense>
            {isExpired && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm" role="status">
                <div className="max-w-sm rounded-xl border border-border bg-surface p-5 text-center shadow-md">
                  <p className="font-display text-[15px] font-semibold">Deadline reached</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Work is frozen at the pre-deadline state — late edits are ignored.
                    Submit your final attempt to open the debrief.
                  </p>
                  <Button size="sm" className="mt-3" onClick={() => handleSubmit("timeout")} disabled={isFinishing}>
                    {isFinishing ? "Submitting…" : "Submit final attempt"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Convert to Coached Practice (AC15) */}
      <Dialog open={showConvertModal} onOpenChange={setShowConvertModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <Sparkles className="h-4 w-4" /> Convert to coached practice?
            </DialogTitle>
            <DialogDescription>
              Unlocks hints but permanently flags this attempt as assisted. Excluded from strict unseen benchmarks (§8.3, AC15).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConvertModal(false)}>
              Keep strict
            </Button>
            <Button variant="warning" onClick={handleConvert}>
              Confirm conversion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version conflict (AC11) */}
      <Dialog open={showConflictModal} onOpenChange={setShowConflictModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <AlertTriangle className="h-4 w-4" /> Draft conflict
            </DialogTitle>
            <DialogDescription>
              Another tab saved a newer revision. Overwrite with your editor or reload the server version — no silent loss.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowConflictModal(false);
                router.refresh();
              }}
            >
              Reload server
            </Button>
            <Button
              onClick={() => {
                setShowConflictModal(false);
                const pId = activePrompt.id;
                const d = drafts.get(pId);
                if (d) scheduleSave(pId, d.code, d.notes, d.revision + 1);
                toast.success("Overwrite queued.");
              }}
            >
              Overwrite with mine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const config: Record<SaveStatus, { label: string; color: string }> = {
    idle: { label: "", color: "" },
    saving: { label: "Saving…", color: "text-warning" },
    saved: { label: "Saved", color: "text-success" },
    error: { label: "Save failed", color: "text-danger" },
    conflict: { label: "Conflict detected", color: "text-danger" },
  };

  const c = config[status];
  if (!c.label) return null;

  return (
    <span className={`text-xs font-mono font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}
