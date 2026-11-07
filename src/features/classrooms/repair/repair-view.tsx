"use client";

/**
 * Sprint B15: Classroom Repair & Qualified Retest Workbench.
 * Authority: planly_architecture.md sections 7, 12, 14; B15_repair_transfer.md
 *
 * Core Product Invariants:
 * - B15-AC1: Nonexistent drill IDs, assistant solutions, and guided retests cannot close a repair.
 * - B15-AC2: A valid delayed independent transfer supports closure and preserves full history.
 * - B15-AC3: Correcting the qualifying observation reopens/recomputes derived state.
 * - Failure to Prevent: Precise evidence instead of global weakness labels; no permanent topic locks.
 */

import React, { useState } from "react";
import Link from "next/link";
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Clock,
  ShieldCheck,
  Sparkles,
  Layers,
  History,
  Info,
  Play,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ClassroomRepairItem {
  id: string;
  competencyKey: string;
  title: string;
  hypothesis: string;
  status: "open" | "drilled" | "retested" | "closed" | "reopened" | "deferred";
  drillKind?: string;
  drillTaskId?: string;
  closureCriterion: string;
  closureResult?: string | null;
  historyCount: number;
  allowContinueWithUncertainty: boolean;
  triggerEvidenceNotes?: string;
  latestEventReason?: string;
}

interface RepairViewProps {
  initialRepairs?: ClassroomRepairItem[];
  classroomId?: string;
}

const DEFAULT_DEMO_REPAIRS: ClassroomRepairItem[] = [
  {
    id: "rep_dsa_while_increment",
    competencyKey: "dsa.arrays.iteration",
    title: "While-Loop Invariant Pointer Advancement",
    hypothesis: "Index pointer increment was omitted in while loop traversal causing potential infinite loop on duplicates.",
    status: "open",
    drillKind: "syntax_drill",
    drillTaskId: "drill_while_increment_01",
    closureCriterion: "Unassisted passing execution on unfamiliar delayed two-pointers transfer problem.",
    closureResult: null,
    historyCount: 2,
    allowContinueWithUncertainty: true,
    triggerEvidenceNotes: "Observed infinite loop in earlier dynamic hash/pointer trial.",
    latestEventReason: "Repair gap identified from verified execution evidence.",
  },
  {
    id: "rep_two_pointers_boundary",
    competencyKey: "dsa.two_pointers.sorted_array",
    title: "Sorted Array Boundary Skip Logic",
    hypothesis: "Left and right pointers did not skip identical duplicates after finding complement match.",
    status: "drilled",
    drillKind: "trace",
    drillTaskId: "drill_two_pointers_dup_skip",
    closureCriterion: "Independent transfer on unseen sorted boundary problem with duplicate elements.",
    closureResult: null,
    historyCount: 3,
    allowContinueWithUncertainty: true,
    triggerEvidenceNotes: "Missed edge cases where target is formed by duplicate numbers.",
    latestEventReason: "Completed trace drill 'Two Pointers Duplicate Skip'.",
  },
  {
    id: "rep_prefix_sum_hash_map",
    competencyKey: "dsa.prefix_sums.basics",
    title: "Prefix Sum Initial Zero-Index Frequency Map",
    hypothesis: "Forgot to initialize frequency map with zero key, failing prefix sum subarray equals k.",
    status: "closed",
    drillKind: "delayed_transfer",
    drillTaskId: "drill_prefix_sum_zero_init",
    closureCriterion: "Independent transfer on continuous subarray sum variant.",
    closureResult: "Independently solved Subarray Sum Equals K transfer problem unassisted (5/5 tests passed).",
    historyCount: 4,
    allowContinueWithUncertainty: true,
    triggerEvidenceNotes: "Off-by-one initial subarray count bug.",
    latestEventReason: "Repair closed: Unassisted passing transfer demonstrated on unfamiliar problem.",
  },
];

