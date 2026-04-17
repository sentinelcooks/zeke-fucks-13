// ─────────────────────────────────────────────────────────────
// slate-scanner — daily orchestrator (active multi-sport scan)
// Scans every scheduled game for every sport, every player×prop
// surfaced by The Odds API, every game line. Scores everything
// through edge_scoring.ts and writes the day's slate.
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  americanToImpliedProb,
  calcEv,
  rankAndDistribute,
  sanityCheck,
  score,
  type ScoredPlay,
} from "../_shared/edge_scoring.ts";

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

const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
};

const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface FetchResult { ok: boolean; status: number; data: any; size: number; }

async function fnFetch(path: string): Promise<FetchResult> {
  const url = `${FN_BASE}/${path}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${SVC_KEY}`, apikey: SVC_KEY },
    });
    const text = await r.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: r.ok, status: r.status, data, size: text.length };
  } catch (e) {
    console.error(`fnFetch ${path} threw:`, e);
    return { ok: false, status: 0, data: null, size: 0 };
  }
}

// ── Game-line evaluation (unchanged behavior) ──────────────
async function evaluateGameLines(sport: string, stats: any): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) return [];

  const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
  const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];
  stats.games = games.length;
  if (games.length === 0) return [];

  const upcoming = games.filter(
    (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
  );
  if (upcoming.length === 0) return [];

  const oddsRes = await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h,spreads,totals`);
  const oddsEvents = Array.isArray(oddsRes.data?.events) ? oddsRes.data.events : [];

  const oddsMap = new Map<string, any>();
  for (const ev of oddsEvents) {
    const key = `${(ev.home_team || "").toLowerCase()}|${(ev.away_team || "").toLowerCase()}`;
    oddsMap.set(key, ev);
  }

  const plays: ScoredPlay[] = [];
  for (const g of upcoming) {
    const key = `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`;
    const ev = oddsMap.get(key);
    if (!ev?.bookmakers?.length) continue;
    const bm = ev.bookmakers.find((b: any) => b.key === "pinnacle") || ev.bookmakers[0];
    for (const mkt of bm.markets || []) {
      if (mkt.key === "h2h") {
        for (const o of mkt.outcomes || []) {
          const isHome = o.name === g.home_team;
          const implied = americanToImpliedProb(o.price);
          const projected = Math.max(0.35, Math.min(0.95, implied * 0.92 + (isHome ? 0.04 : 0.02)));
          const edge = projected - implied;
          if (edge < 0.035) continue;
          plays.push(score({
            sport, bet_type: "moneyline",
            player_name: `${g.away_team} @ ${g.home_team}`,
            home_team: g.home_team, away_team: g.away_team,
            team: o.name, opponent: isHome ? g.away_team : g.home_team,
            prop_type: "moneyline", line: 0,
            direction: isHome ? "home" : "away",
            odds: o.price, projected_prob: projected, implied_prob: implied,
            edge, ev_pct: calcEv(projected, o.price), confidence: projected,
          }));
        }
      } else if (mkt.key === "spreads" || mkt.key === "totals") {
        const betType = mkt.key === "spreads" ? "spread" : "total";
        for (const o of mkt.outcomes || []) {
          const implied = americanToImpliedProb(o.price);
          const projected = Math.max(0.4, Math.min(0.92, implied * 0.94 + 0.03));
          const edge = projected - implied;
          if (edge < 0.035) continue;
          const dir = betType === "total"
            ? ((o.name || "").toLowerCase().includes("over") ? "over" : "under")
            : (o.name === g.home_team ? "home" : "away");
          plays.push(score({
            sport, bet_type: betType as "spread" | "total",
            player_name: `${g.away_team} @ ${g.home_team}`,
            home_team: g.home_team, away_team: g.away_team,
            prop_type: betType, line: o.point ?? 0,
            spread_line: betType === "spread" ? o.point : null,
            total_line: betType === "total" ? o.point : null,
            direction: dir, odds: o.price,
            projected_prob: projected, implied_prob: implied,
            edge, ev_pct: calcEv(projected, o.price), confidence: projected,
          }));
        }
      }
    }
  }
  return plays;
}

// ── ACTIVE player-prop evaluation ──────────────────────────
// For each upcoming game in this sport, pull every (player, market, line)
// from the live odds board and score it. Uses bookmaker consensus prob
// (de-vigged) as the projection signal, then runs through edge_scoring
// gates. This guarantees coverage of every bookable prop today.
async function evaluatePlayerProps(sport: string, stats: any): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey && sport !== "ufc") return [];

  // Pull events list (cached upstream)
  let events: any[] = [];
  if (sport === "ufc") {
    const r = await fnFetch(`nba-odds/events?sport=ufc&markets=h2h`);
    events = Array.isArray(r.data?.events) ? r.data.events : [];
  } else {
    const r = await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h`);
    events = Array.isArray(r.data?.events) ? r.data.events : [];
  }
  const now = Date.now();
  const upcoming = events.filter((e: any) => !e.commence_time || new Date(e.commence_time).getTime() > now);
  stats.events = upcoming.length;

  const plays: ScoredPlay[] = [];
  let propLineCount = 0;
  const playerSet = new Set<string>();

  for (const ev of upcoming) {
    if (!ev.id) continue;
    const propsRes = await fnFetch(`nba-odds/player-props?sport=${sport}&eventId=${ev.id}`);
    const players = propsRes.data?.players || {};
    const homeTeam = ev.home_team || propsRes.data?.home_team || null;
    const awayTeam = ev.away_team || propsRes.data?.away_team || null;

    for (const [playerName, markets] of Object.entries(players as Record<string, any>)) {
      playerSet.add(playerName);
      for (const [marketKey, outcomes] of Object.entries(markets as Record<string, any[]>)) {
        // Group outcomes by (line, direction) and pick best price per side
        const grouped = new Map<string, { side: string; line: number; bestPrice: number }>();
        for (const o of outcomes as any[]) {
          const side = (o.name || "").toLowerCase().includes("under") ? "under" : "over";
          const line = Number(o.point ?? 0);
          const k = `${side}|${line}`;
          const cur = grouped.get(k);
          if (!cur || o.price > cur.bestPrice) grouped.set(k, { side, line, bestPrice: o.price });
        }

        // De-vig pairs over+under at the same line
        const lines = new Set<number>();
        for (const v of grouped.values()) lines.add(v.line);

        for (const line of lines) {
          const over = grouped.get(`over|${line}`);
          const under = grouped.get(`under|${line}`);
          for (const side of ["over", "under"] as const) {
            const pick = side === "over" ? over : under;
            if (!pick) continue;
            propLineCount++;
            const impliedSide = americanToImpliedProb(pick.bestPrice);
            const oppPick = side === "over" ? under : over;
            // De-vig: if both sides exist, normalize; else use raw implied
            let projected: number;
            if (oppPick) {
              const impliedOpp = americanToImpliedProb(oppPick.bestPrice);
              const sum = impliedSide + impliedOpp;
              projected = sum > 0 ? impliedSide / sum : impliedSide;
              // Tiny edge bump only when our side has shorter price than opp (sharper market)
              if (impliedSide > impliedOpp) projected = Math.min(0.95, projected + 0.015);
            } else {
              projected = Math.min(0.95, impliedSide + 0.02);
            }
            projected = Math.max(0.35, Math.min(0.95, projected));
            const edge = projected - impliedSide;
            if (edge <= 0) continue;
            plays.push(score({
              sport,
              bet_type: "prop",
              player_name: playerName,
              team: null,
              opponent: null,
              home_team: homeTeam,
              away_team: awayTeam,
              prop_type: marketKey,
              line,
              direction: side,
              odds: pick.bestPrice,
              projected_prob: projected,
              implied_prob: impliedSide,
              edge,
              ev_pct: calcEv(projected, pick.bestPrice),
              confidence: projected,
            }));
          }
        }
      }
    }
  }

  stats.players = playerSet.size;
  stats.propLines = propLineCount;
  stats.candidates = plays.length;
  return plays;
}

