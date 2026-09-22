import { describe, expect, it } from "vitest";
import type { NflGameRow, NflPlayerWeekRow, NflTeamWeekRow } from "../../supabase/functions/_shared/nfl/data/types";
import { buildGameFeatures } from "../../supabase/functions/_shared/nfl/game/features";
import { calculate_nfl_game_edge } from "../../supabase/functions/_shared/nfl/game/index";
import { NFL_GAME_FITTED_WEIGHTS } from "../../supabase/functions/_shared/nfl/game/weights_fitted";
import { gameGateFailures, resolveGameGates } from "../../supabase/functions/_shared/nfl/game/gates";
import { calculate_nfl_player_prop_edge, type PropMarket } from "../../supabase/functions/_shared/nfl/prop/index";
import { NFL_PROP_FITTED_WEIGHTS } from "../../supabase/functions/_shared/nfl/prop/weights_fitted";
import { propGateFailures, resolvePropGates } from "../../supabase/functions/_shared/nfl/prop/gates";
import { aggregatePositionAllowed } from "../../supabase/functions/_shared/nfl/data/position_allowed";

// ─── Synthetic league ─────────────────────────────────────────────────────

const TEAMS = ["KC", "BUF", "DAL", "PHI"];

function teamWeek(season: number, week: number, team: string, opponent: string, strength: number, isHome: boolean): NflTeamWeekRow {
  const plays = 62;
  const epa = 0.05 * strength;
  return {
    season, week, game_id: `${season}_${week}_${[team, opponent].sort().join("_")}`, team, opponent, is_home: isHome,
    points_for: 22 + 4 * strength, points_against: 22 - 4 * strength,
    off_plays: plays, off_epa_sum: epa * plays, off_success: 0.44 * plays, off_dropbacks: 37,
    off_dropback_epa_sum: epa * 37, off_dropback_success: 17, off_rushes: 25, off_rush_epa_sum: (epa - 0.1) * 25,
    off_rush_success: 10, off_explosive_pass: 3, off_explosive_rush: 3, off_sacks: 2, off_qb_hits: 7,
    off_pressured_dropbacks: 7, off_pressured_epa_sum: -7, off_interceptions: 1, off_fumbles: 1, off_fumbles_lost: 0.5,
    off_drives: 11, off_drive_points: 22 + 4 * strength, off_rz_drives: 3, off_rz_td_drives: 2, off_neutral_plays: 40,
    off_neutral_dropbacks: 22, off_pass_oe_sum: 0, off_pass_oe_n: 50, off_cpoe_sum: 0, off_cpoe_n: 34,
    off_qb_epa_sum: epa * 37, off_seconds_per_play_sum: 900, off_seconds_per_play_n: 30, off_fg_att: 2, off_fg_made: 1.7, off_td: 2.5,
    def_plays: plays, def_epa_sum: -epa * plays, def_success: 0.44 * plays, def_dropbacks: 37, def_dropback_epa_sum: -epa * 37,
    def_dropback_success: 17, def_rushes: 25, def_rush_epa_sum: -0.1 * 25, def_rush_success: 10, def_explosive_pass: 3,
    def_explosive_rush: 3, def_sacks: 2, def_qb_hits: 7, def_interceptions: 1, def_fumbles_forced: 1, def_fumbles_recovered: 0.5,
    def_drives: 11, def_drive_points: 22 - 4 * strength, def_rz_drives: 3, def_rz_td_drives: 2,
  };
}

const STRENGTH: Record<string, number> = { KC: 1, BUF: 0.5, DAL: -0.5, PHI: -1 };
const teamWeeks: NflTeamWeekRow[] = [];
for (const season of [2025, 2026]) {
  for (let week = 1; week <= (season === 2025 ? 17 : 4); week++) {
    const [a, b, c, d] = week % 2 ? TEAMS : [TEAMS[0], TEAMS[2], TEAMS[1], TEAMS[3]];
    for (const [h, v] of [[a, b], [c, d]]) {
      teamWeeks.push(teamWeek(season, week, h, v, STRENGTH[h] - STRENGTH[v], true));
      teamWeeks.push(teamWeek(season, week, v, h, STRENGTH[v] - STRENGTH[h], false));
    }
  }
}

