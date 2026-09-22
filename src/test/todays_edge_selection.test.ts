import { describe, expect, it } from "vitest";
import {
  selectTodaysEdgePicks,
  edgeCategoryOf,
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

describe("selectTodaysEdgePicks — opposing sides of the same market", () => {
  const shadow = (over: Record<string, unknown>) => ({
    sport: "mlb",
    tier: "daily",
    status: null,
    score_kind: "heuristic_score",
    model_diagnostics: { shadow_edge_candidate: true, confidenceSource: "analyzer" },
    bet_type: "over_under",
    event_id: "evt-1",
    line: 9.5,
    ...over,
  });

  it("drops a market where both sides carry the same score", () => {
    // Real data: a 9.5 total written as over:0.68 AND under:0.68. That is the
    // model declining to pick a side, and one of the pair must lose — showing
    // either half as a 68-score lean is false confidence.
    const result = selectTodaysEdgePicks([
      shadow({ id: "over", direction: "over", confidence: 0.68 }),
      shadow({ id: "under", direction: "under", confidence: 0.68 }),
    ], 5);
    expect(result.picks).toHaveLength(0);
  });

  it("keeps the stronger side when the two sides genuinely differ", () => {
    const result = selectTodaysEdgePicks([
      shadow({ id: "over", direction: "over", confidence: 0.72 }),
      shadow({ id: "under", direction: "under", confidence: 0.54 }),
    ], 5);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].id).toBe("over");
  });

  it("drops a tied home/away pair on the same spread", () => {
    const result = selectTodaysEdgePicks([
      shadow({ id: "h", bet_type: "spread", direction: "home", confidence: 0.6 }),
      shadow({ id: "a", bet_type: "spread", direction: "away", confidence: 0.6 }),
    ], 5);
    expect(result.picks).toHaveLength(0);
  });

  it("leaves an unopposed pick alone", () => {
    const result = selectTodaysEdgePicks([
      shadow({ id: "solo", direction: "over", confidence: 0.66 }),
    ], 5);
    expect(result.picks).toHaveLength(1);
  });

  it("does not drop same-direction duplicates, only opposing ones", () => {
    // Two copies of the SAME side is a scanner re-run, not a contradiction —
    // dedupe to one rather than discarding the market.
    const result = selectTodaysEdgePicks([
      shadow({ id: "a", direction: "over", confidence: 0.66 }),
      shadow({ id: "b", direction: "over", confidence: 0.66 }),
    ], 5);
    expect(result.picks).toHaveLength(1);
  });

  it("keeps other markets in the same game when one is contradictory", () => {
    const result = selectTodaysEdgePicks([
      shadow({ id: "t-over", direction: "over", confidence: 0.68 }),
      shadow({ id: "t-under", direction: "under", confidence: 0.68 }),
      shadow({ id: "ml", bet_type: "moneyline", direction: "home", confidence: 0.7 }),
    ], 5);
    expect(result.picks.map((p) => p.id)).toEqual(["ml"]);
  });
});

