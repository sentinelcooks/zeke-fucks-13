/**
 * NFL GAME EDGE ENGINE — pick gating.
 *
 * A market/side becomes an actionable PLAY only if every gate passes.
 * Otherwise it is returned as NO PLAY with the explicit failing reasons —
 * the engine never forces a pick to fill a slate.
 */

import {
  NFL_GAME_GATES_DEFAULT,
  NFL_UNPROVEN_PREFIX,
  describeEvidence,
  isProvenProfitable,
  type NflForwardEvidence,
  type NflGameGates,
} from "../../thresholds.ts";
import type { EvidenceGate } from "./weights.ts";

export interface GameGateInput {
  edge: number;
  expected_value: number;
  confidence: number;
  data_quality: number;
  market_price: number;
  major_injury_uncertainty: boolean;
  /** Backtest evidence for this market; undefined = not supplied. */
  evidence: EvidenceGate | null | undefined;
  /** Forward-test (shadow pick) evidence for this market + model version. */
  forward?: NflForwardEvidence | null;
}

export function resolveGameGates(override: Partial<NflGameGates> | null | undefined): NflGameGates {
  return { ...NFL_GAME_GATES_DEFAULT, ...(override ?? {}) };
}

export function gameGateFailures(i: GameGateInput, g: NflGameGates): string[] {
  const reasons: string[] = [];
  // Proven profitability: a profitable walk-forward backtest threshold for this
  // market, OR a forward test meeting NFL_PROMOTION_RULE. Failing only this
  // gate makes the prediction a shadow pick (graded, never published).
  if (g.respect_backtest_evidence && i.evidence !== undefined) {
    const forwardProven = isProvenProfitable(i.forward);
    const backtestProven = i.evidence !== null && i.edge >= i.evidence.min_edge;
    if (!forwardProven && !backtestProven) {
      const bt = i.evidence === null ? "no profitable threshold" : `needs edge >= ${(i.evidence.min_edge * 100).toFixed(1)}%`;
      reasons.push(`${NFL_UNPROVEN_PREFIX} not proven profitable (backtest: ${bt}; ${describeEvidence(i.forward)})`);
    }
  }
  if (!(i.edge >= g.min_edge)) reasons.push(`edge ${(i.edge * 100).toFixed(1)}% < ${(g.min_edge * 100).toFixed(1)}%`);
  if (i.edge > g.max_edge) reasons.push(`edge ${(i.edge * 100).toFixed(1)}% implausibly large vs market (> ${(g.max_edge * 100).toFixed(0)}%) — check line / data`);
  if (!(i.expected_value > g.min_ev)) reasons.push(`EV ${(i.expected_value * 100).toFixed(1)}% not above ${(g.min_ev * 100).toFixed(1)}%`);
  if (!(i.confidence >= g.min_confidence)) reasons.push(`confidence ${i.confidence} < ${g.min_confidence}`);
  if (!(i.data_quality >= g.min_data_quality)) reasons.push(`data quality ${i.data_quality} < ${g.min_data_quality}`);
  if (g.block_major_injury_uncertainty && i.major_injury_uncertainty) reasons.push("unresolved major injury (QB or 2+ starters Questionable)");
  if (i.market_price > g.max_price) reasons.push(`price +${i.market_price} beyond longshot cap`);
  return reasons;
}
