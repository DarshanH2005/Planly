"use client";

/**
 * Classroom Listing Hub.
 * Sprint: B09
 * Authority: planly_architecture.md sections 1, 8
 */

import React from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, Play, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClassroomRecord } from "@/lib/api/learning-client";

interface ClassroomListProps {
  classrooms: ClassroomRecord[];
}

export function ClassroomList({ classrooms }: ClassroomListProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Classrooms
        </h1>
        <p className="text-sm text-muted">
          Quiet, distraction-free adaptive learning sessions with real-time pedagogical feedback.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classrooms.map((cls) => (
          <div
            key={cls.id}
            data-testid={`classroom-card-${cls.id}`}
            className="card-lift pressable flex flex-col justify-between rounded-xl border border-border bg-surface p-5 shadow-xs"
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase text-muted-strong">
                  {cls.track || "DSA"}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted">
                  <Clock className="h-3 w-3" />
                  <span>Active</span>
                </span>
              </div>

              <h2 className="mt-3 font-display text-base font-semibold text-foreground">
                {cls.title}
              </h2>
              <p className="mt-1.5 text-xs text-muted leading-relaxed">
                Adaptive two-pointer invariant exploration, diagnostic probes, and exposure tracking.
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-border/60">
              <Link href={`/classrooms/${cls.id}`}>
                <Button className="w-full gap-2 text-xs font-medium">
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Enter Classroom</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
