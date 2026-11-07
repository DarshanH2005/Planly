"use client";

import * as React from "react";
import {
  Sparkles,
  Calendar,
  Code2,
  Target,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  History,
  Save,
} from "lucide-react";
import { Card, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { updateProfileAction, updateGoalAction, updateCapacityAction } from "../actions";
import type { IdentityState } from "../service";
import type {
  UserProfile,
  UserGoal,
  CapacityPattern,
  UpdateProfileInput,
  UpdateGoalInput,
  UpdateCapacityInput,
} from "../schemas";
import {
  calculateSafeCapacity,
  calculateWeeklySummary,
} from "../rules";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

const PROGRAMMING_LANGUAGES = [
  "Python",
  "C++",
  "Java",
  "Go",
  "TypeScript",
] as const;

interface DayEditorState {
  dayOfWeek: number;
  totalMinutes: number;
  uninterruptedInput: string;
}

export function ProfileEditor({
  initialState,
}: {
  initialState: IdentityState;
}) {
  // Profile state
  const [profile, setProfile] = React.useState<UserProfile | null>(initialState.profile);
  const [timezone, setTimezone] = React.useState(profile?.timezone || "Asia/Kolkata");
  const [major, setMajor] = React.useState(profile?.major || "CSE");
  const [graduationDate, setGraduationDate] = React.useState(profile?.graduationDate || "2026-12-01");
  const [primaryLanguage, setPrimaryLanguage] = React.useState(profile?.primaryLanguage || "Python");
  const [cgpa, setCgpa] = React.useState(profile?.cgpa != null ? String(profile.cgpa) : "");
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileMessage, setProfileMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // Goal state
  const [currentGoal, setCurrentGoal] = React.useState<UserGoal | null>(initialState.currentGoal);
  const [goalHistory, setGoalHistory] = React.useState<UserGoal[]>(initialState.goalHistory);
  const [targetRoles, setTargetRoles] = React.useState(currentGoal?.targetRoles.join(", ") || "general SDE/backend");
  const [targetCompanies, setTargetCompanies] = React.useState(currentGoal?.targetCompanies.join(", ") || "CRED");
  const [targetDate, setTargetDate] = React.useState(currentGoal?.targetDate || "2026-11-30");
  const [goalSaving, setGoalSaving] = React.useState(false);
  const [goalMessage, setGoalMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  // Capacity state
  const [capacities, setCapacities] = React.useState<DayEditorState[]>(() =>
    initialState.capacities.map((c) => ({
      dayOfWeek: c.dayOfWeek,
      totalMinutes: c.totalMinutes,
      uninterruptedInput: c.uninterruptedLengths.join(", "),
    }))
  );
  const [capacitySaving, setCapacitySaving] = React.useState(false);
  const [capacityMessage, setCapacityMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [capacityErrors, setCapacityErrors] = React.useState<Record<string, string>>({});

  // Live weekly summary
  const parsedCapacities: CapacityPattern[] = React.useMemo(() => {
    return capacities.map((day) => {
      const lengths = day.uninterruptedInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);
      return {
        dayOfWeek: day.dayOfWeek,
        totalMinutes: Math.max(0, day.totalMinutes),
        uninterruptedLengths: lengths.length > 0 ? lengths : [Math.max(0, day.totalMinutes)],
      };
    });
  }, [capacities]);

  const weeklySummary = React.useMemo(() => {
    return calculateWeeklySummary(parsedCapacities);
  }, [parsedCapacities]);

  // Handlers
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMessage(null);

    const input: UpdateProfileInput = {
      timezone,
      major,
      graduationDate,
      primaryLanguage,
      cgpa: cgpa.trim() !== "" ? parseFloat(cgpa) : null,
    };

    const res = await updateProfileAction(input);
    setProfileSaving(false);

    if (res.ok) {
      setProfile(res.data);
      setProfileMessage({ type: "success", text: "Profile preferences saved successfully." });
    } else {
      setProfileMessage({ type: "error", text: res.message });
    }
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoalSaving(true);
    setGoalMessage(null);

    const parsedRoles = targetRoles
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const parsedCompanies = targetCompanies
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const input: UpdateGoalInput = {
      targetRoles: parsedRoles.length > 0 ? parsedRoles : ["general SDE/backend"],
      targetCompanies: parsedCompanies.length > 0 ? parsedCompanies : ["CRED"],
      targetDate,
    };

    const res = await updateGoalAction(input);
    setGoalSaving(false);

    if (res.ok) {
      setCurrentGoal(res.data);
      setGoalHistory((prev) => [res.data, ...prev.filter((g) => g.id !== res.data.id)]);
      setGoalMessage({
        type: "success",
        text: `Goal revision v${res.data.version} created and activated.`,
      });
    } else {
      setGoalMessage({ type: "error", text: res.message });
    }
  };

  const handleSaveCapacity = async (e: React.FormEvent) => {
    e.preventDefault();
    setCapacitySaving(true);
    setCapacityMessage(null);
    setCapacityErrors({});

    // Validate uninterrupted blocks
    const errors: Record<string, string> = {};
    for (let i = 0; i < parsedCapacities.length; i++) {
      const cap = parsedCapacities[i];
      const sum = cap.uninterruptedLengths.reduce((a, b) => a + b, 0);
      if (sum > cap.totalMinutes) {
        errors[`capacity.${i}`] = `Sum of blocks (${sum}m) exceeds total ${cap.totalMinutes}m`;
      }
      for (const block of cap.uninterruptedLengths) {
        if (block > cap.totalMinutes) {
          errors[`capacity.${i}.block`] = `Block (${block}m) exceeds total ${cap.totalMinutes}m`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setCapacityErrors(errors);
      setCapacityMessage({ type: "error", text: "Please correct capacity pattern errors." });
      setCapacitySaving(false);
      return;
    }

    const input: UpdateCapacityInput = {
      capacities: parsedCapacities,
    };

    const res = await updateCapacityAction(input);
    setCapacitySaving(false);

    if (res.ok) {
      setCapacityMessage({ type: "success", text: "7-day capacity patterns saved successfully." });
    } else {
      setCapacityMessage({ type: "error", text: res.message });
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. Candidate Profile Section */}
      <Card className="p-6">
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Candidate Profile</h2>
                <p className="text-xs text-muted">Primary language, graduation timeline, and timezone</p>
              </div>
            </div>
            <Button type="submit" size="sm" disabled={profileSaving} className="gap-1.5">
              {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Profile
            </Button>
          </div>

          {profileMessage && (
            <div
              role="alert"
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                profileMessage.type === "success"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {profileMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{profileMessage.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="editPrimaryLanguage" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Primary Language
              </label>
              <select
                id="editPrimaryLanguage"
                value={primaryLanguage}
                onChange={(e) => setPrimaryLanguage(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {PROGRAMMING_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="editTimezone" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Timezone
              </label>
              <select
                id="editTimezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="editMajor" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Major / Department
              </label>
              <input
                id="editMajor"
                type="text"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="editGraduationDate" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Graduation Date
              </label>
              <input
                id="editGraduationDate"
                type="date"
                value={graduationDate}
                onChange={(e) => setGraduationDate(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="editCgpa" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                CGPA <span className="font-normal lowercase text-muted/70">(optional informational field)</span>
              </label>
              <input
                id="editCgpa"
                type="number"
                step="0.01"
                min="0"
                max="10"
                placeholder="e.g. 8.50"
                value={cgpa}
                onChange={(e) => setCgpa(e.target.value)}
                className="mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-muted">
                Invariant: CGPA is strictly not used for readiness gating, scoring, or difficulty filtering.
              </p>
            </div>
          </div>
        </form>
      </Card>

      {/* 2. Target Goal & Revision History Section (AC-03) */}
      <Card className="p-6">
        <form onSubmit={handleSaveGoal} className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-emerald-600 dark:text-emerald-400">
                <Target className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Target Goals & Checkpoint</h2>
                  {currentGoal && (
                    <Badge tone="emerald">Version {currentGoal.version} Active</Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Saving increments version number rather than overwriting (AC-03)
                </p>
              </div>
            </div>
            <Button type="submit" size="sm" disabled={goalSaving} className="gap-1.5">
              {goalSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Publish Goal Revision
            </Button>
          </div>

          {goalMessage && (
            <div
              role="alert"
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                goalMessage.type === "success"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {goalMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{goalMessage.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="editTargetRoles" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Target Roles / Specializations
              </label>
              <input
                id="editTargetRoles"
                type="text"
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="editTargetCompanies" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Target Benchmark Companies
              </label>
              <input
                id="editTargetCompanies"
                type="text"
                value={targetCompanies}
                onChange={(e) => setTargetCompanies(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="editTargetDate" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
                Target Assessment Checkpoint
              </label>
              <input
                id="editTargetDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Goal Version History */}
          {goalHistory.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <History className="h-3.5 w-3.5" />
                <span>Goal Calibration History ({goalHistory.length} Revisions)</span>
              </div>
              <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border bg-surface-muted/30">
                {goalHistory.map((goal) => (
                  <div key={goal.id || goal.version} className="flex items-center justify-between p-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <Badge tone={goal.version === currentGoal?.version ? "emerald" : "neutral"}>
                        v{goal.version}
                      </Badge>
                      <div>
                        <span className="font-medium text-foreground">
                          {goal.targetCompanies.join(", ")}
                        </span>
                        <span className="ml-2 text-muted">({goal.targetRoles.join(", ")})</span>
                      </div>
                    </div>
                    <div className="font-mono text-[11px] text-muted">
                      Target: {goal.targetDate}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </Card>

      {/* 3. 7-Day Capacity & Burnout Buffer Section */}
      <Card className="p-6">
        <form onSubmit={handleSaveCapacity} className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-primary">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Weekly Capacity Pattern</h2>
                <p className="text-xs text-muted">7-day available minutes & uninterrupted openings</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="emerald" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                80% Burnout Guard
              </Badge>
              <Button type="submit" size="sm" disabled={capacitySaving} className="gap-1.5">
                {capacitySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Capacity
              </Button>
            </div>
          </div>

          {capacityMessage && (
            <div
              role="alert"
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                capacityMessage.type === "success"
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-danger/40 bg-danger/10 text-danger"
              }`}
            >
              {capacityMessage.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{capacityMessage.text}</span>
            </div>
          )}

          {/* KPI Banner */}
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-muted/40 p-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Total Declared</p>
              <p className="mt-1 font-mono text-lg font-bold text-foreground">
                {weeklySummary.totalDeclaredMinutes} <span className="text-xs font-normal text-muted">min</span>
              </p>
              <p className="text-[10px] text-muted">~{(weeklySummary.totalDeclaredMinutes / 60).toFixed(1)} hrs / week</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Safe Usable (80%)</p>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {weeklySummary.safeUsableMinutes} <span className="text-xs font-normal text-muted">min</span>
              </p>
              <p className="text-[10px] text-muted">Max scheduled workload</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Recovery Buffer (20%)</p>
              <p className="mt-1 font-mono text-lg font-bold text-amber-600 dark:text-amber-400">
                {weeklySummary.burnoutBufferMinutes} <span className="text-xs font-normal text-muted">min</span>
              </p>
              <p className="text-[10px] text-muted">Fatigue protection margin</p>
            </div>
          </div>

          {/* 7 Daily rows */}
          <div className="mt-4 space-y-3">
            <div className="hidden grid-cols-12 gap-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted sm:grid">
              <div className="col-span-3">Day</div>
              <div className="col-span-3">Total Minutes</div>
              <div className="col-span-4">Uninterrupted Blocks (min)</div>
              <div className="col-span-2 text-right">Safe 80%</div>
            </div>

            {capacities.map((day, idx) => {
              const safe = calculateSafeCapacity(day.totalMinutes);
              const hasError = capacityErrors[`capacity.${idx}`] || capacityErrors[`capacity.${idx}.block`];
              return (
                <div
                  key={day.dayOfWeek}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-surface p-3 sm:grid-cols-12 sm:items-center sm:gap-3 sm:p-2.5"
                >
                  <div className="col-span-3 flex items-center justify-between sm:justify-start sm:gap-2">
                    <span className="text-xs font-medium text-foreground">{DAY_NAMES[day.dayOfWeek]}</span>
                    {day.dayOfWeek === 0 || day.dayOfWeek === 6 ? (
                      <Badge tone="amber" className="text-[10px]">Weekend</Badge>
                    ) : (
                      <Badge tone="neutral" className="text-[10px]">Weekday</Badge>
                    )}
                  </div>

                  <div className="col-span-3">
                    <input
                      type="number"
                      min="0"
                      max="1440"
                      step="15"
                      value={day.totalMinutes}
                      onChange={(e) => {
                        const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                        setCapacities((prev) => {
                          const next = [...prev];
                          next[idx] = { ...next[idx], totalMinutes: val };
                          return next;
                        });
                      }}
                      aria-label={`${DAY_NAMES[day.dayOfWeek]} total minutes`}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-4">
                    <input
                      type="text"
                      value={day.uninterruptedInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCapacities((prev) => {
                          const next = [...prev];
                          next[idx] = { ...next[idx], uninterruptedInput: val };
                          return next;
                        });
                      }}
                      placeholder="e.g. 90, 60"
                      aria-label={`${DAY_NAMES[day.dayOfWeek]} uninterrupted blocks`}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-2 flex items-center justify-between sm:justify-end">
                    <span className="text-[11px] text-muted sm:hidden">Safe 80%:</span>
                    <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {safe}m
                    </span>
                  </div>

                  {hasError && (
                    <div className="col-span-12 text-[11px] text-danger">
                      {capacityErrors[`capacity.${idx}`] || capacityErrors[`capacity.${idx}.block`]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </form>
      </Card>
    </div>
  );
}
