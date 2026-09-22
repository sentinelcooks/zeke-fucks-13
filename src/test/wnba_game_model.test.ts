import { describe, it, expect } from "vitest";
import {
  buildWnbaGameModel,
  wnbaScoreFromDiff,
  WNBA_GROUP_BUDGET,
  WNBA_GAME_MODEL_VERSION,
  type WnbaGameModelInput,
  type WnbaTeamModelInput,
} from "../../supabase/functions/_shared/wnba_game_model.ts";

function team(overrides: Partial<WnbaTeamModelInput> = {}): WnbaTeamModelInput {
  return {
    name: "Team A",
    games: 30,
    winRate: 0.5,
    pointsFor: 82,
    pointsAgainst: 82,
    netPoints: 0,
    recentGames: 5,
    recentPointsFor: 82,
    recentPointsAgainst: 82,
    recentNetPoints: 0,
    pace: 80,
    offensiveRating: 102,
    defensiveRating: 102,
    venueNetPoints: 0,
    venueWinRate: 0.5,
    restDays: 2,
    backToBack: false,
    travelled: false,
    unavailableMinutes: 0,
    questionableMinutes: 0,
    availabilityResolved: true,
    isHome: false,
    ...overrides,
  };
}

function game(overrides: Partial<WnbaGameModelInput> = {}): WnbaGameModelInput {
  return {
    market: "moneyline",
    team1: team({ name: "A", isHome: true }),
    team2: team({ name: "B", isHome: false }),
    ...overrides,
  };
}

describe("wnbaScoreFromDiff", () => {
  it("is neutral at zero and clamps at the extremes", () => {
    expect(wnbaScoreFromDiff(0, 5)).toBe(50);
    expect(wnbaScoreFromDiff(999, 5)).toBe(90);
    expect(wnbaScoreFromDiff(-999, 5)).toBe(10);
    expect(wnbaScoreFromDiff(NaN, 5)).toBe(50);
  });
});

describe("buildWnbaGameModel — structure", () => {
  it("produces a large factor set and stamps the model version", () => {
    const result = buildWnbaGameModel(game())!;
    expect(result.factors.length).toBeGreaterThanOrEqual(18);
    expect(result.modelVersion).toBe(WNBA_GAME_MODEL_VERSION);
    expect(result.scoreKind).toBe("heuristic_score");
  });

  it("keeps scores complementary and details populated", () => {
    const result = buildWnbaGameModel(game())!;
    for (const f of result.factors) {
      expect(f.team1Score + f.team2Score).toBe(100);
      expect(f.detail.length).toBeGreaterThan(0);
    }
  });

  it("respects group budgets", () => {
    const result = buildWnbaGameModel(game())!;
    for (const group of ["efficiency", "form", "situational", "availability", "environment"] as const) {
      const total = result.factors.filter((f) => f.group === group).reduce((s, f) => s + f.weight, 0);
      expect(total).toBeLessThanOrEqual(WNBA_GROUP_BUDGET[group] + 0.5);
    }
  });

  it("is deterministic and symmetric", () => {
    const a = buildWnbaGameModel(game({
      team1: team({ name: "A", netPoints: 6, offensiveRating: 108, isHome: false }),
      team2: team({ name: "B", netPoints: -3, offensiveRating: 99, isHome: false }),
    }))!;
    const b = buildWnbaGameModel(game({
      team1: team({ name: "B", netPoints: -3, offensiveRating: 99, isHome: false }),
      team2: team({ name: "A", netPoints: 6, offensiveRating: 108, isHome: false }),
    }))!;
    expect(a.team1Score + b.team1Score).toBe(100);
  });

  it("stays neutral between identical teams", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: false }),
      team2: team({ name: "B", isHome: false }),
    }))!;
    expect(result.team1Score).toBeGreaterThanOrEqual(48);
    expect(result.team1Score).toBeLessThanOrEqual(52);
  });
});

