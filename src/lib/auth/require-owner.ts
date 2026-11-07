import { createServerSupabaseClient, isSupabaseConfigured } from "../supabase/server";
import { fail, ok, Result } from "../validation/result";

export type AuthenticatedOwner = {
  ownerId: string;
  email?: string;
};

/**
 * Sprint B02: Canonical Owner Authorization Guard
 *
 * Verifies Supabase authentication token, queries public.allowed_owners table,
 * and fails closed when unconfigured on the pilot path.
 */
export async function requireOwner(): Promise<Result<AuthenticatedOwner>> {
  if (!isSupabaseConfigured()) {
    const isPilot =
      process.env.PLANLY_ENV === "pilot" ||
      process.env.NODE_ENV === "production";

    if (isPilot && process.env.PLANLY_ALLOW_DEV_FALLBACK !== "true") {
      return fail(
        "SERVICE_UNAVAILABLE",
        "Authentication service is unconfigured on the pilot path"
      );
    }

    // Local development/test fallback: use a deterministic dev owner
    // so the app functions with local storage when Supabase is not available.
    return ok({
      ownerId: "dev-owner-001",
      email: "dev@localhost",
    });
  }

  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail("UNAUTHENTICATED", "Authentication required to access this resource");
  }

  // Check against allowed_owners table (B02 reconciled)
  const { data: allowed, error: allowError } = await supabase
    .from("allowed_owners")
    .select("owner_id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (allowError || !allowed) {
    return fail(
      "FORBIDDEN",
      "Account is authenticated but not an authorized owner of this private workbench"
    );
  }

  return ok({
    ownerId: user.id,
    email: user.email,
  });
}
