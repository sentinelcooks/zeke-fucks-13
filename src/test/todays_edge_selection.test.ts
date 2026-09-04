import { describe, expect, it } from "vitest";
import {
  selectTodaysEdgePicks,
  type TodaysEdgeCandidate,
} from "@/lib/todaysEdgeSelection";

function fallbackPick(
  id: string,
  sport: string,
  confidence: number,
  overrides: Partial<TodaysEdgeCandidate> = {},
): TodaysEdgeCandidate {
  return {
    id,
    sport,
    tier: "daily",
    score_kind: "heuristic_score",
    calibration_status: "not_calibrated",
    confidence,
    hit_rate: confidence,
    event_id: `event-${id}`,
    bet_type: "spread",
    prop_type: "spread",
    direction: "home",
    line: -1.5,
    home_team: `Home ${id}`,
    away_team: `Away ${id}`,
    model_diagnostics: {
      shadow_edge_candidate: true,
      confidenceSource: "analyzer",
    },
    ...overrides,
  };
}

function validatedPick(id: string, sport: string): TodaysEdgeCandidate {
  return {
    ...fallbackPick(id, sport, 0.71),
    tier: "edge",
    score_kind: "calibrated_probability",
    calibration_status: "validated",
    calibrated_probability: 0.71,
  };
}

describe("Today's Edge fallback selection", () => {
  it("prefers validated Edge for a sport while allowing fallback for another sport", () => {
    const result = selectTodaysEdgePicks([
      validatedPick("mlb-validated", "mlb"),
      fallbackPick("mlb-fallback", "mlb", 0.90),
      fallbackPick("wnba-fallback", "wnba", 0.66),
    ]);

    expect(result.picks.map((pick) => [pick.id, pick.edgePresentation])).toEqual([
      ["mlb-validated", "validated"],
      ["wnba-fallback", "fallback"],
    ]);
    expect(result.fallbackIds).toEqual(new Set(["wnba-fallback"]));
  });

  it("selects the highest approved model scores across markets and sports", () => {
    const rows = [
      fallbackPick("mlb-spread", "mlb", 0.71),
      fallbackPick("nba-moneyline", "nba", 0.79, {
        event_id: "nba-game", bet_type: "moneyline", prop_type: "moneyline", player_name: "NBA Team",
      }),
      fallbackPick("nhl-total", "nhl", 0.77, {
        event_id: "nhl-game", bet_type: "total", prop_type: "total", direction: "over", line: 6.5,
      }),
      fallbackPick("wnba-prop", "wnba", 0.75, {
        event_id: "wnba-game", bet_type: "prop", prop_type: "points", player_name: "WNBA Player", direction: "over", line: 18.5,
      }),
      fallbackPick("ufc-spread", "ufc", 0.69),
    ];
    const result = selectTodaysEdgePicks(rows, 4);

    expect(result.picks.map((pick) => pick.id)).toEqual([
      "nba-moneyline", "nhl-total", "wnba-prop", "mlb-spread",
    ]);
  });

  it("removes opposing game sides and opposing directions for the same prop", () => {
    const rows = [
      fallbackPick("spread-home", "mlb", 0.74, { event_id: "game-1", direction: "home" }),
      fallbackPick("spread-away", "mlb", 0.68, { event_id: "game-1", direction: "away" }),
      fallbackPick("prop-over", "mlb", 0.69, {
        event_id: "game-2", bet_type: "prop", prop_type: "hits",
        player_name: "Player One", line: 1.5, direction: "over",
      }),
      fallbackPick("prop-under", "mlb", 0.64, {
        event_id: "game-2", bet_type: "prop", prop_type: "hits",
        player_name: "Player One", line: 1.5, direction: "under",
      }),
    ];
    const result = selectTodaysEdgePicks(rows, 4);

    expect(result.picks.map((pick) => pick.id)).toEqual(["spread-home", "prop-over"]);
  });

  it("propagates a WNBA lineup warning without converting the score to a probability", () => {
    const result = selectTodaysEdgePicks([
      fallbackPick("wnba-warning", "wnba", 0.654, {
        model_diagnostics: {
          shadow_edge_candidate: true,
          shadow_edge_warning: "lineups_pending",
          confidenceSource: "analyzer",
        },
      }),
    ]);

    expect(result.picks[0]).toMatchObject({
      id: "wnba-warning",
      edgePresentation: "fallback",
      edgeWarning: "lineups_pending",
      score_kind: "heuristic_score",
      calibrated_probability: undefined,
    });
  });

  it("rejects daily rows that the backend did not mark as shadow candidates", () => {
    const result = selectTodaysEdgePicks([
      fallbackPick("unsafe", "mlb", 0.91, {
        model_diagnostics: { shadow_edge_candidate: false },
      }),
    ]);

    expect(result.picks).toEqual([]);
    expect(result.fallbackIds.size).toBe(0);
  });
});
