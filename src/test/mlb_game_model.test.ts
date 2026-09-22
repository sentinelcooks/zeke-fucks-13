import { describe, it, expect } from "vitest";
import {
  buildMlbGameModel,
  scoreFromDiff,
  MLB_GROUP_BUDGET,
  MLB_GAME_MODEL_VERSION,
  type MlbGameModelInput,
  type MlbTeamModelInput,
} from "../../supabase/functions/_shared/mlb_game_model.ts";

/** A fully-populated team so tests can knock out one input at a time. */
function team(overrides: Partial<MlbTeamModelInput> = {}): MlbTeamModelInput {
  return {
    name: "Team A",
    runsPerGame: 4.5,
    ops: 0.72,
    battingAverage: 0.25,
    strikeoutRate: 0.22,
    walkRate: 0.08,
    gamesPlayed: 140,
    splitVsPitcherHand: { hand: "R", plateAppearances: 900, strikeoutRate: 0.22, walkRate: 0.08, ops: 0.72 },
    lineupConfirmed: true,
    starterName: "Starter",
    starterHand: "R",
    starterEra: 3.8,
    starterWhip: 1.2,
    starterK9: 8.5,
    starterBb9: 2.8,
    starterH9: 8.2,
    starterInningsPitched: 150,
    starterRecentEra: 3.7,
    starterRecentWhip: 1.18,
    starterRecentK9: 8.6,
    starterAvgOutsLast3: 17,
    starterDaysRest: 5,
    starterPitchesLastStart: 95,
    starterAvgPitchesLast3: 94,
    pitchMixWhiffEdge: 0.01,
    bullpenEra: 4.0,
    bullpenFreshness: 70,
    bullpenTaxedCount: 1,
    bullpenPitchesLastTwoDays: 120,
    isHome: false,
    ...overrides,
  };
}

function game(overrides: Partial<MlbGameModelInput> = {}): MlbGameModelInput {
  return {
    market: "moneyline",
    team1: team({ name: "Team A", isHome: true }),
    team2: team({ name: "Team B", isHome: false }),
    parkRunFactor: 1.0,
    temperatureF: 72,
    windMph: 6,
    windDirection: "out to center",
    roofType: "open",
    ...overrides,
  };
}

describe("scoreFromDiff", () => {
  it("is neutral at zero difference", () => {
    expect(scoreFromDiff(0, 10)).toBe(50);
  });

  it("clamps so no single factor can express certainty", () => {
    expect(scoreFromDiff(1000, 50)).toBe(90);
    expect(scoreFromDiff(-1000, 50)).toBe(10);
  });

  it("falls back to neutral for any non-finite difference", () => {
    // A non-finite differential means the inputs were bad, not that one side is
    // infinitely better — so it must resolve to neutral rather than max out.
    expect(scoreFromDiff(NaN, 10)).toBe(50);
    expect(scoreFromDiff(Infinity, 10)).toBe(50);
    expect(scoreFromDiff(-Infinity, 10)).toBe(50);
  });
});

describe("buildMlbGameModel — structure", () => {
  it("produces a large factor set from full inputs", () => {
    const result = buildMlbGameModel(game())!;
    expect(result).not.toBeNull();
    // 29 defined factors; home_field only scores for one side and roof only
    // when indoors, so a full open-air game lands in the high 20s.
    expect(result.factors.length).toBeGreaterThanOrEqual(25);
  });

  it("stamps an immutable model version and never claims a probability", () => {
    const result = buildMlbGameModel(game())!;
    expect(result.modelVersion).toBe(MLB_GAME_MODEL_VERSION);
    expect(result.scoreKind).toBe("heuristic_score");
  });

  it("gives every factor a label, detail, group and weight", () => {
    const result = buildMlbGameModel(game())!;
    for (const f of result.factors) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.detail.length).toBeGreaterThan(0);
      expect(f.weight).toBeGreaterThanOrEqual(0);
      expect(["offense", "starter", "bullpen", "environment"]).toContain(f.group);
    }
  });

  it("keeps team1Score and team2Score complementary", () => {
    const result = buildMlbGameModel(game())!;
    for (const f of result.factors) {
      expect(f.team1Score + f.team2Score).toBe(100);
    }
  });

  it("is deterministic", () => {
    const a = buildMlbGameModel(game())!;
    const b = buildMlbGameModel(game())!;
    expect(a.team1Score).toBe(b.team1Score);
    expect(a.factors.map((f) => f.weight)).toEqual(b.factors.map((f) => f.weight));
  });
});

