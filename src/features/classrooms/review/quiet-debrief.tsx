"use client";

/**
 * Sprint B21: Quiet Session Debrief View
 * Authority: PLANLY_BUILD_SPEC.md §1, 7-8, 14; B21_debrief_progress.md
 *
 * Implements a clutter-free, evidence-first session debrief:
 * - What improved (verified independent demonstrations)
 * - What remains uncertain (specific gaps requiring unassisted transfer)
 * - Single direct next-lesson CTA without an obstructive dashboard wall (B21-AC3)
 */

import React from "react";
import Link from "next/link";
import { CheckCircle2, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { QuietSessionDebrief } from "@/features/progress/types";

interface QuietDebriefProps {
  debrief: QuietSessionDebrief;
}

export function QuietDebriefView({ debrief }: QuietDebriefProps) {
  const { what_improved, what_remains_uncertain, next_step, is_assisted } = debrief;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 px-4">
      {/* Calm Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Session Debrief
          </h1>
          {is_assisted ? (
            <Badge tone="amber">Assisted Practice</Badge>
          ) : (
            <Badge tone="emerald">Independent Evidence</Badge>
          )}
        </div>
        <p className="text-xs text-muted">
          Canonical learning observations from this attempt. No simulated percentages or vanity scores.
        </p>
      </div>

      {/* 1. What Improved */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span>What Improved ({what_improved.length})</span>
        </div>

        {what_improved.length === 0 ? (
          <p className="text-xs text-muted italic">
            No independent demonstrations confirmed in this attempt.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {what_improved.map((item, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-foreground">
                    {item.competency_key}
                  </span>
                  <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    Verified
                  </span>
                </div>
                <p className="text-xs text-muted">{item.evidence_text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 2. What Remains Uncertain */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <span>What Remains Uncertain ({what_remains_uncertain.length})</span>
        </div>

        {what_remains_uncertain.length === 0 ? (
          <p className="text-xs text-muted italic">
            All targeted competencies in this session verified independently.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {what_remains_uncertain.map((item, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-border/50 bg-surface-muted/40 p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-foreground">
                    {item.competency_key}
                  </span>
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    {item.status === "specific_gap"
                      ? "Specific Gap"
                      : "Needs Unassisted Transfer"}
                  </span>
                </div>
                <p className="text-xs text-muted">{item.evidence_text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 3. Direct Next Step (No Dashboard Wall: B21-AC3) */}
      <Card className="p-5 bg-surface-muted/60 border-primary/20 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <ShieldCheck className="h-4 w-4" />
          <span>Next Priority Action</span>
        </div>

        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">{next_step.title}</h2>
          <p className="text-xs text-muted">{next_step.reason}</p>
        </div>

        <div className="pt-2">
          <Link
            href={next_step.route}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <span>{next_step.action_label}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default QuietDebriefView;
