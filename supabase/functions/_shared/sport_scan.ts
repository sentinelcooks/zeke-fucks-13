// Per-sport scan: fetch events/props, prefilter, run analyzer validation,
// and write surviving candidates to daily_picks with tier='_pending'.
// Used by slate-scanner-{nba,mlb,nhl,ufc} so each sport runs in its own
// edge invocation (isolated wall-time budget).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  americanToImpliedProb,
  calcEv,
  scorePrecomputed,
  type ScoredPlay,
} from "./edge_scoring.ts";

const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  ufc: "mma_mixed_martial_arts",
};

// Per-sport analyzer-output confidence floor. MLB/NHL models naturally
// return lower confidence than NBA, so a single 0.65 gate dropped every
// MLB/NHL candidate. Tuned per sport.
const ANALYZER_MIN_CONF: Record<string, number> = {
  nba: 0.65,
  mlb: 0.45,
  nhl: 0.50,
  ufc: 0.50,
};

// Sport-aware mapping from Odds-API market keys → analyzer prop_type.
// Must match cases in nba-api/index.ts getStatValue(). Unmapped → skip.
const NBA_MAP: Record<string, string> = {
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
  player_threes: "3-pointers",
  player_blocks: "blocks",
  player_steals: "steals",
  player_turnovers: "turnovers",
  player_points_rebounds_assists: "pts+reb+ast",
  player_points_rebounds: "pts+reb",
  player_points_assists: "pts+ast",
  player_rebounds_assists: "reb+ast",
  player_blocks_steals: "stl+blk",
};

const MLB_MAP: Record<string, string> = {
  batter_hits: "hits",
  batter_runs_scored: "runs",
  batter_rbis: "rbi",
  batter_home_runs: "home_runs",
  batter_total_bases: "total_bases",
  batter_walks: "walks",
  batter_stolen_bases: "stolen_bases",
  batter_hits_runs_rbis: "h+r+rbi",
  pitcher_strikeouts: "strikeouts",
};

const NHL_MAP: Record<string, string> = {
  player_goals: "goals",
  player_points: "nhl_points",
  player_assists: "nhl_assists",
  player_shots_on_goal: "sog",
  player_total_saves: "saves",
};

function mapMarketToProp(sport: string, rawMarketKey: string): string | null {
  const key = rawMarketKey.replace(/_alternate$/, "");

  if (sport === "nba") return NBA_MAP[key] ?? null;
  if (sport === "mlb") return MLB_MAP[key] ?? null;
  if (sport === "nhl") return NHL_MAP[key] ?? null;

  return null;
}

interface FetchResult {
  ok: boolean;
  status: number;
  data: any;
  size: number;
}

// Read credentials at call-time so the values are always freshly resolved
// from the Deno isolate's environment.
function getInternalHeaders(): {
  Authorization: string;
  apikey: string;
  "Content-Type": string;
} | null {
  const key = Deno.env.get("SERVICE_ROLE_KEY")?.trim();

  if (!key) {
    console.error("sport_scan: SERVICE_ROLE_KEY is missing");
    return null;
  }

  if (!key.startsWith("eyJ")) {
    console.error("sport_scan: SERVICE_ROLE_KEY is not a valid JWT. Check Supabase secrets.");
    return null;
  }

  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
  };
}

// Always build internal function URLs as:
// https://PROJECT_REF.supabase.co/functions/v1/PATH
function getFnBase(): string {
  const rawUrl = Deno.env.get("PROJECT_URL")?.trim();

  if (!rawUrl) {
    throw new Error("sport_scan: PROJECT_URL is missing");
  }

  let cleanUrl = rawUrl.replace(/\/+$/, "");

  // If someone accidentally saved PROJECT_URL with /functions/v1 attached,
  // strip it so we do not create broken URLs.
  cleanUrl = cleanUrl.replace(/\/functions\/v1$/i, "");

  if (!cleanUrl.startsWith("https://")) {
    throw new Error(`sport_scan: PROJECT_URL is invalid: ${cleanUrl}`);
  }

  return `${cleanUrl}/functions/v1`;
}

