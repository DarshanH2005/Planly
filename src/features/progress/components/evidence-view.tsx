"use client";

import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  HelpCircle,
  ShieldCheck,
  History,
  Info,
  Filter,
  Layers,
  ChevronDown,
} from "lucide-react";
import type { ReadinessSummary, DomainReadiness } from "../readiness-service";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/button";
import { RadixProgress } from "@/components/ui/progress-radix";
import { inputCls } from "@/components/ui/page";
import { cn } from "@/components/ui/cn";

interface EvidenceViewProps {
  summary: ReadinessSummary;
}

export function EvidenceView({ summary }: EvidenceViewProps) {
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [showAuditTrail, setShowAuditTrail] = useState(true);

  const filteredDomains =
    selectedDomain === "all"
      ? summary.domains
      : summary.domains.filter((d) => d.domain === selectedDomain);

  const getStatusBadge = (status: DomainReadiness["status"]) => {
    switch (status) {
      case "supported":
        return (
          <Badge tone="emerald">
            <CheckCircle2 className="h-3 w-3" /> Supported
          </Badge>
        );
      case "developing":
        return (
          <Badge tone="blue">
            <Clock className="h-3 w-3" /> Developing
          </Badge>
        );
      case "provisional":
        return (
          <Badge tone="amber">
            <AlertTriangle className="h-3 w-3" /> Provisional
          </Badge>
        );
      case "unknown":
      default:
        return (
          <Badge tone="neutral">
            <HelpCircle className="h-3 w-3" /> Unknown
          </Badge>
        );
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      {/* Top Banner */}
      <div className="animate-rise flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">
              Evidence & readiness
            </h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              by round · no fake scores
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Qualifying vs excluded sessions, gaps, and revision history. Unknown stays unknown.
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted" />
          <select
            value={selectedDomain}
            onChange={(e) => setSelectedDomain(e.target.value)}
            className={cn(inputCls, "!w-auto !py-1.5 text-xs")}
            aria-label="Filter by hiring domain"
          >
            <option value="all">All domains (5)</option>
            <option value="oa">OA simulation</option>
            <option value="technical">Live technical</option>
            <option value="engineering_project">Engineering & project</option>
            <option value="behavioural">Behavioural / HR</option>
            <option value="foundational">Foundational & SQL</option>
          </select>
        </div>
      </div>

      {/* Domain Readiness Cards (§10.4) */}
      <div className="space-y-4">
        {filteredDomains.map((d, i) => {
          const pct = d.benchmarkDenominator > 0 ? (d.qualifyingCount / d.benchmarkDenominator) * 100 : 0;
          return (
          <motion.div
            key={d.domain}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i * 0.06, 0.3) }}
          >
          <Card className="card-lift space-y-4 p-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span>{d.title}</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  {d.stabilityThresholdText}
                </p>
                <div className="mt-2 w-56 max-w-full">
                  <RadixProgress value={pct} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="font-mono text-xs font-semibold tnum">
                    {d.qualifyingCount}/{d.benchmarkDenominator}
                  </span>
                  <span className="block text-[10px] text-muted">
                    qualifying{d.unknownCount > 0 ? ` · ${d.unknownCount} unknown` : ""}
                  </span>
                </div>
                {getStatusBadge(d.status)}
              </div>
            </div>

            {/* Benchmark Conditions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Evaluation Conditions
                </span>
                <ul className="space-y-1 text-foreground list-disc list-inside">
                  {d.conditions.map((cond, idx) => (
                    <li key={idx} className="text-xs text-muted">
                      <span className="text-foreground">{cond}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {d.missingGaps.length > 0 && (
                <div className="space-y-1.5 p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
                  <span className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                    <Info className="h-3.5 w-3.5" />
                    <span>Evidence Gaps & Exclusions</span>
                  </span>
                  <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
                    {d.missingGaps.map((gap, idx) => (
                      <li key={idx}>• {gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Sessions in this domain */}
            {d.sessions.length > 0 && (
              <div className="pt-2 border-t border-border">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted block mb-2">
                  Observed Sessions ({d.sessions.length})
                </span>
                <div className="space-y-2">
                  {d.sessions.map((s) => (
                    <div
                      key={s.sessionId}
                      className="p-3 rounded-lg bg-surface-muted border border-border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {s.packId}
                          </span>
                          <span className="text-[11px] text-muted font-mono">
                            ({s.completedAt})
                          </span>
                          {s.exclusionReason && (
                            <span className="rounded bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              Excluded from Benchmark
                            </span>
                          )}
                        </div>
                        {s.notes && (
                          <p className="text-[11px] text-muted mt-1">
                            {s.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {s.passed ? (
                          <span className="text-success font-medium text-[11px] flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Passed</span>
                          </span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400 font-medium text-[11px]">
                            Failure Observed
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          </motion.div>
          );
        })}
      </div>

      {/* Review Revision Audit Trail (AC22 Invariant) */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Non-Destructive Review Revision History (AC22)
            </h3>
          </div>
          <span className="text-xs text-muted">
            Superseded reviews update effective evidence without erasing history
          </span>
        </div>

        <p className="text-xs text-muted leading-relaxed">
          In Planly, correcting or disputing a review creates an immutable superseding revision.
          Below, observe that Revision 1 remains in the audit log while Revision 2 provides the effective rating (2 / Testing &amp; debugging).
        </p>

        <div className="space-y-3">
          {summary.reviewAuditTrail.map((entry) => (
            <div
              key={entry.reviewId}
              className={`p-4 rounded-lg border text-xs space-y-2 ${
                entry.status === "effective"
                  ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/20"
                  : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 opacity-80"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">
                    Review {entry.reviewId} (Revision {entry.revision})
                  </span>
                  <span className="text-muted">· Evaluator: {entry.evaluator}</span>
                  {entry.supersedesId && (
                    <span className="text-primary font-mono text-[10px]">
                      (Supersedes {entry.supersedesId})
                    </span>
                  )}
                </div>

                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    entry.status === "effective"
                      ? "bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200"
                      : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {entry.status}
                </span>
              </div>

              <div className="space-y-1 pt-1">
                {entry.observations.map((obs, idx) => (
                  <div key={idx} className="flex items-start justify-between">
                    <div>
                      <span className="font-medium text-foreground">
                        {obs.dimension} ({obs.competencyKey}):
                      </span>{" "}
                      <span className="text-muted">{obs.observation}</span>
                    </div>
                    <span className="font-mono font-semibold ml-2 shrink-0">
                      Rating: {obs.rating ?? "N/A"}/3
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