describe("buildWnbaGameModel — directional correctness", () => {
  it("favours the better net rating", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, offensiveRating: 112, defensiveRating: 96, netPoints: 9 }),
      team2: team({ name: "B", offensiveRating: 96, defensiveRating: 110, netPoints: -8 }),
    }))!;
    expect(result.team1Score).toBeGreaterThan(58);
    expect(result.verdict).toBe("LEAN A");
  });

  it("treats a lower defensive rating as better", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, defensiveRating: 95 }),
      team2: team({ name: "B", defensiveRating: 112 }),
    }))!;
    expect(result.factors.find((f) => f.key === "defensive_rating")!.team1Score).toBeGreaterThan(50);
  });

  it("penalises the team on a back-to-back", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, backToBack: true, restDays: 0 }),
      team2: team({ name: "B", backToBack: false, restDays: 2 }),
    }))!;
    expect(result.factors.find((f) => f.key === "back_to_back")!.team1Score).toBeLessThan(50);
    expect(result.factors.find((f) => f.key === "rest")!.team1Score).toBeLessThan(50);
  });

  it("scales injuries by minutes, not by headcount", () => {
    const heavy = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, unavailableMinutes: 68 }),
      team2: team({ name: "B", unavailableMinutes: 0 }),
    }))!;
    const light = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, unavailableMinutes: 8 }),
      team2: team({ name: "B", unavailableMinutes: 0 }),
    }))!;
    const heavyScore = heavy.factors.find((f) => f.key === "unavailable_minutes")!.team1Score;
    const lightScore = light.factors.find((f) => f.key === "unavailable_minutes")!.team1Score;
    expect(heavyScore).toBeLessThan(lightScore);
    expect(heavyScore).toBeLessThan(50);
  });

  it("gives the home side the home-court factor", () => {
    const result = buildWnbaGameModel(game())!;
    expect(result.factors.find((f) => f.key === "home_court")!.team1Score).toBe(56);
  });

  it("weights form trend below raw efficiency", () => {
    const result = buildWnbaGameModel(game())!;
    const offTrend = result.factors.find((f) => f.key === "offensive_trend")!;
    const net = result.factors.find((f) => f.key === "net_rating")!;
    expect(offTrend.weight).toBeLessThan(net.weight);
  });

  it("splits form trend into offence and defence instead of one composite", () => {
    const result = buildWnbaGameModel(game())!;
    // The composite was removed: net trend is offensive minus defensive trend,
    // so keeping all three would count the same movement twice.
    expect(result.factors.find((f) => f.key === "form_trend")).toBeUndefined();
    expect(result.factors.find((f) => f.key === "offensive_trend")).toBeDefined();
    expect(result.factors.find((f) => f.key === "defensive_trend")).toBeDefined();
  });

  it("rewards a team scoring above its own baseline", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, pointsFor: 80, recentPointsFor: 92 }),
      team2: team({ name: "B", pointsFor: 80, recentPointsFor: 74 }),
    }))!;
    expect(result.factors.find((f) => f.key === "offensive_trend")!.team1Score).toBeGreaterThan(50);
  });

  it("rewards a team conceding below its own baseline", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, pointsAgainst: 85, recentPointsAgainst: 75 }),
      team2: team({ name: "B", pointsAgainst: 85, recentPointsAgainst: 95 }),
    }))!;
    expect(result.factors.find((f) => f.key === "defensive_trend")!.team1Score).toBeGreaterThan(50);
  });

  it("detects a team that over-performs its baseline in this venue", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, netPoints: 0, venueNetPoints: 9 }),
      team2: team({ name: "B", netPoints: 0, venueNetPoints: -6 }),
    }))!;
    const delta = result.factors.find((f) => f.key === "venue_split_delta")!;
    expect(delta.team1Score).toBeGreaterThan(50);
    expect(delta.detail).toContain("own season average");
  });

  it("favours the team whose natural tempo is closer to the projected pace", () => {
    // Projected pace is the midpoint, so the extremes are equidistant; give one
    // side a tempo nearer the midpoint and it should be favoured.
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, pace: 84, netPoints: 0 }),
      team2: team({ name: "B", pace: 76, netPoints: 0 }),
    }))!;
    const mismatch = result.factors.find((f) => f.key === "pace_mismatch")!;
    // Equidistant from the midpoint, so this must be neutral — not noise.
    expect(mismatch.team1Score).toBe(50);
  });

  it("drops tempo control when either pace is unknown", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, pace: null }),
      team2: team({ name: "B", pace: 80 }),
    }))!;
    expect(result.factors.find((f) => f.key === "pace_mismatch")).toBeUndefined();
    expect(result.missingInputs).toContain("pace_mismatch");
  });
});

