import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";

export default async function RootPage() {
  const authResult = await requireOwner();

  if (!authResult.ok) {
    redirect("/login");
  }

  redirect("/today");
}
