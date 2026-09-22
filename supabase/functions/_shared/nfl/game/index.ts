/**
 * NFL GAME EDGE ENGINE — `calculate_nfl_game_edge()`.
 *
 * Moneyline, spread and game total ONLY. This engine never produces or reads
 * player-prop projections, and the player-prop engine never reads this one's
 * output (enforced by src/test/nfl_engine_isolation.test.ts).
 *
 * Pipeline:  features.ts (25 factors, point-in-time) → models.ts (three
 * separately-fit market models) → no-vig market comparison → game_confidence →
 * gates → PLAY / NO PLAY per market side.
 */

import { americanToImplied, devigPair } from "../../prob_math.ts";
import { expectedValue, probToAmerican } from "../distributions.ts";
import type { NflMarketQuote } from "../data/types.ts";
import { NFL_UNPROVEN_PREFIX, type NflForwardEvidence, type NflGameGates } from "../../thresholds.ts";
import { buildGameFeatures, type GameFeatureInput, type GameFeatureVector } from "./features.ts";
import {
  fairSpread,
  fairTotal,
  marginWinProbability,
  projectMargin,
  projectMoneyline,
  projectTotal,
  spreadProbabilities,
  totalProbabilities,
} from "./models.ts";
import { gameConfidence, type CalibrationEvidence } from "./confidence.ts";
import { gameGateFailures, resolveGameGates } from "./gates.ts";
import type { GameModelWeights } from "./weights.ts";

export type GameMarketType = "moneyline" | "spread" | "total";

export interface GameMarkets {
  /** price_a = home, price_b = away. */
  moneyline?: NflMarketQuote | null;
  /** line = HOME spread; price_a = home, price_b = away. */
  spread?: NflMarketQuote | null;
  /** line = total; price_a = over, price_b = under. */
  total?: NflMarketQuote | null;
}

export interface NflGameEdgeResult {
  game_id: string;
  market_type: GameMarketType;
  selection: string;
  side: "home" | "away" | "over" | "under";
  line: number | null;
  model_probability: number; // conditional on no push
  push_probability: number;
  market_probability: number; // raw implied of market_price (includes vig)
  no_vig_probability: number;
  fair_price: number | null;
  market_price: number;
  market_book: string | null;
  opening_line: number | null;
  opening_price: number | null;
  edge_percentage: number; // (model − no-vig) × 100
  expected_value: number; // per unit staked × 100 (%)
  confidence: number; // game_confidence
  confidence_components: Record<string, number>;
  projected_score: { home_team: string; home: number; away_team: string; away: number };
  projected_margin: number; // home − away
  projected_total: number;
  fair_line: number | null; // fair spread (home) or fair total
  status: "PLAY" | "NO PLAY";
  /** Passed every gate except proven profitability: graded forward-test pick, never published. */
  shadow_play: boolean;
  no_play_reasons: string[];
  data_quality: number;
  model_version: string;
  timestamp: string;
}

export interface GameEdgeInput {
  features: GameFeatureInput | GameFeatureVector;
  markets: GameMarkets;
  weights: GameModelWeights;
  gates?: Partial<NflGameGates> | null;
  calibration?: Partial<Record<GameMarketType, CalibrationEvidence | null>>;
  /** Forward-test evidence per market for this model version. */
  forward?: Partial<Record<GameMarketType, NflForwardEvidence | null>>;
  now?: string;
}

