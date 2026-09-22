import { describe, it, expect } from "vitest";
import { selectYesterdayEdgeRecap, oddsWithinGuard } from "@/lib/yesterdayEdgeRecap";

const YESTERDAY = "2026-09-10";

// Mirrors what the scanners actually write today: tier=daily rows flagged as
// analyzer-backed shadow edge candidates. No tier=edge rows have been emitted
// since 2026-08-18.
function shadowCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    sport: "mlb",
    tier: "daily",
    status: null,
    result: "pending",
    score_kind: "heuristic_score",
    confidence: 0.7,
    odds: "-120",
    game_date: YESTERDAY,
    player_name: "Ben Rice",
    prop_type: "home_runs",
    line: 0.5,
    event_id: "evt-1",
    model_diagnostics: {
      shadow_edge_candidate: true,
      confidenceSource: "analyzer",
    },
    ...overrides,
  };
}

describe("selectYesterdayEdgeRecap", () => {
  it("surfaces analyzer-backed tier=daily picks (the tier=edge regression)", () => {
    const rows = [shadowCandidate()];
    const picks = selectYesterdayEdgeRecap(rows, YESTERDAY);

    // The old implementation filtered on tier === "edge" and returned nothing,
    // pinning the card to "No edge yesterday" permanently.
    expect(picks).toHaveLength(1);
    expect(picks[0].id).toBe("p1");
  });

  it("keeps graded rows so hits and misses can be displayed", () => {
    const rows = [
      shadowCandidate({ id: "hit", result: "hit", event_id: "e1" }),
      shadowCandidate({ id: "miss", result: "miss", event_id: "e2", confidence: 0.65 }),
    ];
    const picks = selectYesterdayEdgeRecap(rows, YESTERDAY);

    expect(picks.map((p) => p.result).sort()).toEqual(["hit", "miss"]);
  });

  it("only returns picks whose game is the target date", () => {
    const rows = [
      shadowCandidate({ id: "yesterday", event_id: "e1" }),
      shadowCandidate({ id: "today", game_date: "2026-09-11", event_id: "e2" }),
      shadowCandidate({ id: "older", game_date: "2026-09-09", event_id: "e3" }),
    ];
    const picks = selectYesterdayEdgeRecap(rows, YESTERDAY);

    expect(picks.map((p) => p.id)).toEqual(["yesterday"]);
  });

  it("falls back to commence_time when game_date is null (legacy rows)", () => {
    const rows = [
      shadowCandidate({
        id: "legacy",
        game_date: null,
        commence_time: "2026-09-10T23:05:00+00:00",
      }),
    ];

    expect(selectYesterdayEdgeRecap(rows, YESTERDAY).map((p) => p.id)).toEqual(["legacy"]);
  });

  it("drops pass tier, empty_slate rows, and extreme longshots", () => {
    const rows = [
      shadowCandidate({ id: "keep", event_id: "e0" }),
      shadowCandidate({ id: "pass", tier: "pass", event_id: "e1" }),
      shadowCandidate({ id: "empty", status: "empty_slate", event_id: "e2" }),
      shadowCandidate({ id: "longshot", odds: "+1400", event_id: "e3" }),
    ];

    expect(selectYesterdayEdgeRecap(rows, YESTERDAY).map((p) => p.id)).toEqual(["keep"]);
  });

  it("honours the limit and ranks by model score", () => {
    const rows = [
      shadowCandidate({ id: "low", confidence: 0.55, event_id: "e1" }),
      shadowCandidate({ id: "high", confidence: 0.91, event_id: "e2" }),
      shadowCandidate({ id: "mid", confidence: 0.72, event_id: "e3" }),
    ];
    const picks = selectYesterdayEdgeRecap(rows, YESTERDAY, 2);

    expect(picks.map((p) => p.id)).toEqual(["high", "mid"]);
  });

  it("returns nothing when the slate genuinely had no qualifying picks", () => {
    const rows = [shadowCandidate({ id: "x", model_diagnostics: null, tier: "value" })];

    expect(selectYesterdayEdgeRecap(rows, YESTERDAY)).toEqual([]);
  });
});

describe("oddsWithinGuard", () => {
  it("allows missing and unparseable odds", () => {
    expect(oddsWithinGuard(null)).toBe(true);
    expect(oddsWithinGuard("")).toBe(true);
    expect(oddsWithinGuard("EVEN")).toBe(true);
  });

  it("rejects |odds| >= 1000", () => {
    expect(oddsWithinGuard("-999")).toBe(true);
    expect(oddsWithinGuard("+1000")).toBe(false);
    expect(oddsWithinGuard("-1200")).toBe(false);
  });
});
