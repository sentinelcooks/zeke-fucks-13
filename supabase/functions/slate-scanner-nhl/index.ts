import { scanSport } from "../_shared/sport_scan.ts";
import { applyWaitToScanResult, buildWaitClient, parseWaitOptions } from "../_shared/scan_wait.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const waitOpts = await parseWaitOptions(req);
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }
    // Discovery-only by default. analyzer-worker-nhl drains the queue.
    const inlineAnalyze = body?.inline_analyze === true;
    const result = await scanSport("nhl", {
      inlineAnalyze,
      runId: typeof body?.run_id === "string" ? body.run_id : undefined,
    });
    if (waitOpts.wait) {
      const client = buildWaitClient();
      if (client) await applyWaitToScanResult(client, "nhl", result, waitOpts.timeoutMs);
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slate-scanner-nhl error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
