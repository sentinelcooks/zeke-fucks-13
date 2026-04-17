// ─────────────────────────────────────────────────────────────
// slate-scanner — daily orchestrator
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

// Map short code -> Odds-API sport key (for games-schedule)
const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  // UFC not supported by games-schedule yet
};

const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface FetchResult {
  ok: boolean;
  status: number;
  data: any;
  url: string;
  size: number;
}

async function fnFetch(path: string): Promise<FetchResult> {
  const url = `${FN_BASE}/${path}`;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${SVC_KEY}`, apikey: SVC_KEY },
    });
    const text = await r.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = text; }
    const size = text.length;
    console.log(`fnFetch ${path} -> ${r.status} (${size}b)`);
    return { ok: r.ok, status: r.status, data, url, size };
  } catch (e) {
    console.error(`fnFetch ${path} threw:`, e);
    return { ok: false, status: 0, data: null, url, size: 0 };
  }
}

// ── Synthetic seed for off-season validation ────────────────
function syntheticPlays(): ScoredPlay[] {
  const odds = -110;
  const implied = americanToImpliedProb(odds);
  const projected = 0.62;
  const edge = projected - implied;
  return [
    score({
      sport: "nba",
      bet_type: "moneyline",
      player_name: "Test Lakers @ Test Celtics",
      home_team: "Test Celtics",
      away_team: "Test Lakers",
      team: "Test Celtics",
      opponent: "Test Lakers",
      prop_type: "moneyline",
      line: 0,
      direction: "home",
      odds,
      projected_prob: projected,
      implied_prob: implied,
      edge,
      ev_pct: calcEv(projected, odds),
      confidence: projected,
    }),
    score({
      sport: "nba",
      bet_type: "prop",
      player_name: "Test Player",
      team: "Test Lakers",
      opponent: "Test Celtics",
      prop_type: "points",
      line: 25.5,
      direction: "over",
      odds: -115,
      projected_prob: 0.68,
      implied_prob: americanToImpliedProb(-115),
      edge: 0.68 - americanToImpliedProb(-115),
      ev_pct: calcEv(0.68, -115),
      confidence: 0.68,
    }),
  ];
}

// ── Game-line evaluation ───────────────────────────────────
async function evaluateGameLines(
  sport: string,
  diag: Record<string, any>
): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) {
    diag.gamesFetched = 0;
    diag.note = "sport not supported by games-schedule";
    return [];
  }

  const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
  const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];
  diag.gamesFetched = games.length;
  diag.gamesScheduleStatus = gamesRes.status;
  if (games.length === 0) return [];

  const upcoming = games.filter(
    (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
  );
  diag.gamesUpcoming = upcoming.length;
  if (upcoming.length === 0) return [];

  const oddsRes = await fnFetch(
    `nba-odds/events?sport=${sport}&markets=h2h,spreads,totals`
  );
  const oddsEvents = Array.isArray(oddsRes.data?.events)
    ? oddsRes.data.events
    : Array.isArray(oddsRes.data)
      ? oddsRes.data
      : [];
  diag.oddsFetched = oddsEvents.length;
  diag.oddsStatus = oddsRes.status;

  const oddsMap = new Map<string, any>();
  for (const ev of oddsEvents) {
    const key = `${(ev.home_team || "").toLowerCase()}|${(ev.away_team || "").toLowerCase()}`;
    oddsMap.set(key, ev);
  }

  let matched = 0;
  const plays: ScoredPlay[] = [];
  for (const g of upcoming) {
    const key = `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`;
    const ev = oddsMap.get(key);
    if (!ev?.bookmakers?.length) continue;
    matched++;
    const bm = ev.bookmakers.find((b: any) => b.key === "pinnacle") || ev.bookmakers[0];
    for (const mkt of bm.markets || []) {
      if (mkt.key === "h2h") {
        for (const o of mkt.outcomes || []) {
          const isHome = o.name === g.home_team;
            const implied = americanToImpliedProb(o.price);
            // Tighter clamp: no longshot dogs (<35% projected)
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
  diag.gamesWithOdds = matched;
  diag.linesGenerated = plays.length;
  return plays;
}

// ── Player props — read from free_props; auto-trigger generate if empty ──
async function evaluatePlayerProps(
  sport: string,
  diag: Record<string, any>,
  supabase: any
): Promise<ScoredPlay[]> {
  const today = new Date().toISOString().slice(0, 10);

  async function readRows() {
    const { data, error } = await supabase
      .from("free_props")
      .select("*")
      .eq("prop_date", today)
      .eq("sport", sport);
    if (error) {
      diag.propsError = error.message;
      return [];
    }
    return data || [];
  }

  let rows = await readRows();
  // If nothing for this sport, trigger one global generate and re-read.
  // Use a module-level flag to avoid triggering more than once per scan.
  if (rows.filter((r: any) => !r.bet_type || r.bet_type === "prop").length === 0) {
    if (!(globalThis as any).__freePropsGenerated) {
      (globalThis as any).__freePropsGenerated = true;
      diag.triggeredGenerate = true;
      const gen = await fnFetch("free-props/generate");
      diag.generateStatus = gen.status;
      diag.generateBody = gen.data;
    }
    rows = await readRows();
  }
  diag.propsFetched = rows.length;

  const plays: ScoredPlay[] = [];
  for (const r of rows) {
    if (r.bet_type && r.bet_type !== "prop") continue; // skip game-line rows we wrote
    const odds = r.odds ?? -110;
    const implied = americanToImpliedProb(odds);
    const conf = (r.confidence ?? 0) > 1 ? r.confidence / 100 : (r.confidence ?? 0);
    const edgeRaw = r.edge ?? Math.max(0, conf - implied);
    const edge = Math.abs(edgeRaw) > 1 ? edgeRaw / 100 : edgeRaw;
    plays.push(score({
      sport, bet_type: "prop",
      player_name: r.player_name, team: r.team, opponent: r.opponent,
      prop_type: r.prop_type, line: r.line,
      direction: r.direction || "over",
      odds, projected_prob: conf, implied_prob: implied,
      edge, ev_pct: calcEv(conf, odds), confidence: conf,
    }));
  }
  diag.propPlaysGenerated = plays.length;
  return plays;
}

async function runScan(supabase: any) {
  const sports = ["nba", "mlb", "nhl", "ufc"];
  const all: ScoredPlay[] = [];
  const debug: Record<string, any> = {};
  for (const sport of sports) {
    const d: Record<string, any> = {};
    try {
      const [lines, props] = await Promise.all([
        evaluateGameLines(sport, d),
        evaluatePlayerProps(sport, d, supabase),
      ]);
      const combined = [...lines, ...props];
      d.playsGenerated = combined.length;
      all.push(...combined);
    } catch (e) {
      d.error = String(e);
    }
    debug[sport] = d;
  }
  return { all, debug };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "true";
  const debug = url.searchParams.get("debug") === "true";
  const seed = url.searchParams.get("seed") === "true";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SVC_KEY);

  let all: ScoredPlay[] = [];
  let debugInfo: Record<string, any> = {};

  if (seed) {
    all = syntheticPlays();
    debugInfo = { mode: "synthetic", count: all.length };
  } else {
    const r = await runScan(supabase);
    all = r.all;
    debugInfo = r.debug;
  }

  // DEFENSIVE HARD CAP: drop absurd longshots before ranking, regardless of verdict tiering
  const filtered = all.filter((p) => {
    if (p.odds >= 500) return false;
    if (p.confidence < 0.65) return false;
    if (p.edge <= 0) return false;
    return true;
  });
  console.log(`Pre-rank filter: ${all.length} → ${filtered.length} (dropped ${all.length - filtered.length} junk/longshots)`);
  const { todaysEdge, dailyPicks, freePicks, sorted } = rankAndDistribute(filtered);

  if (dryRun) {
    return json({
      dry_run: true,
      seed,
      counts: {
        total: all.length,
        dailyPicks: dailyPicks.length,
        freePicks: freePicks.length,
        todaysEdge: todaysEdge.length,
      },
      ...(debug ? { debug: debugInfo } : {}),
      top10: sorted.slice(0, 10),
      sanity_issues: sanityCheck(all),
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  await supabase.from("daily_picks").delete().eq("pick_date", today);
  // Wipe today's free_props entirely — scanner is now the single source of truth.
  await supabase.from("free_props").delete().eq("prop_date", today);

  // Build a set of edge-tier keys (top 5 quality_score Strong picks)
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

  // Persist all curated free picks (props + game lines) — scanner re-scored them through current gates.
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

  if (dailyRows.length) await supabase.from("daily_picks").insert(dailyRows);
  if (freeRows.length) await supabase.from("free_props").insert(freeRows);

  return json({
    ok: true,
    counts: {
      total: all.length,
      dailyPicks: dailyRows.length,
      freePicks: freeRows.length,
      todaysEdge: todaysEdge.length,
    },
    ...(debug ? { debug: debugInfo } : {}),
  });
});
