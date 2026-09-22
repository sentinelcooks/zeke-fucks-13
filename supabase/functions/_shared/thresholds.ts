// supabase/functions/_shared/thresholds.ts
//
// Single source of truth for verdict thresholds. Everything downstream
// — model narrative tiers, daily-picks gating, edge_scoring verdicts,
// frontend "Strong / Lean / Pass" badges — MUST import from here.
//
// Public use of these probability-space thresholds requires a validated
// chronological holdout under calibration_policy. Raw model scores may use
// the same cutoffs for internal routing, but are not probabilities.

export const PROB_STRONG = 0.72;
export const PROB_LEAN   = 0.58;
export const PROB_FLOOR  = 0.42;

// Edge thresholds (calibrated_prob − fair_implied).
export const EDGE_STRONG_MIN = 0.03;  // 3% edge
export const EDGE_LEAN_MIN   = 0.02;  // 2% edge

// Reliability thresholds (from edge_scoring market-reliability map).
export const RELIABILITY_STRONG_MIN = 0.70;
export const RELIABILITY_LEAN_MIN   = 0.65;
export const RELIABILITY_FLOOR      = 0.40;

// Longshot gate — nothing at +500 or longer ever makes it through.
export const LONGSHOT_ODDS_MAX = 500;
// Mid-longshot gate (+250 to +499) — stricter numbers required.
export const MID_LONGSHOT_ODDS_MIN = 250;

export const MID_LONGSHOT_CONF_MIN = 0.72;
export const MID_LONGSHOT_EDGE_MIN = 0.06;
export const MID_LONGSHOT_RELIABILITY_MIN = 0.65;

// Volatile-market under gate.
export const VOLATILE_UNDER_CONF_MIN = 0.70;
export const VOLATILE_UNDER_EDGE_MIN = 0.06;

// NBA Today's Edge juice gates. Normal favorite juice is diagnostic only when
// canonical signal quality is strong enough; extreme juice remains a hard safety.
export const NBA_HEAVY_JUICE_ODDS = -180;
export const NBA_EXTREME_JUICE_ODDS = -250;
export const NBA_EXTREME_JUICE_EXEMPT_CONF_MIN = 0.85;
export const NBA_EXTREME_JUICE_EXEMPT_EV_MIN = 12;
export const NBA_EXTREME_JUICE_EXEMPT_EDGE_MIN = 0.08;

// NFL pick gates. The two NFL engines are separate products with separate,
// independently configurable gates; runtime overrides are read from
// app_config keys `nfl_game_edge_gates` / `nfl_prop_edge_gates` (JSON) and
// merged over these defaults. Nothing that fails a gate is published as a pick.
export interface NflGameGates {
  min_edge: number;              // model prob − no-vig prob (0..1)
  /**
   * Edges above this vs a liquid market are far more often stale lines, data
   * errors or model failure than real value → NO PLAY for review.
   */
  max_edge: number;
  min_confidence: number;        // game_confidence (0..100)
  min_data_quality: number;      // 0..1
  min_ev: number;                // expected value per unit (0 = must be +EV)
  block_major_injury_uncertainty: boolean;
  max_price: number;             // skip longshots beyond this American price
  /**
   * Publish PLAYs only for markets proven profitable (backtest evidence gate
   * or NFL_PROMOTION_RULE on forward-test shadow picks). Off = research only.
   */
  respect_backtest_evidence: boolean;
}
export const NFL_GAME_GATES_DEFAULT: NflGameGates = {
  min_edge: 0.03,
  max_edge: 0.12,
  min_confidence: 60,
  min_data_quality: 0.6,
  min_ev: 0,
  block_major_injury_uncertainty: true,
  max_price: LONGSHOT_ODDS_MAX,
  respect_backtest_evidence: true,
};

export interface NflPropGates {
  min_edge: number;
  max_edge: number;              // implausible-edge guard (see NflGameGates.max_edge)
  min_confidence: number;        // prop_confidence (0..100)
  min_ev: number;
  min_sample_games: number;      // games in the player's projection sample
  max_role_cv: number;           // coefficient of variation of recent snap share
  allow_questionable: boolean;   // false = Questionable players are NO PLAY
  max_price: number;
  /** Publish PLAYs only for prop types proven profitable (NFL_PROMOTION_RULE). */
  respect_backtest_evidence: boolean;
}
export const NFL_PROP_GATES_DEFAULT: NflPropGates = {
  min_edge: 0.04,
  max_edge: 0.15,
  min_confidence: 60,
  min_ev: 0,
  min_sample_games: 4,
  max_role_cv: 0.3,
  allow_questionable: false,
  max_price: LONGSHOT_ODDS_MAX,
  respect_backtest_evidence: true,
};

/**
 * NFL promotion rule (owner directive 2026-09-22): a market / prop type may
 * publish PLAYs only once it is PROVEN profitable. Until then, would-be picks
 * are stored as shadow picks and graded (forward test). Both the game and the
 * prop engine apply this rule to their OWN evidence, never to each other's.
 */
export const NFL_PROMOTION_RULE = { min_bets: 150, min_roi: 0, min_avg_clv: 0 } as const;
export const NFL_UNPROVEN_PREFIX = "unproven:";

export interface NflForwardEvidence {
  bets: number;
  roi: number;
  avg_clv: number | null;
}

export function isProvenProfitable(e: NflForwardEvidence | null | undefined): boolean {
  return !!e && e.bets >= NFL_PROMOTION_RULE.min_bets && e.roi > NFL_PROMOTION_RULE.min_roi &&
    e.avg_clv !== null && e.avg_clv > NFL_PROMOTION_RULE.min_avg_clv;
}

export function describeEvidence(e: NflForwardEvidence | null | undefined): string {
  if (!e || e.bets === 0) return "forward test: no graded shadow picks yet";
  return `forward test: ${e.bets}/${NFL_PROMOTION_RULE.min_bets} bets, ROI ${(e.roi * 100).toFixed(1)}%, ` +
    `avg CLV ${e.avg_clv === null ? "n/a" : (e.avg_clv * 100).toFixed(2) + "%"}`;
}

// Narrative tiers (displayed text). These map from the same probability
// thresholds so NHL / MLB / NBA / UFC narrators never disagree.
export function tierLabel(calibratedProb: number): "Strong" | "Lean" | "Marginal" | "Pass" {
  if (calibratedProb >= PROB_STRONG) return "Strong";
  if (calibratedProb >= PROB_LEAN)   return "Lean";
  if (calibratedProb >= PROB_FLOOR)  return "Marginal";
  return "Pass";
}