describe("buildMlbGameModel — weighting discipline", () => {
  it("respects the group budgets so no group can out-vote its share", () => {
    const result = buildMlbGameModel(game())!;
    for (const group of ["offense", "starter", "bullpen", "environment"] as const) {
      const groupWeight = result.factors
        .filter((f) => f.group === group)
        .reduce((sum, f) => sum + f.weight, 0);
      // Within rounding tolerance of the declared budget.
      expect(groupWeight).toBeLessThanOrEqual(MLB_GROUP_BUDGET[group] + 0.5);
    }
  });

  it("renormalises a group's budget when some of its factors are missing", () => {
    const stripped = game({
      team1: team({ name: "A", isHome: true, bullpenFreshness: null, bullpenTaxedCount: null, bullpenPitchesLastTwoDays: null }),
      team2: team({ name: "B", bullpenFreshness: null, bullpenTaxedCount: null, bullpenPitchesLastTwoDays: null }),
    });
    const result = buildMlbGameModel(stripped)!;
    const bullpen = result.factors.filter((f) => f.group === "bullpen");
    // Only bullpen ERA survived, so it should now carry the whole budget.
    expect(bullpen).toHaveLength(1);
    expect(bullpen[0].weight).toBeCloseTo(MLB_GROUP_BUDGET.bullpen, 1);
  });

  it("drops a factor rather than defaulting it to neutral", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, starterEra: null }),
      team2: team({ name: "B", starterEra: null }),
    }))!;
    expect(result.factors.find((f) => f.key === "starter_era")).toBeUndefined();
    expect(result.missingInputs).toContain("starter_era");
  });

  it("does not score a one-sided input", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, starterK9: 12 }),
      team2: team({ name: "B", starterK9: null }),
    }))!;
    expect(result.factors.find((f) => f.key === "starter_k9")).toBeUndefined();
    expect(result.missingInputs).toContain("starter_k9");
  });

  it("reports data coverage below 1 when a whole group is absent", () => {
    const noBullpen = {
      bullpenEra: null, bullpenFreshness: null,
      bullpenTaxedCount: null, bullpenPitchesLastTwoDays: null,
    };
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, ...noBullpen }),
      team2: team({ name: "B", ...noBullpen }),
    }))!;
    expect(result.dataCoverage).toBeLessThan(1);
  });
});