export function RepairView({ initialRepairs, classroomId }: RepairViewProps) {
  const [repairs] = useState<ClassroomRepairItem[]>(
    initialRepairs && initialRepairs.length > 0 ? initialRepairs : DEFAULT_DEMO_REPAIRS
  );
  const [activeFilter, setActiveFilter] = useState<string>("active");

  const filteredRepairs = repairs.filter((r) => {
    if (activeFilter === "active") return r.status !== "closed" && r.status !== "deferred";
    if (activeFilter === "closed") return r.status === "closed";
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "closed":
        return (
          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Improved & Closed
          </Badge>
        );
      case "drilled":
        return (
          <Badge tone="neutral">
            <Sparkles className="mr-1 h-3 w-3" /> Drilled — Awaiting Retest
          </Badge>
        );
      case "retested":
        return (
          <Badge tone="neutral">
            <Clock className="mr-1 h-3 w-3" /> Retested — Reviewing Evidence
          </Badge>
        );
      case "reopened":
        return (
          <Badge tone="amber">
            <RotateCcw className="mr-1 h-3 w-3" /> Reopened (Evidence Corrected)
          </Badge>
        );
      default:
        return (
          <Badge tone="amber">
            <Wrench className="mr-1 h-3 w-3" /> Open Repair
          </Badge>
        );
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-primary">
              <Wrench className="h-3 w-3" /> Specific Pedagogical Repairs
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
              <ShieldCheck className="h-3 w-3 text-emerald-400" /> Uncertainty Tolerated
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            Targeted Skill Repairs & Qualified Retests
          </h1>
          <p className="text-xs text-muted sm:text-sm">
            Learning gaps close only when independent, delayed transfer work justifies it. Never global weakness labels.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {classroomId && (
            <Link href={`/classrooms/${classroomId}`}>
              <Button variant="outline" size="sm">
                ← Back to Classroom
              </Button>
            </Link>
          )}
          <Link href="/today">
            <Button variant="secondary" size="sm">
              Today Cockpit
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-border bg-surface-subtle p-1">
          <button
            onClick={() => setActiveFilter("active")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === "active"
                ? "bg-surface font-semibold text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            Active Repairs ({repairs.filter((r) => r.status !== "closed" && r.status !== "deferred").length})
          </button>
          <button
            onClick={() => setActiveFilter("closed")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === "closed"
                ? "bg-surface font-semibold text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            Resolved ({repairs.filter((r) => r.status === "closed").length})
          </button>
          <button
            onClick={() => setActiveFilter("all")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              activeFilter === "all"
                ? "bg-surface font-semibold text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
          >
            All History ({repairs.length})
          </button>
        </div>

        <div className="text-xs text-muted flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-muted" />
          <span>Assistant solutions & guided trials cannot close repairs</span>
        </div>
      </div>

      <div className="space-y-4">
        {filteredRepairs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No repairs matching filter</h3>
            <p className="mt-1 text-xs text-muted">
              {activeFilter === "active"
                ? "All active repairs have been closed with verified transfer evidence."
                : "No resolved repairs yet."}
            </p>
          </div>
        ) : (
          filteredRepairs.map((r) => (
            <div
              key={r.id}
              className="card-lift rounded-xl border border-border bg-surface p-5 shadow-xs"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(r.status)}
                    <span className="font-mono text-xs text-muted">{r.competencyKey}</span>
                    {r.drillKind && (
                      <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                        {r.drillKind.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{r.title}</h3>
                </div>

                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs font-mono text-muted">
                    <History className="h-3 w-3" /> {r.historyCount} events
                  </span>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-border/60 bg-surface-subtle p-3 text-xs">
                <div className="font-medium text-foreground/90 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span>Diagnosed Learning Gap:</span>
                </div>
                <p className="mt-1 text-muted">{r.hypothesis}</p>
                {r.triggerEvidenceNotes && (
                  <p className="mt-1 text-[11px] text-muted/80 italic">Evidence: {r.triggerEvidenceNotes}</p>
                )}
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border/40 pt-3 text-xs">
                <div className="space-y-0.5">
                  <span className="font-medium text-muted">Required Qualified Demonstration:</span>
                  <p className="text-foreground/90">{r.closureCriterion}</p>
                  {r.closureResult && (
                    <p className="mt-1 font-medium text-emerald-400">✓ {r.closureResult}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2 sm:pt-0">
                  {r.status === "open" || r.status === "reopened" ? (
                    <Link href={`/arena/drill-${r.id}`}>
                      <Button size="sm" className="gap-1.5">
                        <Play className="h-3.5 w-3.5" /> Launch Repair Drill
                      </Button>
                    </Link>
                  ) : r.status === "drilled" ? (
                    <Link href={`/arena/retest-${r.id}`}>
                      <Button size="sm" variant="primary" className="gap-1.5">
                        <FileCode className="h-3.5 w-3.5" /> Attempt Delayed Retest
                      </Button>
                    </Link>
                  ) : (
                    <span className="text-xs text-muted font-mono">Transfer Verified</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
