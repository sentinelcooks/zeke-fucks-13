/**
 * wnba-game-model — WNBA team-market analysis (moneyline / spread / total).
 *
 * Split out of `moneyline-api` for the same reason as `mlb-game-model`: its own
 * deployable unit, its own logs, its own blast radius.
 *
 * Orchestration only. ESPN access lives in `_shared/wnba_game_context.ts`,
 * metric/efficiency/availability construction in `_shared/wnba_model.ts`, and
 * all scoring in `_shared/wnba_game_model.ts` (pure, unit-tested).
 *
 * Emits `score_kind: "heuristic_score"`. Not a calibrated win probability.
 */

import {
  buildWnbaTeamMetrics,
  deriveWnbaEfficiency,
  buildWnbaAvailability,
} from "../_shared/wnba_model.ts";
import {
  fetchWnbaTeams,
  fetchWnbaTeamSchedule,
  fetchWnbaTeamStats,
  matchWnbaTeam,
  computeWnbaVenueSplit,
  detectWnbaTravel,
  wnbaSeasonFor,
  type WnbaTeamRef,
} from "../_shared/wnba_game_context.ts";
import { fetchTeamInjuries } from "../_shared/injuries.ts";
import {
  buildWnbaGameModel,
  WNBA_GAME_MODEL_VERSION,
  type WnbaGameModelInput,
  type WnbaTeamModelInput,
} from "../_shared/wnba_game_model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Must mirror moneyline-api: the client attaches session, fingerprint and
  // nonce security headers to every analysis call, and a header missing from
  // this list fails CORS preflight before the function is ever reached.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sentinel-device-id, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

interface RequestBody {
  market?: string;
  homeTeam?: string;
  awayTeam?: string;
  gameDate?: string;
  /** Spread from the HOME team's perspective. */
  homeSpread?: number;
  totalLine?: number;
  totalSide?: "over" | "under";
  venueCity?: string;
}

/** Minutes per game keyed by player name, used to weight the injury report. */
function minutesByPlayerFrom(stats: Record<string, number>): Record<string, number | null> {
  // ESPN's team statistics endpoint does not expose per-player minutes, so the
  // availability builder receives an empty map and reports reduced confidence
  // rather than silently treating every absence as zero minutes.
  void stats;
  return {};
}

