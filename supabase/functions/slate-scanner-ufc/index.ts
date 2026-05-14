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
    // UFC keeps the legacy inline-analyzer path: there is no analyzer-worker-ufc
    // yet, and UFC slate volume is small enough that worker_resource_limit is
    // not a concern. If/when a UFC worker is added, flip this to false and
    // the discovery branch will enqueue all candidates to analyzer_queue.
    const result = await scanSport("ufc", { inlineAnalyze: true });
    if (waitOpts.wait) {
      const client = buildWaitClient();
      if (client) await applyWaitToScanResult(client, "ufc", result, waitOpts.timeoutMs);
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slate-scanner-ufc error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
