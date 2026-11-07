/**
 * Today Page — /today
 *
 * PLANLY_BUILD_SPEC.md §6.2, R04, AC05:
 * Primary cockpit displaying today's focus task, reason, supporting practice slots,
 * 80% safety buffer capacity status, quick adaptive adjusters (Minimum Day, Rest Day, Custom),
 * and lightweight growth notes.
 */

import { TodayView } from "@/features/classrooms/today";
import { requireOwner } from "@/lib/auth/require-owner";
import { redirect } from "next/navigation";

export default async function TodayPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const auth = await requireOwner();
  if (!auth.ok) redirect("/login");
  const params = searchParams ? await searchParams : {};
  if (params.view === "plan" || params.view === "adaptive") {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pb-10">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-muted">Adaptive Classroom Planner</h2>
          <a
            href="/today"
            className="text-xs font-medium text-foreground underline underline-offset-4 hover:opacity-80"
          >
            ← Back to Today Cockpit
          </a>
        </div>
        <TodayView />
      </div>
    );
  }

  // The learning service is the source of truth for capacity and
  // commitments. The old local Map baseline invented tasks and reset on
  // restart, so Today now uses the durable adaptive-plan projection.
  return <TodayView />;
}
