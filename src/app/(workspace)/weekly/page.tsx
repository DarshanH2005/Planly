"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/button";
import { learningApi, type QuietWeeklyReview } from "@/lib/api/learning-client";

export default function WeeklyReviewPage() {
  const [review, setReview] = useState<QuietWeeklyReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    learningApi.getWeeklyReview().then(setReview).catch((err) => setError(err.message));
  }, []);

  if (!review && !error) {
    return <div className="flex min-h-[300px] items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading evidence…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <PageHeader title="Weekly review" description="A review generated from persisted learning evidence." meta={<Badge tone="neutral">Canonical evidence</Badge>} />
      {error && <Card className="border-danger/30 bg-danger/[0.07] p-4 text-sm text-danger">Could not load weekly evidence: {error}</Card>}
      {review && <>
        <Card className="overflow-hidden p-0">
          <div className="h-[2px] bg-primary" />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <div className="rounded-xl border border-success/30 bg-success/[0.07] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-success"><CheckCircle2 className="h-3.5 w-3.5" />Verified · {review.verified_this_week.length}</p>
              <p className="mt-2 text-[13px] leading-relaxed">{review.verified_this_week.length ? review.verified_this_week.join(" · ") : "No independent demonstrations recorded yet."}</p>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning/[0.06] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-warning"><AlertTriangle className="h-3.5 w-3.5" />Uncertain · {review.uncertain_this_week.length}</p>
              <p className="mt-2 text-[13px] leading-relaxed">{review.uncertain_this_week.length ? review.uncertain_this_week.join(" · ") : "No unresolved evidence gaps recorded."}</p>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Next evidence-based actions</h2>
          <div className="mt-3 space-y-2.5">
            {review.next_recommended_activities.length ? review.next_recommended_activities.map((item) => <Link key={item.activity_id} href={item.route} className="block rounded-xl border border-border/70 bg-surface-muted/50 p-3.5 hover:border-border-strong"><p className="text-[13px] font-semibold">{item.title}</p><p className="mt-0.5 text-[13px] leading-relaxed text-muted">{item.reason}</p></Link>) : <p className="text-sm text-muted">Complete a classroom turn to generate the next recommendation.</p>}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted"><CalendarClock className="h-3.5 w-3.5" />Updated from the learning service.</p>
        </Card>
      </>}
    </div>
  );
}
