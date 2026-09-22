/**
 * nfl-player-prop-edge — NFL PLAYER PROP EDGE ENGINE endpoint.
 *
 * Orchestration only: reads shared raw data (feature store, prop odds
 * snapshots, sportsbook game lines, injuries, weather), calls
 * `calculate_nfl_player_prop_edge()`, persists every result to
 * `nfl_player_prop_predictions`.
 *
 * It NEVER calls nfl-game-edge or reads nfl_game_edge_predictions. Game
 * script comes from the sportsbook spread/total only.
 *
 * POST body:
 *   { action: "list", days?: number }                         premium — published (proven) PLAYs
 *   { action: "search", q }                                   premium — NFL player search (analyzer)
 *   { player, prop_type, line, over_under?, opponent? }       premium — one prop on demand (analyzer):
 *                                                             full model analysis, labelled; PLAY only
 *                                                             when the prop type is proven profitable
 *   { slate: true, days?: number }                            service role — every priced prop (cron)
 */

import { requirePremiumAccess, requireServiceRoleAccess } from "../_shared/premium-access.ts";
import { describeEvidence, isProvenProfitable, type NflPropGates } from "../_shared/thresholds.ts";
import type { NflGameRow, NflMarketQuote, NflPlayerWeekRow, NflTeamWeekRow } from "../_shared/nfl/data/types.ts";
import type { NflPositionAllowedRow } from "../_shared/nfl/data/position_allowed.ts";
import { normalizePlayerName } from "../_shared/nfl/data/aggregate.ts";
import {
  findOddsEvent,
  forecastWeather,
  loadGameQuotes,
  loadInjuries,
  loadJsonConfig,
  loadPlayerWeeks,
  loadPositionAllowed,
  loadPropQuotes,
  loadTeamWeeks,
  loadUpcomingGames,
  scanBucket,
  type PropQuote,
} from "../_shared/nfl/data/readers.ts";
import {
  calculate_nfl_player_prop_edge,
  PROP_TYPES_BY_POSITION,
  type NflPlayerPropEdgeResult,
  type NflPropType,
  type PropEvidence,
  type PropMarket,
} from "../_shared/nfl/prop/index.ts";
import { NFL_PROP_FITTED_WEIGHTS } from "../_shared/nfl/prop/weights_fitted.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sentinel-device-id, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const DISCLAIMER =
  "NFL Player Props only publishes picks for prop types proven profitable in forward testing. Until then no picks are shown.";

// deno-lint-ignore no-explicit-any
type Db = any;

const PROP_ALIASES: Record<string, NflPropType> = {
  passing_yards: "pass_yds", pass_yards: "pass_yds", pass_yds: "pass_yds",
  passing_attempts: "pass_att", pass_att: "pass_att", pass_attempts: "pass_att",
  completions: "pass_cmp", pass_cmp: "pass_cmp", passing_completions: "pass_cmp",
  passing_tds: "pass_tds", pass_tds: "pass_tds",
  interceptions: "pass_ints", pass_ints: "pass_ints",
  rushing_yards: "rush_yds", rush_yds: "rush_yds",
  rushing_attempts: "rush_att", rush_att: "rush_att", carries: "rush_att",
  receiving_yards: "rec_yds", rec_yds: "rec_yds",
  receptions: "receptions", targets: "targets",
  anytime_td: "anytime_td", touchdowns: "anytime_td",
  field_goals: "fg_made", fg_made: "fg_made",
  extra_points: "xp_made", xp_made: "xp_made", pats: "xp_made",
  kicking_points: "kicking_points",
};

function marketFrom(q: PropQuote | null, line: number): PropMarket | null {
  if (!q) return null;
  if (q.quote) {
    const c: NflMarketQuote = q.quote;
    return {
      line: c.current.line ?? line,
      over_price: c.current.price_a,
      under_price: c.current.price_b,
      best_over_price: c.best_price_a,
      best_over_book: c.best_book_a,
      best_under_price: c.best_price_b,
      best_under_book: c.best_book_b,
      opening_line: c.opening?.line ?? null,
      opening_over_price: c.opening?.price_a ?? null,
      opening_under_price: c.opening?.price_b ?? null,
      books: c.books,
    };
  }
  if (q.one_sided) {
    const s = q.one_sided;
    return {
      line: s.line, over_price: s.price, under_price: null, best_over_price: s.best, best_over_book: s.best_book,
      best_under_price: null, best_under_book: null, opening_line: s.line, opening_over_price: s.opening,
      opening_under_price: null, books: s.books,
    };
  }
  return null;
}

