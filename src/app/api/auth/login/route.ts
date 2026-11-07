import { NextResponse } from "next/server";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      // Local development: auto-login as dev owner
      return NextResponse.json({
        ok: true,
        user: { id: "dev-owner-001", email: "dev@localhost" },
      });
    }
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, message: "Email and password are required." },
        { status: 400 }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (data?.user && !error) {
      const { data: allowed, error: allowError } = await supabase
        .from("allowed_owners")
        .select("owner_id")
        .eq("owner_id", data.user.id)
        .maybeSingle();

      if (allowError || !allowed) {
        await supabase.auth.signOut();
        return NextResponse.json(
          { ok: false, message: "This account is not authorized for the private workbench." },
          { status: 403 }
        );
      }

      return NextResponse.json({
        ok: true,
        user: { id: data.user.id, email: data.user.email },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message:
          "Invalid credentials.",
      },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}
