/**
 * nfl-game-edge — NFL GAME EDGE ENGINE endpoint (moneyline / spread / total).
 *
 * Orchestration only: reads shared raw data (feature store, odds snapshots,
 * injuries, weather), calls `calculate_nfl_game_edge()`, persists every
 * result (PLAY and NO PLAY) to `nfl_game_edge_predictions`.
 *
 * This function never touches player props. The prop product lives in
 * `nfl-player-prop-edge` with its own engine, tables and confidence.
 *
 * POST body:
 *   { action: "list", days?: number }     premium — published PLAYs for upcoming games
 *   { game_id } | { home_team, away_team, commence_time? }
 *                                         premium — analyze one game now (Game Lines
 *                                         "Analyze"): full model analysis, labelled; a
 *                                         market is a pick only when status === "PLAY"
 *   { slate: true, days?: number }        service role — score every upcoming game (cron)
 *
 * Publishing rule: only markets PROVEN profitable (walk-forward backtest
 * evidence or NFL_PROMOTION_RULE on forward-test shadow picks) produce PLAYs.
 * Everything else is stored — would-be picks as shadow_play — and graded.
 * See docs/claude/nfl-edge-engines.md.
 */

import { requirePremiumAccess, requireServiceRoleAccess } from "../_shared/premium-access.ts";
import { americanToImplied, devigPair } from "../_shared/prob_math.ts";
import { describeEvidence, isProvenProfitable, type NflForwardEvidence, type NflGameGates } from "../_shared/thresholds.ts";
import type { NflGameRow, NflMarketQuote, NflPlayerWeekRow, NflTeamWeekRow } from "../_shared/nfl/data/types.ts";
import { resolveNflTeam } from "../_shared/nfl/data/teams.ts";
import {
  forecastWeather,
  loadGameQuotes,
  loadInjuries,
  loadJsonConfig,
  loadPlayerWeeks,
  loadTeamWeeks,
  loadUpcomingGames,
  loadGame,
  scanBucket,
} from "../_shared/nfl/data/readers.ts";
import { calculate_nfl_game_edge, type CalibrationEvidence, type NflGameEdgeResult } from "../_shared/nfl/game/index.ts";
import { NFL_GAME_FITTED_WEIGHTS } from "../_shared/nfl/game/weights_fitted.ts";

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
  "NFL Game Edge only publishes picks for markets proven profitable (backtest or forward test). Until then every market is in forward testing and no picks are shown.";

// deno-lint-ignore no-explicit-any
type Db = any;

function movementOf(q: NflMarketQuote | null, kind: "line" | "ml"): number | null {
  if (!q || !q.opening) return null;
  if (kind === "line") {
    return q.current.line !== null && q.opening.line !== null ? q.current.line - q.opening.line : null;
  }
  const now = devigPair(americanToImplied(q.current.price_a), americanToImplied(q.current.price_b))[0];
  const open = devigPair(americanToImplied(q.opening.price_a), americanToImplied(q.opening.price_b))[0];
  return now - open;
}

/** Per-market calibration evidence from the latest game backtest for this model version. */
async function loadCalibration(db: Db): Promise<Record<"moneyline" | "spread" | "total", CalibrationEvidence | null>> {
  const { data } = await db.from("nfl_game_backtest_runs").select("metrics")
    .eq("model_version", NFL_GAME_FITTED_WEIGHTS.version).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const m = data?.metrics;
  const ev = (x: { calibration?: { ece?: number }; brier?: number; games?: number } | undefined): CalibrationEvidence | null =>
    x && typeof x.calibration?.ece === "number" ? { ece: x.calibration.ece, brier: x.brier ?? null, n: x.games ?? 0 } : null;
  return { moneyline: ev(m?.moneyline), spread: ev(m?.spread), total: ev(m?.total) };
}

/** Forward-test (shadow pick) evidence per market for this model version. */
async function loadForward(db: Db): Promise<Record<"moneyline" | "spread" | "total", NflForwardEvidence | null>> {
  const { data } = await db.from("nfl_game_edge_forward_test").select("market_type, bets, roi, avg_clv")
    .eq("model_version", NFL_GAME_FITTED_WEIGHTS.version);
  const out: Record<string, NflForwardEvidence | null> = { moneyline: null, spread: null, total: null };
  for (const r of data ?? []) {
    out[r.market_type] = { bets: Number(r.bets ?? 0), roi: Number(r.roi ?? 0), avg_clv: r.avg_clv === null ? null : Number(r.avg_clv) };
  }
  return out as Record<"moneyline" | "spread" | "total", NflForwardEvidence | null>;
}

interface Shared {
  teamWeeks: NflTeamWeekRow[];
  playerWeeks: NflPlayerWeekRow[];
  gates: Partial<NflGameGates> | null;
  calibration: Awaited<ReturnType<typeof loadCalibration>>;
  forward: Awaited<ReturnType<typeof loadForward>>;
}

