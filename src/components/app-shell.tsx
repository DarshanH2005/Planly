"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  GraduationCap,
  BookOpen,
  Code2,
  CheckCircle2,
  Layers,
  Target,
  FolderGit2,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { Tip } from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette } from "@/components/command-palette";

const groups = [
  {
    label: "Learn",
    items: [
      { label: "Today", href: "/today", icon: CalendarDays, tip: "Continue · capacity" },
      { label: "Coach", href: "/coach", icon: GraduationCap, tip: "Main learning chat" },
      { label: "Classrooms", href: "/classrooms", icon: GraduationCap, tip: "Quiet adaptive tutor" },
      { label: "Prep", href: "/prep", icon: BookOpen, tip: "198 problems · 19 families" },
    ],
  },
  {
    label: "Train",
    items: [
      { label: "Repairs", href: "/repairs", icon: Code2, tip: "Drill → unfamiliar retest" },
      { label: "Sprints", href: "/sprints", icon: Layers, tip: "14-day plan + diff" },
    ],
  },
  {
    label: "Prove",
    items: [
      { label: "Evidence", href: "/evidence", icon: CheckCircle2, tip: "Readiness by round" },
      { label: "Weekly", href: "/weekly", icon: CalendarDays, tip: "Calibration & review" },
      { label: "Targets", href: "/targets", icon: Target, tip: "Company targets" },
      { label: "Projects", href: "/projects", icon: FolderGit2, tip: "Portfolio deep dives" },
    ],
  },
] as const;

const mobileTabs = [
  { label: "Today", href: "/today", icon: CalendarDays },
  { label: "Rooms", href: "/classrooms", icon: GraduationCap },
  { label: "Prep", href: "/prep", icon: BookOpen },
  { label: "Proof", href: "/evidence", icon: CheckCircle2 },
] as const;

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Tip label={dark ? "Switch to light" : "Switch to dark"}>
      <button
        onClick={() => {
          const el = document.documentElement;
          const next = !el.classList.contains("dark");
          el.classList.toggle("dark", next);
          el.classList.toggle("light", !next);
          try {
            localStorage.setItem("planly-theme", next ? "dark" : "light");
          } catch {}
          setDark(next);
        }}
        aria-label="Toggle theme"
        className="pressable rounded-lg border border-border bg-surface p-1.5 text-muted hover:bg-surface-hover hover:text-foreground"
      >
        {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>
    </Tip>
  );
}

function NavLink({
  href,
  label,
  tip,
  Icon,
  active,
  collapsed = false,
}: {
  href: string;
  label: string;
  tip: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed?: boolean;
}) {
  return (
    <Tip label={tip}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "pressable relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium",
          collapsed && "justify-center px-2",
          active ? "text-foreground" : "text-muted hover:bg-surface-muted/70 hover:text-foreground"
        )}
      >
        {active && (
          <motion.span
            layoutId="sota-nav-pill"
            className="absolute inset-0 rounded-lg border border-border bg-surface-muted"
            transition={{ type: "spring", stiffness: 550, damping: 38 }}
          />
        )}
        <Icon className="relative h-[15px] w-[15px]" />
        {!collapsed && <span className="relative">{label}</span>}
      </Link>
    </Tip>
  );
}

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");
  const isImmersiveClassroom = pathname === "/coach" || /^\/classrooms\/[^/]+/.test(pathname ?? "");

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className={cn(
        "glass-strong sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface/60 md:flex",
        isImmersiveClassroom ? "w-[68px]" : "w-[232px]"
      )}>
        <div className={cn("flex h-[60px] items-center gap-2.5", isImmersiveClassroom ? "justify-center px-2" : "px-4")}>
          <Link href="/today" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-foreground font-display text-[15px] text-background">
              P
            </span>
            {!isImmersiveClassroom && <span className="flex items-baseline gap-2">
              <span className="font-display text-[17px] tracking-tight">Planly</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Workbench</span>
            </span>}
          </Link>
        </div>
        <nav aria-label="Primary" className={cn("stagger flex-1 space-y-5 overflow-y-auto pb-4", isImmersiveClassroom ? "px-2" : "px-2.5")}>
          {groups.map((g, gi) => (
            <div key={g.label}>
              <p className={cn("flex items-baseline gap-1.5 px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted", isImmersiveClassroom && "sr-only")}>
                <span className="font-mono font-normal text-muted/70">0{gi + 1}</span>
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} tip={item.tip} Icon={item.icon} active={isActive(item.href)} collapsed={isImmersiveClassroom} />
                ))}
              </div>
            </div>
          ))}
          <div>
            <p className={cn("flex items-baseline gap-1.5 px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted", isImmersiveClassroom && "sr-only")}>
              <span className="font-mono font-normal text-muted/70">04</span>
              System
            </p>
            <NavLink href="/settings" label="Settings" tip="Profile + backup" Icon={Settings} active={isActive("/settings")} collapsed={isImmersiveClassroom} />
          </div>
        </nav>
        <div className={cn("border-t border-border/70 p-3", isImmersiveClassroom && "p-2")}>
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-[10px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {!isImmersiveClassroom && "CRED / BigTech"}
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-strong sticky top-0 z-30 border-b border-border bg-surface/85">
          <div className={cn("mx-auto flex h-[60px] w-full items-center justify-between gap-3 px-4 md:px-6", !isImmersiveClassroom && "max-w-[1280px]")}>
            <Link href="/today" className="flex items-center gap-2 md:hidden">
              <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-foreground font-display text-[14px] text-background">P</span>
              <span className="font-display text-[16px] tracking-tight">Planly</span>
            </Link>
            <div className="hidden md:block">
              <CommandPalette />
            </div>
            <div className="flex items-center gap-2">
              <div className="md:hidden">
                <CommandPalette />
              </div>
              <ThemeToggle />
              <UserMenu email={email} />
            </div>
          </div>
        </header>

        <main id="main" className={cn(
          "mx-auto w-full flex-1",
          isImmersiveClassroom ? "max-w-none p-0" : "max-w-[1280px] px-4 py-6 pb-24 md:px-6 md:py-8 md:pb-10"
        )}>
          {children}
        </main>

        <footer className={cn("hidden border-t border-border/70 py-4 md:block", isImmersiveClassroom && "md:hidden")}>
          <p className="mx-auto max-w-[1280px] px-6 text-center text-[11px] text-muted">
            Private workbench · <span className="kbd">⌘K</span> to jump anywhere
          </p>
        </footer>
      </div>

      {/* Mobile bottom bar — 4 tabs only */}
      <nav aria-label="Primary mobile" className="glass-strong fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/92 pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-4 px-2 py-1.5">
          {mobileTabs.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "pressable flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium",
                  active ? "text-foreground" : "text-muted"
                )}
              >
                <span className={cn("flex h-7 items-center justify-center rounded-full px-4", active && "bg-foreground text-background")}>
                  <Icon className="h-4 w-4" />
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
