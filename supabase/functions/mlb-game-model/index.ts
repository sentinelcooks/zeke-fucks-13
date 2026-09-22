/**
 * mlb-game-model — MLB team-market analysis (moneyline / spread).
 *
 * Split out of `moneyline-api` (2,300+ lines serving every sport and market at
 * once) so MLB has its own deployable unit: it can be redeployed, rate-limited,
 * logged and rolled back without touching WNBA or the player-prop paths.
 *
 * This handler orchestrates only — it validates the request, pulls game
 * intelligence via `_shared/mlb_data.ts`, maps it onto the model's input
 * contract, and returns the model's output. All scoring lives in
 * `_shared/mlb_game_model.ts` (pure, unit-tested).
 *
 * The response carries `score_kind: "heuristic_score"` and an explicit
 * `disclaimer`. This model has no out-of-sample calibration, so callers must
 * never render it as a win probability — see docs/claude/model-validation-runbook.md.
 */

import { fetchMlbGameIntelligence } from "../_shared/mlb_data.ts";
import {
  buildMlbGameModel,
  MLB_GAME_MODEL_VERSION,
  type MlbGameModelInput,
  type MlbTeamModelInput,
} from "../_shared/mlb_game_model.ts";

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

/** walks / IP * 9, guarding the divide-by-zero on a pitcher with no innings. */
function per9(total: number | null | undefined, inningsPitched: number | null | undefined): number | null {
  const t = finite(total);
  const ip = finite(inningsPitched);
  if (t === null || ip === null || ip <= 0) return null;
  return Math.round((t / ip) * 9 * 100) / 100;
}

interface RequestBody {
  market?: string;
  homeTeam?: string;
  awayTeam?: string;
  gameDate?: string;
  gameStartTime?: string;
  /** Spread from the HOME team's perspective. */
  homeSpread?: number;
  gamePk?: number;
}

type Intelligence = Awaited<ReturnType<typeof fetchMlbGameIntelligence>>;
type Side = "home" | "away";

/**
 * Maps one side of the MLB feed onto the model's team contract.
 *
 * Note what is deliberately NOT mapped: `pitchTypeMatchup` is fetched for a
 * single focus pitcher, so it exists for at most one side of the game. The
 * model requires both sides before it will score a factor, so passing it here
 * would guarantee a dropped factor while implying we had the data. It is left
 * out and reported in `missingInputs` instead.
 */
function mapTeam(intel: Intelligence, side: Side): MlbTeamModelInput {
  const stats = intel.teamStats[side];
  const pitcher = intel.pitchers[side];
  const bullpen = intel.bullpen[side];
  const lineup = intel.lineups[side];
  const identity = intel[side];

  return {
    name: identity?.name || identity?.abbreviation || side,
    runsPerGame: stats?.runsPerGame ?? null,
    ops: stats?.ops ?? null,
    battingAverage: stats?.battingAverage ?? null,
    strikeoutRate: stats?.strikeoutRate ?? null,
    walkRate: stats?.walkRate ?? null,
    gamesPlayed: stats?.games ?? null,
    splitVsPitcherHand: stats?.splitVsPitcherHand ?? null,
    lineupConfirmed: lineup?.confirmed ?? null,

    starterName: pitcher?.name ?? null,
    starterHand: pitcher?.hand ?? null,
    starterEra: pitcher?.season?.era ?? null,
    starterWhip: pitcher?.season?.whip ?? null,
    starterK9: pitcher?.season?.k9 ?? null,
    starterBb9: per9(pitcher?.season?.walks, pitcher?.season?.inningsPitched),
    starterH9: per9(pitcher?.season?.hits, pitcher?.season?.inningsPitched),
    starterInningsPitched: pitcher?.season?.inningsPitched ?? null,
    starterRecentEra: pitcher?.recent?.era ?? null,
    starterRecentWhip: pitcher?.recent?.whip ?? null,
    starterRecentK9: pitcher?.recent?.k9 ?? null,
    starterAvgOutsLast3: pitcher?.workload?.avgOutsLast3 ?? pitcher?.recent?.avgOuts ?? null,
    starterDaysRest: pitcher?.workload?.daysRest ?? null,
    starterPitchesLastStart: pitcher?.workload?.pitchesLastStart ?? null,
    starterAvgPitchesLast3: pitcher?.workload?.avgPitchesLast3 ?? null,
    pitchMixWhiffEdge: null,

    bullpenEra: stats?.bullpenEra ?? null,
    bullpenFreshness: bullpen?.freshnessScore ?? null,
    bullpenTaxedCount: Array.isArray(bullpen?.taxedRelievers) ? bullpen.taxedRelievers.length : null,
    bullpenPitchesLastTwoDays: bullpen?.pitchesLastTwoDays ?? null,

    isHome: side === "home",
  };
}

