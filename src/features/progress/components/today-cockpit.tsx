"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Play,
  Clock,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Moon,
  Coffee,
  Zap,
  CheckCircle2,
} from "lucide-react";
import type { TodayState, GrowthNotes } from "../service";
import { setDailyMode, submitGrowthNotes } from "../actions";
import { Badge, Progress } from "@/components/ui/badge";
import { Button, Card } from "@/components/ui/button";
import { PageHeader, EmptyState, inputCls } from "@/components/ui/page";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { Rise, Stagger, Item } from "@/components/ui/motion";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/components/ui/cn";

interface TodayCockpitProps {
  initialState: TodayState;
}

const MODES = [
  { id: "full" as const, label: "Full", sub: "75m", icon: Zap, tip: "Standard training day" },
  { id: "minimum_day" as const, label: "Minimum", sub: "12m", icon: Coffee, tip: "12-min continuity" },
  { id: "rest_day" as const, label: "Rest", sub: "0m", icon: Moon, tip: "Zero — recovery counts" },
];

export function TodayCockpit({ initialState }: TodayCockpitProps) {
  const [state, setState] = useState<TodayState>(initialState);
  const [isPending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(state.capacity.declaredMinutes);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesForm, setNotesForm] = useState<GrowthNotes>(
    state.growthNotes ?? {
      date: state.date,
      sleepHours: 7.5,
      energyRating: 4,
      movementNote: "20 min walk",
      reflection: "",
    }
  );

  const handleModeSelect = (mode: "full" | "minimum_day" | "rest_day") => {
    startTransition(async () => {
      const res = await setDailyMode(mode);
      if (res.ok) {
        setState(res.data);
        toast.success(mode === "rest_day" ? "Rest day set — recovery is training." : `Switched to ${mode.replace("_", " ")}.`);
      } else {
        toast.error("Could not change mode.");
      }
    });
  };

  const handleCustomCapacitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await setDailyMode("custom", customMinutes);
      if (res.ok) {
        setState(res.data);
        setCustomOpen(false);
        toast.success(`Capacity set — ${Math.floor(customMinutes * 0.8)}m budget.`);
      } else {
        toast.error("Could not apply capacity.");
      }
    });
  };

  const handleNotesSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await submitGrowthNotes(notesForm);
      if (res.ok) {
        setState((prev) => ({ ...prev, growthNotes: notesForm }));
        setNotesOpen(false);
        toast.success("Growth notes saved.");
      } else {
        toast.error("Could not save notes.");
      }
    });
  };

  const usedPct =
    state.capacity.effectiveBudget > 0
      ? (state.capacity.committedMinutes / state.capacity.effectiveBudget) * 100
      : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <Rise>
        <PageHeader
          kicker="Field log"
          title="Today's focus"
          description="One main session, one lesson, one recall. Capacity guards the rest."
          meta={
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[11px] text-muted">
              {state.date}
            </span>
          }
          actions={
            <>
              <div className="flex rounded-xl border border-border bg-surface p-1 shadow-xs" role="group" aria-label="Day mode">
                {MODES.map((m) => {
                  const active = state.capacity.mode === m.id;
                  const Icon = m.icon;
                  return (
                    <Tip key={m.id} label={m.tip}>
                      <button
                        onClick={() => handleModeSelect(m.id)}
                        disabled={isPending}
                        aria-pressed={active}
                        className={cn(
                          "pressable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                          active ? "bg-foreground text-background shadow-sm" : "text-muted hover:bg-surface-muted hover:text-foreground"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {m.label}
                        <span className={cn("font-mono text-[10px]", active ? "opacity-70" : "text-muted/70")}>{m.sub}</span>
                      </button>
                    </Tip>
                  );
                })}
              </div>
              <Button variant="secondary" onClick={() => setCustomOpen(true)}>
                Change capacity
              </Button>
              <Button
                variant="secondary"
                onClick={() => setNotesOpen(true)}
                className="border-success/30 bg-success/[0.07] text-success hover:bg-success/[0.12]"
              >
                <Sparkles className="h-3.5 w-3.5" /> Growth notes
              </Button>
            </>
          }
        />
      </Rise>

      {state.replanningMessage && (
        <Rise index={1}>
          <div className="flex items-start gap-3 rounded-[20px] border border-warning/30 bg-warning/[0.07] p-4" role="status">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15">
              <AlertTriangle className="h-4 w-4 text-warning" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Schedule adapted · no work deleted</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{state.replanningMessage}</p>
            </div>
          </div>
        </Rise>
      )}

      {/* Bento home grid — hero + tiles, same data flows */}
      <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <Item className="md:col-span-4">
          <Link
            href="/classrooms"
            className="tile tile-hover group relative flex h-full items-center justify-between gap-3 overflow-hidden p-6"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
            <span className="flex items-center gap-4 pl-1">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-xs transition-transform duration-200 ease-out group-hover:scale-[1.05]">
                <Play className="h-4 w-4 fill-current" />
              </span>
              <span>
                <span className="block font-display text-[22px] leading-none">Continue</span>
                <span className="mt-1.5 block text-[12.5px] text-muted">Resume the pending question where you left off — <em className="font-display">no re-setup.</em></span>
              </span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted transition-transform duration-160 ease-out group-hover:translate-x-1 group-hover:text-foreground" />
          </Link>
        </Item>
        <Item className="md:col-span-2">
          <Card className="tile h-full p-5">
            <h3 className="mb-3 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Capacity <span className="font-mono font-normal text-muted/70">80% guard</span>
            </h3>
            <div className="mb-2 flex items-end justify-between">
              <span className="stat font-mono text-[34px] font-semibold leading-none">
                {state.capacity.committedMinutes}
                <span className="text-sm font-normal text-muted">/{state.capacity.effectiveBudget}m</span>
              </span>
            </div>
            <Progress value={usedPct} tone={usedPct > 95 ? "amber" : "blue"} />
            <dl className="mt-4 space-y-2 text-[12px]">
              <div className="flex justify-between border-b border-border/60 pb-1.5">
                <dt className="text-muted">Remaining</dt>
                <dd className={cn("font-mono font-semibold", state.capacity.remainingMinutes > 0 ? "text-success" : "text-muted")}>
                  {state.capacity.remainingMinutes}m{state.capacity.remainingMinutes === 0 ? " · full" : ""}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Mode</dt>
                <dd className="font-medium capitalize">{state.capacity.mode.replace("_", " ")}</dd>
              </div>
            </dl>
          </Card>
        </Item>
        <Item className="md:col-span-6">
          {state.focusTask ? (
            <Card className="tile relative overflow-hidden p-0">
              <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
              <div className="p-6 pl-7">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">Primary · {state.focusTask.stage}</Badge>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
                    <Clock className="h-3.5 w-3.5" />
                    {state.focusTask.totalMinutes}m · {state.focusTask.durationMinutes}m + {state.focusTask.debriefMinutes}m debrief
                  </span>
                  <span className="mx-1 hidden h-3 w-px bg-border sm:block" />
                  <Tip label="Content hash pinned — retest stays unseen">
                    <span className="inline-flex cursor-help items-center gap-1 text-[11px] font-medium text-success">
                      <ShieldCheck className="h-3.5 w-3.5" /> Validated · {state.focusTask.promptId}
                    </span>
                  </Tip>
                </div>
                <h2 className="max-w-3xl text-balance font-display text-[22px] font-medium leading-[1.15] tracking-[-0.015em]">
                  {state.focusTask.title}
                </h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">
                  <span className="font-semibold text-foreground">Why now — </span>
                  {state.focusTask.reason}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <Button asChild size="md">
                    <Link href={`/arena/${state.focusTask.packId.toLowerCase()}`}>
                      <Play className="fill-current" /> Start session
                    </Link>
                  </Button>
                  <Button variant="outline" size="md" asChild>
                    <Link href="/prep">
                      Pattern card <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-10 text-center">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-muted">
                <Moon className="h-6 w-6 text-muted" />
              </span>
              <h2 className="text-[15px] font-semibold">Rest day — recovery is training</h2>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
                No timed sessions. Planned work moved to adequate openings.
              </p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => handleModeSelect("full")}>
                <RotateCcw className="h-3 w-3" /> Resume standard schedule
              </Button>
            </Card>
          )}
        </Item>

        <Item className="md:col-span-6">
          <div className="grid grid-cols-1 gap-4">
            <Card className="tile p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Supporting slots</h3>
                <Badge tone="zinc">{state.supportingSlots.length} active</Badge>
              </div>
              {state.supportingSlots.length > 0 ? (
                <ul className="space-y-2">
                  {state.supportingSlots.map((slot) => (
                    <li
                      key={slot.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface-muted/50 px-3.5 py-2.5 transition-[border-color] duration-160 ease-out hover:border-border-strong"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{slot.title}</p>
                        <p className="truncate text-[11px] text-muted">{slot.description}</p>
                      </div>
                      <span className="shrink-0 rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">
                        {slot.durationMinutes}m
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No supporting slots" description="Full capacity is on the primary session. Recall appears here when due." />
              )}
            </Card>
          </div>
        </Item>
      </Stagger>

      {/* Custom capacity dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Declare today&apos;s capacity</DialogTitle>
            <DialogDescription>
              We schedule at most 80% of what you declare. Buffer absorbs transitions and overruns.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCustomCapacitySubmit} className="space-y-4">
            <div>
              <label htmlFor="custom-min" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Available minutes
              </label>
              <input
                id="custom-min"
                type="number"
                min={10}
                max={300}
                step={5}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Number(e.target.value))}
                className={inputCls}
              />
              <p className="mt-1.5 font-mono text-xs text-muted">→ {Math.floor(customMinutes * 0.8)}m schedulable budget</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCustomOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                Apply buffer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Growth notes dialog */}
      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-success" /> Growth notes · {state.date}
            </DialogTitle>
            <DialogDescription>Private. Never scored. Sleep, energy, movement + one next action.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleNotesSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">Sleep (h)</label>
              <input
                type="number" step="0.5" min="0" max="24"
                value={notesForm.sleepHours ?? 7}
                onChange={(e) => setNotesForm((p) => ({ ...p, sleepHours: Number(e.target.value) }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">Energy 1–5</label>
              <select
                value={notesForm.energyRating ?? 3}
                onChange={(e) => setNotesForm((p) => ({ ...p, energyRating: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 }))}
                className={inputCls}
              >
                <option value="1">1 · Depleted</option>
                <option value="2">2 · Fatigued</option>
                <option value="3">3 · Workable</option>
                <option value="4">4 · High clarity</option>
                <option value="5">5 · Flow</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">Movement</label>
              <input
                type="text" placeholder="20m walk"
                value={notesForm.movementNote ?? ""}
                onChange={(e) => setNotesForm((p) => ({ ...p, movementNote: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted">Reflection + next action</label>
              <textarea
                rows={2}
                placeholder="Main takeaway? Single next action?"
                value={notesForm.reflection ?? ""}
                onChange={(e) => setNotesForm((p) => ({ ...p, reflection: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="flex items-center justify-end gap-2 sm:col-span-3">
              <span className="mr-auto flex items-center gap-1.5 text-[11px] text-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saved to owned storage
              </span>
              <Button type="button" variant="ghost" onClick={() => setNotesOpen(false)}>
                Close
              </Button>
              <Button type="submit" disabled={isPending} variant="success">
                Save notes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
