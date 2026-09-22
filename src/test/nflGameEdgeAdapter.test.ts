import { describe, expect, it } from "vitest";
import sample from "./fixtures.nfl-game-analysis.json";
import {
  adaptNflGameEdgeResponse,
  buildNflGameEdgeRequest,
  type NflGameEdgeResponse,
} from "@/lib/nflGameEdgeAdapter";

// Real nfl-game-edge response (ATL @ GB, 2026 week 3).
const model = () => JSON.parse(JSON.stringify(sample)) as NflGameEdgeResponse;
const opts = { oddsEventId: "evt1", homeTeamName: "Green Bay Packers", awayTeamName: "Atlanta Falcons" };

describe("buildNflGameEdgeRequest", () => {
  const body = {
    sport: "nfl", bet_type: "spread", odds_home_team: "Green Bay Packers", odds_away_team: "Atlanta Falcons",
    odds_event_id: "evt1", odds_commence_time: "2026-09-25T00:15:00Z", team1: "Atlanta Falcons", spread_line: 6.5,
  };

  it("routes NFL game markets to nfl-game-edge with the tapped side", () => {
    const req = buildNflGameEdgeRequest(body)!;
    expect(req.fn).toBe("nfl-game-edge");
    expect(req.payload).toMatchObject({ home_team: "Green Bay Packers", away_team: "Atlanta Falcons" });
    expect(req.options.side).toBe("away");
    expect(buildNflGameEdgeRequest({ ...body, team1: "Green Bay Packers" })!.options.side).toBe("home");
  });

  it("ignores other sports and non-game markets", () => {
    expect(buildNflGameEdgeRequest({ ...body, sport: "mlb" })).toBeNull();
    expect(buildNflGameEdgeRequest({ ...body, bet_type: "player_prop" })).toBeNull();
  });
});

describe("adaptNflGameEdgeResponse", () => {
  it("presents an unproven market as a directional lean, never a recommendation", () => {
    const out = adaptNflGameEdgeResponse(model(), { ...opts, market: "moneyline", side: "home" });
    expect(out.probability_supported).toBe(false);
    expect(out.score_kind).toBe("heuristic_score");
    expect(out.decision?.conviction_tier).toBe("noBet");
    expect(out.decision?.recommended_units).toBe(0);
    expect(out.verdict).toMatch(/Forward testing/);
    expect(out.factorBreakdown?.length).toBeGreaterThan(0);
    expect(out.writeup).toMatch(/projects/);
  });

  it("mirrors orientation for the away side", () => {
    const home = adaptNflGameEdgeResponse(model(), { ...opts, market: "moneyline", side: "home" });
    const away = adaptNflGameEdgeResponse(model(), { ...opts, market: "moneyline", side: "away" });
    expect(home.team1?.name).toBe("Green Bay Packers");
    expect(away.team1?.name).toBe("Atlanta Falcons");
    expect(Number(home.team1_pct) + Number(away.team1_pct)).toBeCloseTo(100, 1);
    // Both sides name the same favourite.
    expect(home.decision?.winning_team_name).toBe(away.decision?.winning_team_name);
    // A factor helping the home side must hurt the away side.
    const key = "factor_20"; // home field
    const h = home.factorBreakdown?.find((f) => f.name === key)?.score ?? 50;
    const a = away.factorBreakdown?.find((f) => f.name === key)?.score ?? 50;
    expect(h).toBeGreaterThan(50);
    expect(a).toBeLessThan(50);
  });

  it("presents a PLAY market as a calibrated recommendation", () => {
    const m = model();
    m.results = m.results!.map((r) => (r.market_type === "moneyline" && r.side === "home" ? { ...r, status: "PLAY" as const, no_play_reasons: [] } : r));
    const out = adaptNflGameEdgeResponse(m, { ...opts, market: "moneyline", side: "home" });
    expect(out.probability_supported).toBe(true);
    expect(out.score_kind).toBe("calibrated_probability");
    expect(out.decision?.recommended_units).toBe(1);
    expect(out.verdict).toBe("PLAY");
  });

  it("uses the requested total side and reports errors", () => {
    const under = adaptNflGameEdgeResponse(model(), { ...opts, market: "total", side: "home", totalSide: "under" });
    expect(under.decision?.winning_side === "under" || under.decision?.winning_side === "over").toBe(true);
    expect(adaptNflGameEdgeResponse({ error: "Game not found", reason: "no schedule row" }, { ...opts, market: "total", side: "home" }).error)
      .toBe("Game not found: no schedule row");
  });
});
