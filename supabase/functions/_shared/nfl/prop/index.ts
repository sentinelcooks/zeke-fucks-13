/**
 * NFL PLAYER PROP EDGE ENGINE — `calculate_nfl_player_prop_edge()`.
 *
 * Player props ONLY. It never calls or reads the game engine; game context
 * comes from raw team data and the sportsbook's own spread/total. Its
 * confidence (`prop_confidence`), gates, weights, model version, backtests and
 * database table are all separate from the game engine's.
 *
 * Pipeline: features.ts (33 factors, point-in-time) → projection.ts
 * (opportunity × efficiency) → stat_models.ts (stat-appropriate distribution)
 * → over/under/push vs the line → no-vig market comparison → prop_confidence
 * → gates → PLAY / NO PLAY per side.
 */

import { americanToImplied, devigPair } from "../../prob_math.ts";
import {
  expectedValue,
  pmfMean,
  probToAmerican,
  probVsLine,
  summarize,
} from "../distributions.ts";
import { NFL_UNPROVEN_PREFIX, type NflPropGates } from "../../thresholds.ts";
import { buildPropFeatures, statValue, type PropFactor, type PropFeatureInput, type PropFeatureVector } from "./features.ts";
import { projectPlayer, type PropProjection } from "./projection.ts";
import { propDistribution } from "./stat_models.ts";
import { propConfidence } from "./confidence.ts";
import { propGateFailures, resolvePropGates, type PropEvidence } from "./gates.ts";
import {
  ONE_SIDED_ASSUMED_HOLD,
  PROP_TYPES_BY_POSITION,
  type NflPropType,
  type PropModelWeights,
} from "./weights.ts";

export interface PropMarket {
  line: number;
  over_price: number | null;
  under_price: number | null;
  best_over_price: number | null;
  best_over_book: string | null;
  best_under_price: number | null;
  best_under_book: string | null;
  opening_line: number | null;
  opening_over_price: number | null;
  opening_under_price: number | null;
  books: number;
}

export interface PropEdgeInput {
  features: PropFeatureInput;
  prop_type: NflPropType;
  line: number;
  market: PropMarket | null;
  weights: PropModelWeights;
  gates?: Partial<NflPropGates> | null;
  /** Graded live results for this prop type + model version, if any. */
  evidence?: PropEvidence | null;
  now?: string;
}

export interface NflPlayerPropEdgeResult {
  game_id: string;
  player_id: string;
  player_name: string;
  team: string;
  opponent: string;
  position: string;
  prop_type: NflPropType;
  side: "over" | "under";
  line: number;
  market_price: number | null;
  market_book: string | null;
  opening_line: number | null;
  opening_price: number | null;
  current_line: number;
  best_price: number | null;
  line_movement: number | null;
  projection: number;
  median_projection: number;
  std_dev: number;
  p10: number;
  p90: number;
  distribution: string;
  over_probability: number;
  under_probability: number;
  push_probability: number;
  model_probability: number; // this side, conditional on no push
  market_probability: number | null;
  no_vig_probability: number | null;
  no_vig_method: "two_way" | "assumed_hold" | null;
  fair_price: number | null;
  edge_percentage: number | null;
  expected_value: number | null;
  confidence: number; // prop_confidence
  confidence_components: Record<string, number>;
  expected_snap_percentage: number;
  injury_status: string | null;
  role_projection: {
    expected_snap_pct: number;
    expected_snaps: number;
    route_participation: number;
    route_proxy: boolean;
    targets: number;
    carries: number;
    pass_attempts: number;
    team_plays: number;
    team_pass_rate: number;
  };
  status: "PLAY" | "NO PLAY";
  /** Passed every gate except proven profitability: graded forward-test pick, never published. */
  shadow_play: boolean;
  no_play_reasons: string[];
  data_quality: number;
  factors: PropFactor[];
  model_version: string;
  timestamp: string;
}

