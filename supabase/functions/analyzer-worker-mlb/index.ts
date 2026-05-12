// analyzer-worker-mlb
//
// Per-sport MLB analyzer worker. The original failure mode this whole
// refactor exists to fix: MLB's monolithic scan hit HTTP 546
// WORKER_RESOURCE_LIMIT. This worker claims a small batch (6) per round
// and stops well before Edge Function CPU/memory limits, so MLB can drain
// the full slate across many invocations instead of dying in one.
//
// MLB analyzer payloads are the heaviest (20-factor pitcher/park/team
// context fanned out from nba-api/analyze → mlb-model/analyze), hence the
// smaller batch and tighter soft deadline than NBA/NHL.

import { runAnalyzerWorker } from "../_shared/analyzer_worker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const result = await runAnalyzerWorker("mlb", {
    batchSize: 6,
    softDeadlineMs: 40_000,
    maxClaimRounds: 3,
    maxAttempts: 5,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