function buildFnUrl(path: string): string {
  const base = getFnBase();
  const cleanPath = path.replace(/^\/+/, "");
  return `${base}/${cleanPath}`;
}

function safeLogUrl(url: string): string {
  return url.replace(/apikey=[^&]+/g, "apikey=REDACTED");
}

async function fnFetch(path: string): Promise<FetchResult> {
  const headers = getInternalHeaders();

  if (!headers) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing or invalid SERVICE_ROLE_KEY" },
      size: 0,
    };
  }

  const url = buildFnUrl(path);
  console.log(`fnFetch calling: ${safeLogUrl(url)}`);

  try {
    const r = await fetch(url, {
      method: "GET",
      headers,
    });

    const text = await r.text();
    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      ok: r.ok,
      status: r.status,
      data,
      size: text.length,
    };
  } catch (e) {
    console.error(`fnFetch ${path} threw:`, e);

    return {
      ok: false,
      status: 0,
      data: null,
      size: 0,
    };
  }
}

async function fnPost(path: string, body: any): Promise<FetchResult> {
  const headers = getInternalHeaders();

  if (!headers) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing or invalid SERVICE_ROLE_KEY" },
      size: 0,
    };
  }

  const url = buildFnUrl(path);
  console.log(`fnPost calling: ${safeLogUrl(url)}`);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await r.text();
    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return {
      ok: r.ok,
      status: r.status,
      data,
      size: text.length,
    };
  } catch (e) {
    console.error(`fnPost ${path} threw:`, e);

    return {
      ok: false,
      status: 0,
      data: null,
      size: 0,
    };
  }
}

// ── Roster name resolver (same as orchestrator pre-split) ──
const ESPN_SPORT_PATH: Record<string, { sport: string; league: string }> = {
  nba: { sport: "basketball", league: "nba" },
  mlb: { sport: "baseball", league: "mlb" },
  nhl: { sport: "hockey", league: "nhl" },
};

const teamRosterCache = new Map<string, string[]>();

async function loadTeamRoster(sport: string, teamName: string): Promise<string[]> {
  if (!teamName) return [];

  const cacheKey = `${sport}|${teamName.toLowerCase()}`;

  if (teamRosterCache.has(cacheKey)) {
    return teamRosterCache.get(cacheKey)!;
  }

  const path = ESPN_SPORT_PATH[sport];

  if (!path) {
    teamRosterCache.set(cacheKey, []);
    return [];
  }

  try {
    const teamsRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams`
    );
    const teamsData = await teamsRes.json();
    const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
    const wanted = teamName.toLowerCase();

    const teamId = teams.find((t: any) =>
      t?.team?.displayName?.toLowerCase() === wanted ||
      t?.team?.name?.toLowerCase() === wanted ||
      t?.team?.location?.toLowerCase() === wanted ||
      `${t?.team?.location} ${t?.team?.name}`.toLowerCase() === wanted
    )?.team?.id;

    if (!teamId) {
      teamRosterCache.set(cacheKey, []);
      return [];
    }

    const rosterRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path.sport}/${path.league}/teams/${teamId}/roster`
    );
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

  const lower = rawName.toLowerCase().trim();
  const exact = rosterPool.find((n) => n.toLowerCase() === lower);

  if (exact) return exact;

  const m = rawName.match(/^([A-Za-z])\.?\s+(.+)$/);

  if (m) {
    const [, initial, last] = m;

    const candidates = rosterPool.filter((n) => {
      const parts = n.split(/\s+/);

      return (
        parts[0]?.[0]?.toLowerCase() === initial.toLowerCase() &&
        parts[parts.length - 1]?.toLowerCase() === last.toLowerCase()
      );
    });

    if (candidates.length === 1) return candidates[0];
  }

  const tokens = rawName.split(/\s+/);
  const last = tokens[tokens.length - 1]?.toLowerCase();

  if (last && last.length > 2) {
    const candidates = rosterPool.filter((n) =>
      n.toLowerCase().endsWith(` ${last}`)
    );

    if (candidates.length === 1) return candidates[0];
  }

  return rawName;
}