async function loadShared(db: Db, season: number, teams: string[]): Promise<Shared> {
  const [teamWeeks, qbs, skill, gates, calibration, forward] = await Promise.all([
    loadTeamWeeks(db, season),
    // QBs league-wide: a starter's own history follows him across teams.
    loadPlayerWeeks(db, season, { positions: ["QB"] }),
    loadPlayerWeeks(db, season, { teams, positions: ["RB", "WR", "TE", "FB"] }),
    loadJsonConfig<NflGameGates>(db, "nfl_game_edge_gates"),
    loadCalibration(db),
    loadForward(db),
  ]);
  return { teamWeeks, playerWeeks: [...qbs, ...skill], gates, calibration, forward };
}

async function scoreGame(db: Db, game: NflGameRow, shared: Shared, persist: boolean) {
  const indoor = game.roof === "dome" || game.roof === "closed";
  const [injuries, quotes, weather] = await Promise.all([
    loadInjuries(db, game.season, game.week, [game.home_team, game.away_team]),
    loadGameQuotes(db, game),
    indoor ? Promise.resolve({ temp: null, wind: null, precip_prob: null, source: "none" as const }) : forecastWeather(game.home_team, game.kickoff),
  ]);
  const movement = quotes.event_id
    ? {
        spread_move_home: movementOf(quotes.spread, "line"),
        total_move: movementOf(quotes.total, "line"),
        ml_move_home: movementOf(quotes.moneyline, "ml"),
      }
    : null;

  const out = calculate_nfl_game_edge({
    features: {
      game,
      teamWeeks: shared.teamWeeks,
      playerWeeks: shared.playerWeeks,
      injuries,
      weather: { ...weather, roof: game.roof },
      movement,
    },
    markets: { moneyline: quotes.moneyline, spread: quotes.spread, total: quotes.total },
    weights: NFL_GAME_FITTED_WEIGHTS,
    gates: shared.gates,
    calibration: shared.calibration,
    forward: shared.forward,
  });

  let persisted = 0;
  const pregame = game.kickoff !== null && new Date(game.kickoff).getTime() > Date.now();
  if (persist && pregame && out.results.length) {
    const bucket = scanBucket();
    const { data: existing } = await db.from("nfl_game_edge_predictions").select("id")
      .eq("game_id", game.game_id).eq("model_version", NFL_GAME_FITTED_WEIGHTS.version).eq("scan_bucket", bucket).limit(1);
    if (!existing?.length) {
      const rows = out.results.map((r: NflGameEdgeResult) => ({
        game_id: r.game_id,
        season: game.season,
        week: game.week,
        home_team: game.home_team,
        away_team: game.away_team,
        commence_time: game.kickoff,
        market_type: r.market_type,
        selection: r.selection,
        side: r.side,
        line: r.line,
        model_version: r.model_version,
        model_probability: r.model_probability,
        push_probability: r.push_probability,
        market_probability: r.market_probability,
        no_vig_probability: r.no_vig_probability,
        fair_price: r.fair_price,
        market_price: r.market_price,
        market_book: r.market_book,
        opening_line: r.opening_line,
        opening_price: r.opening_price,
        edge_percentage: r.edge_percentage,
        expected_value: r.expected_value,
        confidence: r.confidence,
        confidence_components: r.confidence_components,
        projected_score: r.projected_score,
        projected_margin: r.projected_margin,
        projected_total: r.projected_total,
        fair_line: r.fair_line,
        status: r.status,
        shadow_play: r.shadow_play,
        no_play_reasons: r.no_play_reasons,
        data_quality: r.data_quality,
        factors: out.features.factors,
        calibration_status: "unvalidated",
        timestamp: r.timestamp,
        scan_bucket: bucket,
      }));
      const { error } = await db.from("nfl_game_edge_predictions").insert(rows);
      if (error) console.error(`[nfl-game-edge] persist failed ${game.game_id}: ${error.message}`);
      else persisted = rows.length;
    }
  }

  return {
    game_id: game.game_id,
    matchup: { home: game.home_team, away: game.away_team, kickoff: game.kickoff, season: game.season, week: game.week },
    market_available: { moneyline: !!quotes.moneyline, spread: !!quotes.spread, total: !!quotes.total },
    projections: out.projections,
    results: out.results,
    factors: out.features.factors,
    qb: out.features.qb,
    injuries: out.features.injuries,
    data_quality: out.features.data_quality,
    persisted,
  };
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
    // ── Cron: score the whole upcoming slate ──
    if (body.slate === true) {
      const gate = await requireServiceRoleAccess(req, corsHeaders);
      if (!gate.ok) return gate.response;
      const db = gate.admin;
      const now = new Date();
      const games = await loadUpcomingGames(db, now.toISOString(), new Date(now.getTime() + days * 86400e3).toISOString());
      if (!games.length) return json({ ok: true, games: 0, model_version: NFL_GAME_FITTED_WEIGHTS.version });
      const shared = await loadShared(db, games[0].season, [...new Set(games.flatMap((g) => [g.home_team, g.away_team]))]);
      let persisted = 0, plays = 0, shadows = 0, failed = 0;
      for (const g of games) {
        try {
          const r = await scoreGame(db, g, shared, true);
          persisted += r.persisted;
          plays += r.results.filter((x) => x.status === "PLAY").length;
          shadows += r.results.filter((x) => x.shadow_play).length;
        } catch (e) {
          failed++;
          console.error(`[nfl-game-edge] slate game ${g.game_id} failed`, e);
        }
      }
      console.log(`[nfl-game-edge] slate games=${games.length} persisted=${persisted} plays=${plays} shadow=${shadows} failed=${failed} ms=${Date.now() - startedAt}`);
      return json({ ok: failed === 0, games: games.length, persisted, plays, shadow_picks: shadows, failed, model_version: NFL_GAME_FITTED_WEIGHTS.version });
    }

    const gate = await requirePremiumAccess(req, corsHeaders);
    if (!gate.ok) return gate.response;
    const db = gate.admin;

    // ── Published picks for upcoming games (proven-profitable markets only) ──
    if (body.action === "list") {
      const forward = await loadForward(db);
      const { data, error } = await db.from("nfl_game_edge_predictions").select("*")
        .eq("status", "PLAY")
        .gte("commence_time", new Date().toISOString())
        .lte("commence_time", new Date(Date.now() + days * 86400e3).toISOString())
        .eq("model_version", NFL_GAME_FITTED_WEIGHTS.version)
        .order("timestamp", { ascending: false }).limit(2000);
      if (error) throw new Error(error.message);
      // Latest scan per game/market/side.
      const latest = new Map<string, Record<string, unknown>>();
      for (const r of data ?? []) {
        const k = `${r.game_id}|${r.market_type}|${r.side}`;
        if (!latest.has(k)) latest.set(k, r);
      }
      return json({
        model_version: NFL_GAME_FITTED_WEIGHTS.version,
        disclaimer: DISCLAIMER,
        forward_test: Object.fromEntries((["moneyline", "spread", "total"] as const).map((m) => {
          const bt = NFL_GAME_FITTED_WEIGHTS.evidence_gates[m];
          return [m, { proven: bt !== null || isProvenProfitable(forward[m]), status: describeEvidence(forward[m]) }];
        })),
        predictions: [...latest.values()],
      });
    }

    // ── Analyze one game on demand ──
    let game: NflGameRow | null = null;
    const gameId = String(body.game_id ?? "").trim();
    if (gameId) {
      game = await loadGame(db, gameId);
    } else if (body.home_team && body.away_team) {
      // Game Lines passes sportsbook team names; match to the nflverse schedule.
      const home = resolveNflTeam(String(body.home_team));
      const away = resolveNflTeam(String(body.away_team));
      if (!home || !away) return json({ error: "Unknown team", reason: `could not resolve ${!home ? body.home_team : body.away_team} to an NFL team` }, 404);
      const t = body.commence_time ? new Date(String(body.commence_time)).getTime() : Date.now();
      const from = new Date((Number.isFinite(t) ? t : Date.now()) - 3 * 86400e3).toISOString();
      const to = new Date((Number.isFinite(t) ? t : Date.now()) + 10 * 86400e3).toISOString();
      game = (await loadUpcomingGames(db, from, to)).find((g) => g.home_team === home && g.away_team === away) ?? null;
    } else {
      return json({ error: "Invalid request", reason: "game_id, home_team+away_team, action:'list' or slate:true is required" }, 400);
    }
    if (!game) return json({ error: "Game not found", reason: "no matching NFL game on the schedule" }, 404);
    const shared = await loadShared(db, game.season, [game.home_team, game.away_team]);
    if (!shared.teamWeeks.length) {
      return json({ error: "Feature store empty", reason: "run scripts/nfl/ingest.ts", model_version: NFL_GAME_FITTED_WEIGHTS.version }, 503);
    }
    const scored = await scoreGame(db, game, shared, true);
    console.log(`[nfl-game-edge] ${game.game_id} plays=${scored.results.filter((r) => r.status === "PLAY").length} ms=${Date.now() - startedAt}`);
    // Full analysis for the requested game. A market is a published pick only
    // when its result has status "PLAY" (proven profitable); the per-market
    // forward-test status tells the client how to label everything else.
    const forwardTest = Object.fromEntries((["moneyline", "spread", "total"] as const).map((m) => {
      const bt = NFL_GAME_FITTED_WEIGHTS.evidence_gates[m];
      return [m, { proven: bt !== null || isProvenProfitable(shared.forward[m]), status: describeEvidence(shared.forward[m]) }];
    }));
    return json({
      model_version: NFL_GAME_FITTED_WEIGHTS.version,
      disclaimer: DISCLAIMER,
      forward_test: forwardTest,
      ...scored,
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("[nfl-game-edge] failed", e);
    return json({ error: "NFL game edge failed", reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
