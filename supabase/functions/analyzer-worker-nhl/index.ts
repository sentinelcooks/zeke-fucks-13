// analyzer-worker-nhl
//
// Per-sport NHL analyzer worker. Claims pending rows from public.analyzer_queue
// where sport='nhl' via claim_analyzer_queue_batch and drains them through
// nba-api/analyze (which internally fans out to nhl-model/analyze for team
// context). The legacy process-analyzer-queue continues to run on a 2-min
// cron as a safety net.

import { runAnalyzerWorker } from "../_shared/analyzer_worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const result = await runAnalyzerWorker("nhl", {
    batchSize: 10,
    softDeadlineMs: 45_000,
    maxClaimRounds: 3,
    maxAttempts: 5,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
