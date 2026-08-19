import { getMasterClient } from "../_shared/masterClient.ts";
import { calculateCurrentParkFactors, type ParkFactorAggregateInput } from "../_shared/mlb_data.ts";
import { requireServiceRoleAccess } from "../_shared/premium-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const access = await requireServiceRoleAccess(req, corsHeaders);
  if (!access.ok) return access.response;

  try {
    let body: any = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }
    const asOf = String(body?.as_of || new Date().toISOString().slice(0, 10));
    const season = Number(body?.season || asOf.slice(0, 4));
    if (!Number.isInteger(season) || season < 2000 || season > 2100) return json({ error: "Invalid season" }, 400);
    const startDate = `${season}-03-15`;
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R&startDate=${startDate}&endDate=${asOf}&hydrate=venue,team`;
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Sentinel/1.0" } });
    if (!response.ok) return json({ error: `MLB Stats API returned ${response.status}` }, 502);
    const schedule = await response.json();
    const games: ParkFactorAggregateInput[] = [];
    for (const date of schedule?.dates || []) {
      for (const game of date?.games || []) {
        if (String(game?.status?.abstractGameState).toLowerCase() !== "final") continue;
        const venueId = Number(game?.venue?.id);
        const homeTeamId = Number(game?.teams?.home?.team?.id);
        const awayTeamId = Number(game?.teams?.away?.team?.id);
        const homeRuns = Number(game?.teams?.home?.score);
        const awayRuns = Number(game?.teams?.away?.score);
        if (![venueId, homeTeamId, awayTeamId, homeRuns, awayRuns].every(Number.isFinite)) continue;
        games.push({
          venueId,
          venueName: String(game?.venue?.name || `Venue ${venueId}`),
          homeTeamId,
          awayTeamId,
          homeRuns,
          awayRuns,
        });
      }
    }
    const factors = calculateCurrentParkFactors(games, season, asOf);
    const master = await getMasterClient();
    const rows = factors.map((factor) => ({
      venue_id: factor.venueId,
      venue_name: factor.venueName,
      season: factor.season,
      run_factor: factor.runFactor,
      home_games: factor.homeGames,
      road_games: factor.roadGames,
      as_of: factor.asOf,
      source: factor.source,
      methodology_version: "home_road_run_environment_v1",
      updated_at: new Date().toISOString(),
    }));
    if (!rows.length) return json({ error: "No venue met the 20-home/20-road sample requirement", games: games.length }, 422);
    const { error } = await master.from("mlb_park_factors").upsert(rows, { onConflict: "venue_id,season" });
    if (error) throw error;
    return json({ ok: true, season, as_of: asOf, completed_games: games.length, venues_updated: rows.length });
  } catch (error) {
    console.error("refresh-mlb-park-factors failed:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