/** Forward-test (shadow pick) evidence per prop type for this model version. */
async function loadEvidence(db: Db): Promise<Map<string, PropEvidence>> {
  const { data } = await db.from("nfl_player_prop_forward_test").select("prop_type, bets, roi, avg_clv")
    .eq("model_version", NFL_PROP_FITTED_WEIGHTS.version);
  const out = new Map<string, PropEvidence>();
  for (const r of data ?? []) {
    out.set(r.prop_type, { bets: Number(r.bets ?? 0), roi: Number(r.roi ?? 0), avg_clv: r.avg_clv === null ? null : Number(r.avg_clv) });
  }
  return out;
}

interface GameContext {
  game: NflGameRow;
  teamSpreadHome: number | null;
  total: number | null;
  weather: Awaited<ReturnType<typeof forecastWeather>>;
  eventId: string | null;
}

async function gameContext(db: Db, game: NflGameRow): Promise<GameContext> {
  const indoor = game.roof === "dome" || game.roof === "closed";
  const [quotes, weather] = await Promise.all([
    loadGameQuotes(db, game),
    indoor ? Promise.resolve({ temp: null, wind: null, precip_prob: null, source: "none" as const }) : forecastWeather(game.home_team, game.kickoff),
  ]);
  return {
    game,
    teamSpreadHome: quotes.spread?.current.line ?? null,
    total: quotes.total?.current.line ?? null,
    weather,
    eventId: quotes.event_id,
  };
}

interface Loaded {
  teamWeeks: NflTeamWeekRow[];
  teamPlayers: Map<string, NflPlayerWeekRow[]>;
  byPlayer: Map<string, NflPlayerWeekRow[]>;
  allowed: Map<string, NflPositionAllowedRow[]>;
  gates: Partial<NflPropGates> | null;
  evidence: Map<string, PropEvidence>;
}

async function loadCommon(db: Db, season: number, teams: string[]): Promise<Loaded> {
  const [teamWeeks, players, gates, evidence, ...allowed] = await Promise.all([
    loadTeamWeeks(db, season),
    loadPlayerWeeks(db, season, { teams }),
    loadJsonConfig<NflPropGates>(db, "nfl_prop_edge_gates"),
    loadEvidence(db),
    ...["QB", "RB", "WR", "TE", "K", "FB"].map((p) => loadPositionAllowed(db, season, p)),
  ]);
  const teamPlayers = new Map<string, NflPlayerWeekRow[]>();
  const byPlayer = new Map<string, NflPlayerWeekRow[]>();
  for (const p of players) {
    teamPlayers.set(p.team, [...(teamPlayers.get(p.team) ?? []), p]);
    byPlayer.set(p.player_id, [...(byPlayer.get(p.player_id) ?? []), p]);
  }
  const posMap = new Map<string, NflPositionAllowedRow[]>();
  ["QB", "RB", "WR", "TE", "K", "FB"].forEach((p, i) => posMap.set(p, allowed[i]));
  return { teamWeeks, teamPlayers, byPlayer, allowed: posMap, gates, evidence };
}

/** Current-roster lookup: most recent row per player on the team this season (or last). */
function rosterOf(rows: NflPlayerWeekRow[]): Map<string, NflPlayerWeekRow> {
  const latest = new Map<string, NflPlayerWeekRow>();
  for (const r of rows) {
    const prev = latest.get(r.player_id);
    if (!prev || r.season > prev.season || (r.season === prev.season && r.week > prev.week)) latest.set(r.player_id, r);
  }
  return latest;
}

async function scoreProp(
  db: Db,
  ctx: GameContext,
  player: NflPlayerWeekRow,
  propType: NflPropType,
  line: number,
  market: PropMarket | null,
  common: Loaded,
): Promise<NflPlayerPropEdgeResult[]> {
  const g = ctx.game;
  const team = player.team;
  const isHome = g.home_team === team;
  const opponent = isHome ? g.away_team : g.home_team;
  const injuries = await loadInjuries(db, g.season, g.week, [team]);
  const out = calculate_nfl_player_prop_edge({
    features: {
      player: { player_id: player.player_id, player_name: player.player_name, position: player.position, team },
      game: {
        game_id: g.game_id, season: g.season, week: g.week, team, opponent, is_home: isHome,
        roof: g.roof, temp: ctx.weather.temp, wind: ctx.weather.wind, precip_prob: ctx.weather.precip_prob,
        weather_source: ctx.weather.source, team_rest: isHome ? g.home_rest : g.away_rest, opp_rest: isHome ? g.away_rest : g.home_rest,
      },
      market_context: {
        team_spread: ctx.teamSpreadHome === null ? null : isHome ? ctx.teamSpreadHome : -ctx.teamSpreadHome,
        game_total: ctx.total,
      },
      teamPlayerRows: common.teamPlayers.get(team) ?? [],
      playerRows: common.byPlayer.get(player.player_id) ?? [],
      teamWeeks: common.teamWeeks,
      positionAllowed: common.allowed.get(player.position) ?? [],
      injuries,
    },
    prop_type: propType,
    line,
    market,
    weights: NFL_PROP_FITTED_WEIGHTS,
    gates: common.gates,
    evidence: common.evidence.get(propType) ?? null,
  });
  return out.results;
}

