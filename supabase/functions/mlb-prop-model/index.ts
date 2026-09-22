/**
 * mlb-prop-model — MLB player-prop analysis (batter and pitcher markets).
 *
 * Split out of `nba-api` (4,800+ lines serving every sport's props from one
 * handler) so MLB props have their own deployable unit: it can be redeployed,
 * logged and rolled back without touching NBA or NHL.
 *
 * This handler orchestrates only. The ESPN data layer is
 * `_shared/espn_player_data.ts`, the common analysis assembly is
 * `_shared/prop_analysis_base.ts`, and all scoring lives in
 * `_shared/mlb_prop_model.ts`.
 *
 * Output carries `score_kind: "heuristic_score"` with
 * `probability_supported: false`. This model has no out-of-sample calibration,
 * so callers must never render the number as a win probability — see
 * docs/claude/model-validation-runbook.md.
 */

import { requirePremiumAccess } from "../_shared/premium-access.ts";
import {
  isMlbPitcherPosition,
  isMlbPitchingProp,
  normalizeDirection,
  normalizeMlbPropType,
  validateMlbPropLine,
} from "../_shared/prop_normalization.ts";
import { getEspnConfig } from "../_shared/espn_player_data.ts";
import {
  buildPropAnalysisBase,
  isPropAnalysisFailure,
  resolvePropPlayer,
} from "../_shared/prop_analysis_base.ts";
import {
  calculateMlbPropConfidence,
  fetchVerifiedMlbGameContext,
  generateMlbPropWriteup,
  type MlbContextData,
} from "../_shared/mlb_prop_model.ts";

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
 * Three usable games is the floor. MLB plays 162, so a player with fewer than
 * three logged values for the requested stat either does not produce it or is
 * missing from the feed — scoring either case would be inventing evidence.
 */
const MIN_MLB_SAMPLE = 3;

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

  const overUnder = normalizeDirection(String(body.over_under ?? "over")) === "under" ? "under" : "over";
  const requestedOpponent = body.opponent ? String(body.opponent).toUpperCase() : null;

  const cfg = getEspnConfig("mlb");
  const startedAt = Date.now();

  const resolved = await resolvePropPlayer(playerName, cfg);
  if (!resolved) return json({ error: `Player '${playerName}' not found.` });
  const { player, playerId } = resolved;

  // Role decides which market set and which scorer applies. A batting profile
  // cannot answer a pitching prop and vice versa, so the mismatch is rejected
  // rather than scored against the wrong stat line.
  const role = isMlbPitcherPosition(player.position) ? "pitcher" : "batter";
  const propType = normalizeMlbPropType(String(body.prop_type ?? ""), role);

  const lineValidation = validateMlbPropLine(propType, line);
  if (!lineValidation.valid) {
    return json({
      error: lineValidation.error,
      code: lineValidation.code,
      sport: "mlb",
      prop_type: propType,
      line,
      player,
    });
  }
  if (isMlbPitchingProp(propType) && role !== "pitcher") {
    return json({
      error: `${player.full_name} is not listed as a pitcher; pitching props cannot use a batting profile.`,
      player,
    });
  }
  if (!isMlbPitchingProp(propType) && role === "pitcher") {
    return json({
      error: `${player.full_name} is listed as a pitcher; ${propType} requires a verified batting profile.`,
      player,
    });
  }

  const base = await buildPropAnalysisBase({
    cfg,
    playerId,
    player,
    request: { playerName, propType, line, overUnder, opponent: requestedOpponent },
    // Early in a season the current log is empty; the previous season is the
    // only verified record of the player and stands in wholesale rather than
    // being blended, so the sample stays one coherent season.
    usePrevSeasonWhenEmpty: true,
    minCurrentSample: MIN_MLB_SAMPLE,
    insufficientSampleError:
      `Insufficient verified ${role === "pitcher" ? "pitching" : "batting"} game-log data for ${player.full_name}.`,
  });
  if (isPropAnalysisFailure(base)) return json({ ...base, sport: "mlb" });

  const { result, nextGame, opponentAbbr } = base;

  // Verified game context: opposing starter, park, weather, team stats. A gap
  // here shrinks the model's confidence through `dataQuality` rather than
  // being filled with league averages.
  let context: MlbContextData = {};
  try {
    context = await fetchVerifiedMlbGameContext({
      teamAbbr: player.team_abbr,
      opponentAbbr,
      playerName: player.full_name,
      isPitcher: role === "pitcher",
      gameDate: nextGame?.date || null,
    });
  } catch (error) {
    console.error("[mlb-prop-model] verified game context unavailable:", error);
  }
  result.mlb_context = context;

  const score = await calculateMlbPropConfidence(result);

  if (score.playerIsOut) {
    result.confidence = 0;
    result.verdict = "PASS";
    result.reasoning = score.reasoning;
    result.model = "mlb-verified-context-props-v2";
    result.score_kind = "heuristic_score";
    result.probability_supported = false;
    return json(result);
  }

  result.confidence = score.confidence;
  result.reasoning = score.reasoning;
  result.factorBreakdown = score.factors;
  result.mlb_factors = score.factors;
  result.mlb_data_quality = score.dataQuality || { missing: context.intelligence?.missing || [], shrinkFactor: 1 };
  result.prev_season_used = score.prevSeasonUsed;
  result.model = "mlb-verified-context-props-v2";
  result.score_kind = "heuristic_score";
  result.calibration_status = "pending_queue_validation";
  result.probability_supported = false;

  if (score.confidence >= 72) result.verdict = "STRONG";
  else if (score.confidence >= 58) result.verdict = "LEAN";
  else if (score.confidence >= 42) result.verdict = "RISKY";
  else result.verdict = "PASS";

  // A scoring run with no usable evidence returns 0 rather than a mid-range
  // number that would read as a genuine coin flip.
  if (score.confidence === 0 && score.dataQuality?.shrinkFactor === 0) {
    result.verdict = "PASS";
    return json(result);
  }

  try {
    const writeup = await generateMlbPropWriteup(
      player.full_name, propType, line, overUnder,
      score.confidence, score.factors, context, role === "pitcher",
    );
    if (writeup) {
      result.model_writeup = writeup;
      result.reasoning.push(writeup);
    }
  } catch (error) {
    console.error("[mlb-prop-model] writeup generation failed:", error);
  }

  result.generated_at = new Date().toISOString();
  result.duration_ms = Date.now() - startedAt;

  console.log(
    `[mlb-prop-model] ${player.full_name} (${role}) ${propType} ${overUnder} ${line} ` +
    `score=${score.confidence} factors=${score.factors.length} games=${base.analysisGames.length} ` +
    `ms=${result.duration_ms}`,
  );

  return json(result);
});
