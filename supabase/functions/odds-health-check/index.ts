// Odds Health Check — admin diagnostic endpoint.
// Returns rotation-pool counts, env wiring, and reachability of two
// representative odds Edge Functions. Never returns raw API keys.

import { getMasterClient, masterDbConfigured } from "../_shared/masterClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-token, x-device-fingerprint, x-request-timestamp, x-request-nonce",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function ping(path: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;
  try {
    const resp = await fetch(`${url}/functions/v1/${path}`, {
      method: "OPTIONS",
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    return resp.ok || resp.status === 204;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Admin gate: shared password OR session-token check. Keep simple — accept
    // ADMIN_SECRET_PASSWORD via x-admin-password header or JSON body.
    const adminPassword = Deno.env.get("ADMIN_SECRET_PASSWORD");
    let supplied = req.headers.get("x-admin-password") || "";
    if (!supplied && req.method !== "GET") {
      try {
        const body = await req.clone().json().catch(() => ({}));
        supplied = body?.password || "";
      } catch { /* ignore */ }
    }
    if (!adminPassword || supplied !== adminPassword) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const master = await getMasterClient();

    const { data: keys, error: keysErr } = await master
      .from("odds_api_keys")
      .select("id, is_active, exhausted_at, last_used_at");

    const totalKeys = keys?.length || 0;
    const activeKeys = (keys || []).filter((k: any) => k.is_active && !k.exhausted_at).length;
    const exhaustedKeys = (keys || []).filter((k: any) => !!k.exhausted_at).length;
    const lastRotationAt = (keys || [])
      .map((k: any) => k.last_used_at)
      .filter(Boolean)
      .sort()
      .pop() || null;

    const [nbaOddsReachable, moneylineReachable] = await Promise.all([
      ping("nba-odds/events"),
      ping("moneyline-api"),
    ]);

    return json({
      ok: !keysErr && totalKeys > 0,
      masterDbConfigured: masterDbConfigured(),
      totalKeys,
      activeKeys,
      exhaustedKeys,
      lastRotationAt,
      nbaOddsReachable,
      moneylineReachable,
      keysQueryError: keysErr?.message ?? null,
      envSeen: {
        MASTER_SUPABASE_URL: !!Deno.env.get("MASTER_SUPABASE_URL"),
        MASTER_SUPABASE_SERVICE_KEY: !!Deno.env.get("MASTER_SUPABASE_SERVICE_KEY"),
        SUPABASE_URL: !!Deno.env.get("SUPABASE_URL"),
        SUPABASE_SERVICE_ROLE_KEY: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        ODDS_API_KEY: !!Deno.env.get("ODDS_API_KEY"),
        ADMIN_SECRET_PASSWORD: !!Deno.env.get("ADMIN_SECRET_PASSWORD"),
      },
    });
  } catch (err) {
    console.error("odds-health-check error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
