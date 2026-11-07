import { redirect } from "next/navigation";
import { ShieldCheck, Database, Download } from "lucide-react";
import { requireOwner } from "@/lib/auth/require-owner";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/button";
import { getIdentityState, IdentityState } from "@/features/identity/service";
import {
  DEFAULT_PROFILE_VALUES,
  DEFAULT_GOAL_VALUES,
  DEFAULT_WEEKLY_CAPACITY,
} from "@/features/identity/schemas";
import { calculateWeeklySummary } from "@/features/identity/rules";
import { ProfileEditor } from "@/features/identity/components/ProfileEditor";
import { ModelRoutingEditor } from "@/features/settings/components/model-routing-editor";
import { ProviderCredentialsEditor } from "@/features/settings/components/provider-credentials-editor";

export const dynamic = "force-dynamic";

/**
 * Settings Page — /settings
 *
 * PLANLY_BUILD_SPEC.md §3, §4, §5 & sprint_07_onboarding.md:
 * Production settings workspace allowing the authenticated owner to update
 * candidate profile attributes, publish versioned target goals (AC-03),
 * adjust 7-day capacity patterns with the 80% burnout guard buffer,
 * and review data isolation guarantees.
 */
export default async function SettingsPage() {
  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  const ownerId = auth.data.ownerId;
  const identityRes = await getIdentityState(ownerId);

  const fallbackSummary = calculateWeeklySummary(DEFAULT_WEEKLY_CAPACITY);
  const fallbackState: IdentityState = {
    isOnboarded: false,
    profile: {
      id: "default-profile",
      ownerId,
      timezone: DEFAULT_PROFILE_VALUES.timezone,
      major: DEFAULT_PROFILE_VALUES.major,
      graduationDate: DEFAULT_PROFILE_VALUES.graduationDate,
      primaryLanguage: DEFAULT_PROFILE_VALUES.primaryLanguage,
      cgpa: undefined,
    },
    currentGoal: {
      id: "default-goal",
      ownerId,
      version: 1,
      targetRoles: [...DEFAULT_GOAL_VALUES.targetRoles],
      targetCompanies: [...DEFAULT_GOAL_VALUES.targetCompanies],
      targetDate: DEFAULT_GOAL_VALUES.targetDate,
    },
    goalHistory: [
      {
        id: "default-goal",
        ownerId,
        version: 1,
        targetRoles: [...DEFAULT_GOAL_VALUES.targetRoles],
        targetCompanies: [...DEFAULT_GOAL_VALUES.targetCompanies],
        targetDate: DEFAULT_GOAL_VALUES.targetDate,
      },
    ],
    capacities: [...DEFAULT_WEEKLY_CAPACITY],
    capacitySummary: fallbackSummary,
  };

  const identityState: IdentityState = identityRes.ok ? identityRes.data : fallbackState;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <PageHeader
        title="Settings"
        description="Candidate profile, versioned target goals, weekly preparation capacity, and private persistence."
      />

      <ProfileEditor initialState={identityState} />

      <ModelRoutingEditor />

      <ProviderCredentialsEditor />

      <Card className="border-emerald-600/30 bg-surface p-5">
        <div className="flex items-center gap-2 border-b border-border pb-3 text-sm font-semibold text-foreground">
          <Database className="h-4 w-4 text-primary" />
          <span>Private Persistence & Row-Level Security</span>
        </div>
        <p className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            All profile records, versioned goals, and weekly capacity slots are strictly owned by your
            authenticated UUID with PostgreSQL Row-Level Security (RLS). Zero telemetry, no external AI scraping,
            and no hidden gating logic based on candidate background or CGPA.
          </span>
        </p>
      </Card>

      <Card className="bg-surface p-5 border border-border">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Download className="h-4 w-4 text-primary" />
            <span>Data Ownership & Backup Export</span>
          </div>
          <a
            href="/api/backup/export"
            download
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Full Backup (JSON)</span>
          </a>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Export your entire preparation history including completed attempts, code drafts,
          weakness repairs, and competency observations into a validated JSON envelope.
          You can restore this backup into any fresh local or disposable instance anytime.
        </p>
      </Card>
    </div>
  );
}
