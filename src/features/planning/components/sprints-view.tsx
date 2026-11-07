"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Layers,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Target,
  AlertCircle,
  GitCommit,
  Sparkles,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Rise, Stagger, Item, motion } from "@/components/ui/motion";
import type { SprintOverview } from "../service";

interface SprintsViewProps {
  overview: SprintOverview;
}

export function SprintsView({ overview }: SprintsViewProps) {
  const [activeTab, setActiveTab] = useState<"calendar" | "diff" | "outcomes">("calendar");
  const { plan } = overview;

  // Group day allocations into Week 1 (days 0-6) and Week 2 (days 7-13)
  const week1Days = plan.dayAllocations.slice(0, 7);
  const week2Days = plan.dayAllocations.slice(7, 14);

  // Helper to find task details for a day
  const getTasksForDay = (date: string) => {
    return plan.assignments.filter((a) =>
      a.slotAllocations.some((s) => s.localDate === date)
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* Top Banner / Sprint Context */}
      <div className="animate-rise flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{overview.title}</h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              14-day sprint
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {overview.window.startDate} → {overview.window.endDate} · Checkpoint {overview.checkpointDate} · {overview.targetRole}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList>
            <TabsTrigger value="calendar">14-day calendar</TabsTrigger>
            <TabsTrigger value="diff" className="gap-1.5">
              Plan diff
              {(plan.diff.moved.length > 0 || plan.diff.added.length > 0) && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </TabsTrigger>
            <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Strategic Focus Card (§6.3, R03) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-muted" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Primary Bottleneck
            </h3>
          </div>
          <p className="text-sm font-medium text-foreground">
            {overview.bottleneck}
          </p>
          <p className="text-xs text-muted mt-1">
            Receives priority score weight (+40 pts) per §11.2 Rule 6.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-muted" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Supporting Practice Lane
            </h3>
          </div>
          <p className="text-sm font-medium text-foreground">
            {overview.supportingLane}
          </p>
          <p className="text-xs text-muted mt-1">
            Integrated into daily slots to preserve backend and systems defense breadth.
          </p>
        </div>
      </div>

      {/* Weekly Budgets Summary (80% Safety Buffer Rule) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {plan.weekBudgets.map((wb, idx) => (
          <div
            key={wb.weekStartDate}
            className="rounded-xl border border-border bg-surface p-4 space-y-2"
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-semibold text-foreground">
                Week {idx + 1} Budget (Starts Mon {wb.weekStartDate})
              </span>
              <span className="text-[11px] font-mono text-primary">
                {wb.allocatedMinutes}m / {wb.targetBudget}m assigned
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1 text-xs">
              <div className="p-2 rounded-lg bg-surface-muted">
                <span className="block text-[10px] text-muted">Declared Time</span>
                <span className="font-mono font-medium">{wb.declaredAvailableMinutes}m</span>
              </div>
              <div className="p-2 rounded-lg bg-surface-muted">
                <span className="block text-[10px] text-muted">80% Buffer Cap</span>
                <span className="font-mono font-medium text-primary">
                  {wb.bufferBudget}m
                </span>
              </div>
              <div className="p-2 rounded-lg bg-surface-muted">
                <span className="block text-[10px] text-muted">Discretionary</span>
                <span className="font-mono font-medium text-success">
                  {wb.discretionaryMinutes}m
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* TAB 1: 14-Day Calendar Grid */}
      {activeTab === "calendar" && (
        <div className="space-y-6">
          {/* Week 1 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Week 1 (Monday – Sunday)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              {week1Days.map((day) => {
                const tasks = getTasksForDay(day.date);
                const isFull = day.allocatedMinutes >= day.dailyBudget && day.dailyBudget > 0;
                return (
                  <div
                    key={day.date}
                    className="rounded-lg border border-border bg-surface p-3 flex flex-col justify-between min-h-[160px]"
                  >
                    <div>
                      <div className="flex items-center justify-between border-b border-border pb-1.5 mb-2">
                        <span className="text-xs font-mono font-semibold text-foreground">
                          {day.date.slice(5)}
                        </span>
                        <span
                          className={`text-[10px] font-mono ${
                            isFull ? "text-amber-600 dark:text-amber-400" : "text-muted"
                          }`}
                        >
                          {day.allocatedMinutes}/{day.dailyBudget}m
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {tasks.map((t) => (
                          <div
                            key={t.id}
                            className="p-1.5 rounded bg-surface-muted border border-border text-[11px] space-y-0.5"
                          >
                            <span className="font-medium line-clamp-1 text-foreground">
                              {t.title}
                            </span>
                            <div className="flex items-center justify-between text-[10px] text-muted">
                              <span className="uppercase">{t.lane}</span>
                              <span>{t.estimateMinutes}m</span>
                            </div>
                          </div>
                        ))}
                        {tasks.length === 0 && (
                          <span className="text-[11px] text-muted italic block pt-4 text-center">
                            Open Buffer
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 pt-1 border-t border-border/50 text-[10px] text-muted flex justify-between">
                      <span>{day.declaredMinutes}m declared</span>
                      <span>80% cap</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Week 2 */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>Week 2 (Monday – Sunday)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              {week2Days.map((day) => {
                const tasks = getTasksForDay(day.date);
                const isFull = day.allocatedMinutes >= day.dailyBudget && day.dailyBudget > 0;
                return (
                  <div
                    key={day.date}
                    className="rounded-lg border border-border bg-surface p-3 flex flex-col justify-between min-h-[160px]"
                  >
                    <div>
                      <div className="flex items-center justify-between border-b border-border pb-1.5 mb-2">
                        <span className="text-xs font-mono font-semibold text-foreground">
                          {day.date.slice(5)}
                        </span>
                        <span
                          className={`text-[10px] font-mono ${
                            isFull ? "text-amber-600 dark:text-amber-400" : "text-muted"
                          }`}
                        >
                          {day.allocatedMinutes}/{day.dailyBudget}m
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {tasks.map((t) => (
                          <div
                            key={t.id}
                            className="p-1.5 rounded bg-surface-muted border border-border text-[11px] space-y-0.5"
                          >
                            <span className="font-medium line-clamp-1 text-foreground">
                              {t.title}
                            </span>
                            <div className="flex items-center justify-between text-[10px] text-muted">
                              <span className="uppercase">{t.lane}</span>
                              <span>{t.estimateMinutes}m</span>
                            </div>
                          </div>
                        ))}
                        {tasks.length === 0 && (
                          <span className="text-[11px] text-muted italic block pt-4 text-center">
                            Open Buffer
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 pt-1 border-t border-border/50 text-[10px] text-muted flex justify-between">
                      <span>{day.declaredMinutes}m declared</span>
                      <span>80% cap</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Plan Diff (§6.3, AC05) */}
      {activeTab === "diff" && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Commitment Diff: Original vs. Revised Plan
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Tracks rescheduled, added, and completed tasks without rewriting historical commitments.
              </p>
            </div>
            <span className="text-xs font-mono text-muted">
              Hash: {plan.inputHash}
            </span>
          </div>

          <div className="space-y-3">
            {plan.diff.moved.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-amber-700 dark:text-amber-400">
                  Rescheduled Assignments ({plan.diff.moved.length})
                </h4>
                {plan.diff.moved.map((m) => (
                  <div
                    key={m.sourceKey}
                    className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-xs flex items-center justify-between"
                  >
                    <span className="font-medium text-foreground">{m.sourceKey}</span>
                    <span className="text-muted flex items-center gap-1.5">
                      <span className="line-through">{m.fromDate}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-medium text-amber-800 dark:text-amber-300">
                        {m.toDate} (Adapted Feasibly)
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Scheduled Tasks in Current Revision ({plan.assignments.length})
              </h4>
              <div className="space-y-2">
                {plan.assignments.map((t) => (
                  <div
                    key={t.id}
                    className="p-3 rounded-lg border border-border bg-surface-muted text-xs flex items-center justify-between"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium text-foreground">{t.title}</p>
                      <p className="text-[11px] text-muted">
                        Reason: {t.reason}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <span className="font-mono text-xs text-foreground">
                        {t.estimateMinutes}m
                      </span>
                      <span className="block text-[10px] text-muted">
                        {t.slotAllocations[0]?.localDate ?? "Unassigned"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Observable Outcomes & Rules */}
      {activeTab === "outcomes" && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">
            Sprint Outcomes & Evidence Criteria (§6.3)
          </h3>
          <div className="space-y-3">
            {plan.outcomes.map((out) => (
              <div
                key={out.id}
                className="p-4 rounded-lg border border-border bg-surface-muted space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    {out.description}
                  </span>
                  <span className="rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted-strong">
                    {out.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  <strong>Competency: </strong>
                  <code>{out.competencyKey}</code>
                </p>
                <p className="text-xs text-muted">
                  <strong>Evidence Required: </strong>
                  {out.evidenceRequired}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
