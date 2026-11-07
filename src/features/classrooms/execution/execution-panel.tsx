"use client";

/**
 * Execution & Test Verification Panel.
 * Sprint: B10
 * Authority: planly_architecture.md section 9; B10_python_execution.md
 *
 * Enforces:
 * - B10-AC1: Direct display of real passing/failing test outcomes and diffs.
 * - B10-AC2: Bound execution evidence, infinite loop timeouts, and output truncation.
 * - B10-AC3: Stale result warning if code was modified after or during execution.
 * - Failure to prevent: Clear reminder that passing finite tests is not independent mastery.
 */

import React, { useState } from "react";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileCode,
  Terminal,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ExecutionRecord,
  ExecutionResponse,
  TestResult,
} from "@/lib/api/learning-client";

interface ExecutionPanelProps {
  sessionId: string;
  currentRevision: number;
  latestExecution: ExecutionRecord | null;
  onExecute: () => Promise<unknown> | void;
  isExecuting: boolean;
  disabled?: boolean;
  className?: string;
}

export function ExecutionPanel({
  sessionId,
  currentRevision,
  latestExecution,
  onExecute,
  isExecuting,
  disabled = false,
  className = "",
}: ExecutionPanelProps) {
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const [showStdout, setShowStdout] = useState(false);

  const toggleTest = (name: string) => {
    setExpandedTests((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const isStale =
    latestExecution?.is_stale ||
    (latestExecution ? latestExecution.artifact_revision < currentRevision : false);

  const statusTone = (status: string, passed: boolean) => {
    if (status === "timed_out") return "amber";
    if (status === "static_review_only") return "neutral";
    if (passed) return "emerald";
    return "rose";
  };

  return (
    <div
      className={`flex flex-col rounded-lg border border-border bg-card overflow-hidden text-xs ${className}`}
      data-testid="execution-panel"
    >
      {/* 1. Header Bar with Run Action */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">Python Test Runner</span>
          {latestExecution && (
            <Badge
              tone={statusTone(latestExecution.status, latestExecution.passed)}
              className="text-[10px] px-1.5 py-0 capitalize"
              data-testid="execution-status-badge"
            >
              {latestExecution.status === "timed_out"
                ? "Timed Out"
                : latestExecution.status === "static_review_only"
                ? "Static Review"
                : latestExecution.passed
                ? "Tests Passed"
                : "Tests Failed"}
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          onClick={onExecute}
          disabled={isExecuting || disabled}
          className="pressable h-7 px-3 text-xs gap-1.5 font-medium bg-success text-white hover:brightness-110 disabled:opacity-50"
          data-testid="run-tests-btn"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Running...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run Tests</span>
            </>
          )}
        </Button>
      </div>

      {/* 2. Stale Evaluation Warning (B10-AC3) */}
      {isStale && latestExecution && (
        <div
          className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px]"
          data-testid="stale-execution-warning"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Results reflect <strong>Revision {latestExecution.artifact_revision}</strong>. You have newer
            edits (Revision {currentRevision}). Click &quot;Run Tests&quot; to verify the new revision.
          </span>
        </div>
      )}

      {/* 3. Empty / Initial State */}
      {!latestExecution && !isExecuting && (
        <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground gap-1.5">
          <Terminal className="w-6 h-6 text-muted-foreground/60" />
          <p className="font-medium text-foreground text-xs">No execution evidence yet</p>
          <p className="text-[11px] max-w-xs">
            Run test assertions against your code draft to verify invariants with real execution evidence.
          </p>
        </div>
      )}

      {/* 4. Execution Results Breakdown */}
      {latestExecution && (
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          {/* Summary Row */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-2 border-b border-border/60">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                Passed: {latestExecution.tests_passed} / {latestExecution.tests_total}
              </span>
              <span>·</span>
              <span>{latestExecution.duration_ms} ms</span>
              <span>·</span>
              <span className="capitalize">{latestExecution.sandbox_provider} sandbox</span>
            </div>
            <span className="font-mono text-[10px]">
              hash: {latestExecution.artifact_hash.slice(0, 8)}
            </span>
          </div>

          {/* Test Cases List */}
          <div className="space-y-1.5" data-testid="test-results-list">
            {latestExecution.results.map((r) => (
              <div
                key={r.name}
                className="rounded border border-border bg-background p-2 transition hover:bg-muted/20"
                data-testid={`test-result-${r.name}`}
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => toggleTest(r.name)}
                >
                  <div className="flex items-center gap-2">
                    {r.passed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    )}
                    <span className="font-mono font-medium text-[11px] text-foreground">
                      {r.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {r.execution_time_ms ? <span>{r.execution_time_ms} ms</span> : null}
                    {expandedTests[r.name] ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </div>
                </div>

                {/* Expanded Details: Expected vs Actual or Error */}
                {expandedTests[r.name] && (
                  <div className="mt-2 pt-2 border-t border-border/40 font-mono text-[10px] space-y-1">
                    {r.expected !== undefined && (
                      <div className="text-muted-foreground">
                        <span className="font-semibold text-foreground">Expected: </span>
                        {r.expected}
                      </div>
                    )}
                    {r.actual !== undefined && (
                      <div className={r.passed ? "text-emerald-500" : "text-rose-500"}>
                        <span className="font-semibold text-foreground">Actual: </span>
                        {r.actual || "None"}
                      </div>
                    )}
                    {r.error && (
                      <div className="text-rose-500 whitespace-pre-wrap">
                        <span className="font-semibold">Error: </span>
                        {r.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 5. Pedagogical Warning Banner (Failure to Prevent) */}
          {latestExecution.passed && !isStale && (
            <div
              className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-2.5 text-[11px] text-success"
              data-testid="pedagogical-invariant-reminder"
            >
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="font-semibold">Finite tests passed!</span>
                <p className="text-[10px] leading-relaxed opacity-90">
                  Passing finite test cases does not constitute correctness proof or independent mastery.
                  Explain the convergence invariant in chat to complete verified assessment.
                </p>
              </div>
            </div>
          )}

          {/* 6. Standard Output / Stderr Expander */}
          {(latestExecution.stdout || latestExecution.stderr) && (
            <div className="pt-2 border-t border-border/60">
              <button
                onClick={() => setShowStdout(!showStdout)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                {showStdout ? "Hide Output" : "View Runner Output"}
              </button>
              {showStdout && (
                <div className="mt-1.5 p-2 rounded bg-muted/60 font-mono text-[10px] whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {latestExecution.stdout && <div>{latestExecution.stdout}</div>}
                  {latestExecution.stderr && (
                    <div className="text-rose-500 mt-1">{latestExecution.stderr}</div>
                  )}
                  {latestExecution.stdout_truncated && (
                    <div className="text-amber-500 italic mt-1">[Output truncated at 10 KB]</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
