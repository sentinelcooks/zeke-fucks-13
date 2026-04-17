// ─────────────────────────────────────────────────────────────
// NHL Lines Model v2.0 — 26-factor weight tables
// EVERY bet_type lists ALL 26 factor slots explicitly via row().
// Factors set to 0 are excluded from that bet_type by design.
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

function row(overrides: Partial<Record<FactorName, number>>): WeightsTable {
  const out = {} as WeightsTable;
  for (const f of ALL_FACTORS) out[f] = overrides[f] ?? 0;
  return out;
}

export const WEIGHTS_V2: Record<string, WeightsTable> = {
  // ── MONEYLINE (sum = 1.00) ─────────────────────────────────
  // Excluded (=0): pace (totals only), goals_game/goals_allowed (subsumed by goals_blend / xg),
  // pp_pct/pk_pct (replaced by st_diff), goals_l5/goalie_l5 (replaced by blends),
  // public_pct (replaced by rlm), shooting_pct (de-emphasized for ML).
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
  }),

  // ── PUCKLINE (sum = 1.00) ─────────────────────────────────
  // Excluded: pace (totals), pp_pct/pk_pct (st_diff), goals_l5/goalie_l5,
  // blocks_hits, public_pct, backup_goalie, goals_game, shots_against, pts_l10.
  puckline: row({
    cf_proxy: 0.12,
    st_diff: 0.10,
    xg: 0.10,
    goals_allowed: 0.08,
    goalie_sv: 0.07,
    goals_blend: 0.06,
    momentum: 0.05,
    goalie_gaa: 0.05,
    hd_chances: 0.04,
    arena: 0.04,
    rlm: 0.04,
    line_movement: 0.04,
    rest_days: 0.04,
    goalie_l10: 0.04,
    goalie_workload: 0.04,
    home_away: 0.03,
    shooting_pct: 0.03,
    h2h: 0.03,
  }),

  // ── TOTAL (sum = 1.00) ────────────────────────────────────
  // Excluded: home_away, h2h, momentum, backup, hd_chances, blocks_hits,
  // pp_pct/pk_pct, goals_l5, goalie_l5, public_pct, goals_game, pts_l10, shots_against.
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
  // Excluded: arena, blocks_hits, hd_chances, backup, public_pct, gaa, goals_allowed,
  // goalie_l5, goals_l5, pk_pct, goalie_l10 (use opp_workload instead).
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

// Throw at module load — fail fast.
const _validationErrors = validateWeights(WEIGHTS_V2);
if (_validationErrors.length > 0) {
  throw new Error("NHL WEIGHTS_V2 validation failed:\n" + _validationErrors.join("\n"));
}

export const MODEL_VERSION = "v2.0";

export const FACTOR_LABELS: Record<string, string> = {
  goalie_sv: "Goalie Save %",
  goalie_gaa: "Goalie GAA",
  goalie_l5: "Goalie L5 SV%",
  goalie_l10: "Goalie L10 SV% (weighted)",
  backup_goalie: "Backup Goalie",
  shots_against: "Shots Against/Game",
  goals_game: "Goals/Game",
  shooting_pct: "Shooting %",
  pp_pct: "Power Play %",
  pk_pct: "Penalty Kill %",
  pts_l10: "Points/Game L10",
  goals_l5: "Goals L5",
  goals_blend: "Goals Blend (L5/L10/L20)",
  blocks_hits: "Blocks + Hits/Game",
  goals_allowed: "Goals Allowed/Game",
  hd_chances: "HD Chances Against",
  home_away: "Home/Away Record",
  rest_days: "Rest Days",
  momentum: "L5 Momentum",
  h2h: "Head-to-Head",
  line_movement: "Line Movement",
  public_pct: "Public %",
  xg: "Expected Goals (xG/60)",
  goalie_workload: "Goalie Workload (Last 7d)",
  st_diff: "Special Teams Differential",
  cf_proxy: "Possession (CF% proxy)",
  pace: "Pace (combined SAT/60)",
  arena: "Arena Factor",
  rlm: "Reverse Line Movement",
};
