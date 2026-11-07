"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-px text-[11px] font-semibold tracking-[0.01em] transition-[background-color,border-color,color] duration-160 ease-out",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-muted text-muted-strong",
        blue: "border-border bg-surface-muted text-foreground",
        emerald: "border-success/40 bg-success/10 text-success",
        amber: "border-warning/40 bg-warning/10 text-warning",
        rose: "border-danger/40 bg-danger/10 text-danger",
        violet: "border-border bg-surface-muted text-muted-strong",
        zinc: "border-border bg-transparent text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// Animated progress (custom, theme-aware) — for capacity bars
export function Progress({
  value,
  max = 100,
  className,
  tone = "blue",
}: {
  value: number;
  max?: number;
  className?: string;
  tone?: "blue" | "emerald" | "amber";
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const bar = tone === "emerald" ? "bg-success" : tone === "amber" ? "bg-warning" : "bg-primary";
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
