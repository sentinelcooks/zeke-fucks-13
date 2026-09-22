import { describe, expect, it } from "vitest";
import { buildMlbTeamMarketProjection } from "../../supabase/functions/_shared/mlb_team_market_projection";

const baseInput = {
  team1Name: "Home Club",
  team2Name: "Away Club",
  team1RunsPerGame: 5.1,
  team2RunsPerGame: 3.9,
  team1Ops: 0.79,
  team2Ops: 0.68,
  team1StarterEra: 3.1,
  team2StarterEra: 4.7,
  team1BullpenEra: 3.4,
  team2BullpenEra: 4.4,
};

describe("buildMlbTeamMarketProjection", () => {
  it("uses verified current-season inputs to favor the stronger moneyline side", () => {
    const projection = buildMlbTeamMarketProjection({ ...baseInput, market: "moneyline", team1Spread: null });

    expect(projection?.team1Score).toBeGreaterThan(58);
    expect(projection?.verdict).toBe("LEAN Home Club");
    expect(projection?.factors).toHaveLength(4);
  });

  it("evaluates a spread against the projected scoring margin", () => {
    const projection = buildMlbTeamMarketProjection({ ...baseInput, market: "spread", team1Spread: -1.5 });

    expect(projection?.predictedMargin).toBeGreaterThan(0);
    expect(projection?.team1Score).toBeGreaterThan(50);
  });

  it("does not create a projection without both verified run-production inputs", () => {
    const projection = buildMlbTeamMarketProjection({ ...baseInput, market: "moneyline", team1RunsPerGame: null, team1Spread: null });

    expect(projection).toBeNull();
  });
});
