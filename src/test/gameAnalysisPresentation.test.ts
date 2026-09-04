import { describe, expect, it } from "vitest";
import {
  analysisNarrative,
  gameModelMetric,
  headToHeadRows,
  type GameAnalysisResponse,
} from "@/lib/gameAnalysisPresentation";

describe("game analysis presentation", () => {
  it("only labels a score as a probability when the response is calibrated", () => {
    const calibrated = gameModelMetric({
      probability_supported: true,
      score_kind: "calibrated_probability",
      decision: { win_probability: 62.4 },
    });
    const heuristic = gameModelMetric({
      probability_supported: false,
      score_kind: "heuristic_score",
      decision: { win_probability: 62.4 },
    });

    expect(calibrated).toMatchObject({ display: "62%", label: "Win probability", isProbability: true });
    expect(heuristic).toMatchObject({ display: "62/100", label: "Model score", isProbability: false });
  });

  it("formats only completed head-to-head games returned by the model", () => {
    const response: GameAnalysisResponse = {
      head_to_head: [
        {
          date: "2026-08-10T00:00:00.000Z",
          team1_score: 6,
          team2_score: 3,
          team1_winner: true,
          venue: "Example Park",
        },
        { date: "2026-08-01T00:00:00.000Z", team1_score: undefined, team2_score: 4 },
      ],
    };

    expect(headToHeadRows(response, "Tigers", "Guardians")).toEqual([
      expect.objectContaining({
        scoreLabel: "Tigers 6 – 3 Guardians",
        outcomeLabel: "Tigers won",
        venue: "Example Park",
      }),
    ]);
  });

  it("prefers the returned model writeup over a fallback decision explanation", () => {
    expect(analysisNarrative({ writeup: "Pitching matchup favors the home side.", decision: { grade_explanation: "Fallback" } }))
      .toBe("Pitching matchup favors the home side.");
  });
});
