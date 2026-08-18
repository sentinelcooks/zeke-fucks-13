// Per-sport WNBA analyzer worker. Claims WNBA candidates in bounded batches,
// validates props and game lines through their market-specific analyzers,
// and finalizes qualifying rows into daily_picks.

import { runAnalyzerWorker } from "../_shared/analyzer_worker.ts";
import { requireServiceRoleAccess } from "../_shared/premium-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const access = await requireServiceRoleAccess(req, corsHeaders);
  if (!access.ok) return access.response;

  const result = await runAnalyzerWorker("wnba", {
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
