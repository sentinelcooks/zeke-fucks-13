// supabase/functions/_shared/thresholds.ts
//
// Single source of truth for verdict thresholds. Everything downstream
// — model narrative tiers, daily-picks gating, edge_scoring verdicts,
// frontend "Strong / Lean / Pass" badges — MUST import from here.
//
// Thresholds are expressed in *calibrated* probability space (0-1).
// After the calibrate-model job runs, a confidence of 0.70 is a genuine
// 70% hit-rate, not a raw factor-score sum.

export const PROB_STRONG = 0.70; // ≥ 70% calibrated probability
export const PROB_LEAN   = 0.62; // ≥ 62% calibrated probability
export const PROB_FLOOR  = 0.58; // hard floor; anything less is "Pass"

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

// Narrative tiers (displayed text). These map from the same probability
// thresholds so NHL / MLB / NBA / UFC narrators never disagree.
export function tierLabel(calibratedProb: number): "Strong" | "Lean" | "Marginal" | "Pass" {
  if (calibratedProb >= PROB_STRONG) return "Strong";
  if (calibratedProb >= PROB_LEAN)   return "Lean";
  if (calibratedProb >= PROB_FLOOR)  return "Marginal";
  return "Pass";
}
