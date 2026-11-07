import { createClient } from "@supabase/supabase-js";

async function seedDev() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "dummy_key";

  console.log("=== Planly Synthetic Development Seeder ===");
  console.log(`Connecting to: ${supabaseUrl}`);

  const supabase = createClient(supabaseUrl, supabaseKey);

  const testUserId = "00000000-0000-0000-0000-000000000001";

  // Check connection
  try {
    const { data: allowed, error: allowErr } = await supabase
      .from("allowed_owners")
      .upsert({ owner_id: testUserId })
      .select();

    if (allowErr) {
      console.warn("Notice: Local Supabase instance not currently running or reachable.");
      console.warn("SQL migration and seed files are ready in supabase/migrations/ and supabase/seed.sql.");
      return;
    }

    console.log("Allowed owner provisioned:", allowed);
  } catch (err: any) {
    console.warn("Local DB connection skipped:", err.message);
  }
}

seedDev();
