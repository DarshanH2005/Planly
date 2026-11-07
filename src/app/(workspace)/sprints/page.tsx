/**
 * Sprints Route — /sprints
 *
 * PLANLY_BUILD_SPEC.md §6.3, §11, R03:
 * 14-day calendar grid, 80% safety buffer budgets (Week 1 & 2),
 * strategic bottleneck / supporting lane, and original vs revised plan diff table.
 */

import { getActiveSprintOverview } from "@/features/planning/service";
import { SprintsView } from "@/features/planning/components/sprints-view";
import { requireOwner } from "@/lib/auth/require-owner";
import { redirect } from "next/navigation";

export default async function SprintsPage() {
  const auth = await requireOwner();
  if (!auth.ok) redirect("/login");
  const overview = getActiveSprintOverview(auth.data.ownerId);

  return <SprintsView overview={overview} />;
}
