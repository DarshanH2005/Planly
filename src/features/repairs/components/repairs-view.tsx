"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Wrench,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Play,
  Clock,
  Check,
} from "lucide-react";
import type { EnrichedRepair } from "../service";
import type { RepairState } from "@/features/reviews/types";
import { transitionRepairAction } from "../actions";
import { motion } from "motion/react";
import { toast } from "@/components/ui/sonner";

interface RepairsViewProps {
  initialActive: EnrichedRepair[];
  initialResolved: EnrichedRepair[];
}

export function RepairsView({ initialActive, initialResolved }: RepairsViewProps) {
  const [activeRepairs, setActiveRepairs] = useState<EnrichedRepair[]>(initialActive);
  const [resolvedRepairs, setResolvedRepairs] = useState<EnrichedRepair[]>(initialResolved);
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleStateChange = (repairId: string, nextState: RepairState, params?: { drillTaskId?: string; retestSessionId?: string; closureResult?: string }) => {
    startTransition(async () => {
      const res = await transitionRepairAction(repairId, nextState, params);
      if (res.ok) {
        toast.success(`Repair → ${nextState}`);
        setStatusMessage(`Repair ${repairId} successfully transitioned to '${nextState}'`);
        setTimeout(() => setStatusMessage(null), 3000);

        if (nextState === "improved" || nextState === "deferred") {
          setActiveRepairs((prev) => prev.filter((r) => r.id !== repairId));
          setResolvedRepairs((prev) => [res.data, ...prev]);
        } else {
          setActiveRepairs((prev) =>
            prev.map((r) => (r.id === repairId ? res.data : r))
          );
        }
      } else {
        toast.error("Transition failed");
        setStatusMessage(`Transition failed: ${res.message}`);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    });
  };

  const PIPELINE_STEPS: RepairState[] = ["proposed", "scheduled", "drilled", "retested", "improved"];

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* Top Banner */}
      <div className="animate-rise flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">Repairs & retests</h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              drill → retest → transfer
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            One open repair per weakness. Drills need linked attempts; retests need unfamiliar prompts.
          </p>
        </div>

        <div className="text-xs text-muted flex items-center gap-2">
          <span className="font-mono font-medium text-foreground">{activeRepairs.length}</span> active repairs ·{" "}
          <span className="font-mono font-medium text-success">{resolvedRepairs.length}</span> resolved
        </div>
      </div>

      {statusMessage && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-xs text-muted-strong">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="pressable hover:underline">Dismiss</button>
        </div>
      )}

      {/* Active Repairs Section */}
      <div className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-amber-500" />
          <span>Active Weakness Repairs ({activeRepairs.length})</span>
        </h2>

        {activeRepairs.length > 0 ? (
          <div className="space-y-4">
            {activeRepairs.map((repair, idx) => {
              const currentStepIdx = PIPELINE_STEPS.indexOf(repair.state);
              return (
                <motion.div
                  key={repair.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: idx * 0.06 }}
                  className="card-lift pressable rounded-xl border border-border bg-surface p-5 space-y-4 shadow-xs"
                >
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-md bg-amber-100 dark:bg-amber-950 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                        {repair.competencyKey}
                      </span>
                      <span className="text-xs font-medium text-foreground">
                        Repair #{repair.id}
                      </span>
                    </div>

                    {/* Step progress pills */}
                    <div className="flex items-center gap-1 text-[11px]">
                      {PIPELINE_STEPS.map((step, idx) => {
                        const isDone = idx < currentStepIdx;
                        const isCurrent = idx === currentStepIdx;
                        return (
                          <span
                            key={step}
                            className={`px-2 py-0.5 rounded capitalize ${
                              isCurrent
                                ? "bg-foreground text-background font-medium"
                                : isDone
                                ? "bg-emerald-100 dark:bg-emerald-950 text-success"
                                : "bg-surface-muted text-muted"
                            }`}
                          >
                            {step}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Diagnosis & Trigger */}
                  <div className="space-y-2 text-xs">
                    <div>
                      <strong className="text-foreground">Diagnostic Hypothesis: </strong>
                      <span className="text-muted">{repair.hypothesis}</span>
                    </div>
                    <div>
                      <strong className="text-foreground">Trigger Evidence: </strong>
                      <span className="text-muted">{repair.triggerDescription} (</span>
                      {repair.triggerEvidenceIds.map((id, i) => (
                        <span key={id}>
                          <Link href="/evidence" className="font-mono text-primary underline decoration-dotted underline-offset-2 hover:brightness-110" title="Open evidence">
                            {id}
                          </Link>
                          {i < repair.triggerEvidenceIds.length - 1 ? ", " : ""}
                        </span>
                      ))}
                      <span className="text-muted">)</span>
                    </div>
                  </div>

                  {/* Prescribed Drill & Retest Box */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="p-3.5 rounded-lg bg-surface-muted border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Prescribed Drill
                        </span>
                        {repair.drillTaskId && (
                          <span className="text-[10px] font-mono text-success">
                            Linked: {repair.drillTaskId}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground font-medium">
                        {repair.drillType}
                      </p>
                      <div className="pt-2">
                        {repair.state === "scheduled" && (
                          <div className="space-y-2">
                            <p className="text-[11px] text-muted">
                              Complete the prescribed drill through a timed Arena session.
                              The drill attempt ID will be linked automatically.
                            </p>
                            <Link
                              href={`/arena?repair=${repair.id}&mode=drill`}
                              className="inline-flex items-center gap-1.5 rounded bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
                            >
                              <Play className="h-3 w-3" />
                              <span>Start Drill Session</span>
                            </Link>
                          </div>
                        )}
                        {repair.state === "proposed" && (
                          <button
                            onClick={() => handleStateChange(repair.id, "scheduled")}
                            disabled={isPending}
                            className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                          >
                            <span>Schedule into Sprint</span>
                          </button>
                        )}
                        {repair.state === "drilled" && (
                          <span className="text-xs text-success flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Drill Completed with Linked Attempt (AC17)</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-surface-muted border border-border space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block">
                        Unfamiliar Retest Requirement (AC18)
                      </span>
                      <p className="text-xs text-foreground font-medium">
                        {repair.retestRequirement}
                      </p>
                      <div className="pt-2">
                        {repair.state === "drilled" && (
                          <div className="space-y-2">
                            <p className="text-[11px] text-muted">
                              Complete an unfamiliar retest through a distinct Arena session.
                              Must be unseen and unassisted for valid transfer evidence.
                            </p>
                            <Link
                              href={`/arena?repair=${repair.id}&mode=retest`}
                              className="inline-flex items-center gap-1.5 rounded bg-accent text-accent-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 shadow-sm"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>Start Unfamiliar Retest</span>
                            </Link>
                          </div>
                        )}
                        {repair.state === "retested" && (
                          <div className="space-y-2">
                            <p className="text-[11px] text-muted">
                              Review the retest session first, then verify the closure criterion was met.
                            </p>
                            <button
                              onClick={() =>
                                handleStateChange(repair.id, "improved", {
                                  closureResult: `Closure criterion verified through retest session ${repair.retestSessionId}.`,
                                })
                              }
                              disabled={isPending || !repair.retestSessionId}
                              title={!repair.retestSessionId ? "Blocked: qualifying unfamiliar retest required before closure" : "Close with verified retest evidence"}
                              className="pressable inline-flex items-center gap-1.5 rounded bg-success px-3 py-1.5 text-xs font-medium text-white hover:brightness-95 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" />
                              <span>Verify Closure &amp; Close</span>
                            </button>
                            {!repair.retestSessionId && (
                              <p className="text-[11px] text-muted">
                                Blocked: link a qualifying unfamiliar retest session first — closure without retest is rejected.
                              </p>
                            )}
                          </div>
                        )}
                        {(repair.state === "proposed" || repair.state === "scheduled") && (
                          <span className="text-[11px] text-muted">
                            Retest unlocks after linked drill completion (§10.2).
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Closure Criterion */}
                  <div className="pt-2 border-t border-border text-[11px] text-muted flex items-center justify-between">
                    <span>
                      <strong className="text-foreground">Closure Criterion: </strong>
                      {repair.closureCriterion}
                    </span>
                    <span className="font-mono">v{repair.version}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 rounded-xl border border-dashed border-border bg-surface text-center text-xs text-muted">
            No active repairs open. Weakness remediation paths open upon observed session failures.
          </div>
        )}
      </div>

      {/* Resolved Repairs Archive */}
      {resolvedRepairs.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-border">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            <span>Resolved &amp; Improved Weaknesses ({resolvedRepairs.length})</span>
          </h2>

          <div className="space-y-2">
            {resolvedRepairs.map((r) => (
              <div
                key={r.id}
                className="p-4 rounded-lg border border-border bg-surface-muted text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground uppercase">
                      {r.competencyKey}
                    </span>
                    <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                      IMPROVED
                    </span>
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">
                    Result: {r.closureResult}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-muted">
                  Retest: {r.retestSessionId ? (
                    <Link href={`/debrief/${r.retestSessionId}`} className="text-primary underline decoration-dotted underline-offset-2 hover:brightness-110">
                      {r.retestSessionId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
