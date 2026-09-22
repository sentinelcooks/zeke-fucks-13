/**
 * NFL PLAYER PROP EDGE ENGINE — pick gating.
 *
 * A prop side is an actionable PLAY only when every gate passes: edge, EV,
 * prop_confidence, player availability, role stability, sample size, price,
 * and proven profitability of the prop type (forward test, NFL_PROMOTION_RULE).
 * Otherwise NO PLAY with explicit reasons; failing ONLY the proof gate makes
 * the prediction a graded shadow pick.
 */

import {
  NFL_PROP_GATES_DEFAULT,
  NFL_UNPROVEN_PREFIX,
  describeEvidence,
  isProvenProfitable,
  type NflForwardEvidence,
  type NflPropGates,
} from "../../thresholds.ts";

/** Forward-test (shadow pick) results for this prop type + model version. */
export type PropEvidence = NflForwardEvidence;

export interface PropGateInput {
  edge: number;
  expected_value: number;
  confidence: number;
  market_price: number | null;
  injury_status: string | null;
  role_cv: number;
  check_role: boolean;
  sample_games: number;
  evidence: PropEvidence | null;
}

export function resolvePropGates(override: Partial<NflPropGates> | null | undefined): NflPropGates {
  return { ...NFL_PROP_GATES_DEFAULT, ...(override ?? {}) };
}

export function propGateFailures(i: PropGateInput, g: NflPropGates): string[] {
  const reasons: string[] = [];
  if (i.market_price === null) {
    reasons.push("no sportsbook price for this side");
    return reasons;
  }
  if (i.injury_status === "Out" || i.injury_status === "Doubtful") reasons.push(`player ${i.injury_status}`);
  else if (i.injury_status === "Questionable" && !g.allow_questionable) reasons.push("player Questionable (availability unconfirmed)");
  if (!(i.edge >= g.min_edge)) reasons.push(`edge ${(i.edge * 100).toFixed(1)}% < ${(g.min_edge * 100).toFixed(1)}%`);
  if (i.edge > g.max_edge) reasons.push(`edge ${(i.edge * 100).toFixed(1)}% implausibly large vs market (> ${(g.max_edge * 100).toFixed(0)}%) — check line / role data`);
  if (!(i.expected_value > g.min_ev)) reasons.push(`EV ${(i.expected_value * 100).toFixed(1)}% not above ${(g.min_ev * 100).toFixed(1)}%`);
  if (!(i.confidence >= g.min_confidence)) reasons.push(`confidence ${i.confidence} < ${g.min_confidence}`);
  if (i.sample_games < g.min_sample_games) reasons.push(`sample ${i.sample_games} games < ${g.min_sample_games}`);
  if (i.check_role && i.role_cv > g.max_role_cv) reasons.push(`role unstable (snap-share CV ${i.role_cv.toFixed(2)} > ${g.max_role_cv})`);
  if (i.market_price > g.max_price) reasons.push(`price +${i.market_price} beyond longshot cap`);
  // Historical prop prices do not exist, so a prop type is proven only by its
  // forward test. Failing only this gate makes it a shadow pick.
  if (g.respect_backtest_evidence && !isProvenProfitable(i.evidence)) {
    reasons.push(`${NFL_UNPROVEN_PREFIX} prop type not proven profitable (${describeEvidence(i.evidence)})`);
  }
  return reasons;
}