const game: NflGameRow = {
  game_id: "2026_03_PHI_KC", season: 2026, game_type: "REG", week: 3, gameday: "2026-09-20", gametime: "16:25",
  kickoff: "2026-09-20T20:25:00Z", home_team: "KC", away_team: "PHI", home_score: null, away_score: null,
  location: "Home", roof: "outdoors", surface: "grass", temp: 70, wind: 5, home_rest: 7, away_rest: 7, div_game: false,
  home_coach: null, away_coach: null, home_qb_id: null, away_qb_id: null, stadium_id: null,
  spread_line: null, total_line: null, home_moneyline: null, away_moneyline: null, home_spread_odds: null,
  away_spread_odds: null, over_odds: null, under_odds: null,
};

const quote = (line: number | null, a: number, b: number) => ({
  current: { line, price_a: a, price_b: b }, opening: null,
  best_price_a: null, best_book_a: null, best_price_b: null, best_book_b: null, books: 6, snapshot_at: null,
});

describe("NFL Game Edge engine", () => {
  const input = {
    game, teamWeeks, playerWeeks: [], injuries: [],
    weather: { temp: 70, wind: 5, precip_prob: null, roof: "outdoors", source: "forecast" as const },
    movement: null,
  };

  it("drops same-week and future rows (leakage guard)", () => {
    const fv = buildGameFeatures(input);
    expect(fv.diagnostics.leakage_rows_dropped).toBeGreaterThan(0);
    const future = teamWeeks.map((r) => (r.season === 2026 && r.week >= 3 ? { ...r, off_epa_sum: 999 } : r));
    const fv2 = buildGameFeatures({ ...input, teamWeeks: future });
    expect(fv2.side).toEqual(fv.side);
  });

  it("returns ML, spread and total with separate projections and every required field", () => {
    const out = calculate_nfl_game_edge({
      features: input,
      weights: NFL_GAME_FITTED_WEIGHTS,
      markets: { moneyline: quote(null, -200, 170), spread: quote(-4.5, -110, -110), total: quote(46.5, -110, -110) },
    });
    expect(out.results.map((r) => r.market_type).sort()).toEqual(["moneyline", "moneyline", "spread", "spread", "total", "total"]);
    expect(out.projections.projected_margin).toBeGreaterThan(0); // stronger home team
    for (const r of out.results) {
      for (const k of ["market_type", "selection", "model_probability", "market_probability", "no_vig_probability", "fair_price",
        "market_price", "edge_percentage", "expected_value", "confidence", "projected_score", "projected_margin",
        "projected_total", "model_version", "timestamp"]) {
        expect(r).toHaveProperty(k);
      }
      expect(r.model_version).toMatch(/^nfl-game-edge-/);
    }
    const ml = out.results.filter((r) => r.market_type === "moneyline");
    expect(ml[0].model_probability + ml[1].model_probability).toBeCloseTo(1, 6);
    expect(ml[0].no_vig_probability + ml[1].no_vig_probability).toBeCloseTo(1, 6);
  });

  it("handles pushes on whole-number spreads", () => {
    const out = calculate_nfl_game_edge({
      features: input, weights: NFL_GAME_FITTED_WEIGHTS, markets: { spread: quote(-3, -110, -110) },
    });
    const home = out.results.find((r) => r.side === "home")!;
    expect(home.push_probability).toBeGreaterThan(0.03); // 3 is a key number
  });

  it("is NO PLAY while the backtest shows no profitable threshold (v1)", () => {
    const out = calculate_nfl_game_edge({
      features: input, weights: NFL_GAME_FITTED_WEIGHTS,
      markets: { moneyline: quote(null, 300, -400) }, // wildly mispriced vs the model
    });
    expect(out.results.every((r) => r.status === "NO PLAY")).toBe(true);
    expect(out.results[0].no_play_reasons.join(" ")).toMatch(/not proven profitable/);
  });

  it("a pick blocked ONLY by the proof gate is a shadow pick; proven forward test publishes it", () => {
    const g = resolveGameGates(null);
    const ok = { edge: 0.05, expected_value: 0.04, confidence: 70, data_quality: 0.8, market_price: -110, major_injury_uncertainty: false, evidence: null };
    const unproven = gameGateFailures(ok, g);
    expect(unproven).toHaveLength(1);
    expect(unproven[0].startsWith("unproven:")).toBe(true);
    // Forward test short of the rule (too few bets / no CLV) stays unproven.
    expect(gameGateFailures({ ...ok, forward: { bets: 90, roi: 0.08, avg_clv: 0.01 } }, g)).toHaveLength(1);
    expect(gameGateFailures({ ...ok, forward: { bets: 200, roi: 0.03, avg_clv: -0.002 } }, g)).toHaveLength(1);
    // Meets NFL_PROMOTION_RULE → publishable.
    expect(gameGateFailures({ ...ok, forward: { bets: 200, roi: 0.03, avg_clv: 0.004 } }, g)).toEqual([]);
  });

  it("gates on edge, confidence, data quality and injuries", () => {
    const g = resolveGameGates({ respect_backtest_evidence: false });
    const ok = { edge: 0.05, expected_value: 0.04, confidence: 70, data_quality: 0.8, market_price: -110, major_injury_uncertainty: false, evidence: undefined };
    expect(gameGateFailures(ok, g)).toEqual([]);
    expect(gameGateFailures({ ...ok, edge: 0.01 }, g).length).toBe(1);
    expect(gameGateFailures({ ...ok, confidence: 40 }, g).length).toBe(1);
    expect(gameGateFailures({ ...ok, data_quality: 0.3 }, g).length).toBe(1);
    expect(gameGateFailures({ ...ok, major_injury_uncertainty: true }, g).length).toBe(1);
    expect(gameGateFailures({ ...ok, edge: 0.25, expected_value: 0.4 }, g).join()).toMatch(/implausibly large/);
  });
});

