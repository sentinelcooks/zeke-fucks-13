/**
 * NFL GAME EDGE ENGINE — the three market models.
 *
 * MONEYLINE : logistic model on side features → P(home win). Own coefficients.
 * SPREAD    : ridge model on side features → projected margin (points), then a
 *             key-number-weighted discrete margin distribution → P(cover/push).
 * TOTAL     : ridge model on total features → projected total (points), then a
 *             key-number-weighted discrete total distribution → P(over/under/push).
 *
 * The three are fit separately (scripts/nfl/backtest-game.ts) and are never
 * averaged into one "universal" prediction. Cross-model comparison is used
 * only as a confidence input (model agreement).
 */

import {
  keyedDiscreteNormal,
  pmfCdf,
  probVsLine,
  type IntPmf,
  type LineProbabilities,
} from "../distributions.ts";
import { applyPlatt, contributions, predictLinear, predictLogistic } from "./fit.ts";
import { SIDE_FEATURES, TOTAL_FEATURES, type GameFeatureVector } from "./features.ts";
import {
  MARGIN_RANGE,
  MARKET_MOVEMENT_PRIOR as MOVE,
  TOTAL_RANGE,
  type GameModelWeights,
} from "./weights.ts";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const logit = (p: number) => Math.log(Math.min(Math.max(p, 1e-6), 1 - 1e-6) / (1 - Math.min(Math.max(p, 1e-6), 1 - 1e-6)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function sideVector(fv: GameFeatureVector): number[] {
  return SIDE_FEATURES.map((f) => fv.side[f]);
}

export function totalVector(fv: GameFeatureVector): number[] {
  return TOTAL_FEATURES.map((f) => fv.total[f]);
}

// ─── Moneyline ────────────────────────────────────────────────────────────

export interface MoneylineProjection {
  p_home_raw: number; // model output before calibration / movement prior
  p_home: number;
  contributions: Record<string, number>; // logit units
  movement_logit: number;
}

export function projectMoneyline(fv: GameFeatureVector, w: GameModelWeights): MoneylineProjection {
  const x = sideVector(fv);
  const raw = predictLogistic(w.moneyline, x);
  const calibrated = w.calibration.moneyline ? applyPlatt(raw, w.calibration.moneyline) : raw;
  const move = fv.movement?.ml_move_home ?? 0;
  const movementLogit = clamp(move * MOVE.ml_logit_per_prob, -MOVE.ml_cap_logit, MOVE.ml_cap_logit);
  return {
    p_home_raw: raw,
    p_home: sigmoid(logit(calibrated) + movementLogit),
    contributions: contributions(w.moneyline, x),
    movement_logit: movementLogit,
  };
}

// ─── Spread ───────────────────────────────────────────────────────────────

export interface MarginProjection {
  margin: number; // home − away, points
  margin_model: number; // before the movement prior
  contributions: Record<string, number>; // points
  movement_points: number;
  pmf: IntPmf;
}

export function projectMargin(fv: GameFeatureVector, w: GameModelWeights): MarginProjection {
  const x = sideVector(fv);
  const model = predictLinear(w.margin, x);
  // Spread moved toward home (negative change in home spread) → nudge margin up.
  const move = fv.movement?.spread_move_home ?? 0;
  const movementPoints = clamp(-move * MOVE.spread_points_per_point, -MOVE.spread_cap_points, MOVE.spread_cap_points);
  const margin = model + movementPoints;
  return {
    margin,
    margin_model: model,
    contributions: contributions(w.margin, x),
    movement_points: movementPoints,
    pmf: keyedDiscreteNormal(margin, w.margin_sd, MARGIN_RANGE.lo, MARGIN_RANGE.hi, w.margin_key_weights),
  };
}

/**
 * Cover probabilities for a HOME spread `homeLine` (e.g. −3.5 = home gives 3.5).
 * Home covers when margin + homeLine > 0 ⇔ margin > −homeLine.
 */
export function spreadProbabilities(pmf: IntPmf, homeLine: number, w: GameModelWeights): {
  home: number; // P(home covers)
  away: number;
  push: number;
} {
  const raw: LineProbabilities = probVsLine(pmf, -homeLine);
  const decided = raw.over + raw.under;
  if (!(decided > 0)) return { home: 0, away: 0, push: 1 };
  // Calibrate the conditional (push-excluded) probability, then re-expand.
  const condHome = w.calibration.spread ? applyPlatt(raw.over / decided, w.calibration.spread) : raw.over / decided;
  return { home: condHome * decided, away: (1 - condHome) * decided, push: raw.push };
}

/** Home spread at which the model is indifferent (P(cover | no push) ≈ 50%). */
export function fairSpread(pmf: IntPmf): number {
  // Median of the margin distribution, expressed as a home spread.
  let best = 0;
  let bestGap = Infinity;
  for (let l = -30; l <= 30; l += 0.5) {
    const p = probVsLine(pmf, -l);
    const cond = p.over / Math.max(p.over + p.under, 1e-9);
    const gap = Math.abs(cond - 0.5);
    if (gap < bestGap) { bestGap = gap; best = l; }
  }
  return best;
}

/** P(home wins outright) implied by the margin distribution (ties split). */
export function marginWinProbability(pmf: IntPmf): number {
  const lossOrTie = pmfCdf(pmf, 0);
  const tie = lossOrTie - pmfCdf(pmf, -1);
  return 1 - lossOrTie + tie / 2;
}

// ─── Total ────────────────────────────────────────────────────────────────

export interface TotalProjection {
  total: number;
  total_model: number;
  baseline: number; // 2 × league points per game in the rating window
  contributions: Record<string, number>;
  movement_points: number;
  /** Independent structural estimate (drives × points/drive) — used only for agreement. */
  structural_total: number;
  pmf: IntPmf;
}

export function projectTotal(fv: GameFeatureVector, w: GameModelWeights): TotalProjection {
  const x = totalVector(fv);
  const baseline = 2 * fv.league.points_per_game;
  const model = baseline + predictLinear(w.total, x);
  const move = fv.movement?.total_move ?? 0;
  const movementPoints = clamp(move * MOVE.total_points_per_point, -MOVE.total_cap_points, MOVE.total_cap_points);
  const total = Math.max(10, model + movementPoints);

  // Structural cross-check: expected drives × expected points per drive.
  const H = fv.home_profile;
  const A = fv.away_profile;
  const lg = fv.league;
  const drivesPerTeam = 10.8 * (lg.sec_per_play / Math.max((H.sec_per_play + A.sec_per_play) / 2, 20));
  const homePpd = lg.ppd + H.off_ppd + A.def_ppd;
  const awayPpd = lg.ppd + A.off_ppd + H.def_ppd;
  // Drive points count TD = 7 and exclude defensive/special-teams scores; the
  // ratio of actual points to drive points in the window corrects for that.
  const structural = drivesPerTeam * (homePpd + awayPpd) * (lg.points_per_game / Math.max(lg.ppd * 10.8, 1));

  return {
    total,
    total_model: model,
    baseline,
    contributions: contributions(w.total, x),
    movement_points: movementPoints,
    structural_total: structural,
    pmf: keyedDiscreteNormal(total, w.total_sd, TOTAL_RANGE.lo, TOTAL_RANGE.hi, w.total_key_weights),
  };
}

export function totalProbabilities(pmf: IntPmf, line: number, w: GameModelWeights): {
  over: number;
  under: number;
  push: number;
} {
  const raw = probVsLine(pmf, line);
  const decided = raw.over + raw.under;
  if (!(decided > 0)) return { over: 0, under: 0, push: 1 };
  const condOver = w.calibration.total ? applyPlatt(raw.over / decided, w.calibration.total) : raw.over / decided;
  return { over: condOver * decided, under: (1 - condOver) * decided, push: raw.push };
}

export function fairTotal(pmf: IntPmf): number {
  let best = 44.5;
  let bestGap = Infinity;
  for (let l = 20; l <= 80; l += 0.5) {
    const p = probVsLine(pmf, l);
    const gap = Math.abs(p.over / Math.max(p.over + p.under, 1e-9) - 0.5);
    if (gap < bestGap) { bestGap = gap; best = l; }
  }
  return best;
}
