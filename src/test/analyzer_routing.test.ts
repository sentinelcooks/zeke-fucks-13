import { describe, expect, it } from "vitest";
import {
  analyzerConfidenceRaw,
  buildAnalyzerRequest,
  selectAnalyzerPoolDiversifiedByBetType,
  teamMarketExclusivityKey,
} from "../../supabase/functions/_shared/analyzer_routing";

describe("analyzer market routing", () => {
  it("routes WNBA player props through the multi-sport player analyzer", () => {
    const route = buildAnalyzerRequest({
      sport: "wnba",
      bet_type: "prop",
      player_name: "A'ja Wilson",
      team: "Las Vegas Aces",
      opponent: "Minnesota Lynx",
      home_team: "Las Vegas Aces",
      away_team: "Minnesota Lynx",
      prop_type: "points",
      line: 24.5,
      direction: "over",
    });

    expect(route.endpoint).toBe("nba-api/analyze");
    expect(route.payload).toMatchObject({
      player: "A'ja Wilson",
      sport: "wnba",
      bet_type: "player_prop",
      prop_type: "points",
      line: 24.5,
      over_under: "over",
    });
  });

  it("routes MLB moneylines with the selected team as team1", () => {
    const route = buildAnalyzerRequest({
      sport: "mlb",
      bet_type: "moneyline",
      player_name: "Chicago Cubs @ Milwaukee Brewers",
      team: "Milwaukee Brewers",
      opponent: "Chicago Cubs",
      home_team: "Milwaukee Brewers",
      away_team: "Chicago Cubs",
      prop_type: "moneyline",
      line: 0,
      direction: "home",
    });

    expect(route.endpoint).toBe("moneyline-api/analyze");
    expect(route.payload).toMatchObject({
      bet_type: "moneyline",
      team1: "Milwaukee Brewers",
      team2: "Chicago Cubs",
      sport: "mlb",
    });
  });

  it("sends real spread and total lines to the game-line analyzer", () => {
    const spread = buildAnalyzerRequest({
      sport: "wnba",
      bet_type: "spread",
      team: "New York Liberty",
      home_team: "New York Liberty",
      away_team: "Seattle Storm",
      prop_type: "spread",
      line: -5.5,
      spread_line: -5.5,
      direction: "home",
    });
    const total = buildAnalyzerRequest({
      sport: "mlb",
      bet_type: "total",
      home_team: "Los Angeles Dodgers",
      away_team: "San Diego Padres",
      prop_type: "total",
      line: 8.5,
      total_line: 8.5,
      direction: "under",
    });

    expect(spread.payload).toMatchObject({
      spread_team: "New York Liberty",
      spread_line: -5.5,
      team2: "Seattle Storm",
    });
    expect(total.payload).toMatchObject({
      total_line: 8.5,
      over_under: "under",
      team1: "Los Angeles Dodgers",
      team2: "San Diego Padres",
    });
  });

  it("reads moneyline-api team1 probability as analyzer confidence", () => {
    expect(analyzerConfidenceRaw({ team1_pct: 66, verdict: "Lean" })).toBe(66);
  });

  it("preserves the existing UFC analyzer payload while team markets change", () => {
    const route = buildAnalyzerRequest({
      sport: "ufc",
      bet_type: "moneyline",
      player_name: "Fighter A vs Fighter B",
      team: "Fighter A",
      opponent: "Fighter B",
      prop_type: "moneyline",
      line: 0,
      direction: "win",
    });

    expect(route.endpoint).toBe("ufc-api/analyze");
    expect(route.payload).toMatchObject({
      player: "Fighter A vs Fighter B",
      bet_type: "player_prop",
      sport: "ufc",
    });
  });
});

describe("analyzer pool market diversity", () => {
  it("keeps props, moneylines, spreads, and totals in a prop-heavy slate", () => {
    const props = Array.from({ length: 100 }, (_, index) => ({
      id: `prop-${index}`,
      bet_type: "prop",
      edge: 0.25 - index / 1000,
    }));
    const gameLines = ["moneyline", "spread", "total"].flatMap((betType) =>
      Array.from({ length: 8 }, (_, index) => ({
        id: `${betType}-${index}`,
        bet_type: betType,
        edge: 0.04 - index / 1000,
      })),
    );

    const result = selectAnalyzerPoolDiversifiedByBetType(
      [...props, ...gameLines],
      45,
      6,
    );

    expect(result.selected).toHaveLength(45);
    expect(new Set(result.selected.map((candidate) => candidate.bet_type))).toEqual(
      new Set(["prop", "moneyline", "spread", "total"]),
    );
    for (const betType of ["moneyline", "spread", "total"]) {
      expect(result.selected.filter((candidate) => candidate.bet_type === betType)).toHaveLength(6);
    }
  });
});

describe("team-market exclusivity", () => {
  const matchup = {
    sport: "mlb",
    event_id: "dodgers-rockies-2026-08-17",
    home_team: "Colorado Rockies",
    away_team: "Los Angeles Dodgers",
  };

  it("groups opposing spread selections into one game-market slot", () => {
    const dodgers = teamMarketExclusivityKey({
      ...matchup,
      bet_type: "spread",
      team: "Los Angeles Dodgers",
      direction: "away",
      spread_line: -3.5,
    });
    const rockies = teamMarketExclusivityKey({
      ...matchup,
      bet_type: "spread",
      team: "Colorado Rockies",
      direction: "home",
      spread_line: 2.5,
    });

    expect(dodgers).toBe(rockies);
  });

  it("groups over and under selections into one totals slot", () => {
    const over = teamMarketExclusivityKey({
      ...matchup,
      bet_type: "total",
      direction: "over",
      total_line: 11.5,
    });
    const under = teamMarketExclusivityKey({
      ...matchup,
      bet_type: "over_under",
      direction: "under",
      total_line: 11.5,
    });

    expect(over).toBe(under);
  });

  it("keeps different events separate", () => {
    const first = teamMarketExclusivityKey({ ...matchup, bet_type: "moneyline" });
    const second = teamMarketExclusivityKey({
      ...matchup,
      event_id: "dodgers-rockies-2026-08-18",
      bet_type: "moneyline",
    });

    expect(first).not.toBe(second);
  });

  it("does not collapse player props", () => {
    expect(teamMarketExclusivityKey({
      ...matchup,
      bet_type: "prop",
      player_name: "Shohei Ohtani",
      prop_type: "hits",
      direction: "over",
      line: 1.5,
    })).toBeNull();
  });
});
