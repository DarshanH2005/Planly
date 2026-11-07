import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";

interface ArenaIndexProps {
  searchParams: Promise<{
    repair?: string;
    mode?: string;
    pack?: string;
  }>;
}

export default async function ArenaIndexPage({ searchParams }: ArenaIndexProps) {
  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  const params = await searchParams;

  if (params.repair) {
    const prefix = params.mode === "retest" ? "retest" : "drill";
    redirect(`/arena/${prefix}-${params.repair}`);
  }

  if (params.pack) {
    redirect(`/arena/${params.pack}`);
  }

  redirect("/today");
}
