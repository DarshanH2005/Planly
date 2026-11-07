/**
 * Prep Hub Route — /prep
 *
 * Server component that loads the full 198-problem curriculum, pattern reference cards,
 * deterministic POTD selection, and personalized completion statuses.
 * PLANLY_BUILD_SPEC.md §6.5, R05.
 */

import { loadCatalogue, loadPatterns, selectPOTD } from "@/features/curriculum/prep-service";
import PrepHubView from "@/features/curriculum/components/prep-hub-view";
import { requireOwner } from "@/lib/auth/require-owner";
import { redirect } from "next/navigation";
import { getLocalPrepStatuses } from "@/lib/storage/local-store";
import { getLocalRepairs } from "@/lib/storage/local-store";

export default async function PrepPage() {
  const auth = await requireOwner();
  if (!auth.ok) redirect("/login");

  const catalogue = loadCatalogue();
  const patterns = loadPatterns();
  const potd = selectPOTD(catalogue, new Set(), "F01");
  const prepStatuses = getLocalPrepStatuses(auth.data.ownerId);
  const repairs = getLocalRepairs(auth.data.ownerId);

  // Build set of competency keys with active repairs
  const repairCompetencies = new Set(
    repairs
      .filter((r) => r.state !== "improved" && r.state !== "deferred")
      .map((r) => r.competencyKey)
  );

  return (
    <PrepHubView
      catalogue={catalogue}
      patterns={patterns}
      potd={potd}
      prepStatuses={prepStatuses}
      repairCompetencies={Array.from(repairCompetencies)}
    />
  );
}
