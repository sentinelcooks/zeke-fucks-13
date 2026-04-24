import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMasterClient } from "../_shared/masterClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // app_config lives in MASTER DB alongside odds_api_keys (key-admin writes there).
    const supabase = await getMasterClient();

    const body = await req.json();
    const { password, action, key, value } = body;

    const adminPassword = Deno.env.get("ADMIN_SECRET_PASSWORD");
    if (!adminPassword || password !== adminPassword) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── save: upsert a config value ──
    if (action === "save") {
      if (!key || value === undefined) {
        return json({ error: "key and value are required" }, 400);
      }
      const { error } = await supabase
        .from("app_config")
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // ── status: return whether a key is set (never returns the raw value) ──
    if (action === "status") {
      if (!key) return json({ error: "key is required" }, 400);
      const { data } = await supabase
        .from("app_config")
        .select("value, updated_at")
        .eq("key", key)
        .single();
      return json({
        exists: !!(data?.value),
        updated_at: data?.updated_at ?? null,
      });
    }

    return json({ error: "Unknown action. Use: save, status" }, 400);
  } catch (err) {
    console.error("save-config error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
