"use client";

/**
 * Debrief View — Review Submission
 *
 * PLANLY_BUILD_SPEC.md §9.2, §10: Shows frozen attempts
 * and rubric for self-review submission.
 */

import { useState, useCallback } from "react";
import { motion } from "motion/react";
import { submitReview } from "@/features/reviews/actions";
import { RUBRIC_DIMENSIONS } from "@/features/reviews/types";
import type { RubricFamily } from "@/features/reviews/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

interface DebriefViewProps {
  sessionId: string;
  session: {
    stage: string;
    mode: string;
    finishReason: string;
    startedAt: string;
    deadlineAt: string;
    finalizedAt: string;
    packId: string;
    rubricId: string;
    rubricVersion: number;
    isInterrupted: boolean;
    isAssisted: boolean;
  };
  prompts: Array<{
    id: string;
    promptId: string;
    displayOrder: number;
    candidateSnapshot: { title: string; description: string } | null;
  }>;
  attempts: Array<{
    id: string;
    sessionPromptId: string;
    frozenCode: string;
    frozenLanguage: string;
    frozenNotes: string;
    finalizedAt: string;
  }>;
  existingReviews: Array<{
    id: string;
    revision: number;
    status: string;
  }>;
  existingEvidence: Array<{
    id: string;
    competencyKey: string;
    dimension: string;
    rating: number | null;
    observation: string;
  }>;
  isReviewed: boolean;
}

type Rating = 0 | 1 | 2 | 3 | null;

interface EvidenceEntry {
  competencyKey: string;
  dimension: string;
  rating: Rating;
  observation: string;
}