/** Probable starter with the season ERA the model scored against. */
function starterContext(intel: Intelligence, side: Side) {
  const pitcher = intel.pitchers[side];
  if (!pitcher?.name) return null;
  return { name: pitcher.name, era: pitcher.season?.era ?? null };
}

/** Season rates behind the offence and bullpen factors. */
function teamStatsContext(intel: Intelligence, side: Side) {
  const stats = intel.teamStats[side];
  if (!stats) return null;
  return {
    runsPerGame: stats.runsPerGame ?? null,
    ops: stats.ops ?? null,
    bullpenEra: stats.bullpenEra ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Every Edge Function validates the authorization header before doing any
  // meaningful work (docs/claude/supabase-edge-function-rules.md, rule 2).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

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
  if (market !== "moneyline" && market !== "spread") {
    return json({
      error: "Invalid request",
      reason: `unsupported market "${market}"`,
      supported: ["moneyline", "spread"],
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

  const startedAt = Date.now();

  let intel: Intelligence;
  try {
    intel = await fetchMlbGameIntelligence({
      gamePk: body.gamePk ?? null,
      gameDate: body.gameDate ?? null,
      gameStartTime: body.gameStartTime ?? null,
      homeAbbr: homeTeam,
      awayAbbr: awayTeam,
      includePitchTypes: false,
    });
  } catch (error) {
    // Surfaced rather than swallowed: an unmatched game is a real, actionable
    // condition the caller must be able to distinguish from a model failure.
    console.error("[mlb-game-model] intelligence fetch failed", error);
    return json({
      error: "Game data unavailable",
      reason: error instanceof Error ? error.message : String(error),
      model_version: MLB_GAME_MODEL_VERSION,
    }, 502);
  }

  const modelInput: MlbGameModelInput = {
    market: market as "moneyline" | "spread",
    // team1 is always the HOME side, so a score above 50 always means "home".
    team1: mapTeam(intel, "home"),
    team2: mapTeam(intel, "away"),
    team1Spread: homeSpread,
    parkRunFactor: intel.parkFactor?.runFactor ?? null,
    temperatureF: intel.weather?.temperatureF ?? null,
    windMph: intel.weather?.windMph ?? null,
    windDirection: intel.weather?.windDirection ?? null,
    roofType: intel.weather?.roofType ?? null,
  };

  const result = buildMlbGameModel(modelInput);
  if (!result) {
    return json({
      error: "Insufficient model inputs",
      reason: market === "spread"
        ? "no run-production data, or no spread line to compare against"
        : "no run-production data available for either team",
      model_version: MLB_GAME_MODEL_VERSION,
      feed_missing: intel.missing ?? [],
    }, 422);
  }

  console.log(
    `[mlb-game-model] ${awayTeam}@${homeTeam} market=${market} ` +
    `score=${result.team1Score} factors=${result.factors.length} ` +
    `coverage=${result.dataCoverage} ms=${Date.now() - startedAt}`,
  );

  return json({
    model_version: result.modelVersion,
    market: result.market,
    sport: "mlb",
    matchup: {
      home: { name: intel.home?.name ?? homeTeam, abbreviation: intel.home?.abbreviation ?? homeTeam },
      away: { name: intel.away?.name ?? awayTeam, abbreviation: intel.away?.abbreviation ?? awayTeam },
      game_date: intel.officialDate,
      venue: intel.venue?.name ?? null,
      status: intel.status ?? null,
    },
    // Scores are always from the HOME team's perspective.
    home_score: result.team1Score,
    away_score: 100 - result.team1Score,
    predicted_margin: result.predictedMargin,
    verdict: result.verdict,
    factors: result.factors,
    factor_count: result.factors.length,
    missing_inputs: result.missingInputs,
    feed_missing: intel.missing ?? [],
    data_coverage: result.dataCoverage,
    score_kind: result.scoreKind,
    disclaimer:
      "Directional model signal only. This score is not a calibrated win probability and must not be presented as one.",
    context: {
      park_run_factor: intel.parkFactor?.runFactor ?? null,
      weather: intel.weather ?? null,
      home_lineup_confirmed: intel.lineups?.home?.confirmed ?? null,
      away_lineup_confirmed: intel.lineups?.away?.confirmed ?? null,
      // Starters carry their season ERA so the report can show the matchup
      // without a second round trip. Shape changed from a bare name string to
      // an object; the client accepts both so an older deployment still works.
      home_starter: starterContext(intel, "home"),
      away_starter: starterContext(intel, "away"),
      // Season rates behind the model's offence and bullpen factors, surfaced
      // so the report can show what the comparison was actually scored on.
      home_team_stats: teamStatsContext(intel, "home"),
      away_team_stats: teamStatsContext(intel, "away"),
    },
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  });
});
