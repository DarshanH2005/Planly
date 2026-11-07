"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Calendar,
  Code2,
  Target,
  Clock,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Card, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { submitOnboardingAction } from "../actions";
import {
  OnboardingInput,
  CapacityPattern,
  DEFAULT_PROFILE_VALUES,
  DEFAULT_GOAL_VALUES,
  DEFAULT_WEEKLY_CAPACITY,
} from "../schemas";
import {
  calculateSafeCapacity,
  calculateWeeklySummary,
  BURNOUT_GUARD_RATIO,
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

interface DayFormState {
  dayOfWeek: number;
  totalMinutes: number;
  uninterruptedInput: string;
}

export function OnboardingForm({
  onSuccessRedirect = "/today",
}: {
  onSuccessRedirect?: string;
}) {
  const router = useRouter();

  // Profile Form State
  const [timezone, setTimezone] = React.useState<string>(DEFAULT_PROFILE_VALUES.timezone);
  const [major, setMajor] = React.useState<string>(DEFAULT_PROFILE_VALUES.major);
  const [graduationDate, setGraduationDate] = React.useState<string>(DEFAULT_PROFILE_VALUES.graduationDate);
  const [primaryLanguage, setPrimaryLanguage] = React.useState<string>(DEFAULT_PROFILE_VALUES.primaryLanguage);
  const [cgpa, setCgpa] = React.useState<string>("");

  // Goal Form State
  const [targetRoles, setTargetRoles] = React.useState<string>(DEFAULT_GOAL_VALUES.targetRoles.join(", "));
  const [targetCompanies, setTargetCompanies] = React.useState<string>(DEFAULT_GOAL_VALUES.targetCompanies.join(", "));
  const [targetDate, setTargetDate] = React.useState<string>(DEFAULT_GOAL_VALUES.targetDate);

  // 7-Day Capacity State
  const [capacities, setCapacities] = React.useState<DayFormState[]>(() =>
    DEFAULT_WEEKLY_CAPACITY.map((c) => ({
      dayOfWeek: c.dayOfWeek,
      totalMinutes: c.totalMinutes,
      uninterruptedInput: c.uninterruptedLengths.join(", "),
    }))
  );

  // Submission State
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // Parse and compute live capacity summary
  const parsedWeeklyCapacity: CapacityPattern[] = React.useMemo(() => {
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
    return calculateWeeklySummary(parsedWeeklyCapacity);
  }, [parsedWeeklyCapacity]);

  const handleDayMinutesChange = (index: number, minutes: number) => {
    setCapacities((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], totalMinutes: Math.max(0, minutes) };
      return next;
    });
  };

  const handleDayUninterruptedChange = (index: number, val: string) => {
    setCapacities((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], uninterruptedInput: val };
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    // Parse target roles & companies
    const parsedRoles = targetRoles
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const parsedCompanies = targetCompanies
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    // Validate daily uninterrupted sum bounds
    const errors: Record<string, string> = {};
    for (let i = 0; i < parsedWeeklyCapacity.length; i++) {
      const cap = parsedWeeklyCapacity[i];
      const sum = cap.uninterruptedLengths.reduce((a, b) => a + b, 0);
      if (sum > cap.totalMinutes) {
        errors[`capacity.${i}`] = `${DAY_NAMES[cap.dayOfWeek]}: Sum of blocks (${sum}m) exceeds total ${cap.totalMinutes}m`;
      }
      for (const block of cap.uninterruptedLengths) {
        if (block > cap.totalMinutes) {
          errors[`capacity.${i}.block`] = `${DAY_NAMES[cap.dayOfWeek]}: Block (${block}m) exceeds total ${cap.totalMinutes}m`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please correct capacity pattern errors before proceeding.");
      setSubmitting(false);
      return;
    }

    const payload: OnboardingInput = {
      timezone,
      major,
      graduationDate,
      primaryLanguage,
      cgpa: cgpa.trim() !== "" ? parseFloat(cgpa) : undefined,
      targetRoles: parsedRoles.length > 0 ? parsedRoles : ["general SDE/backend"],
      targetCompanies: parsedCompanies.length > 0 ? parsedCompanies : ["CRED"],
      targetDate,
      weeklyCapacity: parsedWeeklyCapacity,
    };

    try {
      const res = await submitOnboardingAction(payload);
      if (!res.ok) {
        setFormError(res.message);
        if (res.fieldErrors) {
          setFieldErrors(res.fieldErrors);
        }
        setSubmitting(false);
        return;
      }

      router.push(onSuccessRedirect);
    } catch (err: any) {
      setFormError(err.message || "An unexpected error occurred while saving your onboarding setup.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6 pb-12">
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-4 text-xs text-danger"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Setup Failed</p>
            <p className="mt-0.5">{formError}</p>
          </div>
        </div>
      )}

      {/* Section 1: Candidate Baseline Profile */}
      <Card className="p-6">
        <div className="flex items-center gap-2.5 border-b border-border pb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">1. Candidate Profile</h2>
            <p className="text-xs text-muted">Primary language, graduation timeline, and timezone</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="primaryLanguage" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Primary Language
            </label>
            <select
              id="primaryLanguage"
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
            <p className="mt-1 text-[11px] text-muted">Interview arena default language</p>
          </div>

          <div>
            <label htmlFor="timezone" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Timezone
            </label>
            <select
              id="timezone"
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
            <p className="mt-1 text-[11px] text-muted">Controls session deadline and schedule calibration</p>
          </div>

          <div>
            <label htmlFor="major" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Degree / Major
            </label>
            <input
              id="major"
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="graduationDate" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Graduation Date
            </label>
            <input
              id="graduationDate"
              type="date"
              value={graduationDate}
              onChange={(e) => setGraduationDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cgpa" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              CGPA <span className="font-normal lowercase text-muted/70">(optional)</span>
            </label>
            <input
              id="cgpa"
              type="number"
              step="0.01"
              min="0"
              max="10"
              placeholder="e.g. 8.75"
              value={cgpa}
              onChange={(e) => setCgpa(e.target.value)}
              className="mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">
              Optional application reference field. Strictly NOT used for readiness gating or scoring.
            </p>
          </div>
        </div>
      </Card>

      {/* Section 2: Target Role & Checkpoint Goal */}
      <Card className="p-6">
        <div className="flex items-center gap-2.5 border-b border-border pb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-emerald-600 dark:text-emerald-400">
            <Target className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">2. Target Role & Checkpoint (Goal v1)</h2>
            <p className="text-xs text-muted">Initial target companies and target assessment date</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="targetRoles" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Target Track / Roles
            </label>
            <input
              id="targetRoles"
              type="text"
              value={targetRoles}
              onChange={(e) => setTargetRoles(e.target.value)}
              placeholder="general SDE/backend, systems"
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">Comma-separated target role specializations</p>
          </div>

          <div>
            <label htmlFor="targetCompanies" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Target Companies
            </label>
            <input
              id="targetCompanies"
              type="text"
              value={targetCompanies}
              onChange={(e) => setTargetCompanies(e.target.value)}
              placeholder="CRED, Google, Uber"
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">Primary benchmark tier companies</p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="targetDate" className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Milestone Checkpoint Date
            </label>
            <input
              id="targetDate"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted">Hiring round deadline anchoring the 14-day sprint engine</p>
          </div>
        </div>
      </Card>

      {/* Section 3: 7-Day Weekly Preparation Capacity & Burnout Guard */}
      <Card className="p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-primary">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">3. Weekly Preparation Capacity</h2>
              <p className="text-xs text-muted">7-day pattern with uninterrupted opening lengths</p>
            </div>
          </div>
          <Badge tone="emerald" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            80% Burnout Guard Active
          </Badge>
        </div>

        {/* Capacity Summary KPI banner */}
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface-muted/40 p-4 sm:grid-cols-3">
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
            <p className="text-[10px] text-muted">Max scheduled training workload</p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Recovery Buffer (20%)</p>
            <p className="mt-1 font-mono text-lg font-bold text-amber-600 dark:text-amber-400">
              {weeklySummary.burnoutBufferMinutes} <span className="text-xs font-normal text-muted">min</span>
            </p>
            <p className="text-[10px] text-muted">Slack for overrun & fatigue protection</p>
          </div>
        </div>

        {/* 7 Daily rows */}
        <div className="mt-5 space-y-3">
          <div className="hidden grid-cols-12 gap-3 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted sm:grid">
            <div className="col-span-3">Day</div>
            <div className="col-span-3">Total Minutes</div>
            <div className="col-span-4">Uninterrupted Blocks (min)</div>
            <div className="col-span-2 text-right">Safe 80%</div>
          </div>

          {capacities.map((day, idx) => {
            const safe = calculateSafeCapacity(day.totalMinutes);
            const hasError = fieldErrors[`capacity.${idx}`] || fieldErrors[`capacity.${idx}.block`];
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
                    onChange={(e) => handleDayMinutesChange(idx, parseInt(e.target.value, 10) || 0)}
                    aria-label={`${DAY_NAMES[day.dayOfWeek]} total minutes`}
                    className="w-full rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-mono text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div className="col-span-4">
                  <input
                    type="text"
                    value={day.uninterruptedInput}
                    onChange={(e) => handleDayUninterruptedChange(idx, e.target.value)}
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
                    {fieldErrors[`capacity.${idx}`] || fieldErrors[`capacity.${idx}.block`]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Submit Button */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="submit"
          size="md"
          disabled={submitting}
          className="gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Initializing Workbench...
            </>
          ) : (
            <>
              Launch Workbench <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
