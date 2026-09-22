/**
 * NFL PLAYER PROP EDGE ENGINE — `prop_confidence` (0–100).
 *
 * Independent of the game engine's `game_confidence`: separate inputs,
 * separate weights, never averaged or combined with it.
 *
 *   probability      distance of P(side) from a coin flip
 *   edge             edge over the no-vig market
 *   data_quality     sample depth, snap data, matchup sample, market context
 *   stability        agreement of the matchup projection with a naive
 *                    recent-average projection pushed through the same distribution
 *   injury_certainty player's own designation / practice participation
 *   liquidity        books quoting the prop; one-sided markets penalised
 *   agreement        direction of median vs line matches recent hit rate
 *   calibration      out-of-sample distribution calibration for this prop type
 */

import { PROP_CONFIDENCE_WEIGHTS as W } from "./weights.ts";

export interface PropConfidenceInputs {
  model_probability: number;
  edge: number;
  data_quality: number;
  /** |P(side) − P(side) under the naive projection| */
  naive_probability_gap: number;
  injury_status: string | null;
  practice_status: string | null;
  books: number;
  one_sided: boolean;
  /** 0..1 — share of recent games (last ≤10) that landed on this side of the line. */
  recent_side_rate: number | null;
  median_agrees: boolean;
  calibration: { pit_ece: number; n: number } | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

export function propConfidence(i: PropConfidenceInputs): { prop_confidence: number; components: Record<keyof typeof W, number> } {
  const injury =
    i.injury_status === "Questionable" ? 0.45 :
    i.injury_status === "Doubtful" ? 0.1 :
    i.injury_status === "Out" ? 0 :
    /did not/i.test(i.practice_status ?? "") ? 0.6 :
    /limited/i.test(i.practice_status ?? "") ? 0.8 : 1;
  const agreement = (i.median_agrees ? 0.6 : 0.2) + 0.4 * (i.recent_side_rate ?? 0.5);
  const components = {
    probability: clamp01(Math.abs(i.model_probability - 0.5) / 0.2),
    edge: clamp01(i.edge / 0.1),
    data_quality: clamp01(i.data_quality),
    stability: clamp01(1 - i.naive_probability_gap / 0.2),
    injury_certainty: injury,
    liquidity: clamp01(i.books / 5) * (i.one_sided ? 0.6 : 1),
    agreement: clamp01(agreement),
    calibration: i.calibration ? clamp01(1 - i.calibration.pit_ece / 0.1) * clamp01(i.calibration.n / 1000) : 0.35,
  };
  let score = 0;
  for (const k of Object.keys(W) as Array<keyof typeof W>) score += W[k] * components[k];
  return { prop_confidence: Math.round(score * 1000) / 10, components };
}
