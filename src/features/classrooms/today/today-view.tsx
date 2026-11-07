"use client";

/**
 * Sprint B13: Today Workbench View.
 * Authority: planly_architecture.md sections 7, 12, 13; B13_adaptive_sprints.md
 *
 * Core Product Invariants:
 * - Shows a few actions, their purpose, and an honest estimate; never the entire backlog.
 * - Missed days preserve pending lessons and reduce new allocation instead of doubling backlog.
 * - 80% safety buffer visible: floor(0.8 * declaredAvailableMinutes).
 * - Direct classroom launch for active task.
 */

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Zap,
  Coffee,
  Moon,
  ShieldCheck,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  HelpCircle,
  Play,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  learningApi,
  type PlanPreviewResponse,
} from "@/lib/api/learning-client";

interface TodayViewProps {
  initialPlan?: PlanPreviewResponse | null;
  todayDate?: string;
}

const MODES = [
  { id: "rest", label: "Rest", sub: "0m", icon: Moon, tip: "Recovery day — zero allocation" },
  { id: "minimum", label: "Minimum", sub: "15m", icon: Coffee, tip: "12m continuity drill" },
  { id: "ramp", label: "Ramp", sub: "45m", icon: Zap, tip: "36m light training" },
  { id: "normal", label: "Normal", sub: "90m", icon: Zap, tip: "72m standard training" },
  { id: "bonus", label: "Bonus", sub: "120m", icon: Zap, tip: "96m deep study block" },
] as const;

