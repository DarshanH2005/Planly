"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Code2,
  BookOpen,
  CheckCircle2,
  Settings,
  Layers,
  Target,
  FolderGit2,
  Moon,
  Sun,
  GraduationCap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { Tip } from "@/components/ui/tooltip";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette } from "@/components/command-palette";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tip: string;
}

export const navItems: readonly NavItem[] = [
  { label: "Today", href: "/today", icon: CalendarDays, tip: "Primary session + capacity" },
  { label: "Classroom", href: "/classrooms", icon: GraduationCap, tip: "Quiet classroom · Adaptive DSA tutor" },
  { label: "Sprints", href: "/sprints", icon: Layers, tip: "14-day plan + diff" },
  { label: "Prep", href: "/prep", icon: BookOpen, tip: "198 problems · 19 families" },
  { label: "Repairs", href: "/repairs", icon: Code2, tip: "Drill → unfamiliar retest" },
  { label: "Evidence", href: "/evidence", icon: CheckCircle2, tip: "Readiness by round" },
  { label: "Targets", href: "/targets", icon: Target, tip: "Company targets & deadlines" },
  { label: "Projects", href: "/projects", icon: FolderGit2, tip: "Portfolio deep dives" },
  { label: "Weekly", href: "/weekly", icon: CalendarDays, tip: "Calibration & review" },
  { label: "Settings", href: "/settings", icon: Settings, tip: "Profile + backup" },
];

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
      <motion.button
        whileTap={{ scale: 0.9, rotate: 12 }}
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
        className="rounded-lg border border-border bg-surface p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </motion.button>
    </Tip>
  );
}

export function WorkspaceNav({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] w-full max-w-[1280px] items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/today" className="group flex shrink-0 items-center gap-2.5">
            <motion.span
              whileHover={{ rotate: -4 }}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-foreground font-display text-[15px] text-background"
            >
              P
            </motion.span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[17px] tracking-tight">Planly</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:inline">
                Workbench
              </span>
            </span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
            {navItems.map((item) => {
              const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href + "/"));
              const Icon = item.icon;
              return (
                <Tip key={item.href} label={item.tip}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      active ? "text-foreground" : "text-muted hover:bg-surface-muted/70 hover:text-foreground"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-lg bg-surface-muted"
                        transition={{ type: "spring", stiffness: 500, damping: 38 }}
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5" />
                    <span className="relative">{item.label}</span>
                  </Link>
                </Tip>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CommandPalette />
          <div className="hidden items-center gap-2 border-l border-border pl-3 font-mono text-[11px] text-muted md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            CRED / BigTech
          </div>
          <ThemeToggle />
          <UserMenu email={email} />
        </div>
      </div>
      <nav aria-label="Primary mobile" className="border-t border-border/70 px-3 py-2 lg:hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href + "/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "pressable flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                  active ? "bg-foreground text-background shadow-sm" : "bg-surface-muted/60 text-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
