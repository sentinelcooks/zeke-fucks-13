// Refreshes the Analyze tab's "Trending tonight" list for MLB.
// Cron-only (service role): users read the stored list from trending_props,
// so browsing never spends Odds API credits. See _shared/trending_props.ts.
import { refreshTrendingProps } from "../_shared/trending_props.ts";
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
    const result = await refreshTrendingProps("mlb");
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trending-props-mlb error:", e);
    return new Response(JSON.stringify({ ok: false, sport: "mlb", error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
