"use client";

/**
 * Preflight — staged start flow:
 * 1 Verify conditions → 2 Declare familiarity → 3 Start.
 * Same session-start transaction, upgraded presentation.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  ShieldCheck,
  AlertTriangle,
  Play,
  FileText,
  BookOpen,
  Bot,
  Lightbulb,
  NotebookPen,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
} from "lucide-react";
import { motion } from "motion/react";
import { startSession } from "@/features/sessions/actions";
import type { Familiarity } from "@/features/sessions/types";
import type { CandidateSafePackSnapshot } from "@/features/curriculum/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/button";
import { RadixProgress } from "@/components/ui/progress-radix";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/components/ui/cn";

interface PreflightPromptItem {
  id: string;
  promptId: string;
  displayOrder: number;
  familyIds: string[];
  difficulty: string;
}

interface PreflightProps {
  sessionId: string;
  sessionVersion: number;
  pack: CandidateSafePackSnapshot;
  prompts: PreflightPromptItem[];
}

const FAMILIARITY: Array<{ id: Familiarity; label: string; hint: string; icon: typeof Eye }> = [
  { id: "unseen_declared", label: "Unseen", hint: "Never solved", icon: EyeOff },
  { id: "familiar", label: "Familiar", hint: "Solved/studied", icon: Eye },
  { id: "unknown", label: "Unsure", hint: "Can't recall", icon: HelpCircle },
];

export default function Preflight({ sessionId, sessionVersion, pack, prompts }: PreflightProps) {
  const router = useRouter();
  const [declarations, setDeclarations] = useState<Record<string, Familiarity>>(() => {
    const initial: Record<string, Familiarity> = {};
    for (const p of prompts) initial[p.promptId] = "unseen_declared";
    return initial;
  });
  const [readyChecks, setReadyChecks] = useState({ environment: false, timer: false, policy: false });
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const checksDone = Object.values(readyChecks).filter(Boolean).length;
  const allChecksReady = checksDone === 3;
  const unseenCount = Object.values(declarations).filter((d) => d === "unseen_declared").length;

  const handleDeclarationChange = useCallback((promptId: string, value: Familiarity) => {
    setDeclarations((prev) => ({ ...prev, [promptId]: value }));
  }, []);

  const handleStart = useCallback(async () => {
    if (isStarting || !allChecksReady) return;
    setIsStarting(true);
    setErrorMessage("");
    const declarationsArray = Object.entries(declarations).map(([promptId, familiarity]) => ({
      promptId,
      familiarity,
    }));
    const result = await startSession({
      sessionId,
      expectedVersion: sessionVersion,
      requestId: crypto.randomUUID(),
      declarations: declarationsArray,
    });
    if (result.ok) {
      toast.success("Session started — timer running.");
      router.refresh();
    } else {
      setIsStarting(false);
      const msg = !result.ok ? result.message : "Failed to start session";
      setErrorMessage(msg);
      toast.error(msg);
    }
  }, [isStarting, allChecksReady, sessionId, sessionVersion, declarations, router]);

  const policies = [
    { key: "docs", label: "Docs / search", allowed: pack.resourcePolicy.docs, icon: BookOpen },
    { key: "ai", label: "AI generation", allowed: pack.resourcePolicy.ai, icon: Bot },
    { key: "hints", label: "Solution hints", allowed: pack.resourcePolicy.hints, icon: Lightbulb },
    { key: "notes", label: "Scratchpad", allowed: pack.resourcePolicy.notes, icon: NotebookPen },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 pb-12">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="blue">{pack.stage.replace(/_/g, " ")} · preflight</Badge>
          <span className="font-mono text-[11px] text-muted">
            {pack.id} · v{pack.version}
          </span>
        </div>
        <h1 className="mt-2 text-balance text-[26px] font-semibold leading-tight tracking-tight">{pack.title}</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted">{pack.instructions}</p>

        {/* Stepper */}
        <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Preflight steps">
          {[
            { n: 1, label: "Verify", done: allChecksReady },
            { n: 2, label: "Declare", done: true },
            { n: 3, label: "Start", done: false },
          ].map((s) => (
            <li
              key={s.n}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5",
                s.done ? "border-success/30 bg-success/[0.07]" : "border-border bg-surface"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  s.done ? "bg-success text-white" : "bg-surface-muted text-muted"
                )}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : s.n}
              </span>
              <span className="text-[13px] font-medium">{s.label}</span>
            </li>
          ))}
        </ol>
      </motion.div>

      {/* Timing + policy */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06 }}>
          <Card className="h-full p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-primary" /> Timebox
            </h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <dt className="text-muted">Assessment</dt>
                <dd className="font-mono font-semibold">{pack.durationMinutes}m</dd>
              </div>
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <dt className="text-muted">Debrief</dt>
                <dd className="font-mono font-semibold">{pack.debriefMinutes}m</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Total slot</dt>
                <dd className="font-mono font-bold text-primary">{pack.durationMinutes + pack.debriefMinutes}m</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              Server clock governs. Timer can&apos;t pause — timeout freezes last saved drafts.
            </p>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }}>
          <Card className="h-full p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-success" /> Resource policy
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {policies.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.key}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2.5",
                      p.allowed ? "border-success/30 bg-success/[0.07]" : "border-danger/30 bg-danger/[0.07]"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", p.allowed ? "text-success" : "text-danger")} />
                    <div>
                      <p className={cn("text-[12px] font-semibold", p.allowed ? "text-success" : "text-danger")}>
                        {p.allowed ? "Allowed" : "Blocked"}
                      </p>
                      <p className="text-[11px] text-muted">{p.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {!pack.resourcePolicy.hints && (
              <p className="mt-2.5 text-[11px] text-muted">Need a hint mid-strict? Convert to coached practice inside the arena.</p>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Familiarity */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }}>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" /> Familiarity declaration
            </h2>
            <Badge tone={unseenCount === prompts.length ? "emerald" : "amber"}>
              {unseenCount}/{prompts.length} unseen
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted">Honest declarations protect your readiness metrics. The reveal freezes this status.</p>
          <div className="mt-3 space-y-2.5">
            {prompts.map((p, idx) => (
              <div key={p.promptId} className="rounded-xl border border-border/70 bg-background p-3.5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-primary">Q{idx + 1}</span>
                  <span className="font-mono text-[11px] text-muted">{p.promptId}</span>
                  <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted">
                    {p.difficulty} · {p.familyIds.join(", ")}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Familiarity for ${p.promptId}`}>
                  {FAMILIARITY.map((f) => {
                    const active = (declarations[p.promptId] || "unseen_declared") === f.id;
                    const Icon = f.icon;
                    return (
                      <button
                        key={f.id}
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleDeclarationChange(p.promptId, f.id)}
                        className={cn(
                          "pressable flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2",
                          active
                            ? "border-primary bg-primary/[0.08] text-foreground shadow-xs"
                            : "border-border text-muted hover:border-border-strong hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span className="text-[12px] font-semibold">{f.label}</span>
                        <span className="text-[10px]">{f.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Checklist */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.24 }}>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Readiness checklist</h2>
            <span className="font-mono text-[11px] text-muted">{checksDone}/3</span>
          </div>
          <div className="mt-2">
            <RadixProgress value={(checksDone / 3) * 100} />
          </div>
          <div className="mt-3 space-y-1.5">
            {[
              { key: "environment" as const, label: "Quiet, dedicated environment — distractions away." },
              { key: "timer" as const, label: `The ${pack.durationMinutes}-minute countdown starts now and can't pause.` },
              { key: "policy" as const, label: "I'll follow the resource policy and declare assistance honestly." },
            ].map((c) => {
              const on = readyChecks[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => setReadyChecks((p) => ({ ...p, [c.key]: !p[c.key] }))}
                  aria-pressed={on}
                  className={cn(
                    "pressable flex w-full items-center gap-3 rounded-xl border p-3 text-left",
                    on ? "border-success/30 bg-success/[0.07]" : "border-border hover:border-border-strong"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color] duration-160 ease-out",
                      on ? "border-success bg-success text-white" : "border-border-strong text-transparent"
                    )}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[13px]">{c.label}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {errorMessage && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/[0.07] p-3.5 text-xs text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorMessage}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pb-2">
        <Tip label="Harmless sample — clock hasn't started">
          <span className="text-[11px] text-muted">Nothing is timed until you press start.</span>
        </Tip>
        <Button size="md" disabled={!allChecksReady || isStarting} onClick={handleStart} className="min-w-[240px]">
          <Play className="fill-current" />
          {isStarting ? "Starting…" : `Start ${pack.durationMinutes}m session`}
        </Button>
      </div>
      {!allChecksReady && (
        <p className="text-right text-[11px] text-muted">Complete the 3 checklist items to unlock start.</p>
      )}
    </div>
  );
}
