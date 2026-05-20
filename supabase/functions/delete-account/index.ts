import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLocalClient } from "../_shared/masterClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Deletes the calling user's Supabase auth account and best-effort cleanup of
 * related rows. Apple Guideline 5.1.1(v) requires in-app account deletion when
 * the app supports account creation. This function is invoked by the in-app
 * "Delete Account" confirmation in Settings.
 *
 * NOTE: Deleting the account does NOT cancel the user's Apple subscription —
 * the UI explicitly warns them and provides a Manage Subscription link before
 * they hit this endpoint.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Invalid token" }, 401);
    }
    const userId = userData.user.id;

    const admin = getLocalClient();

    // Best-effort cleanup of app data tied to the user. Failures here are
    // logged but do not block the auth user deletion — the user explicitly
    // requested removal.
    const cleanupTables = ["profiles", "user_picks", "user_settings"] as const;
    for (const table of cleanupTables) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error && !/relation .* does not exist|column .* does not exist/i.test(error.message)) {
        console.warn(`[delete-account] cleanup ${table} failed:`, error.message);
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("[delete-account] auth.admin.deleteUser failed:", deleteError);
      return json({ error: "Failed to delete account" }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[delete-account] error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
