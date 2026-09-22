/**
 * wnba-prop-model — WNBA player-prop analysis.
 *
 * Split out of `nba-api` (4,800+ lines serving every sport's props from one
 * handler) so WNBA props have their own deployable unit: it can be redeployed,
 * logged and rolled back without touching NBA or NHL.
 *
 * This handler orchestrates only. The ESPN data layer is
 * `_shared/espn_player_data.ts`, the common analysis assembly is
 * `_shared/prop_analysis_base.ts`, and all scoring lives in
 * `_shared/wnba_model.ts` (pure and unit-tested).
 *
 * Output carries `score_kind: "heuristic_score"` with
 * `probability_supported: false`. This model has no out-of-sample calibration,
 * so callers must never render the number as a win probability — see
 * docs/claude/model-validation-runbook.md.
 */

import { requirePremiumAccess } from "../_shared/premium-access.ts";
import { normalizeDirection, normalizeNbaPropType } from "../_shared/prop_normalization.ts";
import { getEspnConfig, getStatValue, type GameRow } from "../_shared/espn_player_data.ts";
import {
  buildPropAnalysisBase,
  isPropAnalysisFailure,
  resolvePropPlayer,
} from "../_shared/prop_analysis_base.ts";
import { fetchWnbaLineupContext, scoreWnbaPlayerProp } from "../_shared/wnba_model.ts";
import { fetchWnbaTeamContext } from "../_shared/wnba_game_context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // Must mirror nba-api: the client attaches session, fingerprint and nonce
  // security headers to every analysis call, and a header missing from this
  // list fails CORS preflight before the function is ever reached.
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

/**
 * A WNBA season is 44 games, so the sample floor is lower than a sport that
 * plays 162 — but five usable values is the point below which a hit rate is
 * noise rather than evidence.
 */
const MIN_WNBA_SAMPLE = 5;

const INSUFFICIENT_SAMPLE =
  "Insufficient WNBA data available for a confident analysis.";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", reason: "use POST" }, 405);
  }

  const gate = await requirePremiumAccess(req, corsHeaders);
  if (!gate.ok) return gate.response;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request", reason: "body must be JSON" }, 400);
  }

  const playerName = String(body.player ?? "").trim();
  if (!playerName) return json({ error: "Player name is required" }, 400);

  const line = Number(body.line);
  if (!Number.isFinite(line) || line <= 0) {
    return json({ error: "A valid line is required for prop analysis" }, 400);
  }

  const propType = normalizeNbaPropType(String(body.prop_type ?? ""));
  const overUnder = normalizeDirection(String(body.over_under ?? "over")) === "under" ? "under" : "over";
  const requestedOpponent = body.opponent ? String(body.opponent).toUpperCase() : null;

  const cfg = getEspnConfig("wnba");
  const startedAt = Date.now();

  const resolved = await resolvePropPlayer(playerName, cfg);
  if (!resolved) return json({ error: `Player '${playerName}' not found.` });

  const base = await buildPropAnalysisBase({
    cfg,
    playerId: resolved.playerId,
    player: resolved.player,
    request: { playerName, propType, line, overUnder, opponent: requestedOpponent },
    // WNBA keeps the prior season as a separately labelled low-weight prior
    // rather than silently standing in for the current one.
    usePrevSeasonWhenEmpty: false,
    minCurrentSample: MIN_WNBA_SAMPLE,
    insufficientSampleError: INSUFFICIENT_SAMPLE,
  });
  if (isPropAnalysisFailure(base)) return json({ ...base, sport: "wnba" });

  const { result, player, analysisGames, prevSeasonGames, nextGame, opponentAbbr } = base;

  const lineup = await fetchWnbaLineupContext(
    nextGame?.event_id ?? null,
    player.team_abbr,
    player.full_name,
  );
  if (nextGame) nextGame.lineup_status = lineup.status;

  // Team and opponent efficiency drive the pace and matchup factors. A failure
  // here drops those factors rather than sinking the analysis — the model
  // reports the gap in `missing` instead of scoring around it silently.
  let teamContext: Awaited<ReturnType<typeof fetchWnbaTeamContext>> | null = null;
  let opponentContext: Awaited<ReturnType<typeof fetchWnbaTeamContext>> | null = null;
  if (opponentAbbr) {
    const targetDate = nextGame?.date_time || nextGame?.date || new Date().toISOString();
    try {
      [teamContext, opponentContext] = await Promise.all([
        fetchWnbaTeamContext(player.team_abbr, targetDate),
        fetchWnbaTeamContext(opponentAbbr, targetDate),
      ]);
      result.pace_context = {
        team: teamContext.efficiency,
        opponent: opponentContext.efficiency,
        sport: "wnba",
        matchup_source: "espn-team-statistics-derived",
      };
    } catch (error) {
      console.error("[wnba-prop-model] efficiency context unavailable:", error);
    }
  }

  const toWnbaGame = (game: GameRow) => ({
    date: game.date,
    value: getStatValue(game, propType),
    minutes: Number.isFinite(game.min) ? game.min : null,
    isHome: game.isHome,
    opponent: game.opponent,
  });

  const playerInjury = base.playerInjuries[0];
  const playerAvailability = playerInjury
    ? {
        name: player.full_name,
        status: playerInjury.status,
        // Minutes come from the player's own log rather than a roster average:
        // it is the same number, from a source this endpoint already has.
        minutesPerGame: result.minutes_trend?.avg_min ?? null,
        detail: playerInjury.detail ?? null,
      }
    : null;

  const score = scoreWnbaPlayerProp({
    games: analysisGames.map(toWnbaGame),
    previousSeasonGames: prevSeasonGames.map(toWnbaGame),
    line,
    direction: overUnder,
    propType,
    opponent: opponentAbbr || null,
    nextGameDate: nextGame?.date_time ?? nextGame?.date ?? null,
    isHome: typeof nextGame?.is_home === "boolean" ? nextGame.is_home : null,
    lineup,
    playerAvailability,
    injurySourceAvailable: base.teamInjuryReport.sourceAvailable && base.teamInjuryReport.team1Matched,
    teamEfficiency: teamContext?.efficiency ?? null,
    opponentEfficiency: opponentContext?.efficiency ?? null,
    targetVenueCity: nextGame?.venue_city ?? null,
    lastVenueCity: teamContext?.metrics.lastVenueCity ?? null,
  });

  result.confidence = score.score;
  result.verdict = score.verdict;
  result.reasoning = score.reasoning;
  result.factorBreakdown = score.factors;
  result.wnba_factors = score.factors;
  result.playerIsOut = score.playerIsOut;
  result.model = "wnba-verified-props-v1";
  result.score_kind = "heuristic_score";
  result.calibration_status = "pending_queue_validation";
  result.probability_supported = false;
  result.model_diagnostics = {
    ...score.diagnostics,
    injury_source_updated_at: base.teamInjuryReport.sourceUpdatedAt,
    injury_team_matched: base.teamInjuryReport.team1Matched,
    pace_context_source: result.pace_context?.matchup_source ?? null,
  };
  result.generated_at = new Date().toISOString();
  result.duration_ms = Date.now() - startedAt;

  console.log(
    `[wnba-prop-model] ${player.full_name} ${propType} ${overUnder} ${line} ` +
    `score=${score.score} factors=${score.factors.length} games=${analysisGames.length} ` +
    `ms=${result.duration_ms}`,
  );

  return json(result);
});
