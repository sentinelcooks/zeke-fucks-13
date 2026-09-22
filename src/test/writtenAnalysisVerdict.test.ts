import { describe, expect, it } from "vitest";
import { buildUncalibratedSections, isDirectionalHeuristicLean } from "@/components/WrittenAnalysis";
import { quoteSelectionLabel } from "@/lib/gameAnalysisPresentation";

describe("written analysis verdict presentation", () => {
  it("shows a directional research lean for an uncalibrated model signal", () => {
    expect(isDirectionalHeuristicLean({
      probabilitySupported: false,
      scoreKind: "heuristic_score",
      decision: {
        winning_side: "over",
        winning_team_name: "Over",
        win_probability: 72,
        edge: null,
        conviction_tier: "noBet",
        recommended_units: 0,
        verdict_text: "STRONG OVER",
      },
    })).toBe(true);
  });

  it("keeps a non-directional or calibrated response out of the research-lean state", () => {
    const noDirection = {
      winning_side: null,
      winning_team_name: null,
      win_probability: 50,
      edge: null,
      conviction_tier: "noBet" as const,
      recommended_units: 0 as const,
      verdict_text: "RISKY",
    };

    expect(isDirectionalHeuristicLean({ scoreKind: "heuristic_score", decision: noDirection })).toBe(false);
    expect(isDirectionalHeuristicLean({
      probabilitySupported: true,
      scoreKind: "calibrated_probability",
      decision: { ...noDirection, winning_side: "over", winning_team_name: "Over", verdict_text: "STRONG OVER" },
    })).toBe(false);
  });
});

/**
 * The reported bug: a 62/LEAN total card whose written analysis was five fixed
 * disclaimer paragraphs naming no factor, team or number — so the only reading
 * left was that 62 meant a 62% win chance worth a unit or two.
 */
describe("uncalibrated written analysis", () => {
  const total = {
    type: "moneyline" as const,
    verdict: "NO BET",
    confidence: 62,
    playerOrTeam: "Over 167.5",
    scoreKind: "heuristic_score",
    probabilitySupported: false,
    projection: 170.6,
    lineValue: 167.5,
    unit: "points",
    factorCount: 23,
    coverage: 1,
    factorBreakdown: [
      { name: "Pace differential", team1Score: 61, team2Score: 39, weight: 9, detail: "Both sides top-10 in pace" },
      { name: "Defensive rating", team1Score: 57, team2Score: 43, weight: 7 },
      { name: "Even split", team1Score: 50, team2Score: 50, weight: 12 },
    ],
  };

  function contentOf(sections: Array<{ title: string; content: string }>): string {
    return sections.map((section) => section.content).join(" ");
  }

  it("states the score is a ranking, not a win probability", () => {
    const sections = buildUncalibratedSections(total, "OVER 167.5");
    const first = sections[0];

    expect(first.content).toContain("62/100");
    expect(first.content).toMatch(/not a 62% win probability/i);
  });

  it("names the heaviest directional factors and their detail", () => {
    const text = contentOf(buildUncalibratedSections(total, "OVER 167.5"));

    expect(text).toContain("Pace differential");
    expect(text).toContain("Both sides top-10 in pace");
    expect(text).toContain("Defensive rating");
  });

  it("excludes a factor sitting at exactly 50, which states no direction", () => {
    const text = contentOf(buildUncalibratedSections(total, "OVER 167.5"));

    // "Even split" carries the highest weight, so a naive sort would lead with it.
    expect(text).not.toContain("Even split");
  });

  it("states the projection, the line and the signed gap that produced the lean", () => {
    const text = contentOf(buildUncalibratedSections(total, "OVER 167.5"));

    expect(text).toContain("170.6");
    expect(text).toContain("167.5");
    expect(text).toContain("+3.1");
    expect(text).toMatch(/toward the Over/i);
  });

  it("never recommends a size or asserts an edge or EV number", () => {
    const text = contentOf(buildUncalibratedSections(total, "OVER 167.5"));

    // Naming a stake, not merely using the word to say there isn't one.
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s*units?\b/i);
    expect(text).not.toMatch(/\b(?:recommended|suggested)\s+(?:sizing|size|stake|units?)\b/i);
    expect(text).not.toMatch(/\b(?:proceed|bet|wager|stake)\s+(?:at|with)\b/i);
    // A quantified edge or EV claim.
    expect(text).not.toMatch(/[+-]?\d+(?:\.\d+)?%\s*(?:EV|edge)\b/i);
    expect(text).not.toMatch(/\bedge of\b/i);
  });

  it("explains what is actually missing before sizing can appear", () => {
    const risk = buildUncalibratedSections(total, "OVER 167.5")
      .find((section) => section.title === "Risk");

    expect(risk?.content).toMatch(/graded/i);
    expect(risk?.content).toMatch(/win probability/i);
  });

  it("reports excluded inputs by name when the model could not use them", () => {
    const text = contentOf(buildUncalibratedSections(
      { ...total, missingInputs: ["bullpen_era", "park_factor"] },
      "OVER 167.5",
    ));

    expect(text).toContain("bullpen_era");
    expect(text).toContain("park_factor");
  });

  it("falls back to a player prop's own reasoning when it has no factor breakdown", () => {
    const text = contentOf(buildUncalibratedSections({
      type: "prop",
      verdict: "LEAN",
      confidence: 58,
      playerOrTeam: "Aaron Judge",
      scoreKind: "heuristic_score",
      probabilitySupported: false,
      reasoning: ["Judge has cleared this line in 7 of his last 10."],
      seasonHitRate: { rate: 61 },
      last10: { rate: 70 },
    }, "OVER 1.5 Total Bases"));

    expect(text).toContain("7 of his last 10");
    expect(text).toContain("season 61%");
    expect(text).toContain("last 10 70%");
  });

  it("omits sections rather than padding when a caller supplies no data", () => {
    const sections = buildUncalibratedSections({
      type: "moneyline",
      verdict: "NO BET",
      confidence: 55,
      playerOrTeam: "Team A",
      scoreKind: "heuristic_score",
      probabilitySupported: false,
    }, "");

    const text = contentOf(sections);
    expect(text).not.toContain("[object Object]");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
    // Still says what the score is and why there is no sizing.
    expect(sections.some((section) => section.title === "Risk")).toBe(true);
    expect(sections.length).toBeLessThan(5);
  });
});

describe("market quote labels", () => {
  it("does not repeat a total's number when the label already carries it", () => {
    // Regression: totals rendered "Over 167.5 167.5" because over/under has no
    // winning_team_name to overwrite the request-time label.
    expect(quoteSelectionLabel("Over 167.5", 167.5, "over")).toBe("Over 167.5");
    expect(quoteSelectionLabel("Under 167.5", 167.5, "under")).toBe("Under 167.5");
  });

  it("still appends a total's number when the label lacks it", () => {
    expect(quoteSelectionLabel("Over", 167.5, "over")).toBe("Over 167.5");
  });

  it("keeps the sign on a spread, where the sign is the meaning", () => {
    expect(quoteSelectionLabel("Dodgers", 1.5, "home")).toBe("Dodgers +1.5");
    expect(quoteSelectionLabel("Dodgers", -1.5, "home")).toBe("Dodgers -1.5");
  });

  it("leaves a moneyline label alone when there is no point", () => {
    expect(quoteSelectionLabel("Dodgers", null, "home")).toBe("Dodgers");
    expect(quoteSelectionLabel("Dodgers", undefined, "home")).toBe("Dodgers");
  });
});
