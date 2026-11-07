"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  CalendarDays,
  Layers,
  BookOpen,
  Code2,
  CheckCircle2,
  Settings,
  Search,
  GraduationCap,
  Play,
  Brain,
} from "lucide-react";

const ACTIONS = [
  { label: "Continue learning", href: "/classrooms", icon: Play, hint: "Resume pending Q" },
  { label: "Today's focus", href: "/today", icon: CalendarDays, hint: "Capacity" },
  { label: "Open memory", href: "/classrooms", icon: Brain, hint: "Press M inside" },
];

const ITEMS = [
  { label: "Classrooms · quiet tutor", href: "/classrooms", icon: GraduationCap, hint: "Adaptive chat" },
  { label: "Sprints · 14-day plan", href: "/sprints", icon: Layers, hint: "Capacity" },
  { label: "Prep hub · 198 problems", href: "/prep", icon: BookOpen, hint: "Patterns" },
  { label: "Repairs & retests", href: "/repairs", icon: Code2, hint: "Weakness" },
  { label: "Evidence & readiness", href: "/evidence", icon: CheckCircle2, hint: "By round" },
  { label: "Weekly review", href: "/weekly", icon: CalendarDays, hint: "Calibration" },
  { label: "Settings", href: "/settings", icon: Settings, hint: "Profile" },
];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="pressable hidden items-center gap-2 rounded-lg border border-border bg-surface-muted/60 px-2.5 py-1.5 text-xs text-muted hover:bg-surface-muted hover:text-foreground md:flex"
        aria-label="Open command palette (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Jump to…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>
      <button
        onClick={() => setOpen(true)}
        className="pressable flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-muted hover:text-foreground md:hidden"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[14vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          {/* No open animation: keyboard-initiated (⌘K) actions must feel instant */}
          <div className="glass popover-origin w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-popover shadow-lg" onClick={(e) => e.stopPropagation()}>
            <Command label="Jump to page" className="[&_[cmdk-input]]:w-full">
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 text-muted" />
                <Command.Input
                  autoFocus
                  placeholder="Type a destination — today, arena, evidence…"
                  className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted"
                />
              </div>
              <Command.List className="max-h-[320px] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-xs text-muted">No match. Try “prep” or “repair”.</Command.Empty>
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                  {ACTIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.label}
                        value={`${item.label} ${item.hint}`}
                        onSelect={() => {
                          setOpen(false);
                          router.push(item.href);
                        }}
                        className="pressable flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-surface-muted"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-medium">{item.label}</span>
                        <span className="ml-auto text-[11px] text-muted">{item.hint}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
                <Command.Group heading="Workspace" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                  {ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Command.Item
                        key={item.href}
                        value={`${item.label} ${item.hint}`}
                        onSelect={() => {
                          setOpen(false);
                          router.push(item.href);
                        }}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-surface-muted"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-muted">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-medium">{item.label}</span>
                        <span className="ml-auto text-[11px] text-muted">{item.hint}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </Command.List>
              <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10.5px] text-muted">
                <span className="flex items-center gap-1"><kbd className="kbd">↑↓</kbd> move</span>
                <span className="flex items-center gap-1"><kbd className="kbd">↵</kbd> open</span>
                <span className="flex items-center gap-1"><kbd className="kbd">esc</kbd> close</span>
                <span className="ml-auto font-mono">Planly</span>
              </div>
            </Command>
          </div>
        </div>
      )}
    </>
  );
}
