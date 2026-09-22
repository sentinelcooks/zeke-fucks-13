import { describe, expect, it } from "vitest";
import { analyzerTotalSideMismatch } from "../../supabase/functions/_shared/analyzer_side";

/**
 * Regression: a Daily Edge card read "Under 6.5" while its own report read
 * "Over 6.5". The verified MLB total model flips to the side its projection
 * favours and returns THAT side's score, but the scanner kept the requested
 * direction — so an Over read was published as an Under pick.
 */
describe("analyzerTotalSideMismatch", () => {
  it("flags a game total whose analyzer answered the opposite side", () => {
    expect(analyzerTotalSideMismatch("total", "under", { selected_direction: "over", confidence: 78 }))
      .toEqual({ requestedSide: "under", analyzerSide: "over" });
    expect(analyzerTotalSideMismatch("over_under", "over", { decision: { winning_side: "under" } }))
      .toEqual({ requestedSide: "over", analyzerSide: "under" });
    expect(analyzerTotalSideMismatch("total", "under", { selectedSide: "Over" }))
      .toEqual({ requestedSide: "under", analyzerSide: "over" });
  });

  it("passes when the analyzer answered the side it was asked about", () => {
    expect(analyzerTotalSideMismatch("total", "over", { selected_direction: "over" })).toBeNull();
    expect(analyzerTotalSideMismatch("total", "under", { decision: { winning_side: "under" } })).toBeNull();
  });

  it("never touches player props or team markets", () => {
    // A prop analyzer scores the requested side; its lean is not a side swap.
    expect(analyzerTotalSideMismatch("prop", "over", { decision: { winning_side: "under" } })).toBeNull();
    expect(analyzerTotalSideMismatch("moneyline", "home", { decision: { winning_side: "team2" } })).toBeNull();
    expect(analyzerTotalSideMismatch("spread", "away", { decision: { winning_side: "team1" } })).toBeNull();
  });

  it("passes when the analyzer reports no side", () => {
    expect(analyzerTotalSideMismatch("total", "under", { confidence: 60 })).toBeNull();
    expect(analyzerTotalSideMismatch("total", "under", null)).toBeNull();
  });
});
