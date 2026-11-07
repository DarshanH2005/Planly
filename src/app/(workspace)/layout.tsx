import { requireOwner } from "@/lib/auth/require-owner";
import { AppShell } from "@/components/app-shell";
import { PageFade } from "@/components/page-fade";

// Every workspace response is owner-specific; never bake an anonymous result into a static route.
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ownerRes = await requireOwner();
  const ownerEmail = ownerRes.ok ? (ownerRes.data.email ?? "Authenticated owner") : "Sign in required";

  return (
    <AppShell email={ownerEmail}>
      <PageFade>{children}</PageFade>
    </AppShell>
  );
}
