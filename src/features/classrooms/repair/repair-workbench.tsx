"use client";

/**
 * Sprint B15: Classroom Repair Workbench.
 * Authority: planly_architecture.md sections 7, 12, 14; B15_repair_transfer.md
 *
 * Enforces:
 * - Links repair to trigger evidence, micro-skill, and exercises (syntax drill, trace, reduced scaffold).
 * - Displays qualification criteria: independent work, unfamiliar transfer, passing execution.
 * - Concise reason and next action; allows candidate to "Continue with Uncertainty" without permanent topic locks.
 * - History log preserving full audit trail across all transitions.
 */

import React, { useState } from "react";
import {
  Wrench,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  BookOpen,
  Code2,
  ListTree,
  Unlock,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface RepairHistoryItem {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  createdAtUtc: string;
}

export interface RepairItem {
  id: string;
  competencyKey: string;
  title: string;
  hypothesis: string;
  status: "open" | "drilled" | "retested" | "closed" | "reopened" | "deferred";
  drillTaskId?: string | null;
  drillKind?: "syntax_drill" | "trace" | "reduced_scaffold" | "delayed_transfer" | null;
  retestSessionId?: string | null;
  closureCriterion: string;
  closureResult?: string | null;
  allowContinueWithUncertainty: boolean;
  history: RepairHistoryItem[];
  updatedAtUtc: string;
}

interface RepairWorkbenchProps {
  initialRepair?: RepairItem;
  onDrillLaunch?: (drillKind: string) => void;
  onContinueWithUncertainty?: (repairId: string) => void;
}

const DEFAULT_REPAIR: RepairItem = {
  id: "rep_dsa_loop_01",
  competencyKey: "dsa.arrays.iteration",
  title: "While Loop Variable Increment Repair",
  hypothesis: "Index pointer j was not incremented in while loop body, causing timeout on duplicate values",
  status: "open",
  drillKind: "syntax_drill",
  closureCriterion: "Unassisted passing execution on unfamiliar delayed transfer exercise",
  allowContinueWithUncertainty: true,
  history: [
    {
      id: "ev_1",
      fromStatus: "none",
      toStatus: "open",
      reason: "Failing test execution detected timeout in array iteration",
      createdAtUtc: "2026-09-14T10:00:00Z",
    },
  ],
  updatedAtUtc: "2026-09-14T10:00:00Z",
};

export function RepairWorkbench({
  initialRepair = DEFAULT_REPAIR,
  onDrillLaunch,
  onContinueWithUncertainty,
}: RepairWorkbenchProps) {
  const [repair, setRepair] = useState<RepairItem>(initialRepair);
  const [uncertaintyAcknowledged, setUncertaintyAcknowledged] = useState(false);

  const statusToneMap: Record<string, "neutral" | "blue" | "emerald" | "amber" | "rose"> = {
    open: "amber",
    drilled: "blue",
    retested: "blue",
    closed: "emerald",
    reopened: "rose",
    deferred: "neutral",
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6" data-testid="repair-workbench">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Wrench className="h-4 w-4" />
            </span>
            <h1 className="text-xl font-bold tracking-tight">Micro-Skill Repair Drill</h1>
            <Badge tone={statusToneMap[repair.status] || "neutral"}>
              {repair.status.toUpperCase()}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Targeted micro-drill to resolve specific execution gaps before delayed transfer.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {repair.allowContinueWithUncertainty && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setUncertaintyAcknowledged(true);
                onContinueWithUncertainty?.(repair.id);
              }}
              data-testid="continue-uncertainty-btn"
            >
              <Unlock className="h-3.5 w-3.5" />
              Continue with Uncertainty
            </Button>
          )}
        </div>
      </div>

      {/* Uncertainty Notice if acknowledged */}
      {uncertaintyAcknowledged && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <span className="font-semibold">Curriculum Progression Unlocked: </span>
            You chose to proceed without a permanent topic lock. This micro-skill gap remains active and will be monitored in future delayed transfer checks.
          </div>
        </div>
      )}

      {/* Precise Diagnosis Card (Failure to Prevent: No global weakness label) */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone="neutral" className="font-mono text-[11px]">
              {repair.competencyKey}
            </Badge>
            <span className="text-xs text-muted-foreground">Evidence Diagnosis</span>
          </div>
          <span className="text-xs text-muted-foreground">Version {repair.history.length}</span>
        </div>

        <h2 className="text-base font-semibold">{repair.title}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50">
          <span className="font-medium text-foreground">Hypothesis: </span>
          {repair.hypothesis}
        </p>

        {repair.closureResult && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <span className="font-semibold">Verified Closure: </span>
              {repair.closureResult}
            </div>
          </div>
        )}
      </div>

      {/* 3 Supported Drill Formats */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Step 1: Complete Practice Drill
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Syntax Drill */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-semibold">Syntax Drill</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              5-10m micro drill focusing exclusively on the missing mechanical idiom or loop step syntax.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => onDrillLaunch?.("syntax_drill")}
            >
              Start Drill
            </Button>
          </div>

          {/* Trace Drill */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors">
            <div className="flex items-center gap-2">
              <ListTree className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold">Invariant Trace</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Step through iterations with concrete sample inputs to verify pointer advancement manually.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => onDrillLaunch?.("trace")}
            >
              Start Trace
            </Button>
          </div>

          {/* Reduced Scaffold */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-2 hover:border-primary/40 transition-colors">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-violet-500" />
              <span className="text-xs font-semibold">Reduced Scaffold</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Skeletonized problem where outer context is given, requiring you to author the missing segment.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={() => onDrillLaunch?.("reduced_scaffold")}
            >
              Start Scaffold
            </Button>
          </div>
        </div>
      </div>

      {/* Step 2: Delayed Independent Retest Qualifications */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Step 2: Qualified Delayed Retest (B15 Gate)
        </h3>
        <p className="text-xs text-muted-foreground">
          A repair can only close upon demonstrated transfer on a distinct, unfamiliar problem without assistance.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 pt-1">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 p-2.5 text-xs">
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <span className="font-semibold block">Independent Code</span>
              <span className="text-[11px] text-muted-foreground">No assistant solutions</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/70 p-2.5 text-xs">
            <Sparkles className="h-4 w-4 text-blue-500 shrink-0" />
            <div>
              <span className="font-semibold block">Unfamiliar Transfer</span>
              <span className="text-[11px] text-muted-foreground">Distinct problem statement</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/70 p-2.5 text-xs">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <div>
              <span className="font-semibold block">Passing Execution</span>
              <span className="text-[11px] text-muted-foreground">5/5 automated test pass</span>
            </div>
          </div>
        </div>
      </div>

      {/* History & Invalidation Trail (B15-AC2, B15-AC3) */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Audit & Invalidation History ({repair.history.length})
        </h3>
        <div className="rounded-xl border border-border bg-muted/10 divide-y divide-border/60">
          {repair.history.map((event) => (
            <div key={event.id} className="p-3 text-xs flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral" className="text-[10px]">
                    {event.fromStatus} → {event.toStatus}
                  </Badge>
                  <span className="font-medium text-foreground">{event.reason}</span>
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {event.createdAtUtc.slice(0, 10)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