describe("selectTodaysEdgePicks — category diversity", () => {
  const cand = (over: Record<string, unknown>) => ({
    sport: "mlb",
    tier: "daily",
    status: null,
    score_kind: "heuristic_score",
    model_diagnostics: { shadow_edge_candidate: true, confidenceSource: "analyzer" },
    bet_type: "prop",
    ...over,
  });

  it("does not fill the lineup with one prop type", () => {
    // The real pool was 83% rbi+hits, which produced a lineup of five RBI props.
    const rows = [
      ...Array.from({ length: 8 }, (_, i) =>
        cand({ id: `rbi${i}`, prop_type: "rbi", player_name: `R${i}`, line: 0.5, confidence: 0.9 - i * 0.01 })),
      cand({ id: "ml", bet_type: "moneyline", prop_type: "moneyline", event_id: "e1", direction: "home", confidence: 0.7 }),
      cand({ id: "tot", bet_type: "over_under", prop_type: "total", event_id: "e2", direction: "over", confidence: 0.68 }),
      cand({ id: "hit1", prop_type: "hits", player_name: "H1", line: 0.5, confidence: 0.66 }),
    ];
    const picks = selectTodaysEdgePicks(rows, 5).picks;

    expect(picks).toHaveLength(5);
    const rbiCount = picks.filter((p) => p.prop_type === "rbi").length;
    expect(rbiCount).toBeLessThanOrEqual(2);
    // A five-pick lineup should span several kinds of bet.
    expect(new Set(picks.map(edgeCategoryOf)).size).toBeGreaterThanOrEqual(3);
  });

  it("lets game markets through even when props outscore them", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        cand({ id: `rbi${i}`, prop_type: "rbi", player_name: `R${i}`, line: 0.5, confidence: 0.95 })),
      cand({ id: "ml", bet_type: "moneyline", prop_type: "moneyline", event_id: "e1", direction: "home", confidence: 0.55 }),
      cand({ id: "tot", bet_type: "over_under", prop_type: "total", event_id: "e2", direction: "over", confidence: 0.54 }),
    ];
    const ids = selectTodaysEdgePicks(rows, 5).picks.map((p) => p.id);
    expect(ids).toContain("ml");
    expect(ids).toContain("tot");
  });

  it("still ranks by quality inside a category", () => {
    const rows = [
      cand({ id: "weak", prop_type: "rbi", player_name: "W", line: 0.5, confidence: 0.51 }),
      cand({ id: "strong", prop_type: "rbi", player_name: "S", line: 0.5, confidence: 0.92 }),
      cand({ id: "mid", prop_type: "rbi", player_name: "M", line: 0.5, confidence: 0.7 }),
    ];
    const ids = selectTodaysEdgePicks(rows, 2).picks.map((p) => p.id);
    expect(ids).toEqual(["strong", "mid"]);
  });

  it("fills the lineup even when a thin slate has too few categories", () => {
    // Relaxing the cap beats showing a short lineup.
    const rows = Array.from({ length: 5 }, (_, i) =>
      cand({ id: `rbi${i}`, prop_type: "rbi", player_name: `R${i}`, line: 0.5, confidence: 0.8 - i * 0.01 }));
    expect(selectTodaysEdgePicks(rows, 5).picks).toHaveLength(5);
  });

  it("treats total and over_under as the same market", () => {
    expect(edgeCategoryOf({ id: "a", sport: "mlb", bet_type: "total" }))
      .toBe(edgeCategoryOf({ id: "b", sport: "mlb", bet_type: "over_under" }));
  });

  it("separates a game market from a prop", () => {
    expect(edgeCategoryOf({ id: "a", sport: "mlb", bet_type: "moneyline" }))
      .not.toBe(edgeCategoryOf({ id: "b", sport: "mlb", bet_type: "prop", prop_type: "rbi" }));
  });
});

describe("UFC fight-winner lineup eligibility", () => {
  // UFC is uncalibrated (no graded history yet), so its picks can only ever
  // reach the lineup through the fallback lane. These assert the shape the
  // scanner now writes is actually selectable, and that it is presented as a
  // model score rather than a win probability.
  function ufcFightPick(
    id: string,
    fighter: string,
    confidence: number,
    overrides: Partial<TodaysEdgeCandidate> = {},
  ): TodaysEdgeCandidate {
    return {
      id,
      sport: "ufc",
      tier: "daily",
      score_kind: "heuristic_score",
      calibration_status: "not_calibrated",
      confidence,
      hit_rate: confidence,
      event_id: `ufc-event-${id}`,
      bet_type: "moneyline",
      prop_type: "moneyline",
      direction: "win",
      line: 0,
      team: fighter,
      player_name: `${fighter} vs Opponent`,
      home_team: "Opponent",
      away_team: fighter,
      model_diagnostics: {
        shadow_edge_candidate: true,
        confidenceSource: "analyzer",
        shadow_edge_warning: "Model score only — not yet calibrated for this sport.",
      },
      ...overrides,
    };
  }

  it("selects an analyzer-backed UFC fight winner as a fallback pick", () => {
    const result = selectTodaysEdgePicks([ufcFightPick("ufc-1", "Fighter A", 0.72)], 5);

    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].sport).toBe("ufc");
    expect(result.picks[0].edgePresentation).toBe("fallback");
    // Never presented as a calibrated win probability.
    expect(result.picks[0].calibrated_probability).toBeUndefined();
    expect(result.picks[0].edgeWarning).toContain("not yet calibrated");
  });

  it("refuses a UFC pick that carries scanner-only confidence", () => {
    // This is the state every UFC pick was in before the matchup analyzer was
    // wired up — it must not be publishable.
    const result = selectTodaysEdgePicks([
      ufcFightPick("ufc-scanner", "Fighter A", 0.80, {
        model_diagnostics: { shadow_edge_candidate: true, confidenceSource: "scanner" },
      }),
    ], 5);

    expect(result.picks).toHaveLength(0);
  });

  it("keeps a UFC fight winner alongside other sports' picks", () => {
    const result = selectTodaysEdgePicks([
      fallbackPick("mlb-1", "mlb", 0.78),
      ufcFightPick("ufc-1", "Fighter A", 0.74),
    ], 5);

    expect(result.picks.map((pick) => pick.sport).sort()).toEqual(["mlb", "ufc"]);
  });
});