describe("buildMlbGameModel — directional correctness", () => {
  it("favours the better offence, but will not call a lean on offence alone", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, runsPerGame: 5.6, ops: 0.79 }),
      team2: team({ name: "B", runsPerGame: 3.5, ops: 0.66 }),
    }))!;
    expect(result.team1Score).toBeGreaterThan(50);
    // Offence is only 34% of the budget. With identical pitching on both sides
    // a big offensive edge should tilt the score without reaching a lean —
    // that restraint is the point of the group budgets.
    expect(result.verdict).toBe("RISKY");
  });

  it("calls a lean when a team is better across every group", () => {
    const result = buildMlbGameModel(game({
      team1: team({
        name: "A", isHome: true,
        runsPerGame: 5.6, ops: 0.79, battingAverage: 0.272, strikeoutRate: 0.17, walkRate: 0.11,
        starterEra: 2.4, starterWhip: 1.0, starterK9: 10.8, starterBb9: 1.9, starterH9: 6.8,
        starterRecentEra: 2.2, starterRecentWhip: 0.98, starterRecentK9: 11.1,
        bullpenEra: 3.0, bullpenFreshness: 90, bullpenTaxedCount: 0, bullpenPitchesLastTwoDays: 40,
      }),
      team2: team({
        name: "B",
        runsPerGame: 3.5, ops: 0.66, battingAverage: 0.229, strikeoutRate: 0.28, walkRate: 0.06,
        starterEra: 5.6, starterWhip: 1.55, starterK9: 6.1, starterBb9: 4.2, starterH9: 10.1,
        starterRecentEra: 6.0, starterRecentWhip: 1.62, starterRecentK9: 5.8,
        bullpenEra: 5.1, bullpenFreshness: 35, bullpenTaxedCount: 3, bullpenPitchesLastTwoDays: 190,
      }),
    }))!;
    expect(result.team1Score).toBeGreaterThanOrEqual(58);
    expect(result.verdict).toBe("LEAN A");
  });

  it("favours the better starter (lower ERA wins)", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, starterEra: 2.1, starterWhip: 0.95, starterRecentEra: 2.0 }),
      team2: team({ name: "B", starterEra: 5.9, starterWhip: 1.6, starterRecentEra: 6.1 }),
    }))!;
    expect(result.team1Score).toBeGreaterThan(50);
  });

  it("treats a lower lineup strikeout rate as better", () => {
    const hi = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, strikeoutRate: 0.30 }),
      team2: team({ name: "B", strikeoutRate: 0.16 }),
    }))!;
    const kFactor = hi.factors.find((f) => f.key === "team_k_rate")!;
    expect(kFactor.team1Score).toBeLessThan(50);
  });

  it("penalises a starter on short rest", () => {
    const short = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, starterDaysRest: 3 }),
      team2: team({ name: "B", starterDaysRest: 5 }),
    }))!;
    const rest = short.factors.find((f) => f.key === "starter_rest")!;
    expect(rest.team1Score).toBeLessThan(50);
  });

  it("penalises a taxed bullpen", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, bullpenTaxedCount: 4 }),
      team2: team({ name: "B", bullpenTaxedCount: 0 }),
    }))!;
    expect(result.factors.find((f) => f.key === "bullpen_taxed")!.team1Score).toBeLessThan(50);
  });

  it("gives the home side the home-field factor", () => {
    const result = buildMlbGameModel(game())!;
    const home = result.factors.find((f) => f.key === "home_field")!;
    expect(home.team1Score).toBe(54);
  });

  it("is symmetric — swapping the teams mirrors the score", () => {
    const a = buildMlbGameModel(game({
      team1: team({ name: "A", runsPerGame: 5.4, isHome: false }),
      team2: team({ name: "B", runsPerGame: 3.9, isHome: false }),
    }))!;
    const b = buildMlbGameModel(game({
      team1: team({ name: "B", runsPerGame: 3.9, isHome: false }),
      team2: team({ name: "A", runsPerGame: 5.4, isHome: false }),
    }))!;
    expect(a.team1Score + b.team1Score).toBe(100);
  });

  it("stays neutral when the two sides are identical", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: false }),
      team2: team({ name: "B", isHome: false }),
    }))!;
    expect(result.team1Score).toBeGreaterThanOrEqual(48);
    expect(result.team1Score).toBeLessThanOrEqual(52);
    expect(result.verdict).toBe("RISKY");
  });
});

describe("buildMlbGameModel — environment", () => {
  it("amplifies the stronger offence in a hitter's park", () => {
    const base = { team1: team({ name: "A", runsPerGame: 5.5, isHome: true }), team2: team({ name: "B", runsPerGame: 3.8 }) };
    const hitters = buildMlbGameModel(game({ ...base, parkRunFactor: 1.25 }))!;
    const pitchers = buildMlbGameModel(game({ ...base, parkRunFactor: 0.8 }))!;
    const hp = hitters.factors.find((f) => f.key === "park_factor")!;
    const pp = pitchers.factors.find((f) => f.key === "park_factor")!;
    expect(hp.team1Score).toBeGreaterThan(pp.team1Score);
  });

  it("neutralises weather under a closed roof", () => {
    const result = buildMlbGameModel(game({ roofType: "Dome", temperatureF: 95, windMph: 20 }))!;
    expect(result.factors.find((f) => f.key === "roof")).toBeDefined();
    expect(result.factors.find((f) => f.key === "temperature")).toBeUndefined();
    expect(result.factors.find((f) => f.key === "wind")).toBeUndefined();
  });

  it("ignores wind with no usable direction", () => {
    const result = buildMlbGameModel(game({ windDirection: "variable" }))!;
    expect(result.factors.find((f) => f.key === "wind")).toBeUndefined();
    expect(result.missingInputs).toContain("wind");
  });

  it("flags a small season sample", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, gamesPlayed: 12 }),
      team2: team({ name: "B", gamesPlayed: 14 }),
    }))!;
    const sample = result.factors.find((f) => f.key === "sample_size")!;
    expect(sample.detail).toContain("Small sample");
    // It records context but must not tilt the score.
    expect(sample.weight).toBe(0);
  });
});

