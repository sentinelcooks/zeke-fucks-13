import { describe, expect, it } from "vitest";
import { buildInputNodes, inputLabel } from "@/lib/gameAnalysisInputs";

describe("game analysis input labels", () => {
  it("shows the six standard rows as verified when nothing is missing", () => {
    const nodes = buildInputNodes([]);
    expect(nodes.map((node) => node.label)).toEqual([
      "Team offense",
      "Starting pitchers",
      "Bullpen form",
      "Park factor",
      "Lineups",
      "Lineup stats",
    ]);
    expect(nodes.every((node) => node.verified)).toBe(true);
  });

  it("marks a row pending from the model's own key", () => {
    const nodes = buildInputNodes(["LINEUP_UNCONFIRMED", "PROBABLE_STARTER_PROFILE_MISSING"]);
    const byLabel = Object.fromEntries(nodes.map((node) => [node.label, node.verified]));
    expect(byLabel["Lineups"]).toBe(false);
    expect(byLabel["Starting pitchers"]).toBe(false);
    expect(byLabel["Team offense"]).toBe(true);
  });

  it("never lets a raw key reach the screen", () => {
    // This is the whole point of the module: a user reading
    // "LINEUP_UNCONFIRMED" learns nothing except that something leaked.
    const nodes = buildInputNodes(
      ["LINEUP_UNCONFIRMED", "platoon_ops", "starter_rest"],
      ["WEATHER_MISSING", "PITCH_TYPE_MATCHUP_INSUFFICIENT", "CURRENT_PARK_FACTOR_MISSING"],
    );
    for (const node of nodes) {
      expect(node.label).not.toMatch(/_/);
      expect(node.label).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("merges feed gaps with model gaps", () => {
    const nodes = buildInputNodes(["park_factor"], ["TEAM_SEASON_STATS_INCOMPLETE"]);
    const byLabel = Object.fromEntries(nodes.map((node) => [node.label, node.verified]));
    expect(byLabel["Park factor"]).toBe(false);
    expect(byLabel["Team offense"]).toBe(false);
  });

  it("appends extra inputs the model reports, without duplicating them", () => {
    const nodes = buildInputNodes(["temperature", "wind"], ["WEATHER_MISSING"]);
    const weather = nodes.filter((node) => node.label === "Weather");
    expect(weather).toHaveLength(1);
    expect(weather[0].verified).toBe(false);
    expect(nodes.some((node) => node.label === "Wind")).toBe(true);
  });

  it("title-cases an unmapped key rather than printing the constant", () => {
    expect(inputLabel("LINEUP_UNCONFIRMED")).toBe("Lineups");
    expect(inputLabel("official_probable_starter_season_era")).toBe("Official probable starter season era");
    expect(inputLabel("")).toBe("");
  });

  it("tolerates a missing list entirely", () => {
    expect(buildInputNodes(undefined, undefined)).toHaveLength(6);
    expect(buildInputNodes(null)).toHaveLength(6);
  });
});
