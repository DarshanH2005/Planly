import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { PageHeader } from "@/components/ui/page";
import { OnboardingForm } from "@/features/identity/components/OnboardingForm";

export const dynamic = "force-dynamic";

/**
 * Onboarding Page — /onboarding
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * First-time setup experience for candidate profile, initial benchmark goal (v1),
 * and 7-day preparation capacity pattern with the 80% burnout guard buffer.
 */
export default async function OnboardingPage() {
  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <PageHeader
        title="Welcome to Planly"
        description="Configure your candidate profile, target companies, and weekly preparation capacity."
      />

      <OnboardingForm onSuccessRedirect="/today" />
    </div>
  );
}
