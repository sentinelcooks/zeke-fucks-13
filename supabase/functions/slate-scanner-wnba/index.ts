import { scanSport } from "../_shared/sport_scan.ts";
import { applyWaitToScanResult, buildWaitClient, parseWaitOptions } from "../_shared/scan_wait.ts";
import { requireServiceRoleAccess } from "../_shared/premium-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const access = await requireServiceRoleAccess(req, corsHeaders);
  if (!access.ok) return access.response;

  try {
    const waitOpts = await parseWaitOptions(req);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    // Discovery-only by default. analyzer-worker-wnba drains the bounded
    // queue, matching the production NBA/MLB/NHL scanner architecture.
    const result = await scanSport("wnba", {
      inlineAnalyze: body.inline_analyze === true,
      runId: typeof body.run_id === "string" ? body.run_id : undefined,
    });

    if (waitOpts.wait) {
      const client = buildWaitClient();
      if (client) await applyWaitToScanResult(client, "wnba", result, waitOpts.timeoutMs);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("slate-scanner-wnba error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