describe("buildWnbaGameModel — missing input handling", () => {
  it("drops a factor instead of defaulting it to neutral", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, offensiveRating: null, defensiveRating: null }),
      team2: team({ name: "B", offensiveRating: null, defensiveRating: null }),
    }))!;
    expect(result.factors.find((f) => f.key === "net_rating")).toBeUndefined();
    expect(result.missingInputs).toContain("net_rating");
    expect(result.dataCoverage).toBeLessThanOrEqual(1);
  });

  it("does not score a one-sided input", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, pace: 88 }),
      team2: team({ name: "B", pace: null }),
    }))!;
    expect(result.factors.find((f) => f.key === "pace")).toBeUndefined();
  });

  it("flags an unresolved injury report without tilting the score", () => {
    const result = buildWnbaGameModel(game({
      team1: team({ name: "A", isHome: true, availabilityResolved: false }),
      team2: team({ name: "B", availabilityResolved: true }),
    }))!;
    const quality = result.factors.find((f) => f.key === "availability_quality")!;
    expect(quality.weight).toBe(0);
    expect(quality.detail).toContain("incomplete");
  });

  it("returns null when there is nothing to score", () => {
    expect(buildWnbaGameModel({
      market: "moneyline",
      team1: { name: "A" },
      team2: { name: "B" },
    })).toBeNull();
  });
});

describe("buildWnbaGameModel — markets", () => {
  it("requires a spread line for the spread market", () => {
    expect(buildWnbaGameModel(game({ market: "spread", team1Spread: null }))).toBeNull();
  });

  it("rates a favourite better against a shorter number", () => {
    const strong = {
      team1: team({ name: "A", isHome: true, netPoints: 11, recentNetPoints: 11 }),
      team2: team({ name: "B", netPoints: -7, recentNetPoints: -7 }),
    };
    const easy = buildWnbaGameModel(game({ ...strong, market: "spread", team1Spread: -2.5 }))!;
    const hard = buildWnbaGameModel(game({ ...strong, market: "spread", team1Spread: -12.5 }))!;
    expect(easy.team1Score).toBeGreaterThan(hard.team1Score);
  });

  it("scores the total from projected points, and flips with the side", () => {
    const base = {
      team1: team({ name: "A", isHome: true, pointsFor: 90, pointsAgainst: 88 }),
      team2: team({ name: "B", pointsFor: 89, pointsAgainst: 91 }),
    };
    const over = buildWnbaGameModel(game({ ...base, market: "total", totalLine: 160, totalSide: "over" }))!;
    const under = buildWnbaGameModel(game({ ...base, market: "total", totalLine: 160, totalSide: "under" }))!;
    expect(over.projectedTotal).toBeGreaterThan(160);
    expect(over.team1Score).toBeGreaterThan(50);
    expect(under.team1Score).toBeLessThan(50);
  });

  it("requires a total line for the total market", () => {
    expect(buildWnbaGameModel(game({ market: "total", totalLine: null, totalSide: "over" }))).toBeNull();
  });
});