export interface PropEdgeOutput {
  features: PropFeatureVector;
  projection: PropProjection;
  results: NflPlayerPropEdgeResult[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Scale every opportunity-driven mean — used to build the naive comparison projection. */
function scaledProjection(p: PropProjection, k: number): PropProjection {
  return {
    ...p,
    targets: p.targets * k,
    carries: p.carries * k,
    pass_att: p.pass_att * k,
    rec_td_lambda: p.rec_td_lambda * k,
    rush_td_lambda: p.rush_td_lambda * k,
    fg_att: p.fg_att * k,
    xp_mean: p.xp_mean * k,
  };
}

export function calculate_nfl_player_prop_edge(input: PropEdgeInput): PropEdgeOutput {
  const stat = input.prop_type;
  const fv = buildPropFeatures(input.features, stat);
  const allowed = PROP_TYPES_BY_POSITION[fv.position] ?? [];
  if (!allowed.includes(stat)) {
    throw new Error(`prop type ${stat} is not supported for position ${fv.position}`);
  }
  const w = input.weights;
  const gates = resolvePropGates(input.gates);
  const ts = input.now ?? new Date().toISOString();

  const proj = projectPlayer(fv);
  const dist = propDistribution(stat, proj, w.params, fv.position);
  const summary = summarize(dist.pmf);
  const probs = probVsLine(dist.pmf, input.line);

  // Naive comparison: same family, mean = recent (L5) average. Measures how
  // much the matchup model moved the number — large moves lower stability.
  const projMean = pmfMean(dist.pmf);
  const naiveMean = fv.usage.stat_l5 ?? fv.usage.stat_rolling;
  const naiveProbs = naiveMean !== null && projMean > 0
    ? probVsLine(propDistribution(stat, scaledProjection(proj, naiveMean / projMean), w.params, fv.position).pmf, input.line)
    : null;

  // Recent hit rate on this line (last ≤10 games played, point-in-time).
  const { season, week } = input.features.game;
  const recent = input.features.playerRows
    .filter((r) => (r.season < season || (r.season === season && r.week < week)) &&
      ((r.offense_snaps ?? 0) > 0 || r.fg_att + r.pat_att > 0))
    .sort((a, b) => (b.season - a.season) || (b.week - a.week))
    .slice(0, 10)
    .map((r) => statValue(r, stat));

  const m = input.market;
  const twoWay = !!m && m.over_price !== null && m.under_price !== null;
  const [nvOver, nvUnder] = twoWay
    ? devigPair(americanToImplied(m!.over_price!), americanToImplied(m!.under_price!))
    : [null, null];
  const lineMovement = m && m.opening_line !== null ? r2(m.line - m.opening_line) : null;
  const status = fv.availability.status;
  const checkRole = fv.position !== "K";

  const results: NflPlayerPropEdgeResult[] = [];
  for (const side of ["over", "under"] as const) {
    const pSide = side === "over" ? probs.over : probs.under;
    const decided = Math.max(1 - probs.push, 1e-9);
    const cond = pSide / decided;
    const consensus = m ? (side === "over" ? m.over_price : m.under_price) : null;
    const best = m ? (side === "over" ? m.best_over_price : m.best_under_price) : null;
    const price = best ?? consensus;
    const book = m ? (side === "over" ? m.best_over_book : m.best_under_book) : null;

    let noVig: number | null = null;
    let method: NflPlayerPropEdgeResult["no_vig_method"] = null;
    if (twoWay) {
      noVig = side === "over" ? nvOver : nvUnder;
      method = "two_way";
    } else if (consensus !== null) {
      noVig = americanToImplied(consensus) / (1 + ONE_SIDED_ASSUMED_HOLD);
      method = "assumed_hold";
    }
    const edge = noVig !== null ? cond - noVig : null;
    const ev = price !== null ? expectedValue(pSide, probs.push, price) : null;

    const naiveSide = naiveProbs ? (side === "over" ? naiveProbs.over : naiveProbs.under) / Math.max(1 - naiveProbs.push, 1e-9) : cond;
    const sideRate = recent.length
      ? recent.filter((v) => (side === "over" ? v > input.line : v < input.line)).length / recent.length
      : null;
    const medianAgrees = side === "over" ? summary.median > input.line : summary.median < input.line;
    const conf = propConfidence({
      model_probability: cond,
      edge: edge ?? 0,
      data_quality: fv.data_quality,
      naive_probability_gap: Math.abs(cond - naiveSide),
      injury_status: status,
      practice_status: fv.availability.practice,
      books: m?.books ?? 0,
      one_sided: !twoWay,
      recent_side_rate: sideRate,
      median_agrees: medianAgrees,
      calibration: w.calibration[stat] ? { pit_ece: w.calibration[stat]!.pit_ece, n: w.calibration[stat]!.n } : null,
    });
    const reasons = propGateFailures({
      edge: edge ?? -1,
      expected_value: ev ?? -1,
      confidence: conf.prop_confidence,
      market_price: price,
      injury_status: status,
      role_cv: fv.usage.snap_cv,
      check_role: checkRole,
      sample_games: fv.usage.sample_games,
      evidence: input.evidence ?? null,
    }, gates);

    results.push({
      game_id: input.features.game.game_id,
      player_id: fv.player_id,
      player_name: fv.player_name,
      team: input.features.game.team,
      opponent: input.features.game.opponent,
      position: fv.position,
      prop_type: stat,
      side,
      line: input.line,
      market_price: price,
      market_book: book,
      opening_line: m?.opening_line ?? null,
      opening_price: m ? (side === "over" ? m.opening_over_price : m.opening_under_price) : null,
      current_line: m?.line ?? input.line,
      best_price: best,
      line_movement: lineMovement,
      projection: r2(summary.mean),
      median_projection: summary.median,
      std_dev: r2(summary.sd),
      p10: summary.p10,
      p90: summary.p90,
      distribution: dist.family,
      over_probability: r4(probs.over),
      under_probability: r4(probs.under),
      push_probability: r4(probs.push),
      model_probability: r4(cond),
      market_probability: price !== null ? r4(americanToImplied(price)) : null,
      no_vig_probability: noVig !== null ? r4(noVig) : null,
      no_vig_method: method,
      fair_price: probToAmerican(cond),
      edge_percentage: edge !== null ? r4(edge * 100) : null,
      expected_value: ev !== null ? r4(ev * 100) : null,
      confidence: conf.prop_confidence,
      confidence_components: Object.fromEntries(Object.entries(conf.components).map(([k, v]) => [k, r4(v)])),
      expected_snap_percentage: r4(proj.exp_snap_pct),
      injury_status: status,
      role_projection: {
        expected_snap_pct: r4(proj.exp_snap_pct),
        expected_snaps: r2(proj.exp_snaps),
        route_participation: r4(fv.usage.route_participation),
        route_proxy: fv.usage.route_proxy,
        targets: r2(proj.targets),
        carries: r2(proj.carries),
        pass_attempts: r2(proj.pass_att),
        team_plays: r2(proj.team_plays),
        team_pass_rate: r4(proj.pass_rate),
      },
      status: reasons.length === 0 ? "PLAY" : "NO PLAY",
      shadow_play: reasons.length > 0 && reasons.every((r) => r.startsWith(NFL_UNPROVEN_PREFIX)),
      no_play_reasons: reasons,
      data_quality: fv.data_quality,
      factors: proj.factors,
      model_version: w.version,
      timestamp: ts,
    });
  }

  // Never both sides (real or shadow).
  const shadows = results.filter((r) => r.shadow_play).sort((a, b) => (b.edge_percentage ?? 0) - (a.edge_percentage ?? 0));
  for (const r of shadows.slice(1)) r.shadow_play = false;
  const plays = results.filter((r) => r.status === "PLAY");
  if (plays.length > 1) {
    plays.sort((a, b) => (b.edge_percentage ?? 0) - (a.edge_percentage ?? 0));
    for (const r of plays.slice(1)) { r.status = "NO PLAY"; r.no_play_reasons.push("opposite side has the larger edge"); }
  }

  return { features: fv, projection: proj, results };
}

export { buildPropFeatures } from "./features.ts";
export type { PropFeatureInput, PropFeatureVector } from "./features.ts";
export type { PropEvidence } from "./gates.ts";
export { NFL_PROP_MODEL_VERSION, PROP_TYPES_BY_POSITION, type NflPropType } from "./weights.ts";
