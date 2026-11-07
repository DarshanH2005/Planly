/**
 * Repairs Route — /repairs
 *
 * PLANLY_BUILD_SPEC.md §10.2, §17 (AC17, AC18), R12:
 * Weakness remediation pipeline: proposed → scheduled → drilled → retested → improved.
 * Retests require prior drill completion and unfamiliar conditions.
 */

import { getRepairs } from "@/features/repairs/service";
import { RepairsView } from "@/features/repairs/components/repairs-view";
import { requireOwner } from "@/lib/auth/require-owner";
import { redirect } from "next/navigation";

export default async function RepairsPage() {
  const auth = await requireOwner();
  if (!auth.ok) redirect("/login");
  const { active, resolved } = getRepairs(auth.data.ownerId);

  return <RepairsView initialActive={active} initialResolved={resolved} />;
}