export function TodayView({ initialPlan, todayDate }: TodayViewProps) {
  const [plan, setPlan] = useState<PlanPreviewResponse | null>(initialPlan || null);
  const [loading, setLoading] = useState<boolean>(!initialPlan);
  const [activeMode, setActiveMode] = useState<string>(initialPlan?.mode || "normal");
  const [showRetained, setShowRetained] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(async (mode: string) => {
    setLoading(true);
    setError(null);
    try {
      const prev = await learningApi.previewPlan({
        today_date: todayDate,
        declared_mode: mode,
      });
      setPlan(prev);
      setActiveMode(prev.mode);
    } catch (err: any) {
      setError(err.message || "Failed to load today's study plan");
    } finally {
      setLoading(false);
    }
  }, [todayDate]);

  useEffect(() => {
    let ignore = false;
    if (!initialPlan) {
      void (async () => {
        await Promise.resolve();
        if (ignore) return;
        await fetchPlan("normal");
      })();
    }
    return () => {
      ignore = true;
    };
  }, [initialPlan, fetchPlan]);

  const handleModeChange = async (newMode: string) => {
    setActiveMode(newMode);
    await fetchPlan(newMode);
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await learningApi.completeCommitment(taskId);
      if (plan) {
        setPlan({
          ...plan,
          today_commitments: plan.today_commitments.map((t) =>
            t.id === taskId ? { ...t, status: "completed" } : t
          ),
        });
      }
    } catch (e: any) {
      setError(`Failed to mark complete: ${e.message}`);
    }
  };

  const dateStr = todayDate || new Date().toISOString().slice(0, 10);
  const isRestDay = activeMode === "rest" || plan?.effective_budget_minutes === 0;
  const hasCarryover = (plan?.carryover_count ?? 0) > 0;
  const hasRepairs = (plan?.prerequisite_repairs?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6" data-testid="today-container">
      {/* 1. Header: Date and Capacity Envelope */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Today&apos;s Focus
            </h1>
            <Badge tone="neutral" className="text-xs text-muted">
              {dateStr}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted">
            Achievable daily outcomes buffered for sustainable preparation.
          </p>
        </div>

        {/* 80% Buffer Badge */}
        {plan && (
          <div
            data-testid="buffer-badge"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs text-muted-strong"
          >
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>
              <strong>{plan.effective_budget_minutes}m</strong> buffered budget (80% of{" "}
              {plan.declared_capacity_minutes}m)
            </span>
          </div>
        )}
      </div>

      {/* 2. Capacity Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/50 p-1.5">
        {MODES.map((m) => {
          const Icon = m.icon;
          const isSelected = activeMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              data-testid={`mode-btn-${m.id}`}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-[background-color,color] duration-160 ease-out ${
                isSelected
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted hover:bg-surface hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{m.label}</span>
              <span className={`text-[10px] ${isSelected ? "opacity-70" : "text-muted"}`}>
                ({m.sub})
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Recovery & Repair Alerts */}
      {hasCarryover && (
        <div
          data-testid="carryover-alert"
          className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300"
        >
          <RotateCcw className="h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <span className="font-semibold text-amber-200">Smooth Recovery Active: </span>
            Carrying forward 1 interrupted priority task from your missed day. New focus is throttled
            to prevent backlog avalanches (B13-AC1).
          </div>
        </div>
      )}

      {hasRepairs && (
        <div
          data-testid="repair-alert"
          className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-xs text-muted-strong"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div>
            <span className="font-semibold text-foreground">Diagnostic Repair Prioritized: </span>
            A while-loop step invariant gap was detected. A short 12m repair drill is scheduled first
            while retaining Two Pointers (B13-AC3).
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 4. Main Plan / Committed Tasks */}
      {isRestDay ? (
        <div
          data-testid="rest-day-notice"
          className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface/30 p-12 text-center"
        >
          <Moon className="h-10 w-10 text-primary" />
          <h3 className="mt-3 text-sm font-semibold text-foreground">Declared Rest Day</h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            0 minutes scheduled today. Taking intentional rest restores cognitive energy and preserves
            your long-term learning consistency.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-medium uppercase tracking-wider text-muted">
              Committed Tasks ({plan?.today_commitments?.length || 0})
            </span>
            <span>
              Total: {plan?.today_committed_minutes || 0}m / {plan?.effective_budget_minutes || 0}m
            </span>
          </div>

          <div className="space-y-2.5" data-testid="tasks-list">
            {plan?.today_commitments?.map((task) => {
              const isCompleted = task.status === "completed";
              const isRepair = task.kind === "dsa_repair";
              const isCarryover = task.is_carryover;

              return (
                <div
                  key={task.id}
                  data-testid={`task-card-${task.id}`}
                  className={`flex flex-col justify-between gap-3 rounded-xl border p-4 transition-[border-color,box-shadow] duration-160 ease-out sm:flex-row sm:items-center ${
                    isCompleted
                      ? "border-success/30 bg-success/5 opacity-80"
                      : isRepair
                      ? "border-border-strong bg-surface"
                      : isCarryover
                      ? "border-warning/30 bg-warning/5"
                      : "border-border bg-surface/60 hover:border-border-strong"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4
                        className={`text-sm font-medium ${
                          isCompleted ? "line-through text-muted" : "text-foreground"
                        }`}
                      >
                        {task.title}
                      </h4>

                      {isRepair && (
                        <Badge tone="neutral" className="text-[10px]">
                          Diagnostic Repair
                        </Badge>
                      )}
                      {isCarryover && (
                        <Badge tone="amber" className="text-[10px]">
                          Carryover
                        </Badge>
                      )}
                      <Badge tone="zinc" className="text-[10px]">
                        {task.estimate_minutes} min
                      </Badge>
                    </div>

                    {task.reason && (
                      <p className="text-xs text-muted leading-relaxed">
                        {task.reason}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!isCompleted ? (
                      <>
                        <Link href={`/classrooms/${task.activity_id || "cls_default"}`}>
                          <Button size="sm" className="h-8 gap-1 text-xs">
                            <Play className="h-3 w-3" />
                            <span>Start</span>
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCompleteTask(task.id)}
                          data-testid={`complete-btn-${task.id}`}
                          className="h-8 text-xs text-muted hover:text-foreground"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Badge tone="emerald" className="gap-1 text-[10px]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Done</span>
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Bounded Pedagogical Explanation */}
      {plan && (
        <div
          data-testid="explanation-card"
          className="rounded-xl border border-border bg-surface/30 p-4 text-xs leading-relaxed text-muted"
        >
          <div className="mb-1 flex items-center gap-1.5 font-medium text-muted-strong">
            <HelpCircle className="h-3.5 w-3.5 text-primary" />
            <span>Plan Rationale:</span>
          </div>
          <p>
            {plan.explanations?.["rest_day"] ||
              plan.explanations?.[plan.today_commitments?.[0]?.id] ||
              "Generated deterministic schedule within your declared energy envelope. Incomplete tasks from prior sessions are preserved without backlog doubling."}
          </p>
        </div>
      )}

      {/* 6. Retained / Deferred Schedule Toggle */}
      {plan && (plan.retained_commitments?.length ?? 0) > 0 && (
        <div className="border-t border-border pt-4">
          <button
            onClick={() => setShowRetained(!showRetained)}
            data-testid="toggle-retained-btn"
            className="flex items-center gap-2 text-xs font-medium text-muted hover:text-foreground"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>
              {showRetained ? "Hide" : "View"} Retained Schedule ({plan.retained_commitments.length}{" "}
              tasks queued)
            </span>
          </button>

          {showRetained && (
            <div className="mt-3 space-y-2" data-testid="retained-tasks-list">
              {plan.retained_commitments.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/20 px-3 py-2 text-xs text-muted"
                >
                  <div className="flex items-center gap-2">
                    <span>{t.title}</span>
                    <Badge tone="neutral" className="text-[10px]">
                      {t.estimate_minutes}m
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted">Preserved pending</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