export default function DebriefView({
  sessionId,
  session,
  prompts,
  attempts,
  existingReviews,
  existingEvidence,
  isReviewed,
}: DebriefViewProps) {
  const [activeTab, setActiveTab] = useState<"code" | "review">("code");
  const [activePromptIndex, setActivePromptIndex] = useState(0);

  // Review form state
  const applicableDimensions = getApplicableDimensions(session.stage);
  const [evidence, setEvidence] = useState<EvidenceEntry[]>(() =>
    applicableDimensions.map((d) => {
      const existing = existingEvidence.find(
        (e) => e.competencyKey === d.dimension && e.dimension === d.dimension
      );
      return {
        competencyKey: d.dimension,
        dimension: d.dimension,
        rating: (existing?.rating as Rating) ?? null,
        observation: existing?.observation ?? "",
      };
    })
  );

  // Learning card
  const [learningCard, setLearningCard] = useState({
    initialIdea: "",
    failure: "",
    correctedInsight: "",
    lesson: "",
  });

  // Repair or no-action
  const [noActionReason, setNoActionReason] = useState("");
  const [createRepair, setCreateRepair] = useState(false);
  const [repairHypothesis, setRepairHypothesis] = useState("");
  const [closureCriterion, setClosureCriterion] = useState("");
  const [repairCompetency, setRepairCompetency] = useState<string>("implementation");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  // Get the first attempt for the learning card
  const firstAttempt = attempts[0];

  // ---------------------------------------------------------------------------
  // Update evidence
  // ---------------------------------------------------------------------------
  const updateEvidence = useCallback((index: number, updates: Partial<EvidenceEntry>) => {
    setEvidence((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Submit review
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitMessage("");

    const result = await submitReview({
      sessionId,
      requestId: crypto.randomUUID(),
      rubricId: session.rubricId,
      rubricVersion: session.rubricVersion,
      evidence: evidence.map((e) => ({
        attemptId: firstAttempt?.id ?? null,
        competencyKey: e.competencyKey,
        dimension: e.dimension,
        rating: e.rating,
        observation: e.observation,
      })),
      learningCard: {
        attemptId: firstAttempt?.id ?? "",
        initialIdea: learningCard.initialIdea,
        failure: learningCard.failure,
        correctedInsight: learningCard.correctedInsight,
        lesson: learningCard.lesson,
      },
      repairProposal: createRepair ? {
        competencyKey: repairCompetency as any,
        hypothesis: repairHypothesis,
        closureCriterion,
      } : undefined,
      noActionReason: noActionReason || undefined,
    });

    setIsSubmitting(false);

    if (result.ok) {
      setSubmitMessage("Review submitted successfully.");
      toast.success(result.data.repairId ? "Review saved — repair proposed." : "Review saved.");
      window.location.reload();
    } else {
      setSubmitMessage(`Error: ${!result.ok ? result.message : "Unknown error"}`);
      toast.error("Review failed to save.");
    }
  }, [isSubmitting, sessionId, session, evidence, learningCard, createRepair, repairHypothesis, repairCompetency, closureCriterion, noActionReason, firstAttempt]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const currentPrompt = prompts[activePromptIndex];
  const currentAttempt = attempts.find((a) => a.sessionPromptId === currentPrompt?.id);

  const elapsed = session.startedAt && session.finalizedAt
    ? Math.round((new Date(session.finalizedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)
    : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* Session summary header */}
      <div className="animate-rise overflow-hidden rounded-[10px] border border-border bg-surface shadow-xs">
        <div className="h-[2px] bg-primary" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-tight">Session debrief</h1>
              <span className="rounded-full bg-surface-muted px-2.5 py-0.5 font-mono text-[11px] text-muted">
                {session.packId}
              </span>
              {session.isAssisted && (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
                  Assisted
                </span>
              )}
              {session.isInterrupted && (
                <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-0.5 text-[11px] font-semibold text-danger">
                  Interrupted
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              {session.stage} · {session.mode} · {session.finishReason} · rubric v{session.rubricVersion}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-2xl font-semibold tabular-nums">{elapsed}<span className="text-sm font-normal text-muted"> min</span></div>
              <div className="text-[11px] text-muted">elapsed · frozen</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab switch */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="code">Frozen code</TabsTrigger>
          <TabsTrigger value="review">Review & learning</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Code tab */}
      {activeTab === "code" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {/* Prompt navigation */}
          <div className="mb-4 flex gap-1.5">
            {prompts.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActivePromptIndex(i)}
                className={`pressable rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                  i === activePromptIndex
                    ? "bg-foreground text-background shadow-sm"
                    : "border border-border bg-surface text-muted hover:text-foreground"
                }`}
              >
                Q{p.displayOrder + 1}
              </button>
            ))}
          </div>

          {currentPrompt && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Prompt */}
              <div className="rounded-xl border border-border bg-surface p-5">
                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted">Prompt · Q{currentPrompt.displayOrder + 1}</p>
                <h3 className="text-[15px] font-semibold leading-snug">
                  {currentPrompt.candidateSnapshot?.title ?? currentPrompt.promptId}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                  {currentPrompt.candidateSnapshot?.description ?? ""}
                </p>
              </div>

              {/* Frozen attempt */}
              <div className="overflow-hidden rounded-xl border border-[#2C2C28] bg-[#131311]">
                <div className="flex items-center justify-between bg-[#1A1A18] px-4 py-2 text-xs text-[#A4A196]">
                  <span className="font-mono">frozen · {currentAttempt?.frozenLanguage ?? "python"}</span>
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">immutable</span>
                </div>
                <pre className="max-h-96 overflow-auto p-4 font-mono text-[13px] leading-relaxed text-[#F4F2EA]">
                  {currentAttempt?.frozenCode || "(blank answer — recorded as-is)"}
                </pre>
                {currentAttempt?.frozenNotes && (
                  <div className="border-t border-white/10 px-4 py-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#8A877D]">Notes</div>
                    <p className="whitespace-pre-wrap text-[13px] text-[#E4E1D8]">
                      {currentAttempt.frozenNotes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Review tab */}
      {activeTab === "review" && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-8">
          {/* Status banner */}
          {isReviewed && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-sm text-success">
              ✓ This session has been reviewed (revision {existingReviews.length}).
              You can submit a superseding review.
            </div>
          )}

          {/* Evidence observations */}
          <section>
            <h2 className="text-lg font-semibold mb-4">Rubric Evidence</h2>
            <div className="space-y-4">
              {evidence.map((e, i) => {
                const dim = applicableDimensions.find((d) => d.dimension === e.dimension);
                return (
                  <div key={e.dimension} className="p-4 bg-surface rounded-xl border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-sm capitalize">
                        {e.dimension.replace(/_/g, " ")}
                      </h3>
                      <RatingSelector
                        value={e.rating}
                        onChange={(r) => updateEvidence(i, { rating: r })}
                      />
                    </div>
                    {dim && (
                      <p className="text-xs text-muted mb-2">
                        2: {dim.rating2Criterion} · 3: {dim.rating3Extension}
                      </p>
                    )}
                    <textarea
                      value={e.observation}
                      onChange={(ev) => updateEvidence(i, { observation: ev.target.value })}
                      placeholder="Observation (required for any rating)..."
                      className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-20"
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Learning card */}
          <section>
            <h2 className="text-lg font-semibold mb-4">Learning Card</h2>
            <div className="p-4 bg-surface rounded-xl border border-border space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Initial Idea</label>
                <textarea
                  value={learningCard.initialIdea}
                  onChange={(e) => setLearningCard((p) => ({ ...p, initialIdea: e.target.value }))}
                  placeholder="What was your first approach?"
                  className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-16"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Failure / Mistake</label>
                <textarea
                  value={learningCard.failure}
                  onChange={(e) => setLearningCard((p) => ({ ...p, failure: e.target.value }))}
                  placeholder="What went wrong or what was missed?"
                  className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-16"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Corrected Insight</label>
                <textarea
                  value={learningCard.correctedInsight}
                  onChange={(e) => setLearningCard((p) => ({ ...p, correctedInsight: e.target.value }))}
                  placeholder="What's the correct approach?"
                  className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-16"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Lesson *</label>
                <textarea
                  value={learningCard.lesson}
                  onChange={(e) => setLearningCard((p) => ({ ...p, lesson: e.target.value }))}
                  placeholder="Key takeaway to remember..."
                  className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-16"
                />
              </div>
            </div>
          </section>

          {/* No-action reason */}
          <section>
            <h2 className="text-lg font-semibold mb-4">Repair Decision</h2>
            <div className="p-4 bg-surface rounded-xl border border-border">
              <label className="mb-3 flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={createRepair} onChange={(e) => setCreateRepair(e.target.checked)} />
                Create a targeted repair from this evidence
              </label>
              {createRepair && <div className="mb-4 grid gap-3">
                <select
                  value={repairCompetency}
                  onChange={(e) => setRepairCompetency(e.target.value)}
                  className="w-full rounded border border-border bg-background p-2 text-sm"
                >
                  <option value="pattern_selection">Pattern selection</option>
                  <option value="implementation">Implementation</option>
                  <option value="boundaries">Boundaries</option>
                  <option value="explanation">Explanation</option>
                  <option value="adaptation">Adaptation</option>
                  <option value="project_depth">Project depth</option>
                  <option value="behavioural_specificity">Behavioural specificity</option>
                </select>
                <textarea value={repairHypothesis} onChange={(e) => setRepairHypothesis(e.target.value)} placeholder="What specific weakness did the evidence show?" className="w-full rounded border border-border bg-background p-2 text-sm" />
                <textarea value={closureCriterion} onChange={(e) => setClosureCriterion(e.target.value)} placeholder="What must an unfamiliar retest demonstrate?" className="w-full rounded border border-border bg-background p-2 text-sm" />
              </div>}
              <label className="block text-sm font-medium mb-2">
                No-action reason (required if no repair proposal)
              </label>
              <textarea
                value={noActionReason}
                onChange={(e) => setNoActionReason(e.target.value)}
                placeholder="Why no repair is needed, e.g. 'Met criteria independently'"
                className="w-full p-2 bg-background border border-border rounded text-sm resize-none h-16"
              />
            </div>
          </section>

          {/* Submit */}
          <div className="flex items-center gap-4">
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              size="md"
            >
              {isSubmitting ? "Submitting…" : "Submit review"}
            </Button>
            {submitMessage && (
              <span className={`text-sm ${
                submitMessage.startsWith("Error") ? "text-danger" : "text-success"
              }`}>
                {submitMessage}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rating selector
// ---------------------------------------------------------------------------

function RatingSelector({
  value,
  onChange,
}: {
  value: Rating;
  onChange: (r: Rating) => void;
}) {
  const options: Array<{ label: string; val: Rating }> = [
    { label: "—", val: null },
    { label: "0", val: 0 },
    { label: "1", val: 1 },
    { label: "2", val: 2 },
    { label: "3", val: 3 },
  ];

  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {options.map((opt) => (
        <button
          key={String(opt.val)}
          onClick={() => onChange(opt.val)}
          role="radio"
          aria-checked={value === opt.val}
          title={opt.val === null ? "Not elicited" : `Rating ${opt.val}`}
          className={`pressable h-9 w-9 rounded-lg font-mono text-[13px] ${
            value === opt.val
              ? opt.val === null
                ? "bg-surface-muted text-foreground ring-2 ring-border-strong"
                : opt.val <= 1
                ? "bg-danger text-white shadow-xs"
                : opt.val === 2
                ? "bg-success text-white shadow-xs"
                : "bg-foreground text-background shadow-xs"
              : "border border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApplicableDimensions(stage: string) {
  let family: RubricFamily;
  switch (stage) {
    case "oa": family = "technical"; break;
    case "technical_a":
    case "technical_b": family = "technical"; break;
    case "engineering": family = "engineering"; break;
    case "project": family = "project"; break;
    case "behavioural": family = "behavioural"; break;
    default: family = "technical";
  }

  return RUBRIC_DIMENSIONS.filter((d) => d.family === family);
}