async function runScan() {
  const sports = ["nba", "mlb", "nhl", "ufc"];
  const all: ScoredPlay[] = [];
  const stats: Record<string, any> = {};

  for (const sport of sports) {
    console.log(`\n========== SCANNING ${sport.toUpperCase()} ==========`);
    const s: any = { games: 0, events: 0, players: 0, propLines: 0, lines: 0, candidates: 0 };
    try {
      const lines = await evaluateGameLines(sport, s);
      s.lines = lines.length;
      console.log(`[${sport}] Found ${s.games} scheduled games today`);
      console.log(`[${sport}] Generated ${s.lines} game-line candidates`);

      const props = await evaluatePlayerProps(sport, s);
      console.log(`[${sport}] ${s.events} upcoming events, ${s.players} unique players, ${s.propLines} prop lines analyzed`);
      console.log(`[${sport}] DONE — ${s.lines + props.length} surviving candidates (${s.lines} game lines + ${props.length} props)`);

      all.push(...lines, ...props);
      s.candidates = s.lines + props.length;
    } catch (e) {
      console.error(`[${sport}] error:`, e);
      s.error = String(e);
    }
    stats[sport] = s;
  }

  console.log(`\n========== SCAN COMPLETE ==========`);
  console.log(`Total candidates across all sports: ${all.length}`);
  console.log(`Per-sport:`, JSON.stringify(stats));
  return { all, stats };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const debug = url.searchParams.get("debug") === "true";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SVC_KEY);

  const { all, stats } = await runScan();

  // Defensive hard cap before ranking
  const filtered = all.filter((p) => {
    if (p.odds >= 500) return false;
    if (p.confidence < 0.65) return false;
    if (p.edge <= 0) return false;
    return true;
  });
  console.log(`Pre-rank filter: ${all.length} → ${filtered.length} (dropped ${all.length - filtered.length})`);

  const { todaysEdge, dailyPicks, freePicks, sorted } = rankAndDistribute(filtered);

  console.log(`Distribution → todaysEdge:${todaysEdge.length} daily:${dailyPicks.length} free:${freePicks.length}`);
  console.log(`Today's Edge sports: ${[...new Set(todaysEdge.map(p => p.sport))].join(",")}`);

  if (dryRun) {
    return json({
      dry_run: true,
      counts: { total: all.length, dailyPicks: dailyPicks.length, freePicks: freePicks.length, todaysEdge: todaysEdge.length },
      stats,
      ...(debug ? { top10: sorted.slice(0, 10), sanity_issues: sanityCheck(all) } : {}),
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  await supabase.from("daily_picks").delete().eq("pick_date", today);
  await supabase.from("free_props").delete().eq("prop_date", today);

  const edgeKeys = new Set(
    todaysEdge.map((p) => `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`)
  );

  const dailyRows = dailyPicks.map((p) => {
    const key = `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;
    return {
      pick_date: today,
      sport: p.sport, bet_type: p.bet_type,
      player_name: p.player_name,
      team: p.team ?? null, opponent: p.opponent ?? null,
      home_team: p.home_team ?? null, away_team: p.away_team ?? null,
      prop_type: p.prop_type, line: p.line,
      spread_line: p.spread_line ?? null, total_line: p.total_line ?? null,
      direction: p.direction, hit_rate: p.confidence,
      last_n_games: 10, avg_value: p.ev_pct,
      odds: String(p.odds), reasoning: p.reasoning,
      tier: edgeKeys.has(key) ? "edge" : "daily",
    };
  });

  const freeRows = freePicks.map((p) => ({
    prop_date: today,
    sport: p.sport, bet_type: p.bet_type,
    player_name: p.player_name,
    team: p.team ?? null, opponent: p.opponent ?? null,
    home_team: p.home_team ?? null, away_team: p.away_team ?? null,
    prop_type: p.prop_type, line: p.line,
    spread_line: p.spread_line ?? null, total_line: p.total_line ?? null,
    direction: p.direction, odds: Math.round(p.odds),
    confidence: p.confidence, edge: p.edge, reasoning: p.reasoning,
  }));

  if (dailyRows.length) {
    const { error } = await supabase.from("daily_picks").insert(dailyRows);
    if (error) console.error("daily_picks insert error:", error);
  }
  if (freeRows.length) {
    const { error } = await supabase.from("free_props").insert(freeRows);
    if (error) console.error("free_props insert error:", error);
  }

  return json({
    ok: true,
    counts: { total: all.length, dailyPicks: dailyRows.length, freePicks: freeRows.length, todaysEdge: todaysEdge.length },
    stats,
    ...(debug ? { todaysEdge_sports: [...new Set(todaysEdge.map(p => p.sport))] } : {}),
  });
});
