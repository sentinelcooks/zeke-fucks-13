/**
 * NFL GAME EDGE ENGINE — `game_confidence` (0–100).
 *
 * Owned by the game engine. Never reads, averages or blends the prop
 * engine's `prop_confidence`.
 *
 * Confidence is NOT a probability. It scores how much the model's edge on
 * this specific market/side should be trusted, from eight components:
 *   probability      distance of the model probability from a coin flip
 *   edge             size of the edge over the no-vig market
 *   data_quality     sample depth + input coverage (feature vector)
 *   stability        robustness to removing the single largest factor
 *   injury_certainty unresolved Questionable designations
 *   liquidity        books quoting the market and their hold
 *   agreement        this market's model vs an independent cross-check
 *   calibration      historical calibration of this market's model (backtest)
 */

import { GAME_CONFIDENCE_WEIGHTS as W } from "./weights.ts";

export interface CalibrationEvidence {
  /** Expected calibration error on out-of-sample predictions (0..1). */
  ece: number | null;
  brier: number | null;
  n: number;
}

export interface GameConfidenceInputs {
  model_probability: number; // conditional on no push
  edge: number;
  data_quality: number;
  /** Probability shift if the largest single contribution were removed. */
  largest_factor_shift: number;
  qb_questionable: boolean;
  questionable_starters: number;
  books: number;
  hold: number | null; // sum of raw implied − 1
  /** 0..1 agreement between this market model and its independent cross-check. */
  agreement: number;
  calibration: CalibrationEvidence | null;
}

export interface GameConfidenceResult {
  game_confidence: number;
  components: Record<keyof typeof W, number>;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

export function gameConfidence(i: GameConfidenceInputs): GameConfidenceResult {
  const holdPenalty = i.hold === null ? 0.7 : 1 - clamp01((i.hold - 0.045) / 0.06);
  const calibration = i.calibration && i.calibration.ece !== null
    ? clamp01(1 - i.calibration.ece / 0.08) * clamp01(i.calibration.n / 500)
    : 0.35; // unknown calibration is penalised, not assumed good
  const components = {
    probability: clamp01(Math.abs(i.model_probability - 0.5) / 0.2),
    edge: clamp01(i.edge / 0.08),
    data_quality: clamp01(i.data_quality),
    stability: clamp01(1 - i.largest_factor_shift / 0.15),
    injury_certainty: clamp01(1 - (i.qb_questionable ? 0.6 : 0) - 0.15 * i.questionable_starters),
    liquidity: clamp01(i.books / 6) * holdPenalty,
    agreement: clamp01(i.agreement),
    calibration,
  };
  let score = 0;
  for (const k of Object.keys(W) as Array<keyof typeof W>) score += W[k] * components[k];
  return { game_confidence: Math.round(score * 1000) / 10, components };
}