// ─── Player props ────────────────────────────────────────────────────────

function wrRow(season: number, week: number, targets: number, yards: number): NflPlayerWeekRow {
  return {
    season, week, game_id: `${season}_${week}`, player_id: "WR1", player_name: "Test Receiver", position: "WR",
    team: "KC", opponent: week % 2 ? "BUF" : "DAL", is_home: true, offense_snaps: 55, offense_pct: 0.88,
    team_offense_snaps: 62, routes: null, targets, rz_targets: 1, air_yards: targets * 10, target_share: targets / 34,
    air_yards_share: 0.3, carries: 0, rz_carries: 0, gl_carries: 0, team_carries: 25, team_dropbacks: 37,
    receptions: Math.round(targets * 0.65), receiving_yards: yards, receiving_tds: week % 3 === 0 ? 1 : 0,
    rushing_yards: 0, rushing_tds: 0, pass_attempts: 0, completions: 0, passing_yards: 0, passing_tds: 0,
    interceptions: 0, sacks_taken: 0, passing_epa: null, passing_cpoe: null, rushing_epa: null, receiving_epa: 1,
    fg_made: 0, fg_att: 0, fg_made_40_plus: 0, fg_att_40_plus: 0, pat_made: 0, pat_att: 0,
  };
}

const wrRows = [
  ...Array.from({ length: 17 }, (_, i) => wrRow(2025, i + 1, 8, 72)),
  wrRow(2026, 1, 10, 95), wrRow(2026, 2, 9, 88),
  wrRow(2026, 3, 30, 400), // same-week row — must be ignored
];

const propInput = {
  player: { player_id: "WR1", player_name: "Test Receiver", position: "WR", team: "KC" },
  game: {
    game_id: "2026_03_PHI_KC", season: 2026, week: 3, team: "KC", opponent: "PHI", is_home: true,
    roof: "outdoors", temp: 70, wind: 5, precip_prob: null, weather_source: "forecast" as const, team_rest: 7, opp_rest: 7,
  },
  market_context: { team_spread: -6.5, game_total: 49.5 },
  teamPlayerRows: wrRows,
  playerRows: wrRows,
  teamWeeks,
  positionAllowed: aggregatePositionAllowed(wrRows),
  injuries: [],
};

const propMarket = (line: number, over: number | null, under: number | null): PropMarket => ({
  line, over_price: over, under_price: under, best_over_price: null, best_over_book: null,
  best_under_price: null, best_under_book: null, opening_line: line - 2, opening_over_price: -110,
  opening_under_price: -110, books: 5,
});