// ── Game-line evaluation ──────────────
async function evaluateGameLines(sport: string, stats: any): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];

  if (!sportKey) return [];

  const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
  const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];

  stats.games = games.length;

  if (games.length === 0) {
    console.log(
      `[${sport}] evaluateGameLines: 0 games from games-schedule (status=${gamesRes.status})`
    );
    return [];
  }

  const upcoming = games.filter(
    (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
  );

  if (upcoming.length === 0) return [];

  const oddsRes = await fnFetch(
    `nba-odds/events?sport=${sport}&markets=h2h,spreads,totals`
  );

  if (!oddsRes.ok) {
    console.error(
      `[${sport}] nba-odds/events game-lines error (HTTP ${oddsRes.status}):`,
      JSON.stringify(oddsRes.data).slice(0, 300)
    );
  }

  const oddsEvents = Array.isArray(oddsRes.data?.events) ? oddsRes.data.events : [];

  console.log(
    `[${sport}] evaluateGameLines: ${upcoming.length} upcoming games, ${oddsEvents.length} Odds API events (HTTP ${oddsRes.status})`
  );

  const oddsMap = new Map<string, any>();

  for (const ev of oddsEvents) {
    const home = (ev.home_team || "").toLowerCase();
    const away = (ev.away_team || "").toLowerCase();

    oddsMap.set(`${home}|${away}`, ev);
    oddsMap.set(`${away}|${home}`, ev);
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
          const projected = Math.max(
            0.35,
            Math.min(0.95, implied * 0.92 + (isHome ? 0.04 : 0.02))
          );
          const edge = projected - implied;

          if (edge < 0.035) continue;

          plays.push(
            scorePrecomputed({
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
          const projected = Math.max(0.4, Math.min(0.92, implied * 0.94 + 0.03));
          const edge = projected - implied;

          if (edge < 0.035) continue;

          const dir =
            betType === "total"
              ? (o.name || "").toLowerCase().includes("over")
                ? "over"
                : "under"
              : o.name === g.home_team
                ? "home"
                : "away";

          plays.push(
            scorePrecomputed({
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

// ── Player-prop evaluation ────────────
async function evaluatePlayerProps(sport: string, stats: any): Promise<ScoredPlay[]> {
  const sportKey = SPORT_KEYS[sport];

  if (!sportKey && sport !== "ufc") return [];

  let events: any[] = [];

  const r = await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h`);

  if (!r.ok) {
    console.error(
      `[${sport}] nba-odds/events props error (HTTP ${r.status}):`,
      JSON.stringify(r.data).slice(0, 300)
    );
  }

  events = Array.isArray(r.data?.events) ? r.data.events : [];

  console.log(
    `[${sport}] evaluatePlayerProps: ${events.length} Odds API events (HTTP ${r.status})`
  );

  // Drive scanning off the Games-tab schedule so EVERY scheduled game gets a chance.
  let upcoming: any[] = events;

  if (sportKey) {
    const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
    const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];

    const upcomingGames = games.filter(
      (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
    );

    stats.scheduled_games = upcomingGames.length;

    const eventByMatchup = new Map<string, any>();

    for (const ev of events) {
      const home = (ev.home_team || "").toLowerCase();
      const away = (ev.away_team || "").toLowerCase();

      eventByMatchup.set(`${home}|${away}`, ev);
      eventByMatchup.set(`${away}|${home}`, ev);
    }

    upcoming = upcomingGames
      .map((g: any) =>
        eventByMatchup.get(
          `${(g.home_team || "").toLowerCase()}|${(g.away_team || "").toLowerCase()}`
        )
      )
      .filter(Boolean);
  } else {
    stats.scheduled_games = events.length;
  }

  stats.events = upcoming.length;

  const plays: ScoredPlay[] = [];
  let propLineCount = 0;
  const playerSet = new Set<string>();

  const CHUNK = 5;
  const eventProps: Array<{ ev: any; data: any }> = [];

  for (let i = 0; i < upcoming.length; i += CHUNK) {
    const slice = upcoming.slice(i, i + CHUNK);

    const results = await Promise.all(
      slice.map((ev: any) =>
        fnFetch(`nba-odds/player-props?sport=${sport}&eventId=${ev.id}`).then((res) => ({
          ev,
          data: res.data,
        }))
      )
    );

    eventProps.push(...results);
  }

  for (const { ev, data } of eventProps) {
    if (!ev?.id) continue;

    const players = data?.players || {};
    const homeTeam = ev.home_team || data?.home_team || null;
    const awayTeam = ev.away_team || data?.away_team || null;

    const [homeRoster, awayRoster] = await Promise.all([
      loadTeamRoster(sport, homeTeam),
      loadTeamRoster(sport, awayTeam),
    ]);

    const rosterPool = [...homeRoster, ...awayRoster];

    for (const [rawPlayerName, markets] of Object.entries(
      players as Record<string, any>
    )) {
      const playerName = rosterPool.length
        ? resolveFullName(rawPlayerName, rosterPool)
        : rawPlayerName;

      playerSet.add(playerName);

      for (const [rawMarketKey, outcomes] of Object.entries(
        markets as Record<string, any[]>
      )) {
        if (/_alternate$/.test(rawMarketKey)) continue;

        const marketKey = mapMarketToProp(sport, rawMarketKey);

        if (!marketKey) continue;

        const grouped = new Map<string, { side: string; line: number; bestPrice: number }>();
        const lineBookCount = new Map<number, number>();
        const lineJuiceSum = new Map<number, { sum: number; n: number }>();

        for (const o of outcomes as any[]) {
          const side = (o.name || "").toLowerCase().includes("under")
            ? "under"
            : "over";
          const line = Number(o.point ?? 0);
          const k = `${side}|${line}`;
          const cur = grouped.get(k);

          if (!cur || o.price > cur.bestPrice) {
            grouped.set(k, { side, line, bestPrice: o.price });
          }

          lineBookCount.set(line, (lineBookCount.get(line) || 0) + 1);

          const j = lineJuiceSum.get(line) || { sum: 0, n: 0 };
          j.sum += Math.abs((o.price ?? -110) - -110);
          j.n += 1;
          lineJuiceSum.set(line, j);
        }

        if (lineBookCount.size === 0) continue;

        let standardLine: number | null = null;
        let bestCount = -1;
        let bestJuice = Infinity;

        for (const [ln, count] of lineBookCount.entries()) {
          const j = lineJuiceSum.get(ln)!;
          const avgJuice = j.sum / j.n;

          if (count > bestCount || (count === bestCount && avgJuice < bestJuice)) {
            standardLine = ln;
            bestCount = count;
            bestJuice = avgJuice;
          }
        }

        if (standardLine === null || bestCount < 3) continue;

        const lines = new Set<number>([standardLine]);

        for (const line of lines) {
          const over = grouped.get(`over|${line}`);
          const under = grouped.get(`under|${line}`);

          for (const side of ["over", "under"] as const) {
            const pick = side === "over" ? over : under;

            if (!pick) continue;
            if (pick.bestPrice <= -350 || pick.bestPrice >= 400) continue;

            propLineCount++;

            const impliedSide = americanToImpliedProb(pick.bestPrice);
            const oppPick = side === "over" ? under : over;

            let projected: number;

            if (oppPick) {
              const impliedOpp = americanToImpliedProb(oppPick.bestPrice);
              const sum = impliedSide + impliedOpp;
              projected = sum > 0 ? impliedSide / sum : impliedSide;
            } else {
              projected = impliedSide;
            }

            const baseBump =
              pick.bestPrice < 0
                ? Math.min(0.10, 0.04 + (Math.abs(pick.bestPrice) - 100) / 2000)
                : Math.max(0.02, 0.04 - (pick.bestPrice - 100) / 4000);

            projected = Math.min(0.95, projected + baseBump);
            projected = Math.max(0.35, Math.min(0.95, projected));

            const edge = projected - impliedSide;

            if (edge <= 0.005) continue;

            plays.push(
              scorePrecomputed({
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
              })
            );
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

// ── Analyzer validation ──────────────
async function validateWithAnalyzer(
  play: ScoredPlay,
  cache: Map<string, any>
): Promise<ScoredPlay | null> {
  if (play.bet_type !== "prop") return play;

  const cacheKey = `${play.sport}|${play.player_name}|${play.prop_type}|${play.line}|${play.direction}`;
  let analyzed = cache.get(cacheKey);

  if (!analyzed) {
    const opponent =
      play.opponent ||
      (play.home_team && play.away_team ? play.away_team : "") ||
      "";

    const body = {
      player: play.player_name,
      prop_type: play.prop_type,
      line: play.line,
      over_under: play.direction,
      opponent,
      sport: play.sport,
      bet_type: "player_prop",
    };

    let r = await fnPost("nba-api/analyze", body);

    if (r.status === 429 || (typeof r.data === "string" && /rate limit/i.test(r.data))) {
      const waitMs = 3000;
      await new Promise((res) => setTimeout(res, waitMs));
      r = await fnPost("nba-api/analyze", body);
    }

    if (!r.ok || !r.data) return null;

    analyzed = r.data;
    cache.set(cacheKey, analyzed);
  }

  if (analyzed.playerIsOut === true) return null;

  const conf = Number(analyzed.confidence ?? analyzed.displayConfidence ?? 0);

  if (!conf || conf <= 0) return null;

  const verdict = String(analyzed.verdict || "").toUpperCase();

  if (verdict === "PASS" || verdict === "FADE") return null;

  const seasonAvg = Number(
    analyzed.seasonAvg ??
      analyzed.propAvg ??
      analyzed.avg ??
      analyzed.stats?.seasonAvg ??
      analyzed.stats?.avg ??
      NaN
  );

  if (Number.isFinite(seasonAvg) && seasonAvg === 0) return null;

  const projected = Math.max(0, Math.min(1, conf / 100));
  const implied = play.implied_prob;
  const edge = projected - implied;

  if (edge <= 0.025) return null;

  const minConf = ANALYZER_MIN_CONF[play.sport] ?? 0.55;

  if (projected < minConf) return null;

  const reasoningArr = Array.isArray(analyzed.reasoning) ? analyzed.reasoning : [];

  const reasoning = reasoningArr.length
    ? reasoningArr.slice(0, 3).join(" ")
    : play.reasoning;

  return {
    ...play,
    projected_prob: projected,
    edge,
    ev_pct: (() => {
      const o = play.odds;
      const decimal = o > 0 ? o / 100 + 1 : 100 / -o + 1;
      return (projected * (decimal - 1) - (1 - projected)) * 100;
    })(),
    confidence: projected,
    reasoning,
  };
}

// ── Main per-sport entry ──────────────
export async function scanSport(sport: string): Promise<{
  sport: string;
  scanned: number;
  validated: number;
  inserted: number;
  stats: any;
  error?: string;
}> {
  const stats: any = {
    games: 0,
    scheduled_games: 0,
    events: 0,
    players: 0,
    propLines: 0,
    lines: 0,
    candidates: 0,
  };

  let lines: ScoredPlay[] = [];
  let props: ScoredPlay[] = [];

  try {
    lines = await evaluateGameLines(sport, stats);
    stats.lines = lines.length;

    props = await evaluatePlayerProps(sport, stats);
  } catch (e) {
    console.error(`[${sport}] scan error:`, e);

    return {
      sport,
      scanned: 0,
      validated: 0,
      inserted: 0,
      stats,
      error: String(e),
    };
  }

  const all = [...lines, ...props];
  const scanned = all.length;

  const prefiltered = all.filter((p) => {
    if (p.odds >= 500) return false;
    if (p.odds <= -350) return false;
    if (p.confidence < 0.62) return false;
    if (p.edge <= 0) return false;

    return true;
  });

  const ANALYZER_CAP = 45;
  const ANALYZER_CHUNK = 1;
  const top = prefiltered.sort((a, b) => b.edge - a.edge).slice(0, ANALYZER_CAP);
  const cache = new Map<string, any>();
  const validated: ScoredPlay[] = [];

  for (let i = 0; i < top.length; i += ANALYZER_CHUNK) {
    if (i > 0) {
      await new Promise((res) => setTimeout(res, 1500));
    }

    const slice = top.slice(i, i + ANALYZER_CHUNK);

    const results = await Promise.all(
      slice.map((p) => validateWithAnalyzer(p, cache).catch(() => null))
    );

    for (const r of results) {
      if (!r) continue;

      const rescored = scorePrecomputed({
        sport: r.sport,
        bet_type: r.bet_type,
        player_name: r.player_name,
        team: r.team ?? null,
        opponent: r.opponent ?? null,
        home_team: r.home_team ?? null,
        away_team: r.away_team ?? null,
        prop_type: r.prop_type,
        line: r.line,
        spread_line: r.spread_line ?? null,
        total_line: r.total_line ?? null,
        direction: r.direction,
        odds: r.odds,
        projected_prob: r.projected_prob,
        implied_prob: r.implied_prob,
        edge: r.edge,
        ev_pct: r.ev_pct,
        confidence: r.confidence,
      });

      rescored.reasoning = r.reasoning || rescored.reasoning;
      validated.push(rescored);
    }
  }

  const supabaseUrl = Deno.env.get("PROJECT_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing PROJECT_URL or SERVICE_ROLE_KEY for daily_picks insert");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = new Date().toISOString().slice(0, 10);

  const rows = validated.map((p) => ({
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
    hit_rate: Math.round(p.confidence * 100),
    confidence: Math.round(p.confidence * 1000) / 1000,
    last_n_games: 10,
    avg_value: p.ev_pct,
    odds: String(p.odds),
    reasoning: p.reasoning,
    tier: p.confidence >= 0.70 ? "edge" : "daily",
  }));

  // Dedupe inside the same scanner run before inserting.
  // This fixes duplicate key errors when the same player/prop/line appears twice in one batch.
  const uniqueRowsMap = new Map<string, any>();

  for (const row of rows) {
    const key = [
      row.pick_date,
      row.sport,
      row.tier,
      row.player_name ?? "",
      row.prop_type ?? "",
      row.direction ?? "",
      row.line ?? -9999,
    ].join("|");

    const existing = uniqueRowsMap.get(key);

    // Keep the higher-confidence duplicate if there is one.
    if (!existing || Number(row.confidence ?? 0) > Number(existing.confidence ?? 0)) {
      uniqueRowsMap.set(key, row);
    }
  }

  const uniqueRows = Array.from(uniqueRowsMap.values());

  let inserted = 0;

  if (uniqueRows.length) {
    // Clear all rows for this sport/date first, not just _pending.
    // This prevents conflicts with previously promoted edge/daily rows too.
    const { error: deleteError } = await supabase
      .from("daily_picks")
      .delete()
      .eq("pick_date", today)
      .eq("sport", sport);

    if (deleteError) {
      console.error(`[${sport}] pre-insert delete error:`, deleteError);
    }

    const { error, count } = await supabase
      .from("daily_picks")
      .insert(uniqueRows, { count: "exact" });

    if (error) {
      console.error(`[${sport}] insert error:`, error);
    } else {
      inserted = count ?? uniqueRows.length;
    }
  }

  console.log(
    `[${sport}] scanned=${scanned} prefiltered=${prefiltered.length} validated=${validated.length} inserted=${inserted}`
  );

  return {
    sport,
    scanned,
    validated: validated.length,
    inserted,
    stats,
  };
}