async function buildTeamInput(
  team: WnbaTeamRef,
  season: number,
  targetDate: string,
  isHome: boolean,
  venueCity: string | null,
): Promise<{ input: WnbaTeamModelInput; resolved: boolean }> {
  const [schedule, stats, injuries] = await Promise.all([
    fetchWnbaTeamSchedule(team.id, season),
    fetchWnbaTeamStats(team.id),
    fetchTeamInjuries("wnba", { id: team.id, abbr: team.abbreviation, name: team.name })
      .catch((error) => {
        console.error(`[wnba-game-model] injury fetch failed team=${team.id}`, error);
        return [] as Array<{ name?: string; status?: string; detail?: string }>;
      }),
  ]);

  const metrics = buildWnbaTeamMetrics(schedule, team.id, targetDate);
  const efficiency = deriveWnbaEfficiency(stats, metrics);
  const availability = buildWnbaAvailability(
    injuries as Array<{ name?: string; status?: string; detail?: string }>,
    minutesByPlayerFrom(stats),
    Array.isArray(injuries) && injuries.length > 0,
    true,
  );
  const split = computeWnbaVenueSplit(schedule, team.id, isHome);

  return {
    resolved: availability.sourceAvailable === true,
    input: {
      name: team.name,
      games: metrics.games ?? null,
      winRate: metrics.winRate ?? null,
      pointsFor: metrics.pointsFor ?? null,
      pointsAgainst: metrics.pointsAgainst ?? null,
      netPoints: metrics.netPoints ?? null,

      recentGames: metrics.recentGames ?? null,
      recentPointsFor: metrics.recentPointsFor ?? null,
      recentPointsAgainst: metrics.recentPointsAgainst ?? null,
      recentNetPoints: metrics.recentNetPoints ?? null,

      pace: efficiency.pace ?? null,
      offensiveRating: efficiency.offensiveRating ?? null,
      defensiveRating: efficiency.defensiveRating ?? null,

      venueNetPoints: split.netPoints,
      venueWinRate: split.winRate,

      restDays: metrics.restDays ?? null,
      backToBack: metrics.backToBack ?? null,
      travelled: detectWnbaTravel(metrics.lastVenueCity, venueCity),

      unavailableMinutes: availability.unavailableMinutes ?? null,
      questionableMinutes: availability.questionableMinutes ?? null,
      availabilityResolved: availability.sourceAvailable === true && availability.teamMatched === true,

      isHome,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  if (req.method !== "POST") {
    return json({ error: "Method not allowed", reason: "use POST" }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request", reason: "body must be JSON" }, 400);
  }

  const market = String(body.market ?? "moneyline").toLowerCase();
  if (!["moneyline", "spread", "total"].includes(market)) {
    return json({
      error: "Invalid request",
      reason: `unsupported market "${market}"`,
      supported: ["moneyline", "spread", "total"],
    }, 400);
  }

  const homeTeam = String(body.homeTeam ?? "").trim();
  const awayTeam = String(body.awayTeam ?? "").trim();
  if (!homeTeam || !awayTeam) {
    return json({ error: "Invalid request", reason: "homeTeam and awayTeam are required" }, 400);
  }

  const homeSpread = finite(body.homeSpread);
  if (market === "spread" && homeSpread === null) {
    return json({ error: "Invalid request", reason: "homeSpread is required for the spread market" }, 400);
  }
  const totalLine = finite(body.totalLine);
  if (market === "total" && totalLine === null) {
    return json({ error: "Invalid request", reason: "totalLine is required for the total market" }, 400);
  }

  const startedAt = Date.now();
  const targetDate = body.gameDate || new Date().toISOString();
  const season = wnbaSeasonFor(new Date(targetDate));

  let teams: WnbaTeamRef[];
  try {
    teams = await fetchWnbaTeams();
  } catch (error) {
    console.error("[wnba-game-model] team list fetch failed", error);
    return json({ error: "Team data unavailable", reason: String(error) }, 502);
  }

  const home = matchWnbaTeam(teams, homeTeam);
  const away = matchWnbaTeam(teams, awayTeam);
  if (!home || !away) {
    return json({
      error: "Unknown team",
      reason: `could not resolve ${!home ? homeTeam : awayTeam} to a WNBA team`,
    }, 404);
  }

  const venueCity = body.venueCity ?? null;

  let homeSide, awaySide;
  try {
    [homeSide, awaySide] = await Promise.all([
      buildTeamInput(home, season, targetDate, true, venueCity),
      buildTeamInput(away, season, targetDate, false, venueCity),
    ]);
  } catch (error) {
    console.error("[wnba-game-model] context build failed", error);
    return json({
      error: "Game data unavailable",
      reason: error instanceof Error ? error.message : String(error),
      model_version: WNBA_GAME_MODEL_VERSION,
    }, 502);
  }

  const modelInput: WnbaGameModelInput = {
    market: market as "moneyline" | "spread" | "total",
    // team1 is always the HOME side, so a score above 50 always means "home"
    // (or, on the total market, the requested side).
    team1: homeSide.input,
    team2: awaySide.input,
    team1Spread: homeSpread,
    totalLine,
    totalSide: body.totalSide === "under" ? "under" : "over",
  };

  const result = buildWnbaGameModel(modelInput);
  if (!result) {
    return json({
      error: "Insufficient model inputs",
      reason: "not enough completed-game data to score this matchup",
      model_version: WNBA_GAME_MODEL_VERSION,
    }, 422);
  }

  console.log(
    `[wnba-game-model] ${away.abbreviation}@${home.abbreviation} market=${market} ` +
    `score=${result.team1Score} factors=${result.factors.length} ` +
    `coverage=${result.dataCoverage} ms=${Date.now() - startedAt}`,
  );

  return json({
    model_version: result.modelVersion,
    market: result.market,
    sport: "wnba",
    matchup: {
      home: { name: home.name, abbreviation: home.abbreviation },
      away: { name: away.name, abbreviation: away.abbreviation },
      game_date: targetDate,
      season,
    },
    home_score: result.market === "total" ? null : result.team1Score,
    away_score: result.market === "total" ? null : 100 - result.team1Score,
    side_score: result.market === "total" ? result.team1Score : null,
    total_side: result.market === "total" ? modelInput.totalSide : null,
    predicted_margin: result.predictedMargin,
    projected_total: result.projectedTotal,
    verdict: result.verdict,
    factors: result.factors,
    factor_count: result.factors.length,
    missing_inputs: result.missingInputs,
    data_coverage: result.dataCoverage,
    score_kind: result.scoreKind,
    disclaimer:
      "Directional model signal only. This score is not a calibrated win probability and must not be presented as one.",
    context: {
      home_injury_report_resolved: homeSide.resolved,
      away_injury_report_resolved: awaySide.resolved,
      home_back_to_back: homeSide.input.backToBack,
      away_back_to_back: awaySide.input.backToBack,
    },
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });
});