describe("buildMlbGameModel — spread market", () => {
  it("requires a spread line", () => {
    expect(buildMlbGameModel(game({ market: "spread", team1Spread: null }))).toBeNull();
  });

  it("rates a favourite better when the projected margin clears the number", () => {
    const strong = { team1: team({ name: "A", runsPerGame: 6.2, isHome: true }), team2: team({ name: "B", runsPerGame: 3.2 }) };
    const easy = buildMlbGameModel(game({ ...strong, market: "spread", team1Spread: -1.5 }))!;
    const hard = buildMlbGameModel(game({ ...strong, market: "spread", team1Spread: -4.5 }))!;
    expect(easy.team1Score).toBeGreaterThan(hard.team1Score);
  });

  it("returns a projected margin on the moneyline market too", () => {
    const result = buildMlbGameModel(game())!;
    expect(typeof result.predictedMargin).toBe("number");
  });
});

describe("buildMlbGameModel — degraded input", () => {
  it("returns null when neither side has run production", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", runsPerGame: null, ops: null, battingAverage: null, strikeoutRate: null, walkRate: null,
        splitVsPitcherHand: null, starterEra: null, starterWhip: null, starterK9: null, starterBb9: null, starterH9: null,
        starterRecentEra: null, starterRecentWhip: null, starterRecentK9: null, starterAvgOutsLast3: null,
        starterDaysRest: null, starterPitchesLastStart: null, starterAvgPitchesLast3: null, pitchMixWhiffEdge: null,
        bullpenEra: null, bullpenFreshness: null, bullpenTaxedCount: null, bullpenPitchesLastTwoDays: null,
        gamesPlayed: null, isHome: false }),
      team2: team({ name: "B", runsPerGame: null, ops: null, battingAverage: null, strikeoutRate: null, walkRate: null,
        splitVsPitcherHand: null, starterEra: null, starterWhip: null, starterK9: null, starterBb9: null, starterH9: null,
        starterRecentEra: null, starterRecentWhip: null, starterRecentK9: null, starterAvgOutsLast3: null,
        starterDaysRest: null, starterPitchesLastStart: null, starterAvgPitchesLast3: null, pitchMixWhiffEdge: null,
        bullpenEra: null, bullpenFreshness: null, bullpenTaxedCount: null, bullpenPitchesLastTwoDays: null,
        gamesPlayed: null, isHome: false }),
      parkRunFactor: null, temperatureF: null, windMph: null, windDirection: null, roofType: null,
    }));
    expect(result).toBeNull();
  });

  it("ignores a platoon split built on too few plate appearances", () => {
    const result = buildMlbGameModel(game({
      team1: team({ name: "A", isHome: true, splitVsPitcherHand: { hand: "L", plateAppearances: 11, strikeoutRate: 0.1, walkRate: 0.1, ops: 1.4 } }),
      team2: team({ name: "B" }),
    }))!;
    expect(result.factors.find((f) => f.key === "platoon_ops")).toBeUndefined();
    expect(result.missingInputs).toContain("platoon_ops");
  });

  it("still scores with only run production available", () => {
    const bare = (name: string, rpg: number): MlbTeamModelInput => ({ name, runsPerGame: rpg });
    const result = buildMlbGameModel({
      market: "moneyline",
      team1: bare("A", 5.5),
      team2: bare("B", 3.9),
    })!;
    expect(result).not.toBeNull();
    expect(result.team1Score).toBeGreaterThan(50);
    expect(result.dataCoverage).toBeLessThan(0.5);
  });
});
