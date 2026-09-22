import { describe, expect, it } from "vitest";
import { quoteForModelDecision } from "@/lib/gameAnalysisSelection";

const teams = {
  home: { name: "Cleveland Guardians", shortName: "Guardians", abbr: "CLE" },
  away: { name: "Detroit Tigers", shortName: "Tigers", abbr: "DET" },
};

const spreadQuotes = [
  { side: "home" as const, label: "Cleveland Guardians", price: -120, point: 3.5 },
  { side: "away" as const, label: "Detroit Tigers", price: -105, point: -3.5 },
];

describe("game analysis selection", () => {
  it("binds a team decision to that team's published spread quote", () => {
    expect(quoteForModelDecision(spreadQuotes, {
      winning_side: "team2",
      winning_team_name: "Guardians",
    }, teams)).toEqual(spreadQuotes[0]);
  });

  it("binds an away-team decision to that team's published quote", () => {
    expect(quoteForModelDecision(spreadQuotes, {
      winning_side: "team2",
      winning_team_name: "Tigers",
    }, teams)).toEqual(spreadQuotes[1]);
  });

  it("binds total decisions to the corresponding over or under quote", () => {
    const totalQuotes = [
      { side: "over" as const, label: "Over", price: -110, point: 8.5 },
      { side: "under" as const, label: "Under", price: -110, point: 8.5 },
    ];

    expect(quoteForModelDecision(totalQuotes, {
      winning_side: "under",
      winning_team_name: "Under",
    }, teams)).toEqual(totalQuotes[1]);
  });

  it("withholds a quote when the returned team cannot be verified", () => {
    expect(quoteForModelDecision(spreadQuotes, {
      winning_side: "team1",
      winning_team_name: "Another Team",
    }, teams)).toBeUndefined();
  });

  it("withholds a quote when the event teams are unavailable", () => {
    expect(quoteForModelDecision(spreadQuotes, {
      winning_side: "team1",
      winning_team_name: "Cleveland Guardians",
    }, undefined)).toBeUndefined();
  });
});