describe("NFL Player Prop Edge engine", () => {
  it("builds a matchup projection (not the season average) with a full distribution", () => {
    const out = calculate_nfl_player_prop_edge({
      features: propInput, prop_type: "rec_yds", line: 67.5, market: propMarket(67.5, -115, -105), weights: NFL_PROP_FITTED_WEIGHTS,
    });
    const over = out.results.find((r) => r.side === "over")!;
    expect(over.projection).not.toBeCloseTo(72, 0); // not the prior-season average
    expect(over.median_projection).toBeLessThanOrEqual(over.projection + 1); // right skew
    expect(over.p10).toBeLessThan(over.median_projection);
    expect(over.p90).toBeGreaterThan(over.median_projection);
    expect(over.over_probability + over.under_probability + over.push_probability).toBeCloseTo(1, 6);
    expect(over.distribution).toMatch(/gamma/);
    expect(over.factors).toHaveLength(33);
    expect(over.line_movement).toBe(2);
    expect(over.model_version).toMatch(/^nfl-prop-edge-/);
  });

  it("ignores same-week rows (leakage guard)", () => {
    const out = calculate_nfl_player_prop_edge({ features: propInput, prop_type: "targets", line: 8.5, market: null, weights: NFL_PROP_FITTED_WEIGHTS });
    expect(out.features.usage.games_current).toBe(2);
    expect(out.features.diagnostics.leakage_rows_dropped).toBeGreaterThan(0);
  });

  it("uses count distributions for count stats and reports push on whole lines", () => {
    const out = calculate_nfl_player_prop_edge({
      features: propInput, prop_type: "receptions", line: 6, market: propMarket(6, -110, -110), weights: NFL_PROP_FITTED_WEIGHTS,
    });
    expect(out.results[0].distribution).toMatch(/negative_binomial/);
    expect(out.results[0].push_probability).toBeGreaterThan(0);
  });

  it("is NO PLAY without a price and when the player is Out", () => {
    const noPrice = calculate_nfl_player_prop_edge({ features: propInput, prop_type: "targets", line: 8.5, market: null, weights: NFL_PROP_FITTED_WEIGHTS });
    expect(noPrice.results.every((r) => r.status === "NO PLAY")).toBe(true);
    const out = calculate_nfl_player_prop_edge({
      features: { ...propInput, injuries: [{ season: 2026, week: 3, team: "KC", player_id: "WR1", player_name: "Test Receiver", position: "WR", report_status: "Out", practice_status: null, report_primary_injury: "Ankle" }] },
      prop_type: "rec_yds", line: 67.5, market: propMarket(67.5, -110, -110), weights: NFL_PROP_FITTED_WEIGHTS,
    });
    expect(out.results.every((r) => r.status === "NO PLAY")).toBe(true);
    expect(out.results[0].projection).toBe(0);
  });

  it("prop gates: role stability, sample, questionable, negative track record", () => {
    const g = resolvePropGates(null);
    const proven = { bets: 180, roi: 0.04, avg_clv: 0.006 };
    const ok = { edge: 0.06, expected_value: 0.05, confidence: 70, market_price: -110, injury_status: null, role_cv: 0.1, check_role: true, sample_games: 10, evidence: proven };
    expect(propGateFailures(ok, g)).toEqual([]);
    // No forward-test proof → only the proof gate fails (shadow pick).
    const unproven = propGateFailures({ ...ok, evidence: null }, g);
    expect(unproven).toHaveLength(1);
    expect(unproven[0].startsWith("unproven:")).toBe(true);
    expect(propGateFailures({ ...ok, role_cv: 0.6 }, g).length).toBe(1);
    expect(propGateFailures({ ...ok, sample_games: 2 }, g).length).toBe(1);
    expect(propGateFailures({ ...ok, injury_status: "Questionable" }, g).length).toBe(1);
    expect(propGateFailures({ ...ok, evidence: { bets: 150, roi: -0.04, avg_clv: 0.01 } }, g).length).toBe(1);
    expect(propGateFailures({ ...ok, evidence: { bets: 40, roi: 0.2, avg_clv: 0.01 } }, g).length).toBe(1); // too small to prove
    expect(propGateFailures({ ...ok, edge: 0.3, expected_value: 0.5 }, g).join()).toMatch(/implausibly large/);
  });
});
