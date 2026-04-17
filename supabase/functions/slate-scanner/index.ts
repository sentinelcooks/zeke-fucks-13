// ─────────────────────────────────────────────────────────────
// slate-scanner — daily orchestrator
// 1. Pulls full slate (NBA/MLB/NHL/UFC) from games-schedule
// 2. Evaluates game lines (ML/spread/total) + player props
// 3. Ranks by score = edge × confidence
// 4. Writes to daily_picks (≥70%) and free_props (≥65%)
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
  ufc: "mma_mixed_martial_arts",
};

const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function fnFetch(path: string) {
  const r = await fetch(`${FN_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${SVC_KEY}`, apikey: SVC_KEY },
  });
  if (!r.ok) {
    console.warn(`fnFetch ${path} -> ${r.status}`);
    return null;
  }
  return r.json().catch(() => null);
}

// ── Game-line evaluation ───────────────────────────────────
async function evaluateGameLines(sport: string): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];
  const games = (await fnFetch(`games-schedule?sport=${sportKey}`)) || [];
  if (!Array.isArray(games) || games.length === 0) return [];

  // Pull odds for the sport (h2h / spreads / totals)
  const odds =
    (await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h,spreads,totals`)) || [];
  const oddsMap = new Map<string, any>();
  for (const ev of Array.isArray(odds) ? odds : []) {
    const key = `${(ev.home_team || "").toLowerCase()}|${(ev.away_team || "").toLowerCase()}`;
    oddsMap.set(key, ev);
  }

  const plays: ScoredPlay[] = [];
  for (const g of games) {
    if (g.status === "STATUS_FINAL" || g.status === "STATUS_IN_PROGRESS") continue;
    const key = `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`;
    const ev = oddsMap.get(key);
    if (!ev?.bookmakers?.length) continue;

    // Use first bookmaker as canonical (Pinnacle preferred if present)
    const bm = ev.bookmakers.find((b: any) => b.key === "pinnacle") || ev.bookmakers[0];
    for (const mkt of bm.markets || []) {
      if (mkt.key === "h2h") {
        for (const o of mkt.outcomes || []) {
          const isHome = o.name === g.home_team;
          const implied = americanToImpliedProb(o.price);
          // Lightweight model: shrink toward 50/50 + small home bias
          const projected = Math.max(
            0.05,
            Math.min(0.95, implied * 0.92 + (isHome ? 0.04 : 0.02))
          );
          const edge = projected - implied;
          if (edge < 0.02) continue;
          plays.push(
            score({
              sport,
              bet_type: "moneyline",
              player_name: `${g.away_team} @ ${g.home_team}`,
              home_team: g.home_team,
              away_team: g.away_team,
              team: o.name,
              opponent: isHome ? g.away_team : g.home_team,
              prop_type: "moneyline",
              line: 0,
              direction: isHome ? "home" : "away",
              odds: o.price,
              projected_prob: projected,
              implied_prob: implied,
              edge,
              ev_pct: calcEv(projected, o.price),
              confidence: projected,
            })
          );
        }
      } else if (mkt.key === "spreads" || mkt.key === "totals") {
        const betType = mkt.key === "spreads" ? "spread" : "total";
        for (const o of mkt.outcomes || []) {
          const implied = americanToImpliedProb(o.price);
          const projected = Math.max(0.05, Math.min(0.95, implied * 0.94 + 0.03));
          const edge = projected - implied;
          if (edge < 0.02) continue;
          const dir =
            betType === "total"
              ? (o.name || "").toLowerCase().includes("over")
                ? "over"
                : "under"
              : o.name === g.home_team
                ? "home"
                : "away";
          plays.push(
            score({
              sport,
              bet_type: betType as "spread" | "total",
              player_name: `${g.away_team} @ ${g.home_team}`,
              home_team: g.home_team,
              away_team: g.away_team,
              prop_type: betType,
              line: o.point ?? 0,
              spread_line: betType === "spread" ? o.point : null,
              total_line: betType === "total" ? o.point : null,
              direction: dir,
              odds: o.price,
              projected_prob: projected,
              implied_prob: implied,
              edge,
              ev_pct: calcEv(projected, o.price),
              confidence: projected,
            })
          );
        }
      }
    }
  }
  return plays;
}

// ── Player-prop evaluation (delegates to existing free-props logic) ──
async function evaluatePlayerProps(sport: string): Promise<ScoredPlay[]> {
  // Reuse free-props edge function which already scans active players
  const data = await fnFetch(`free-props/scan?sport=${sport}`);
  const rows = Array.isArray(data) ? data : data?.props || [];
  const plays: ScoredPlay[] = [];
  for (const r of rows) {
    const odds = r.odds ?? -110;
    const implied = americanToImpliedProb(odds);
    const conf = (r.confidence ?? 0) / (r.confidence > 1 ? 100 : 1);
    const edge = (r.edge ?? Math.max(0, conf - implied)) / (Math.abs(r.edge) > 1 ? 100 : 1);
    plays.push(
      score({
        sport,
        bet_type: "prop",
        player_name: r.player_name,
        team: r.team,
        opponent: r.opponent,
        prop_type: r.prop_type,
        line: r.line,
        direction: r.direction || "over",
        odds,
        projected_prob: conf,
        implied_prob: implied,
        edge,
        ev_pct: calcEv(conf, odds),
        confidence: conf,
      })
    );
  }
  return plays;
}

async function runScan(): Promise<{ all: ScoredPlay[]; perSport: Record<string, number> }> {
  const sports = ["nba", "mlb", "nhl", "ufc"];
  const all: ScoredPlay[] = [];
  const perSport: Record<string, number> = {};
  for (const sport of sports) {
    try {
      const [lines, props] = await Promise.all([
        evaluateGameLines(sport),
        evaluatePlayerProps(sport),
      ]);
      const combined = [...lines, ...props];
      perSport[sport] = combined.length;
      all.push(...combined);
    } catch (e) {
      console.error(`scan ${sport} failed:`, e);
      perSport[sport] = 0;
    }
  }
  return { all, perSport };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SVC_KEY);

  const { all, perSport } = await runScan();
  const { todaysEdge, dailyPicks, freePicks, sorted } = rankAndDistribute(all);

  if (dryRun) {
    return json({
      dry_run: true,
      counts: { total: all.length, perSport, dailyPicks: dailyPicks.length, freePicks: freePicks.length, todaysEdge: todaysEdge.length },
      top10: sorted.slice(0, 10),
      sanity_issues: sanityCheck(all),
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Wipe today's rows then insert
  await supabase.from("daily_picks").delete().eq("pick_date", today);
  await supabase.from("free_props").delete().eq("prop_date", today);

  const dailyRows = dailyPicks.map((p) => ({
    pick_date: today,
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
    hit_rate: p.confidence,
    last_n_games: 10,
    avg_value: p.ev_pct,
    odds: String(p.odds),
    reasoning: p.reasoning,
  }));

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

  if (dailyRows.length) await supabase.from("daily_picks").insert(dailyRows);
  if (freeRows.length) await supabase.from("free_props").insert(freeRows);

  return json({
    ok: true,
    counts: {
      total: all.length,
      perSport,
      dailyPicks: dailyRows.length,
      freePicks: freeRows.length,
      todaysEdge: todaysEdge.length,
    },
  });
});