export interface GameEdgeOutput {
  features: GameFeatureVector;
  results: NflGameEdgeResult[];
  projections: {
    p_home_win: number;
    projected_margin: number;
    projected_total: number;
    structural_total: number;
    margin_contributions: Record<string, number>;
    moneyline_contributions: Record<string, number>;
    total_contributions: Record<string, number>;
  };
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r1 = (x: number) => Math.round(x * 10) / 10;

function isFeatureVector(f: GameFeatureInput | GameFeatureVector): f is GameFeatureVector {
  return (f as GameFeatureVector).side !== undefined;
}

/** The single largest (signed) factor contribution — removed to test stability. */
function topContribution(c: Record<string, number>): number {
  return Object.values(c).reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
}

function hold(q: NflMarketQuote): number | null {
  const a = americanToImplied(q.current.price_a);
  const b = americanToImplied(q.current.price_b);
  return a > 0 && b > 0 ? a + b - 1 : null;
}

export function calculate_nfl_game_edge(input: GameEdgeInput): GameEdgeOutput {
  const fv = isFeatureVector(input.features) ? input.features : buildGameFeatures(input.features);
  const w = input.weights;
  const gates = resolveGameGates(input.gates);
  const ts = input.now ?? new Date().toISOString();
  const home = fv.home;
  const away = fv.away;

  const ml = projectMoneyline(fv, w);
  const mp = projectMargin(fv, w);
  const tp = projectTotal(fv, w);
  const marginWin = marginWinProbability(mp.pmf);
  const projectedScore = {
    home_team: home,
    home: r1((tp.total + mp.margin) / 2),
    away_team: away,
    away: r1((tp.total - mp.margin) / 2),
  };
  const inj = fv.injuries;
  const questionableStarters = inj.home.questionable_starters.length + inj.away.questionable_starters.length;
  const qbQuestionable = inj.home.qb_questionable || inj.away.qb_questionable ||
    fv.qb.home.starter_status === "Questionable" || fv.qb.away.starter_status === "Questionable";
  const majorInjuryUncertainty = qbQuestionable ||
    inj.home.questionable_starters.length >= 2 || inj.away.questionable_starters.length >= 2;

  const results: NflGameEdgeResult[] = [];

  const emit = (
    market: GameMarketType,
    q: NflMarketQuote,
    side: NflGameEdgeResult["side"],
    selection: string,
    pWin: number,
    pPush: number,
    pWinWithoutTop: number,
    agreement: number,
    fairLine: number | null,
  ) => {
    const isA = side === "home" || side === "over";
    const consensusPrice = isA ? q.current.price_a : q.current.price_b;
    const bestPrice = isA ? q.best_price_a : q.best_price_b;
    const price = bestPrice ?? consensusPrice;
    const [nvA, nvB] = devigPair(americanToImplied(q.current.price_a), americanToImplied(q.current.price_b));
    const noVig = isA ? nvA : nvB;
    const decided = Math.max(1 - pPush, 1e-9);
    const cond = pWin / decided;
    const edge = cond - noVig;
    const ev = expectedValue(pWin, pPush, price);
    const conf = gameConfidence({
      model_probability: cond,
      edge,
      data_quality: fv.data_quality,
      largest_factor_shift: Math.abs(cond - pWinWithoutTop / decided),
      qb_questionable: qbQuestionable,
      questionable_starters: questionableStarters,
      books: q.books,
      hold: hold(q),
      agreement,
      calibration: input.calibration?.[market] ?? null,
    });
    const reasons = gameGateFailures({
      edge,
      expected_value: ev,
      confidence: conf.game_confidence,
      data_quality: fv.data_quality,
      market_price: price,
      major_injury_uncertainty: majorInjuryUncertainty,
      evidence: w.evidence_gates ? w.evidence_gates[market] : undefined,
      forward: input.forward?.[market] ?? null,
    }, gates);
    results.push({
      game_id: fv.game_id,
      market_type: market,
      selection,
      side,
      line: market === "moneyline" ? null : (side === "away" ? -(q.current.line ?? 0) : q.current.line),
      model_probability: r4(cond),
      push_probability: r4(pPush),
      market_probability: r4(americanToImplied(price)),
      no_vig_probability: r4(noVig),
      fair_price: probToAmerican(cond),
      market_price: price,
      market_book: (isA ? q.best_book_a : q.best_book_b) ?? null,
      opening_line: q.opening ? (market === "moneyline" ? null : (side === "away" ? -(q.opening.line ?? 0) : q.opening.line)) : null,
      opening_price: q.opening ? (isA ? q.opening.price_a : q.opening.price_b) : null,
      edge_percentage: r4(edge * 100),
      expected_value: r4(ev * 100),
      confidence: conf.game_confidence,
      confidence_components: Object.fromEntries(Object.entries(conf.components).map(([k, v]) => [k, r4(v)])),
      projected_score: projectedScore,
      projected_margin: r1(mp.margin),
      projected_total: r1(tp.total),
      fair_line: fairLine,
      status: reasons.length === 0 ? "PLAY" : "NO PLAY",
      shadow_play: reasons.length > 0 && reasons.every((r) => r.startsWith(NFL_UNPROVEN_PREFIX)),
      no_play_reasons: reasons,
      data_quality: fv.data_quality,
      model_version: w.version,
      timestamp: ts,
    });
  };

  // ── Moneyline ──
  if (input.markets.moneyline) {
    const q = input.markets.moneyline;
    const pHome = ml.p_home;
    const logitP = Math.log(pHome / (1 - pHome));
    const pHomeWithoutTop = 1 / (1 + Math.exp(-(logitP - topContribution(ml.contributions))));
    const agreement = 1 - Math.abs(marginWin - pHome) / 0.15;
    emit("moneyline", q, "home", `${home} ML`, pHome, 0, pHomeWithoutTop, agreement, null);
    emit("moneyline", q, "away", `${away} ML`, 1 - pHome, 0, 1 - pHomeWithoutTop, agreement, null);
  }

  // ── Spread ──
  if (input.markets.spread && input.markets.spread.current.line !== null) {
    const q = input.markets.spread;
    const homeLine = q.current.line!;
    const p = spreadProbabilities(mp.pmf, homeLine, w);
    // Same distribution shifted as if the largest single contribution were absent.
    const withoutTop = spreadProbabilities(
      { offset: mp.pmf.offset - Math.round(topContribution(mp.contributions)), p: mp.pmf.p },
      homeLine,
      w,
    );
    const agreement = 1 - Math.abs(ml.p_home - marginWin) / 0.15;
    const fs = fairSpread(mp.pmf);
    const fmt = (l: number) => (l > 0 ? `+${l}` : `${l}`);
    emit("spread", q, "home", `${home} ${fmt(homeLine)}`, p.home, p.push, withoutTop.home, agreement, fs);
    emit("spread", q, "away", `${away} ${fmt(-homeLine)}`, p.away, p.push, withoutTop.away, agreement, -fs);
  }

  // ── Total ──
  if (input.markets.total && input.markets.total.current.line !== null) {
    const q = input.markets.total;
    const line = q.current.line!;
    const p = totalProbabilities(tp.pmf, line, w);
    const withoutTop = totalProbabilities(
      { offset: tp.pmf.offset - Math.round(topContribution(tp.contributions)), p: tp.pmf.p },
      line,
      w,
    );
    const agreement = 1 - Math.abs(tp.total - tp.structural_total) / 8;
    const ft = fairTotal(tp.pmf);
    emit("total", q, "over", `Over ${line}`, p.over, p.push, withoutTop.over, agreement, ft);
    emit("total", q, "under", `Under ${line}`, p.under, p.push, withoutTop.under, agreement, ft);
  }

  // At most one PLAY per market: keep the larger edge if both somehow pass.
  for (const m of ["moneyline", "spread", "total"] as const) {
    const plays = results.filter((r) => r.market_type === m && r.status === "PLAY");
    if (plays.length > 1) {
      plays.sort((a, b) => b.edge_percentage - a.edge_percentage);
      for (const r of plays.slice(1)) {
        r.status = "NO PLAY";
        r.no_play_reasons.push("opposite side has the larger edge");
      }
    }
    // Same rule for shadow picks: at most one per market.
    const shadows = results.filter((r) => r.market_type === m && r.shadow_play)
      .sort((a, b) => b.edge_percentage - a.edge_percentage);
    for (const r of shadows.slice(1)) r.shadow_play = false;
  }

  return {
    features: fv,
    results,
    projections: {
      p_home_win: r4(ml.p_home),
      projected_margin: r1(mp.margin),
      projected_total: r1(tp.total),
      structural_total: r1(tp.structural_total),
      margin_contributions: mapR4(mp.contributions),
      moneyline_contributions: mapR4(ml.contributions),
      total_contributions: mapR4(tp.contributions),
    },
  };
}

function mapR4(c: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r4(v)]));
}

// Re-exported so handlers and scripts have one import surface for this engine.
export { buildGameFeatures } from "./features.ts";
export type { GameFeatureInput, GameFeatureVector } from "./features.ts";
export type { CalibrationEvidence } from "./confidence.ts";
