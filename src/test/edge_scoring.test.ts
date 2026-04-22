import { describe, it, expect } from "vitest";
import {
  score,
  rankAndDistribute,
  tierVerdict,
  getMarketReliability,
} from "../../supabase/functions/_shared/edge_scoring";

describe("score() pipeline", () => {
  it("de-vigs when odds_opp supplied", () => {
    const s = score({
      sport: "nba",
      bet_type: "prop",
      player_name: "Test",
      prop_type: "points",
      line: 22.5,
      direction: "over",
      odds: -110,
      odds_opp: -110,
      raw_confidence: 0.65,
    });
    // fair implied at -110/-110 is 0.5; raw conf 0.65 → edge 0.15
    expect(s.implied_prob).toBeCloseTo(0.5, 6);
    expect(s.edge).toBeCloseTo(0.15, 6);
    expect(s.confidence).toBeCloseTo(0.65, 6);
  });

  it("applies identity calibration by default", () => {
    const s = score({
      sport: "nba",
      bet_type: "prop",
      player_name: "Test",
      prop_type: "points",
      line: 22.5,
      direction: "over",
      odds: -110,
      raw_confidence: 70, // percent form
    });
    expect(s.confidence).toBeCloseTo(0.7, 6);
  });

  it("applies Platt calibration when supplied", () => {
    const s = score({
      sport: "nba",
      bet_type: "prop",
      player_name: "Test",
      prop_type: "points",
      line: 22.5,
      direction: "over",
      odds: -110,
      raw_confidence: 0.5,
      calibration: { method: "platt", params: { a: 2, b: -1 } },
    });
    // sigmoid(2*0.5 - 1) = sigmoid(0) = 0.5
    expect(s.confidence).toBeCloseTo(0.5, 6);
  });
});

describe("tierVerdict", () => {
  it("+500 is always Pass", () => {
    expect(tierVerdict(0.99, 0.5, 1, "moneyline", "", "home", +500)).toBe("Pass");
  });
  it("longshot requires elite numbers", () => {
    expect(tierVerdict(0.75, 0.08, 0.7, "moneyline", "", "home", +300)).toBe("Strong");
    expect(tierVerdict(0.65, 0.03, 0.7, "moneyline", "", "home", +300)).toBe("Pass");
  });
  it("0.70 / 3% edge / 0.70 rel → Strong", () => {
    expect(tierVerdict(0.70, 0.03, 0.75, "prop", "points", "over", -110)).toBe("Strong");
  });
  it("below floor → Pass", () => {
    expect(tierVerdict(0.55, 0.01, 0.5, "prop", "points", "over", -110)).toBe("Pass");
  });
});

describe("getMarketReliability", () => {
  it("moneyline favorite is 0.95", () => {
    expect(getMarketReliability("moneyline", "", "home", -200)).toBe(0.95);
  });
  it("under on low-reliability prop is 0.4", () => {
    expect(getMarketReliability("prop", "strikeouts", "under", -110)).toBe(0.4);
  });
  it("unknown prop is 0.65", () => {
    expect(getMarketReliability("prop", "made_field_goals_weird", "over", -110)).toBe(0.65);
  });
});

describe("rankAndDistribute", () => {
  function make(sport: string, conf: number, edge: number, rel = 0.8, odds = -110) {
    return score({
      sport,
      bet_type: "prop",
      player_name: `P-${sport}-${conf}`,
      prop_type: "points",
      line: 20.5,
      direction: "over",
      odds,
      odds_opp: -110, // fair implied 0.5
      raw_confidence: 0.5 + edge, // -> conf = 0.5+edge when identity-calibrated
      reliability: rel,
    });
  }

  it("fills Today's Edge up to 5 from Strong picks", () => {
    const plays = [
      make("nba", 0.75, 0.20, 0.8),
      make("nba", 0.74, 0.20, 0.8),
      make("mlb", 0.74, 0.19, 0.8),
      make("nhl", 0.73, 0.19, 0.8),
      make("ufc", 0.72, 0.19, 0.8),
      make("nba", 0.70, 0.18, 0.8),
    ];
    const { todaysEdge } = rankAndDistribute(plays);
    expect(todaysEdge.length).toBe(5);
    // Max 2 per sport → nba appears at most twice.
    const nbaCount = todaysEdge.filter((p) => p.sport === "nba").length;
    expect(nbaCount).toBeLessThanOrEqual(2);
  });

  it("falls back to Lean when fewer than 5 Strongs exist", () => {
    const plays = [
      make("nba", 0.75, 0.20, 0.8), // Strong
      make("nba", 0.64, 0.13, 0.7), // Lean
      make("mlb", 0.63, 0.12, 0.7), // Lean
      make("nhl", 0.63, 0.12, 0.7), // Lean
      make("ufc", 0.63, 0.12, 0.7), // Lean
    ];
    const { todaysEdge } = rankAndDistribute(plays);
    // Fallback pulls from the entire sorted list, not just Strongs.
    expect(todaysEdge.length).toBeGreaterThan(1);
  });

  it("drops picks below the floor", () => {
    const plays = [make("nba", 0.55, 0.01, 0.3)];
    const { dailyPicks, todaysEdge } = rankAndDistribute(plays);
    expect(dailyPicks.length).toBe(0);
    expect(todaysEdge.length).toBe(0);
  });
});