async function persist(db: Db, game: NflGameRow, results: NflPlayerPropEdgeResult[]): Promise<number> {
  const pregame = game.kickoff !== null && new Date(game.kickoff).getTime() > Date.now();
  if (!pregame || !results.length) return 0;
  const bucket = scanBucket();
  const rows = results.map((r) => ({
    game_id: r.game_id, season: game.season, week: game.week, commence_time: game.kickoff,
    player_id: r.player_id, player_name: r.player_name, team: r.team, opponent: r.opponent, position: r.position,
    prop_type: r.prop_type, side: r.side, line: r.line, market_price: r.market_price, market_book: r.market_book,
    opening_line: r.opening_line, opening_price: r.opening_price, current_line: r.current_line, best_price: r.best_price,
    line_movement: r.line_movement, model_version: r.model_version, projection: r.projection,
    median_projection: r.median_projection, std_dev: r.std_dev, p10: r.p10, p90: r.p90, distribution: r.distribution,
    over_probability: r.over_probability, under_probability: r.under_probability, push_probability: r.push_probability,
    model_probability: r.model_probability, market_probability: r.market_probability,
    no_vig_probability: r.no_vig_probability, no_vig_method: r.no_vig_method, fair_price: r.fair_price,
    edge_percentage: r.edge_percentage, expected_value: r.expected_value, confidence: r.confidence,
    confidence_components: r.confidence_components, expected_snap_percentage: r.expected_snap_percentage,
    injury_status: r.injury_status, role_projection: r.role_projection, status: r.status, shadow_play: r.shadow_play,
    no_play_reasons: r.no_play_reasons, data_quality: r.data_quality, factors: r.factors,
    calibration_status: "unvalidated", timestamp: r.timestamp, scan_bucket: bucket,
  }));
  // Skip rows already written in this scan bucket (identity index would reject them).
  const { data: existing } = await db.from("nfl_player_prop_predictions").select("player_id, prop_type, side, line")
    .eq("game_id", game.game_id).eq("model_version", NFL_PROP_FITTED_WEIGHTS.version).eq("scan_bucket", bucket);
  const seen = new Set((existing ?? []).map((e: Record<string, unknown>) => `${e.player_id}|${e.prop_type}|${e.side}|${Number(e.line)}`));
  const fresh = rows.filter((r) => !seen.has(`${r.player_id}|${r.prop_type}|${r.side}|${r.line}`));
  if (!fresh.length) return 0;
  const { error } = await db.from("nfl_player_prop_predictions").insert(fresh);
  if (error) {
    console.error(`[nfl-player-prop-edge] persist failed ${game.game_id}: ${error.message}`);
    return 0;
  }
  return fresh.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed", reason: "use POST" }, 405);
  if (!req.headers.get("Authorization")) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request", reason: "body must be JSON" }, 400);
  }
  const startedAt = Date.now();
  const days = Math.min(Math.max(Number(body.days ?? 7) || 7, 1), 14);

  try {
    // ── Cron: every priced prop on the upcoming slate ──
    if (body.slate === true) {
      const gate = await requireServiceRoleAccess(req, corsHeaders);
      if (!gate.ok) return gate.response;
      const db = gate.admin;
      const now = new Date();
      const games = await loadUpcomingGames(db, now.toISOString(), new Date(now.getTime() + days * 86400e3).toISOString());
      if (!games.length) return json({ ok: true, games: 0, model_version: NFL_PROP_FITTED_WEIGHTS.version });
      const common = await loadCommon(db, games[0].season, [...new Set(games.flatMap((g) => [g.home_team, g.away_team]))]);
      let scored = 0, persisted = 0, plays = 0, shadows = 0, unmatched = 0, failed = 0;
      for (const g of games) {
        const ctx = await gameContext(db, g);
        if (!ctx.eventId) continue;
        const quotes = await loadPropQuotes(db, ctx.eventId);
        const roster = new Map<string, NflPlayerWeekRow>();
        for (const t of [g.home_team, g.away_team]) {
          for (const p of rosterOf(common.teamPlayers.get(t) ?? []).values()) {
            if (p.team === t) roster.set(normalizePlayerName(p.player_name), p);
          }
        }
        const results: NflPlayerPropEdgeResult[] = [];
        for (const q of quotes) {
          const player = roster.get(q.player_key);
          const propType = q.prop_type as NflPropType;
          if (!player || !(PROP_TYPES_BY_POSITION[player.position] ?? []).includes(propType)) { unmatched++; continue; }
          const market = marketFrom(q, 0.5);
          if (!market) continue;
          try {
            results.push(...await scoreProp(db, ctx, player, propType, market.line, market, common));
            scored++;
          } catch (e) {
            failed++;
            console.error(`[nfl-player-prop-edge] ${q.player_label} ${propType} failed`, e);
          }
        }
        plays += results.filter((r) => r.status === "PLAY").length;
        shadows += results.filter((r) => r.shadow_play).length;
        persisted += await persist(db, g, results);
      }
      console.log(`[nfl-player-prop-edge] slate games=${games.length} props=${scored} persisted=${persisted} plays=${plays} shadow=${shadows} unmatched=${unmatched} failed=${failed} ms=${Date.now() - startedAt}`);
      return json({ ok: failed === 0, games: games.length, props: scored, persisted, plays, shadow_picks: shadows, unmatched, failed, model_version: NFL_PROP_FITTED_WEIGHTS.version });
    }

    const gate = await requirePremiumAccess(req, corsHeaders);
    if (!gate.ok) return gate.response;
    const db = gate.admin;

    // ── Player search for the analyzer (NFL feature store, not ESPN) ──
    if (body.action === "search") {
      const raw = String(body.q ?? "");
      const q = normalizePlayerName(raw);
      if (q.length < 2) return json([]);
      const now = new Date();
      const upcoming = await loadUpcomingGames(db, now.toISOString(), new Date(now.getTime() + 10 * 86400e3).toISOString());
      const season = upcoming[0]?.season ?? (now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
      // Query the DB on a RAW word ("Amon" from "Amon-Ra"): stored names keep
      // punctuation, so a normalised token like "amonra" would never ILIKE-match.
      const token = raw.split(/[^A-Za-z']+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? q;
      const rows = await loadPlayerWeeks(db, season, { nameLike: token });
      const latest = rosterOf(rows.filter((r) => normalizePlayerName(r.player_name).includes(q)));
      const players = [...latest.values()]
        .filter((r) => (PROP_TYPES_BY_POSITION[r.position] ?? []).length > 0)
        .sort((a, b) => (b.season - a.season) || (b.week - a.week))
        .slice(0, 10)
        .map((r) => ({ name: r.player_name, team: r.team, position: r.position, player_id: r.player_id, headshot: null }));
      return json(players);
    }

    if (body.action === "list") {
      const evidence = await loadEvidence(db);
      const { data, error } = await db.from("nfl_player_prop_predictions").select("*")
        .eq("status", "PLAY")
        .gte("commence_time", new Date().toISOString())
        .lte("commence_time", new Date(Date.now() + days * 86400e3).toISOString())
        .eq("model_version", NFL_PROP_FITTED_WEIGHTS.version)
        .order("timestamp", { ascending: false }).limit(5000);
      if (error) throw new Error(error.message);
      const latest = new Map<string, Record<string, unknown>>();
      for (const r of data ?? []) {
        const k = `${r.game_id}|${r.player_id}|${r.prop_type}|${r.side}`;
        if (!latest.has(k)) latest.set(k, r);
      }
      const proven = [...evidence.entries()].filter(([, e]) => isProvenProfitable(e)).map(([k]) => k);
      return json({
        model_version: NFL_PROP_FITTED_WEIGHTS.version,
        disclaimer: DISCLAIMER,
        forward_test: { proven_prop_types: proven, status: Object.fromEntries([...evidence.entries()].map(([k, e]) => [k, describeEvidence(e)])) },
        predictions: [...latest.values()],
      });
    }

    // ── One prop on demand ──
    const name = String(body.player ?? "").trim();
    const propType = PROP_ALIASES[String(body.prop_type ?? "").toLowerCase()];
    const line = Number(body.line);
    if (!name) return json({ error: "Invalid request", reason: "player is required" }, 400);
    if (!propType) return json({ error: "Invalid request", reason: `unsupported prop_type "${body.prop_type}"`, supported: Object.keys(PROP_ALIASES) }, 400);
    if (!Number.isFinite(line) || line < 0) return json({ error: "Invalid request", reason: "a valid line is required" }, 400);

    const now = new Date();
    const upcoming = await loadUpcomingGames(db, now.toISOString(), new Date(now.getTime() + 10 * 86400e3).toISOString());
    const season = upcoming[0]?.season ?? now.getUTCFullYear();
    const key = normalizePlayerName(name);
    const rawWord = name.split(/[^A-Za-z']+/).filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? key;
    const candidates = (await loadPlayerWeeks(db, season, { nameLike: rawWord }))
      .filter((r) => normalizePlayerName(r.player_name) === key);
    if (!candidates.length) return json({ error: `Player '${name}' not found in the NFL feature store.` }, 404);
    const player = [...rosterOf(candidates).values()].sort((a, b) => (b.season - a.season) || (b.week - a.week))[0];
    const game = upcoming.find((g) => g.home_team === player.team || g.away_team === player.team);
    if (!game) return json({ error: `No upcoming game found for ${player.player_name} (${player.team}).` }, 404);
    if (!(PROP_TYPES_BY_POSITION[player.position] ?? []).includes(propType)) {
      return json({ error: "Invalid request", reason: `${propType} is not supported for a ${player.position}` }, 400);
    }

    const opponentOf = game.home_team === player.team ? game.away_team : game.home_team;
    const requestedOpponent = String(body.opponent ?? "").trim().toUpperCase();
    if (requestedOpponent && requestedOpponent !== opponentOf) {
      return json({ error: `${player.player_name}'s next game is vs ${opponentOf}, not ${requestedOpponent}. Leave opponent on auto-detect.` }, 400);
    }

    const ctx = await gameContext(db, game);
    const common = await loadCommon(db, season, [game.home_team, game.away_team]);
    let market: PropMarket | null = null;
    let fromSnapshot = false;
    let sportsbookLine: PropMarket | null = null;
    const eventId = ctx.eventId ?? await findOddsEvent(db, game);
    if (eventId) {
      const q = (await loadPropQuotes(db, eventId)).find((x) => x.player_key === key && x.prop_type === propType) ?? null;
      const m = marketFrom(q, line);
      if (m && m.line === line) { market = m; fromSnapshot = true; }
      else if (m) sportsbookLine = m; // book has this prop at a different line
    }
    // Caller-supplied prices are accepted only when no snapshot exists for that exact line.
    if (!market && (Number.isFinite(Number(body.over_price)) || Number.isFinite(Number(body.under_price)))) {
      const over = Number.isFinite(Number(body.over_price)) ? Number(body.over_price) : null;
      const under = Number.isFinite(Number(body.under_price)) ? Number(body.under_price) : null;
      market = {
        line, over_price: over, under_price: under, best_over_price: null, best_over_book: null,
        best_under_price: null, best_under_book: null, opening_line: null, opening_over_price: null,
        opening_under_price: null, books: 1,
      };
    }
    const results = await scoreProp(db, ctx, player, propType, line, market, common);
    // Only sportsbook-snapshot prices become tracked predictions; caller-supplied
    // prices are unverifiable and must never enter the graded record.
    const persisted = fromSnapshot ? await persist(db, game, results) : 0;
    const evidence = common.evidence.get(propType) ?? null;
    const requestedSide = String(body.over_under ?? "over").toLowerCase() === "under" ? "under" : "over";
    return json({
      model_version: NFL_PROP_FITTED_WEIGHTS.version,
      disclaimer: DISCLAIMER,
      player: { name: player.player_name, team: player.team, position: player.position, player_id: player.player_id },
      game: { game_id: game.game_id, home: game.home_team, away: game.away_team, kickoff: game.kickoff, opponent: opponentOf },
      prop_type: propType,
      line,
      requested_side: requestedSide,
      market_source: fromSnapshot ? "odds_snapshots" : market ? "caller_supplied" : "none",
      sportsbook_line: sportsbookLine
        ? { line: sportsbookLine.line, over_price: sportsbookLine.over_price, under_price: sportsbookLine.under_price }
        : null,
      // Full analysis for the user-requested prop. It is a published pick only
      // when status === "PLAY", which requires the prop type to be proven
      // profitable (forward test) — every other result is labelled as such.
      proven: isProvenProfitable(evidence),
      forward_test: describeEvidence(evidence),
      results,
      persisted,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[nfl-player-prop-edge] failed", e);
    return json({ error: "NFL player prop edge failed", reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
