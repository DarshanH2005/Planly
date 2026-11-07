"use client";

import * as React from "react";
import { Brain, History, FlaskConical, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MessageRecord, LessonMicroGoal, TeachingDecision } from "@/lib/api/learning-client";

interface MemoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingQuestion: string | null;
  messages: MessageRecord[];
  microGoals: LessonMicroGoal[];
  decisions: TeachingDecision[];
  savedRevision: number;
}

export function MemoryDrawer({
  open,
  onOpenChange,
  pendingQuestion,
  messages,
  microGoals,
  decisions,
  savedRevision,
}: MemoryDrawerProps) {
  const [tab, setTab] = React.useState<"memory" | "history" | "evidence">("memory");
  const lastDecision = decisions.length > 0 ? decisions[decisions.length - 1] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-label="Memory and history">
        <SheetHeader>
          <SheetTitle>Memory</SheetTitle>
          <SheetDescription>
            Saved state · rev {savedRevision} · corrections supersede, history is kept
          </SheetDescription>
        </SheetHeader>

        <div className="flex gap-1 rounded-lg border border-border bg-surface-muted/50 p-1 mx-5 mb-3" role="tablist" aria-label="Memory sections">
          {(
            [
              { id: "memory", label: "Memory", icon: Brain },
              { id: "history", label: "History", icon: History },
              { id: "evidence", label: "Evidence", icon: FlaskConical },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`pressable flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
                  active ? "bg-background text-foreground shadow-xs" : "text-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <SheetBody>
          {tab === "memory" && (
            <div className="space-y-3">
              {pendingQuestion && (
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Pending question</p>
                  <p className="mt-1 text-[13px] italic leading-relaxed text-foreground">{pendingQuestion}</p>
                </div>
              )}
              {lastDecision ? (
                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Last teaching decision</p>
                    <Badge tone="neutral" className="text-[10px]">{lastDecision.next_action}</Badge>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-strong">
                    {lastDecision.uncertainty_reason || lastDecision.assessment || "Assessed from source-linked evidence."}
                  </p>
                  {lastDecision.discriminating_probe && (
                    <p className="mt-1.5 text-[12.5px] italic text-foreground">Probe: {lastDecision.discriminating_probe}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface/50 p-4 text-center text-xs text-muted">
                  No teaching decision yet — unknown stays unknown.
                </div>
              )}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Micro-goals ({microGoals.length})
                </p>
                {microGoals.length === 0 ? (
                  <p className="text-xs text-muted">No micro-goals recorded for this session.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {microGoals.slice(-8).map((g, i) => (
                      <li key={g.goal_id ?? i} className="flex items-start justify-between gap-2 rounded-lg border border-border/70 bg-surface/60 px-2.5 py-2 text-xs">
                        <span className="text-foreground">{g.description || `Goal ${i + 1}`}</span>
                        <Badge tone={g.status === "done" ? "emerald" : "neutral"} className="shrink-0 text-[10px]">
                          {g.status || "open"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs text-muted" onClick={() => onOpenChange(false)}>
                <Undo2 className="h-3.5 w-3.5" /> Correct something? Tell the tutor in chat — it supersedes, never deletes.
              </Button>
            </div>
          )}

          {tab === "history" && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Turns ({messages.length})
              </p>
              {messages.length === 0 ? (
                <p className="text-xs text-muted">No turns yet. Your first answer starts the record.</p>
              ) : (
                <ol className="space-y-1.5">
                  {[...messages].slice(-30).reverse().map((m, i) => (
                    <li key={m.id || i} className="rounded-lg border border-border/70 bg-surface/60 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2 text-[10px] text-muted">
                        <span className="font-semibold capitalize">{m.sender_role === "learner" ? "You" : "Tutor"}</span>
                        {m.created_at && (
                          <span suppressHydrationWarning>
                            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-strong">{m.content}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {tab === "evidence" && (
            <div className="space-y-2">
              <div className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted-strong">
                Artifact rev <span className="font-mono text-foreground">{savedRevision}</span> · learner code vs
                tutor code kept separate · execution provenance recorded on run.
              </div>
              {decisions.length === 0 ? (
                <p className="text-xs text-muted">No assessed evidence yet. Submit an answer to create the first record.</p>
              ) : (
                <ol className="space-y-1.5">
                  {[...decisions].slice(-10).reverse().map((d, i) => (
                    <li key={d.decision_id ?? i} className="rounded-lg border border-border/70 bg-surface/60 px-2.5 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{d.next_action || "Decision"}</span>
                        <span className="font-mono text-[10px] text-muted">{d.assessment || "unassessed"}</span>
                      </div>
                      <p className="mt-1 font-mono text-[10.5px] text-muted">
                        rev {d.expected_revision} · {d.policy_version || d.model_version || "policy"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
