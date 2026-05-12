// analyzer-worker-nba
//
// Per-sport NBA analyzer worker. Claims pending rows from public.analyzer_queue
// where sport='nba' via the new claim_analyzer_queue_batch RPC, runs each
// through nba-api/analyze, and finalizes successful rows into daily_picks via
// the same applyAnalyzerFinalizeInsertGuard the live scanner uses.
//
// NBA was previously drained by process-nba-analyzer-queue (its own dedicated
// queue table). With the discovery refactor, NBA discovery now also enqueues
// into the generic analyzer_queue. Both drainers run in parallel during
// rollout; legacy nba_analyzer_queue rows are NOT touched here.

import { runAnalyzerWorker } from "../_shared/analyzer_worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const result = await runAnalyzerWorker("nba", {
    batchSize: 8,
    softDeadlineMs: 45_000,
    maxClaimRounds: 3,
    maxAttempts: 5,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
