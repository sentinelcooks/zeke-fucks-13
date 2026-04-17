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

// ── Lightweight ESPN roster name resolver ──────────────────
// Some odds-API feeds occasionally return abbreviated names ("B. Miller").
// Resolve to full ESPN names by hitting the team roster once per game.
const ESPN_SPORT_PATH: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
};

const teamRosterCache = new Map<string, string[]>(); // key: `${sport}|${teamName}` → fullName[]

async function loadTeamRoster(sport: string, teamName: string): Promise<string[]> {
  if (!teamName) return [];
  const cacheKey = `${sport}|${teamName.toLowerCase()}`;
  if (teamRosterCache.has(cacheKey)) return teamRosterCache.get(cacheKey)!;
  const path = ESPN_SPORT_PATH[sport];
  if (!path) { teamRosterCache.set(cacheKey, []); return []; }
  try {
    // Find team id
    const teamsRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams`);
    const teamsData = await teamsRes.json();
    const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
    const wanted = teamName.toLowerCase();
    const teamId = teams.find((t: any) =>
      t?.team?.displayName?.toLowerCase() === wanted ||
      t?.team?.name?.toLowerCase() === wanted ||
      t?.team?.location?.toLowerCase() === wanted ||
      `${t?.team?.location} ${t?.team?.name}`.toLowerCase() === wanted
    )?.team?.id;
    if (!teamId) { teamRosterCache.set(cacheKey, []); return []; }
    const rosterRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams/${teamId}/roster`);
    const rosterData = await rosterRes.json();
    const names: string[] = [];
    const collect = (arr: any[]) => {
      for (const a of arr || []) {
        if (a?.displayName) names.push(a.displayName);
        if (a?.fullName) names.push(a.fullName);
        if (Array.isArray(a?.items)) collect(a.items);
      }
    };
    collect(rosterData?.athletes || []);
    teamRosterCache.set(cacheKey, names);
    return names;
  } catch (e) {
    console.error(`roster fetch failed for ${sport} ${teamName}:`, e);
    teamRosterCache.set(cacheKey, []);
    return [];
  }
}

function resolveFullName(rawName: string, rosterPool: string[]): string {
  if (!rawName) return rawName;
  // If already looks full (2+ words, no single-letter token), keep as-is but try exact match for canonical casing
  const lower = rawName.toLowerCase().trim();
  const exact = rosterPool.find((n) => n.toLowerCase() === lower);
  if (exact) return exact;
  // Match "B. Miller" or "B Miller" → first initial + last name
  const m = rawName.match(/^([A-Za-z])\.?\s+(.+)$/);
  if (m) {
    const [, initial, last] = m;
    const candidates = rosterPool.filter((n) => {
      const parts = n.split(/\s+/);
      return parts[0]?.[0]?.toLowerCase() === initial.toLowerCase() &&
             parts[parts.length - 1]?.toLowerCase() === last.toLowerCase();
    });
    if (candidates.length === 1) return candidates[0];
  }
  // Fallback: substring last-name match if unique
  const tokens = rawName.split(/\s+/);
  const last = tokens[tokens.length - 1]?.toLowerCase();
  if (last && last.length > 2) {
    const candidates = rosterPool.filter((n) => n.toLowerCase().endsWith(` ${last}`));
    if (candidates.length === 1) return candidates[0];
  }
  return rawName;
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
  // Today + next 24h window only — avoid scanning 7 days of MLB at once
  const cutoff = now + 36 * 3600 * 1000;
  const upcoming = events
    .filter((e: any) => {
      if (!e.commence_time) return true;
      const t = new Date(e.commence_time).getTime();
      return t > now && t < cutoff;
    })
    .sort((a: any, b: any) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
    .slice(0, 16); // hard cap per sport to stay under wall-time
  stats.events = upcoming.length;

  const plays: ScoredPlay[] = [];
  let propLineCount = 0;
  const playerSet = new Set<string>();

  // Fetch event props in chunks of 5 in parallel
  const CHUNK = 5;
  const eventProps: Array<{ ev: any; data: any }> = [];
  for (let i = 0; i < upcoming.length; i += CHUNK) {
    const slice = upcoming.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((ev: any) =>
        fnFetch(`nba-odds/player-props?sport=${sport}&eventId=${ev.id}`).then((r) => ({ ev, data: r.data }))
      )
    );
    eventProps.push(...results);
  }

  for (const { ev, data } of eventProps) {
    if (!ev?.id) continue;
    const players = data?.players || {};
    const homeTeam = ev.home_team || data?.home_team || null;
    const awayTeam = ev.away_team || data?.away_team || null;

    // Pre-load both team rosters for full-name resolution (parallel, cached)
    const [homeRoster, awayRoster] = await Promise.all([
      loadTeamRoster(sport, homeTeam),
      loadTeamRoster(sport, awayTeam),
    ]);
    const rosterPool = [...homeRoster, ...awayRoster];

    for (const [rawPlayerName, markets] of Object.entries(players as Record<string, any>)) {
      const playerName = rosterPool.length ? resolveFullName(rawPlayerName, rosterPool) : rawPlayerName;
      playerSet.add(playerName);
      for (const [rawMarketKey, outcomes] of Object.entries(markets as Record<string, any[]>)) {
        // Normalize Odds API market keys (e.g. "player_points" → "points") so reliability map works.
        const marketKey = rawMarketKey
          .replace(/^(player|batter|pitcher)_/, "")
          .replace(/_alternate$/, "")
          .replace(/^(?:nba_|mlb_|nhl_)/, "");
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
            } else {
              projected = impliedSide;
            }
            // Universal sharp-side bump: market consensus carries signal beyond pure de-vig.
            // Bigger bump for shorter-priced (more confident) markets.
            // -200 → +8pp, -150 → +6pp, -110 → +4pp, +110 → +3pp, +200 → +2pp
            const baseBump = pick.bestPrice < 0
              ? Math.min(0.10, 0.04 + (Math.abs(pick.bestPrice) - 100) / 2000)
              : Math.max(0.02, 0.04 - (pick.bestPrice - 100) / 4000);
            projected = Math.min(0.95, projected + baseBump);
            projected = Math.max(0.35, Math.min(0.95, projected));
            const edge = projected - impliedSide;
            if (edge <= 0.005) continue;
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
