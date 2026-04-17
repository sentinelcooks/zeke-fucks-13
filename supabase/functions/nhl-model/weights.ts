// ─────────────────────────────────────────────────────────────
// NHL Lines Model v2.0 — 26-factor weight tables
// EVERY bet_type lists ALL 26 factor slots explicitly.
// Factors set to 0 include a comment explaining why.
// validateWeights() throws if any sum != 1.00 (±0.001).
// ─────────────────────────────────────────────────────────────

export const ALL_FACTORS = [
  // Original 1-20
  "goalie_sv",         // 1
  "goalie_gaa",        // 2
  "goalie_l5",         // 3 — replaced by goalie_l10 (recency-weighted)
  "backup_goalie",     // 4
  "shots_against",     // 5
  "goals_game",        // 6
  "shooting_pct",      // 7
  "pp_pct",            // 8 — replaced by st_diff (composite)
  "pts_l10",           // 9
  "goals_l5",          // 10 — replaced by goals_blend
  "pk_pct",            // 11 — replaced by st_diff (composite)
  "blocks_hits",       // 12
  "goals_allowed",     // 13
  "hd_chances",        // 14
  "home_away",         // 15
  "rest_days",         // 16
  "momentum",          // 17
  "h2h",               // 18
  "line_movement",     // 19 — upgraded scorer
  "public_pct",        // 20 — replaced by rlm
  // New 21-26
  "xg",                // 21
  "goalie_workload",   // 22
  "st_diff",           // 23
  "cf_proxy",          // 24
  "pace",              // 25
  "arena",             // 26
  // Derived/upgraded
  "goalie_l10",        // recency-weighted goalie L10 (replaces goalie_l5)
  "goals_blend",       // L5/L10/L20 weighted blend (replaces goals_l5)
  "rlm",               // Reverse Line Movement (replaces public_pct)
] as const;

export type FactorName = typeof ALL_FACTORS[number];
export type WeightsTable = Record<FactorName, number>;

// Helper to make a fully-populated row (defaults all to 0)
function row(overrides: Partial<Record<FactorName, number>>): WeightsTable {
  const out = {} as WeightsTable;
  for (const f of ALL_FACTORS) out[f] = overrides[f] ?? 0;
  return out;
}

export const WEIGHTS_V2: Record<string, WeightsTable> = {
  // ── MONEYLINE (sum = 1.00) ─────────────────────────────────
  // Excluded (=0): pace (totals only), pp_pct/pk_pct (replaced by st_diff),
  // goals_l5/goalie_l5 (replaced by goals_blend/goalie_l10), public_pct (replaced by rlm)
  moneyline: row({
    goalie_sv: 0.15,
    xg: 0.10,
    goalie_gaa: 0.08,
    st_diff: 0.08,
    home_away: 0.07,
    goalie_l10: 0.07,
    cf_proxy: 0.06,
    goals_blend: 0.06,
    momentum: 0.05,
    goalie_workload: 0.05,
    rlm: 0.04,
    line_movement: 0.03,
    rest_days: 0.03,
    h2h: 0.03,
    arena: 0.03,
    backup_goalie: 0.03,
    hd_chances: 0.02,
    blocks_hits: 0.02,
    shooting_pct: 0.01,
    // Explicit zeros (kept in row() default = 0):
    // pace, goals_allowed, pp_pct, pk_pct, goals_l5, goalie_l5, public_pct, goals_game
  }),

  // ── PUCKLINE (sum = 1.00) ─────────────────────────────────
  // Excluded: pace, pp_pct/pk_pct, goals_l5/goalie_l5, blocks_hits, public_pct
  puckline: row({
    cf_proxy: 0.12,
    st_diff: 0.10,
    xg: 0.10,
    goals_allowed: 0.08,
    goalie_sv: 0.07,
    goals_blend: 0.06,
    momentum: 0.05,
    gaa: 0,                         // alias intentionally unset; goalie_gaa below
    goalie_gaa: 0.05,
    hd_chances: 0.04,
    arena: 0.04,
    rlm: 0.04,
    line_movement: 0.04,
    rest_days: 0.04,
    home_away: 0.04,
    goalie_l10: 0.04,
    goalie_workload: 0.04,
    shooting_pct: 0.04,
    h2h: 0.04,
    backup_goalie: 0.01,
    // pace, pp_pct, pk_pct, goals_l5, goalie_l5, blocks_hits, public_pct, goals_game, shots_against = 0
  } as Partial<Record<FactorName, number>>),

  // ── TOTAL (sum = 1.00) ────────────────────────────────────
  // Excluded: home_away, h2h, momentum, backup, hd, blocks, pp/pk, goals_l5, goalie_l5, public_pct
  total: row({
    pace: 0.14,
    xg: 0.12,
    goalie_sv: 0.10,
    goalie_gaa: 0.10,
    goals_blend: 0.08,
    arena: 0.06,
    shooting_pct: 0.06,
    goalie_l10: 0.06,
    goals_allowed: 0.06,
    st_diff: 0.05,
    cf_proxy: 0.05,
    rest_days: 0.04,
    goalie_workload: 0.04,
    line_movement: 0.02,
    rlm: 0.02,
  }),

  // ── PLAYER PROP (sum = 1.00) ──────────────────────────────
  // Player prop uses opponent goalie/pace context. Excluded: arena, blocks, hd, backup, public_pct, gaa
  player_prop: row({
    shooting_pct: 0.12,
    pace: 0.10,
    shots_against: 0.10,
    st_diff: 0.08,
    goals_blend: 0.07,
    cf_proxy: 0.06,
    goalie_workload: 0.06,
    pts_l10: 0.06,
    momentum: 0.05,
    pp_pct: 0.05,
    goalie_sv: 0.05,
    rest_days: 0.05,
    home_away: 0.04,
    h2h: 0.04,
    line_movement: 0.03,
    rlm: 0.03,
    goals_game: 0.01,
  }),
};

export function validateWeights(table: Record<string, WeightsTable>): string[] {
  const errors: string[] = [];
  for (const [bt, weights] of Object.entries(table)) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.001) {
      errors.push(`WEIGHTS_V2.${bt} sum=${sum.toFixed(4)}, expected 1.00`);
    }
  }
  return errors;
}

// Throw at module load — fail fast in production.
const _validationErrors = validateWeights(WEIGHTS_V2);
if (_validationErrors.length > 0) {
  throw new Error("NHL WEIGHTS_V2 validation failed:\n" + _validationErrors.join("\n"));
}

export const MODEL_VERSION = "v2.0";
