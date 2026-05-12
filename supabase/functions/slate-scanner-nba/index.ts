import { scanSport } from "../_shared/sport_scan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    // Discovery-only by default: builds the candidate pool, enqueues every
    // survivor to public.analyzer_queue with a fresh run_id, writes the
    // scan_run_metrics discovery row, and returns. The analyzer-worker-nba
    // function drains the queue in chunks via cron. Set inline_analyze=true
    // in the request body to force the legacy in-process analyzer path
    // (debug / manual recovery only).
    const inlineAnalyze = body?.inline_analyze === true;
    const result = await scanSport("nba", {
      diagnosticsOnly: body?.diagnostics_only === true,
      traceTargets: Array.isArray(body?.trace_targets) ? body.trace_targets : [],
      inlineAnalyze,
      runId: typeof body?.run_id === "string" ? body.run_id : undefined,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slate-scanner-nba error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
