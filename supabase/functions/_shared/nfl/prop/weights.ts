/**
 * NFL PLAYER PROP EDGE ENGINE — model version, priors and distribution params.
 *
 * Fully separate from the game engine's weights. Dispersion / per-unit spread
 * parameters are fit by `node scripts/nfl/backtest-prop.ts --write-weights`
 * into `weights_fitted.ts`; the priors below are documented football baselines
 * used for shrinkage (not fit, deliberately conservative).
 */

export const NFL_PROP_MODEL_VERSION = "nfl-prop-edge-v1";

export type NflPropType =
  | "pass_yds" | "pass_att" | "pass_cmp" | "pass_tds" | "pass_ints"
  | "rush_yds" | "rush_att"
  | "rec_yds" | "receptions" | "targets"
  | "anytime_td"
  | "fg_made" | "xp_made" | "kicking_points";

export const PROP_TYPES_BY_POSITION: Record<string, NflPropType[]> = {
  QB: ["pass_yds", "pass_att", "pass_cmp", "pass_tds", "pass_ints", "rush_yds", "rush_att"],
  RB: ["rush_yds", "rush_att", "rec_yds", "receptions", "targets", "anytime_td"],
  FB: ["rush_yds", "rush_att", "rec_yds", "receptions", "targets", "anytime_td"],
  WR: ["rec_yds", "receptions", "targets", "anytime_td"],
  TE: ["rec_yds", "receptions", "targets", "anytime_td"],
  K: ["fg_made", "xp_made", "kicking_points"],
};

/**
 * Sample-window blend for rolling features (renormalised when a window is
 * empty). Deliberately NOT "season average": recent role carries the most
 * weight, last season is a low-weight prior.
 */
export const BLEND = { last3: 0.3, last5: 0.25, season: 0.3, prior: 0.15 } as const;

/** Position priors used for shrinkage (league-typical per-opportunity rates). */
export const POSITION_PRIORS = {
  catch_rate: { WR: 0.63, TE: 0.7, RB: 0.77, FB: 0.75, QB: 0.5 } as Record<string, number>,
  yards_per_target: { WR: 8.3, TE: 7.3, RB: 5.9, FB: 5.5, QB: 5 } as Record<string, number>,
  yards_per_carry: { RB: 4.3, FB: 3.5, QB: 5.2, WR: 6.5, TE: 4 } as Record<string, number>,
  rec_td_per_target: { WR: 0.045, TE: 0.055, RB: 0.03, FB: 0.05, QB: 0 } as Record<string, number>,
  rush_td_per_carry: { RB: 0.028, FB: 0.06, QB: 0.035, WR: 0.03, TE: 0.03 } as Record<string, number>,
  completion_pct: 0.645,
  yards_per_attempt: 6.9,
  pass_td_per_att: 0.044,
  int_per_att: 0.023,
  fg_pct: 0.85,
  xp_pct: 0.95,
} as const;

/** Pseudo-sample sizes for shrinkage (in opportunities). */
export const SHRINK = {
  catch_rate: 30,
  yards_per_target: 40,
  yards_per_carry: 60,
  rec_td: 80,
  rush_td: 80,
  completion_pct: 150,
  yards_per_attempt: 200,
  pass_td: 250,
  int: 300,
  fg_pct: 30,
  share_games: 2, // games of position-typical share mixed into usage shares
} as const;

/** Distribution parameters (overwritten by the fitted file when present). */
export interface PropDistributionParams {
  /** Negative-binomial dispersion r per count stat (Var = μ + μ²/r). */
  dispersion: Record<"targets" | "carries" | "pass_att" | "qb_carries", number>;
  /** Per-unit gain SD as a multiple of the per-unit mean (yards per reception / carry / completion). */
  per_unit_cv: Record<"rec" | "rush" | "pass", number>;
  /**
   * QB early-exit mixture: with probability `prob` the starter plays only
   * `fraction` of a normal game (injury, blowout benching). Without it a single
   * negative binomial is simultaneously too wide in the body and too thin in
   * the left tail (seen in the PIT histogram).
   */
  qb_early_exit: { prob: number; fraction: number };
  /**
   * Mean calibration fit on TRAIN seasons (Σ actual / Σ projected). Corrects
   * systematic level bias in the opportunity and efficiency layers without
   * touching the matchup structure. 1 = no correction.
   */
  scale: Record<
    "targets" | "catch" | "carries" | "qb_carries" | "pass_att" | "cmp" | "ypr" | "ypc" | "ypcmp" | "pass_td" | "int" | "td" | "fg" | "xp",
    number
  >;
}

export interface PropModelWeights {
  version: string;
  params: PropDistributionParams;
  /** Out-of-sample distribution calibration evidence per prop type (from backtest). */
  calibration: Partial<Record<NflPropType, { pit_ece: number; over_ece: number; n: number; mae: number }>>;
  trained_on: string;
  fitted_at: string;
}

export const DEFAULT_PROP_PARAMS: PropDistributionParams = {
  dispersion: { targets: 6, carries: 8, pass_att: 30, qb_carries: 3 },
  per_unit_cv: { rec: 1.05, rush: 1.6, pass: 0.95 },
  qb_early_exit: { prob: 0, fraction: 0.35 },
  scale: {
    targets: 1, catch: 1, carries: 1, qb_carries: 1, pass_att: 1, cmp: 1,
    ypr: 1, ypc: 1, ypcmp: 1, pass_td: 1, int: 1, td: 1, fg: 1, xp: 1,
  },
};

/**
 * `prop_confidence` component weights (sum = 1). Independent of the game
 * engine's `game_confidence`; the two are never averaged or combined.
 */
export const PROP_CONFIDENCE_WEIGHTS = {
  probability: 0.1,
  edge: 0.2,
  data_quality: 0.15,
  stability: 0.12,
  injury_certainty: 0.1,
  liquidity: 0.08,
  agreement: 0.1,
  calibration: 0.15,
} as const;

/** Assumed hold for one-sided markets (anytime TD "yes" only) when devigging. */
export const ONE_SIDED_ASSUMED_HOLD = 0.07;
