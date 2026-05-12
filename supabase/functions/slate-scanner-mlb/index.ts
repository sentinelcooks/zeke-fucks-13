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
      try { body = await req.json(); } catch { body = {}; }
    }
    // Discovery-only by default. The analyzer-worker-mlb function drains
    // the queue in small chunks via cron — this is the fix for the HTTP 546
    // WORKER_RESOURCE_LIMIT that killed MLB's inline scan.
    const inlineAnalyze = body?.inline_analyze === true;
    const result = await scanSport("mlb", {
      inlineAnalyze,
      runId: typeof body?.run_id === "string" ? body.run_id : undefined,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slate-scanner-mlb error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
