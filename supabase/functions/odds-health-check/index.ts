// Odds Health Check — admin diagnostic endpoint.
// Returns rotation-pool counts, env wiring, and reachability of two
// representative odds Edge Functions. Never returns raw API keys.

import { getMasterClient, masterDbConfigured } from "../_shared/masterClient.ts";
import { loadKeyPoolStats } from "../_shared/oddsKeyPool.ts";

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

    let stats: Awaited<ReturnType<typeof loadKeyPoolStats>> | null = null;
    let keysQueryError: string | null = null;
    try {
      stats = await loadKeyPoolStats(master);
    } catch (e) {
      keysQueryError = e instanceof Error ? e.message : String(e);
    }

    // In-process probe of the next usable key against /v4/sports/. Reveals
    // env-level breakage (DNS, TLS, account suspended) that ping-style
    // OPTIONS checks cannot. Probe consumes 1 request from the chosen key.
    let probeResult: { ok: boolean; status?: number; source?: string } | null = null;
    try {
      const { data: probeRow } = await master
        .from("odds_api_keys")
        .select("api_key")
        .eq("status", "available")
        .order("last_used_at", { ascending: true, nullsFirst: true })
        .limit(1)
        .maybeSingle();
      if (probeRow?.api_key) {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(probeRow.api_key)}`);
        probeResult = { ok: r.ok, status: r.status, source: "pool" };
      } else if (Deno.env.get("ODDS_API_KEY")) {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(Deno.env.get("ODDS_API_KEY")!)}`);
        probeResult = { ok: r.ok, status: r.status, source: "env" };
      } else {
        probeResult = { ok: false, source: "none" };
      }
    } catch (e) {
      probeResult = { ok: false, status: 0, source: "error" };
      console.warn("odds-health-check probe failed:", e instanceof Error ? e.message : e);
    }

    const [nbaOddsReachable, moneylineReachable] = await Promise.all([
      ping("nba-odds/events"),
      ping("moneyline-api"),
    ]);

    return json({
      ok: !keysQueryError && (stats?.total ?? 0) > 0,
      masterDbConfigured: masterDbConfigured(),
      // Status-driven shape (canonical, shared with key-admin's api_key_status).
      total: stats?.total ?? 0,
      byStatus: stats?.byStatus ?? null,
      usableNow: stats?.usableNow ?? 0,
      staleExhaustedWithQuotaRemaining: stats?.staleExhaustedWithQuotaRemaining ?? 0,
      usableRequestsRemaining: stats?.usableRequestsRemaining ?? 0,
      totalRequestsRemainingAllKeys: stats?.totalRequestsRemainingAllKeys ?? 0,
      oldestLastChecked: stats?.oldestLastChecked ?? null,
      newestLastChecked: stats?.newestLastChecked ?? null,
      // Back-compat fields for the current admin UI render (will be removed
      // once AdminPage binds to byStatus directly):
      totalKeys: stats?.total ?? 0,
      activeKeys: stats?.usableNow ?? 0,
      exhaustedKeys: (stats?.byStatus.exhausted_quota ?? 0) + (stats?.byStatus.invalid_auth ?? 0) + (stats?.byStatus.rate_limited ?? 0),
      lastRotationAt: stats?.newestLastChecked ?? null,
      probe: probeResult,
      nbaOddsReachable,
      moneylineReachable,
      keysQueryError,
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
