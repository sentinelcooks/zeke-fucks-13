// ─────────────────────────────────────────────────────────────
// slate-scanner — orchestrator
// 1. Wipe today's daily_picks + free_props (ONCE)
// 2. Invoke per-sport scanners in parallel (each = own edge invocation)
// 3. Read all _pending rows back, run rankAndDistribute
// 4. Update tiers (edge / daily / value) and insert top free_props
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { rankAndDistribute, scorePrecomputed, type ScoredPlay } from "../_shared/edge_scoring.ts";

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

const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Use supabase.functions.invoke() so the service-role client handles auth
// automatically — avoids the 401s that manual Bearer header assembly produces
// when functions call peer functions internally.
async function invokeSport(supabase: ReturnType<typeof createClient>, sport: string): Promise<any> {
  try {
    const { data, error } = await supabase.functions.invoke(`slate-scanner-${sport}`, {
      body: {},
    });
    if (error) {
      console.error(`[${sport}] invoke error:`, error);
      return { sport, error: String(error), scanned: 0, validated: 0, inserted: 0 };
    }
    return data ?? { sport, scanned: 0, validated: 0, inserted: 0 };
  } catch (e) {
    console.error(`[${sport}] invoke threw:`, e);
    return { sport, error: String(e), scanned: 0, validated: 0, inserted: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "true";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SVC_KEY);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Wipe today's rows ONCE
  console.log("Wiping today's daily_picks + free_props...");
  await supabase.from("daily_picks").delete().eq("pick_date", today);
  await supabase.from("free_props").delete().eq("prop_date", today);

  // 2. Invoke per-sport scanners SEQUENTIALLY to avoid AI Gateway rate limits
  console.log("Dispatching per-sport scanners sequentially...");
  const sports = ["nba", "mlb", "nhl", "ufc"];
  const perSport: Record<string, any> = {};
  for (const s of sports) {
    try {
      perSport[s] = await invokeSport(supabase, s);
    } catch (e) {
      perSport[s] = { error: String(e) };
    }
  }
  console.log("Per-sport results:", JSON.stringify(perSport));

  // 3. Read all _pending rows for today
  const { data: pendingRows, error: readErr } = await supabase
    .from("daily_picks")
    .select("*")
    .eq("pick_date", today)
    .eq("tier", "_pending");

  if (readErr) {
    console.error("Failed to read pending rows:", readErr);
    return json({ ok: false, error: String(readErr), perSport }, 500);
  }
  console.log(`Loaded ${pendingRows?.length ?? 0} _pending rows for finalization`);

  // 4. Re-score each pending row (so rankAndDistribute can use composite quality)
  // The per-sport scanners already wrote a calibrated confidence (0-1) into
  // the `confidence` column; fall back to hit_rate (0-100 percent) if missing
  // for legacy rows.
  const validated: ScoredPlay[] = (pendingRows || []).map((r: any) => {
    const confidence = r.confidence != null
      ? Number(r.confidence)
      : Number(r.hit_rate ?? 0) / 100;
    const oddsNum = Number(r.odds ?? -110);
    const decimal = oddsNum > 0 ? oddsNum / 100 + 1 : 100 / -oddsNum + 1;
    const implied = oddsNum > 0 ? 100 / (oddsNum + 100) : -oddsNum / (-oddsNum + 100);
    const edge = Math.max(0, confidence - implied);
    const ev_pct = (confidence * (decimal - 1) - (1 - confidence)) * 100;
    return scorePrecomputed({
      sport: r.sport,
      bet_type: r.bet_type as any,
      player_name: r.player_name,
      team: r.team ?? null,
      opponent: r.opponent ?? null,
      home_team: r.home_team ?? null,
      away_team: r.away_team ?? null,
      prop_type: r.prop_type,
      line: Number(r.line),
      spread_line: r.spread_line ?? null,
      total_line: r.total_line ?? null,
      direction: r.direction,
      odds: oddsNum,
      projected_prob: confidence,
      implied_prob: implied,
      edge,
      ev_pct,
      confidence,
    });
  });

  const { todaysEdge, dailyPicks, freePicks } = rankAndDistribute(validated);
  console.log(`Distribution → edge:${todaysEdge.length} daily:${dailyPicks.length} free:${freePicks.length}`);

  // Build a map: pending row id → tier
  const edgeKeys = new Set(
    todaysEdge.map((p) => `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`)
  );
  const dailyKeys = new Set(
    dailyPicks.map((p) => `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`)
  );

  // 5. Update tiers in bulk (one update per tier)
  const tierEdgeIds: string[] = [];
  const tierDailyIds: string[] = [];
  const tierValueIds: string[] = [];
  const tierKeepIds: string[] = []; // any pending row that survived ranking

  for (const r of pendingRows || []) {
    const key = `${r.sport}|${r.player_name}|${r.prop_type}|${r.direction}|${r.line}`;
    if (edgeKeys.has(key)) {
      tierEdgeIds.push(r.id);
      tierKeepIds.push(r.id);
    } else if (dailyKeys.has(key)) {
      const conf = Number(r.hit_rate ?? 0) / 100;
      if (conf >= 0.70) tierDailyIds.push(r.id);
      else tierValueIds.push(r.id);
      tierKeepIds.push(r.id);
    }
  }

  // Delete any _pending rows that didn't make it (kept the table clean)
  await supabase
    .from("daily_picks")
    .delete()
    .eq("pick_date", today)
    .eq("tier", "_pending");

  // Re-insert the survivors with their final tier
  const survivors = (pendingRows || []).filter((r: any) =>
    edgeKeys.has(`${r.sport}|${r.player_name}|${r.prop_type}|${r.direction}|${r.line}`) ||
    dailyKeys.has(`${r.sport}|${r.player_name}|${r.prop_type}|${r.direction}|${r.line}`)
  );
  const finalRows = survivors.map((r: any) => {
    const key = `${r.sport}|${r.player_name}|${r.prop_type}|${r.direction}|${r.line}`;
    let tier = "value";
    if (edgeKeys.has(key)) tier = "edge";
    else if (Number(r.hit_rate ?? 0) >= 70) tier = "daily";
    // Preserve calibrated confidence so the frontend can sort by it.
    const confidence01 = r.confidence != null
      ? Number(r.confidence)
      : Number(r.hit_rate ?? 0) / 100;
    return {
      pick_date: today,
      event_id: r.event_id ?? null,
      commence_time: r.commence_time ?? null,
      game_date: r.game_date ?? null,
      sport: r.sport,
      bet_type: r.bet_type,
      player_name: r.player_name,
      team: r.team,
      opponent: r.opponent,
      home_team: r.home_team,
      away_team: r.away_team,
      prop_type: r.prop_type,
      line: r.line,
      spread_line: r.spread_line,
      total_line: r.total_line,
      direction: r.direction,
      hit_rate: r.hit_rate,
      confidence: Math.round(confidence01 * 1000) / 1000,
      last_n_games: r.last_n_games ?? 10,
      avg_value: r.avg_value,
      odds: r.odds,
      reasoning: r.reasoning,
      tier,
    };
  });

  if (finalRows.length) {
    const { error } = await supabase.from("daily_picks").insert(finalRows);
    if (error) console.error("Final daily_picks insert error:", error);
  }

  // 6. Insert top free_props
  const freeRows = freePicks.map((p) => ({
    prop_date: today,
    sport: p.sport,
    bet_type: p.bet_type,
    player_name: p.player_name,
    team: p.team ?? null,
    opponent: p.opponent ?? null,
    home_team: p.home_team ?? null,
    away_team: p.away_team ?? null,
    prop_type: p.prop_type,
    line: p.line,
    spread_line: p.spread_line ?? null,
    total_line: p.total_line ?? null,
    direction: p.direction,
    odds: Math.round(p.odds),
    confidence: p.confidence,
    edge: p.edge,
    reasoning: p.reasoning,
  }));
  if (freeRows.length) {
    const { error } = await supabase.from("free_props").insert(freeRows);
    if (error) console.error("free_props insert error:", error);
  }

  const tiers = { edge: tierEdgeIds.length, daily: tierDailyIds.length, value: tierValueIds.length };
  console.log("Final tiers:", JSON.stringify(tiers));

  return json({
    ok: true,
    perSport,
    totals: {
      pending: pendingRows?.length ?? 0,
      survivors: survivors.length,
      free: freeRows.length,
    },
    tiers,
    ...(debug ? { todaysEdge_sports: [...new Set(todaysEdge.map((p) => p.sport))] } : {}),
  });
});
