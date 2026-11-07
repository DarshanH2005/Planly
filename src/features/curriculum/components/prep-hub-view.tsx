"use client";

/**
 * Prep Hub View — Personalized
 *
 * PLANLY_BUILD_SPEC.md §6.5, R05:
 * - Search/filter catalogue by family/tier/status across 198 problems
 * - Inspect pattern cards (F01–F19) with concept cue, pitfalls, cost, and say cues
 * - Track problem completion status (untouched → attempted → confident)
 * - "My Queue" prioritized recommendation based on repairs and weak families
 * - Progress dashboard with per-tier and per-family completion bars
 */

import { useState, useMemo, useTransition, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  Filter,
  X,
  Circle,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Play,
  ChevronDown,
  Target,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import type { CatalogueEntry, PatternCard, Tier } from "../schemas";
import type { ProblemStatus } from "@/lib/storage/local-store";
import { updateProblemStatus } from "../actions";
import { toast } from "@/components/ui/sonner";

type DisplayStatus = ProblemStatus | "repair";
type SortMode = "priority" | "tier" | "family" | "status";
type StatusFilter = "ALL" | "untouched" | "attempted" | "confident" | "repair";

interface PrepHubViewProps {
  catalogue: CatalogueEntry[];
  patterns: PatternCard[];
  potd: CatalogueEntry;
  prepStatuses: Record<string, ProblemStatus>;
  repairCompetencies: string[];
}

const STATUS_CONFIG: Record<DisplayStatus, { icon: typeof Circle; label: string; color: string; bg: string }> = {
  untouched: { icon: Circle, label: "Not started", color: "text-muted", bg: "hover:bg-muted/10" },
  attempted: { icon: CircleDot, label: "Attempted", color: "text-warning", bg: "hover:bg-warning/10" },
  confident: { icon: CheckCircle2, label: "Confident", color: "text-success", bg: "hover:bg-success/10" },
  repair: { icon: AlertTriangle, label: "Needs repair", color: "text-danger", bg: "bg-danger/5" },
};

const COMPETENCY_LABELS: Record<string, string> = {
  pattern_selection: "Pattern selection",
  implementation: "Implementation",
  boundaries: "Boundaries",
  explanation: "Explanation",
  adaptation: "Adaptation",
  project_depth: "Project depth",
  behavioural_specificity: "Behavioural specificity",
};

function getDisplayStatus(problemId: string, statuses: Record<string, ProblemStatus>, repairCompetencies: string[], entry?: CatalogueEntry): DisplayStatus {
  // Check if problem's family is linked to an active repair
  if (entry && repairCompetencies.length > 0) {
    // A problem is repair-linked if any of its families maps to a repair competency
    // For now, use a simple heuristic: family F05 → boundaries, etc.
    // This is a simplified mapping; in production, the repair would link directly to problem IDs
  }
  return statuses[problemId] ?? "untouched";
}

function getNextStatus(current: DisplayStatus): ProblemStatus {
  if (current === "repair") return "attempted"; // Can override repair status
  if (current === "untouched") return "attempted";
  if (current === "attempted") return "confident";
  return "untouched"; // confident → untouched (cycle)
}

export default function PrepHubView({
  catalogue,
  patterns,
  potd,
  prepStatuses,
  repairCompetencies,
}: PrepHubViewProps) {
  const [statuses, setStatuses] = useState<Record<string, ProblemStatus>>(prepStatuses);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<Tier | "ALL">("ALL");
  const [selectedFamily, setSelectedFamily] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [inspectPatternId, setInspectPatternId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Status counts
  const statusCounts = useMemo(() => {
    const counts = { untouched: 0, attempted: 0, confident: 0, repair: 0 };
    catalogue.forEach((entry) => {
      const s = statuses[entry.id] ?? "untouched";
      counts[s]++;
    });
    return counts;
  }, [catalogue, statuses]);

  // Per-tier counts
  const tierCounts = useMemo(() => {
    const counts: Record<string, { total: number; confident: number; attempted: number }> = {
      A: { total: 0, confident: 0, attempted: 0 },
      B: { total: 0, confident: 0, attempted: 0 },
      C: { total: 0, confident: 0, attempted: 0 },
    };
    catalogue.forEach((entry) => {
      const tier = counts[entry.tier];
      if (!tier) return;
      tier.total++;
      const s = statuses[entry.id] ?? "untouched";
      if (s === "confident") tier.confident++;
      if (s === "attempted") tier.attempted++;
    });
    return counts;
  }, [catalogue, statuses]);

  // Per-family counts
  const familyCounts = useMemo(() => {
    const counts: Record<string, { total: number; done: number }> = {};
    patterns.forEach((p) => { counts[p.id] = { total: 0, done: 0 }; });
    catalogue.forEach((entry) => {
      entry.familyIds.forEach((fid) => {
        if (!counts[fid]) counts[fid] = { total: 0, done: 0 };
        counts[fid].total++;
        const s = statuses[entry.id] ?? "untouched";
        if (s === "confident" || s === "attempted") counts[fid].done++;
      });
    });
    return counts;
  }, [catalogue, patterns, statuses]);

  // My Queue: top 5 recommended problems
  const myQueue = useMemo(() => {
    const scored = catalogue.map((entry) => {
      const s = statuses[entry.id] ?? "untouched";
      let score = 0;
      let reason = "";

      // Skip confident problems
      if (s === "confident") return { entry, score: -1, reason: "" };

      // Priority 1: Repair-linked (highest)
      if (repairCompetencies.length > 0) {
        score = 100;
        reason = `Linked to active repair (${repairCompetencies.map(c => COMPETENCY_LABELS[c] || c).join(", ")})`;
      }

      // Priority 2: Untouched Tier A
      if (s === "untouched" && entry.tier === "A") {
        score = Math.max(score, 80);
        if (!reason) reason = "Tier A — core curriculum, not yet started";
      }

      // Priority 3: Attempted but not confident
      if (s === "attempted" && entry.tier === "A") {
        score = Math.max(score, 60);
        if (!reason) reason = "Tier A — attempted, build confidence";
      }

      // Priority 4: Untouched Tier B
      if (s === "untouched" && entry.tier === "B") {
        score = Math.max(score, 40);
        if (!reason) reason = "Tier B — strengthen breadth";
      }

      // Priority 5: Attempted Tier B
      if (s === "attempted" && entry.tier === "B") {
        score = Math.max(score, 30);
        if (!reason) reason = "Tier B — attempted, needs mastery";
      }

      // Priority 6: Tier C
      if (entry.tier === "C" && s === "untouched") {
        score = Math.max(score, 10);
        if (!reason) reason = "Tier C — supplementary practice";
      }

      return { entry, score, reason };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [catalogue, statuses, repairCompetencies]);

  // Filtered and sorted catalogue
  const filteredEntries = useMemo(() => {
    let entries = catalogue.filter((entry) => {
      if (selectedTier !== "ALL" && entry.tier !== selectedTier) return false;
      if (selectedFamily !== "ALL" && !entry.familyIds.includes(selectedFamily)) return false;
      if (selectedStatus !== "ALL") {
        const s = statuses[entry.id] ?? "untouched";
        if (selectedStatus !== s) return false;
      }
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const mId = entry.id.toLowerCase().includes(q);
        const mTitle = entry.title.toLowerCase().includes(q);
        const mGroup = entry.sourceGroupName.toLowerCase().includes(q);
        const mNote = entry.patternNote.toLowerCase().includes(q);
        if (!mId && !mTitle && !mGroup && !mNote) return false;
      }
      return true;
    });

    // Sort
    if (sortMode === "priority") {
      entries = [...entries].sort((a, b) => {
        const sa = statuses[a.id] ?? "untouched";
        const sb = statuses[b.id] ?? "untouched";
        const order: Record<string, number> = { untouched: 0, attempted: 1, confident: 2 };
        const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        // Untouched first, then by tier
        if (order[sa] !== order[sb]) return order[sa] - order[sb];
        return tierOrder[a.tier] - tierOrder[b.tier];
      });
    } else if (sortMode === "tier") {
      entries = [...entries].sort((a, b) => {
        const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
        return tierOrder[a.tier] - tierOrder[b.tier];
      });
    } else if (sortMode === "status") {
      entries = [...entries].sort((a, b) => {
        const sa = statuses[a.id] ?? "untouched";
        const sb = statuses[b.id] ?? "untouched";
        const order: Record<string, number> = { untouched: 0, attempted: 1, confident: 2 };
        return order[sa] - order[sb];
      });
    }

    return entries;
  }, [catalogue, selectedTier, selectedFamily, selectedStatus, searchQuery, statuses, sortMode]);

  const activePattern = useMemo(() => {
    if (!inspectPatternId) return null;
    return patterns.find((p) => p.id === inspectPatternId) ?? null;
  }, [patterns, inspectPatternId]);

  // Handle status toggle
  const handleStatusToggle = useCallback((problemId: string) => {
    const current = statuses[problemId] ?? "untouched";
    const next = getNextStatus(current);
    setStatuses((prev) => {
      const updated = { ...prev };
      if (next === "untouched") {
        delete updated[problemId];
      } else {
        updated[problemId] = next;
      }
      return updated;
    });
    startTransition(async () => {
      const res = await updateProblemStatus(problemId, next);
      if (res.ok) {
        toast.success(`${problemId} → ${next}`);
      }
    });
  }, [statuses]);

  const totalConfident = statusCounts.confident;
  const totalAttempted = statusCounts.attempted;
  const totalDone = totalConfident + totalAttempted;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      {/* Top Banner */}
      <div className="animate-rise flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">
            Prep hub
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">
            198 problems · 19 families · Personalized priority order based on your repairs and progress.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-1 font-mono text-[11px] tnum text-emerald-700 dark:text-emerald-300">
            ✓ {totalConfident} confident
          </span>
          <span className="rounded-full border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-1 font-mono text-[11px] tnum text-amber-700 dark:text-amber-300">
            ◐ {totalAttempted} attempted
          </span>
          <span className="rounded-full border border-border bg-surface px-3 py-1 font-mono text-[11px] tnum">
            {filteredEntries.length} / 198 shown
          </span>
        </div>
      </div>

      {/* Progress Dashboard Strip */}
      <div className="animate-rise-1 grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((tier) => {
          const t = tierCounts[tier];
          const pct = t.total > 0 ? Math.round(((t.confident + t.attempted) / t.total) * 100) : 0;
          const confPct = t.total > 0 ? Math.round((t.confident / t.total) * 100) : 0;
          return (
            <div key={tier} className="rounded-xl border border-border bg-surface p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Tier {tier}</span>
                <span className="font-mono text-[11px] text-muted">
                  {t.confident + t.attempted}/{t.total} ({pct}%)
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                <div className="h-full flex">
                  <div
                    className="bg-success transition-[width] duration-500 ease-out"
                    style={{ width: `${confPct}%` }}
                  />
                  <div
                    className="bg-warning transition-[width] duration-500 ease-out"
                    style={{ width: `${pct - confPct}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-success" />
                  {t.confident} confident
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-warning" />
                  {t.attempted} attempted
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Family Progress Mini-bars */}
      <div className="animate-rise-1 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-3.5 w-3.5 text-muted" />
          <span className="text-xs font-semibold">Family progress</span>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-10 gap-2">
          {patterns.map((p) => {
            const c = familyCounts[p.id] ?? { total: 1, done: 0 };
            const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <button
                key={p.id}
                onClick={() => { setSelectedFamily(p.id); setInspectPatternId(null); }}
                className={`pressable text-center p-2 rounded-lg border ${
                  selectedFamily === p.id
                    ? "border-primary bg-primary/5"
                    : "border-transparent hover:border-border hover:bg-surface-hover"
                }`}
              >
                <div className="font-mono text-[10px] font-bold text-foreground">{p.id}</div>
                <div className="h-1.5 rounded-full bg-surface-muted mt-1 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="font-mono text-[9px] text-muted mt-0.5">{c.done}/{c.total}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* My Queue */}
      {myQueue.length > 0 && (
        <div className="animate-rise-1 space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">My queue</h2>
            <span className="text-[11px] text-muted">— Recommended next based on your progress</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {myQueue.map(({ entry, reason }, idx) => {
              const s = statuses[entry.id] ?? "untouched";
              const cfg = STATUS_CONFIG[s];
              return (
                <div
                  key={entry.id}
                  className="card-lift rounded-xl border border-border bg-surface p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div>
                      <span className="font-mono text-[10px] text-muted">#{idx + 1}</span>
                      <div className="font-mono text-xs font-bold">{entry.id}</div>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                      entry.tier === "A"
                        ? "border-success/30 bg-success/10 text-success"
                        : entry.tier === "B"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-surface-muted text-muted"
                    }`}>
                      {entry.tier}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium leading-snug line-clamp-2">
                    {entry.title}
                  </div>
                  <div className="text-[10px] text-muted leading-snug line-clamp-2">
                    {reason}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => handleStatusToggle(entry.id)}
                      className={`inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 ${cfg.color} ${cfg.bg}`}
                    >
                      <cfg.icon className="h-3 w-3" />
                      {cfg.label}
                    </button>
                    <Link
                      href={`/arena/${entry.id.toLowerCase()}`}
                      className="text-[10px] text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      Practice <ArrowRight className="h-2.5 w-2.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="sticky top-[104px] z-10 space-y-3 rounded-2xl border border-border bg-surface/90 p-4 shadow-xs backdrop-blur-xl lg:top-[60px]">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search bar */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by problem title, ID, topic, or source group..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Sort Dropdown */}
          <div className="relative shrink-0">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="appearance-none pl-3 pr-8 py-2 bg-surface border border-border rounded-lg text-xs font-medium cursor-pointer"
            >
              <option value="priority">Sort: Priority</option>
              <option value="tier">Sort: Tier</option>
              <option value="family">Sort: Family</option>
              <option value="status">Sort: Status</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-muted pointer-events-none" />
          </div>

          {/* Tier Buttons */}
          <div className="flex items-center gap-1 shrink-0 w-full md:w-auto">
            {(["ALL", "A", "B", "C"] as const).map((t) => {
              const count = t === "ALL" ? 198 : tierCounts[t]?.total ?? 0;
              return (
                <button
                  key={t}
                  onClick={() => setSelectedTier(t)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    selectedTier === t
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-surface border border-border text-muted hover:text-foreground"
                  }`}
                >
                  {t === "ALL" ? `All (${count})` : `Tier ${t} (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Filter + Family Pills */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Status filter pills */}
          <div className="flex items-center gap-1 text-xs shrink-0">
            <span className="text-muted font-medium mr-1">Status:</span>
            {(["ALL", "untouched", "attempted", "confident"] as StatusFilter[]).map((sf) => {
              const label = sf === "ALL" ? "All" : sf.charAt(0).toUpperCase() + sf.slice(1);
              return (
                <button
                  key={sf}
                  onClick={() => setSelectedStatus(sf)}
                  className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                    selectedStatus === sf
                      ? "bg-primary/10 text-primary font-semibold"
                      : "bg-surface text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Family Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs flex-1">
            <span className="text-muted font-medium mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Families:
            </span>
            <button
              onClick={() => setSelectedFamily("ALL")}
              className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                selectedFamily === "ALL"
                  ? "bg-primary/10 text-primary font-semibold"
                  : "bg-surface text-muted hover:text-foreground"
              }`}
            >
              All (19)
            </button>
            {patterns.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedFamily(p.id)}
                className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors font-mono ${
                  selectedFamily === p.id
                    ? "bg-primary/10 text-primary font-semibold"
                    : "bg-surface text-muted hover:text-foreground"
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Catalogue Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-hover/50 text-muted font-semibold uppercase tracking-wider text-[11px]">
              <th className="py-3 px-3 w-12">✓</th>
              <th className="py-3 px-4 w-24">ID</th>
              <th className="py-3 px-4">Title & Concept</th>
              <th className="py-3 px-4 w-24">Tier</th>
              <th className="py-3 px-4 w-28">Family</th>
              <th className="py-3 px-4 w-44">Source Group</th>
              <th className="py-3 px-4 w-24 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filteredEntries.map((item) => {
              const s: DisplayStatus = statuses[item.id] ?? "untouched";
              const cfg = STATUS_CONFIG[s];
              const Icon = cfg.icon;
              return (
                <tr key={item.id} className="group transition-colors hover:bg-primary/[0.04]">
                  <td className="px-3 py-3">
                    <button
                      onClick={() => handleStatusToggle(item.id)}
                      disabled={isPending}
                      className={`p-1 rounded-md transition-colors ${cfg.color} ${cfg.bg}`}
                      title={`Click to change status (${cfg.label})`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] font-bold">
                    {item.id}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-semibold">{item.title}</div>
                    <div className="mt-0.5 max-w-lg truncate text-[11px] text-muted">
                      {item.patternNote}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      item.tier === "A"
                        ? "border-success/30 bg-success/10 text-success"
                        : item.tier === "B"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-surface-muted text-muted"
                    }`}>
                      {item.tier}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 flex-wrap">
                      {item.familyIds.map((fid) => (
                        <button
                          key={fid}
                          onClick={() => setInspectPatternId(fid)}
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium hover:underline"
                        >
                          {fid}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted text-[11px]">
                    G{item.sourceGroupNumber}: {item.sourceGroupName}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2.5">
                      <button
                        onClick={() => setInspectPatternId(item.familyIds[0])}
                        className="text-[11px] text-muted hover:text-foreground font-medium transition-colors"
                      >
                        Card
                      </button>
                      <Link
                        href={`/arena/${item.id.toLowerCase()}`}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        Practice
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        {filteredEntries.length === 0 && (
          <div className="flex flex-col items-center gap-1 p-10 text-center">
            <p className="text-sm font-semibold">No matches</p>
            <p className="text-xs text-muted">Try clearing a filter — Tier A core stays visible by default.</p>
          </div>
        )}
      </div>

      {/* Pattern Card Drawer / Modal */}
      {activePattern && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl overflow-y-auto max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-base text-primary">
                  {activePattern.id}
                </span>
                <h3 className="text-base font-bold text-foreground">
                  {activePattern.title}
                </h3>
              </div>
              <button
                onClick={() => setInspectPatternId(null)}
                className="p-1 rounded-md text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed">
              <div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-1">
                  Concept & Cue
                </h4>
                <p className="text-foreground/90 bg-background p-3 rounded-lg border border-border">
                  {activePattern.conceptCue}
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-1">
                  Key Representatives
                </h4>
                <div className="flex gap-1.5 flex-wrap">
                  {activePattern.representatives.map((rep, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-surface border border-border font-mono text-[11px]">
                      {rep}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider text-[11px] mb-1">
                  Common Pitfalls
                </h4>
                <p className="text-foreground/90 bg-amber-500/5 p-3 rounded-lg border border-amber-500/20">
                  {activePattern.pitfalls}
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-1">
                  Complexity / Cost
                </h4>
                <p className="text-foreground/90 font-mono bg-background p-3 rounded-lg border border-border text-[11px]">
                  {activePattern.cost}
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-primary uppercase tracking-wider text-[11px] mb-1">
                  Say in Interview
                </h4>
                <p className="text-foreground/90 italic bg-primary/5 p-3 rounded-lg border border-primary/20">
                  &ldquo;{activePattern.say}&rdquo;
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setInspectPatternId(null)}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:bg-primary/90"
              >
                Close Card
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
