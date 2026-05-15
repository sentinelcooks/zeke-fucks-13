// odds-key-recheck — admin-gated batch recheck of exhausted/rate-limited/unknown keys.
//
// Designed to be invoked from pg_cron on an hourly schedule (or from the admin
// "Recheck Exhausted/Stale Keys" button via key-admin's `recheck_keys` action,
// which is the same code path). Probes each candidate against /v4/sports/ and
// updates its status based on the real response. Never returns raw key material.

import { getMasterClient } from "../_shared/masterClient.ts";
import { recheckKeys } from "../_shared/oddsKeyPool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-password",
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
    const adminPassword = Deno.env.get("ADMIN_SECRET_PASSWORD");
    let supplied = req.headers.get("x-admin-password") || "";
    let batchSize = 100;
    if (req.method !== "GET") {
      try {
        const body = await req.clone().json().catch(() => ({}));
        if (!supplied && body?.password) supplied = body.password;
        if (Number.isFinite(body?.batchSize)) {
          batchSize = Math.max(1, Math.min(500, Number(body.batchSize)));
        }
      } catch { /* ignore */ }
    }
    if (!adminPassword || supplied !== adminPassword) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const master = await getMasterClient();
    const result = await recheckKeys(master, batchSize);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error("odds-key-recheck error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
