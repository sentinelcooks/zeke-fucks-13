import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWnbaAvailability,
  buildWnbaTeamMetrics,
  deriveWnbaEfficiency,
  detectMinutesRestriction,
  parseWnbaLineupContext,
  scoreWnbaPlayerProp,
  scoreWnbaTeamMarket,
  selectWnbaConsensusMarkets,
  type WnbaAvailability,
  type WnbaEfficiency,
  type WnbaTeamMetrics,
} from "../../supabase/functions/_shared/wnba_model";
import { fetchTeamInjuryReport } from "../../supabase/functions/_shared/injuries";
import { buildWnbaQueueFinalization } from "../../supabase/functions/_shared/nba_queue_finalization";
import type { ScoredPlay } from "../../supabase/functions/_shared/edge_scoring";

function competition(args: {
  id: string;
  date: string;
  teamId: string;
  opponentId: string;
  teamScore: number;
  opponentScore: number;
  home?: boolean;
  city?: string;
  final?: boolean;
}) {
  return {
    id: args.id,
    date: args.date,
    status: { type: { name: args.final === false ? "STATUS_SCHEDULED" : "STATUS_FINAL", completed: args.final !== false } },
    competitions: [{
      status: { type: { name: args.final === false ? "STATUS_SCHEDULED" : "STATUS_FINAL", completed: args.final !== false } },
      venue: { address: { city: args.city ?? "Las Vegas" } },
      competitors: [
        {
          id: args.teamId,
          team: { id: args.teamId, abbreviation: "LV" },
          homeAway: args.home === false ? "away" : "home",
          score: { value: args.teamScore },
          winner: args.teamScore > args.opponentScore,
        },
        {
          id: args.opponentId,
          team: { id: args.opponentId, abbreviation: "MIN" },
          homeAway: args.home === false ? "home" : "away",
          score: { value: args.opponentScore },
          winner: args.opponentScore > args.teamScore,
        },
      ],
    }],
  };
}

function metrics(overrides: Partial<WnbaTeamMetrics> = {}): WnbaTeamMetrics {
  const split = {
    games: 8,
    wins: 6,
    losses: 2,
    winRate: 0.75,
    pointsFor: 86,
    pointsAgainst: 78,
    netPoints: 8,
  };
  return {
    games: 16,
    wins: 12,
    losses: 4,
    winRate: 0.75,
    pointsFor: 86,
    pointsAgainst: 78,
    netPoints: 8,
    recentGames: 10,
    recentPointsFor: 88,
    recentPointsAgainst: 77,
    recentNetPoints: 11,
    home: { ...split },
    away: { ...split },
    restDays: 2,
    backToBack: false,
    lastGameDate: "2026-08-15T00:00:00.000Z",
    lastVenueCity: "Las Vegas",
    ...overrides,
  };
}

const healthyAvailability: WnbaAvailability = {
  sourceAvailable: true,
  teamMatched: true,
  profiles: [],
  unavailableMinutes: 0,
  questionableMinutes: 0,
  missingMinutesProfiles: 0,
};

const strongEfficiency: WnbaEfficiency = {
  games: 16,
  pace: 81,
  offensiveRating: 110,
  defensiveRating: 96,
  source: "espn-team-statistics-derived",
};

describe("WNBA source integrity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the WNBA injury endpoint and reports source/team availability", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        timestamp: "2026-08-18T12:00:00Z",
        injuries: [{ id: "17", displayName: "Las Vegas Aces", injuries: [] }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const report = await fetchTeamInjuryReport("wnba", { id: "17" });
    expect(urls[0]).toContain("/basketball/wnba/injuries");
    expect(report.sourceAvailable).toBe(true);
    expect(report.team1Matched).toBe(true);
    expect(report.sourceUpdatedAt).toBe("2026-08-18T12:00:00.000Z");
  });

  it("does not silently substitute NBA for an unsupported injury sport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = await fetchTeamInjuryReport("unknown-league", { id: "17" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(report.sourceAvailable).toBe(false);
    expect(report.error).toContain("unsupported_injury_sport");
  });

  it("keeps missing injured-player minutes unknown instead of zero", () => {
    const result = buildWnbaAvailability(
      [{ name: "Starter", status: "out", detail: "ankle" }],
      {},
      true,
      true,
    );
    expect(result.unavailableMinutes).toBeNull();
    expect(result.missingMinutesProfiles).toBe(1);
  });
});

describe("WNBA pregame data boundaries", () => {
  it("excludes target/future games and calculates full rest days", () => {
    const events = [
      competition({ id: "1", date: "2026-08-10T23:00:00Z", teamId: "17", opponentId: "8", teamScore: 85, opponentScore: 80, city: "Las Vegas" }),
      competition({ id: "2", date: "2026-08-16T23:00:00Z", teamId: "17", opponentId: "8", teamScore: 90, opponentScore: 82, city: "Phoenix" }),
      competition({ id: "target", date: "2026-08-18T23:00:00Z", teamId: "17", opponentId: "8", teamScore: 120, opponentScore: 60, city: "Minnesota" }),
      competition({ id: "future", date: "2026-08-20T23:00:00Z", teamId: "17", opponentId: "8", teamScore: 120, opponentScore: 60 }),
    ];
    const result = buildWnbaTeamMetrics(events, "17", "2026-08-18T23:00:00Z");
    expect(result.games).toBe(2);
    expect(result.pointsFor).toBe(87.5);
    expect(result.restDays).toBe(1);
    expect(result.lastVenueCity).toBe("Phoenix");
  });

  it("derives possessions and ratings only from verified aggregate inputs", () => {
    const result = deriveWnbaEfficiency({
      gamesPlayed: 10,
      avgFieldGoalsAttempted: 70,
      avgOffensiveRebounds: 10,
      avgTurnovers: 14,
      avgFreeThrowsAttempted: 20,
      avgPoints: 84,
    }, metrics({ pointsAgainst: 78 }));
    expect(result.pace).toBeCloseTo(79.49, 2);
    expect(result.offensiveRating).toBeCloseTo(105.68, 2);
    expect(result.defensiveRating).toBeCloseTo(98.13, 2);
    expect(deriveWnbaEfficiency({ gamesPlayed: 10, avgPoints: 84 }, metrics()).source).toBe("unavailable");
  });

  it("confirms a lineup only when five official starters are present", () => {
    const athletes = Array.from({ length: 8 }, (_, index) => ({
      starter: index < 5,
      active: true,
      athlete: { displayName: index === 0 ? "A'ja Wilson" : `Player ${index}` },
    }));
    const confirmed = parseWnbaLineupContext({
      boxscore: { players: [{ team: { abbreviation: "LV" }, statistics: [{ athletes }] }] },
    }, "LV", "A'ja Wilson");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.playerStarting).toBe(true);

    const unconfirmed = parseWnbaLineupContext({ boxscore: { players: [] } }, "LV", "A'ja Wilson");
    expect(unconfirmed.status).toBe("unconfirmed");
    expect(unconfirmed.playerStarting).toBeNull();
  });
});

describe("WNBA consensus market discovery", () => {
  it("emits both sides at consensus lines without preselecting a favorite", () => {
    const bookmakers = ["a", "b", "c", "d"].map((book, index) => ({
      key: book,
      markets: [
        { key: "h2h", outcomes: [
          { name: "Las Vegas Aces", price: -150 + index },
          { name: "Minnesota Lynx", price: 130 + index },
        ] },
        { key: "spreads", outcomes: [
          { name: "Las Vegas Aces", price: -110 + index, point: -4.5 },
          { name: "Minnesota Lynx", price: -110 + index, point: 4.5 },
        ] },
        { key: "totals", outcomes: [
          { name: "Over", price: -108 + index, point: 165.5 },
          { name: "Under", price: -112 + index, point: 165.5 },
        ] },
      ],
    }));
    const selections = selectWnbaConsensusMarkets(bookmakers, "Las Vegas Aces", "Minnesota Lynx");
    expect(selections).toHaveLength(6);
    expect(selections.filter((row) => row.betType === "moneyline").map((row) => row.team)).toEqual([
      "Las Vegas Aces",
      "Minnesota Lynx",
    ]);
    expect(selections.filter((row) => row.betType === "spread").map((row) => row.line)).toEqual([-4.5, 4.5]);
    expect(selections.filter((row) => row.betType === "total").map((row) => row.direction)).toEqual(["over", "under"]);
    expect(selections.every((row) => row.bookCount === 4)).toBe(true);
  });
});

describe("WNBA player prop scoring", () => {
  const games = Array.from({ length: 16 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}T23:00:00Z`,
    value: index < 8 ? 24 : 30,
    minutes: index < 8 ? 31 : 35,
    isHome: index % 2 === 0,
    opponent: index % 3 === 0 ? "MIN" : "NY",
  }));
  const lineup = {
    status: "confirmed" as const,
    sourceAvailable: true,
    starters: ["Player"],
    playerListed: true,
    playerStarting: true,
    playerActive: true,
  };

  it("uses separate baseline and recent samples rather than counting L5 inside both", () => {
    const result = scoreWnbaPlayerProp({
      games,
      line: 25.5,
      direction: "over",
      propType: "points",
      opponent: "MIN",
      nextGameDate: "2026-08-01T23:00:00Z",
      isHome: true,
      lineup,
      playerAvailability: null,
      injurySourceAvailable: true,
      teamEfficiency: strongEfficiency,
      opponentEfficiency: { ...strongEfficiency, pace: 84, defensiveRating: 108 },
      targetVenueCity: "Las Vegas",
      lastVenueCity: "Las Vegas",
    });
    const baseline = result.factors.find((factor) => factor.name === "current_season_baseline");
    const recent = result.factors.find((factor) => factor.name === "recent_form");
    expect(baseline?.sampleSize).toBe(11);
    expect(recent?.sampleSize).toBe(5);
    expect(result.diagnostics.score_kind).toBe("heuristic_score");
    expect(result.diagnostics.probability_supported).toBe(false);
  });

  it("passes an officially unavailable player and detects minutes restrictions", () => {
    const result = scoreWnbaPlayerProp({
      games,
      line: 25.5,
      direction: "over",
      propType: "points",
      opponent: "MIN",
      nextGameDate: "2026-08-01T23:00:00Z",
      isHome: true,
      lineup,
      playerAvailability: { name: "Player", status: "out", minutesPerGame: 34, detail: "out" },
      injurySourceAvailable: true,
      teamEfficiency: strongEfficiency,
      opponentEfficiency: strongEfficiency,
    });
    expect(result.playerIsOut).toBe(true);
    expect(result.verdict).toBe("PASS");
    expect(detectMinutesRestriction("Available with a 22-minute restriction")).toBe(true);
  });

  it("caps thin prior-season fallback and leaves current sample separately reported", () => {
    const result = scoreWnbaPlayerProp({
      games: games.slice(0, 3),
      previousSeasonGames: Array.from({ length: 20 }, (_, index) => ({
        date: `2025-06-${String((index % 20) + 1).padStart(2, "0")}T23:00:00Z`,
        value: 40,
        minutes: 36,
        isHome: true,
        opponent: "MIN",
      })),
      line: 25.5,
      direction: "over",
      propType: "points",
      opponent: "MIN",
      nextGameDate: "2026-08-01T23:00:00Z",
      isHome: true,
      lineup,
      playerAvailability: null,
      injurySourceAvailable: true,
      teamEfficiency: strongEfficiency,
      opponentEfficiency: strongEfficiency,
    });
    expect(result.score).toBeLessThanOrEqual(55);
    expect(result.diagnostics.current_season_sample).toBe(3);
    expect(result.diagnostics.previous_season_used).toBe(true);
  });
});

describe("WNBA game-market selection and Edge gate", () => {
  it("scores opposing team selections symmetrically so only one side survives", () => {
    const weakMetrics = metrics({
      wins: 4, losses: 12, winRate: 0.25, pointsFor: 76, pointsAgainst: 88, netPoints: -12,
      recentPointsFor: 74, recentPointsAgainst: 90, recentNetPoints: -16,
      home: { ...metrics().home, wins: 2, losses: 6, winRate: 0.25, pointsFor: 76, pointsAgainst: 88, netPoints: -12 },
      away: { ...metrics().away, wins: 2, losses: 6, winRate: 0.25, pointsFor: 76, pointsAgainst: 88, netPoints: -12 },
    });
    const weakEfficiency = { ...strongEfficiency, offensiveRating: 92, defensiveRating: 112 };
    const strong = scoreWnbaTeamMarket({
      market: "moneyline", selectedTeamName: "Las Vegas Aces", opponentTeamName: "Minnesota Lynx",
      selectedMetrics: metrics(), opponentMetrics: weakMetrics,
      selectedEfficiency: strongEfficiency, opponentEfficiency: weakEfficiency,
      selectedAvailability: healthyAvailability, opponentAvailability: healthyAvailability,
      selectedIsHome: true,
    });
    const weak = scoreWnbaTeamMarket({
      market: "moneyline", selectedTeamName: "Minnesota Lynx", opponentTeamName: "Las Vegas Aces",
      selectedMetrics: weakMetrics, opponentMetrics: metrics(),
      selectedEfficiency: weakEfficiency, opponentEfficiency: strongEfficiency,
      selectedAvailability: healthyAvailability, opponentAvailability: healthyAvailability,
      selectedIsHome: false,
    });
    expect(strong.verdict).toMatch(/STRONG|LEAN/);
    expect(weak.verdict).toBe("PASS");
    expect(strong.score + weak.score).toBeCloseTo(100, 0);
  });

  it("blocks WNBA Edge when lineup or injury evidence is unavailable", () => {
    const play: ScoredPlay = {
      sport: "wnba", bet_type: "prop", player_name: "Player", team: "LV", opponent: "MIN",
      prop_type: "points", line: 25.5, direction: "over", odds: -110,
      projected_prob: 0.65, implied_prob: 0.524, raw_implied_prob: 0.524, edge: 0.126,
      ev_pct: 20, confidence: 0.65, raw_confidence: 0.7, reliability: 0.8,
      score: 0.08, quality_score: 0.08, verdict: "Lean", reasoning: "verified",
      model_diagnostics: {
        probability_supported: true,
        score_kind: "calibrated_probability",
        calibration_status: "validated",
      },
    };
    const result = buildWnbaQueueFinalization({
      baseDiagnostics: {
        wnba_data_quality: "high",
        injury_source_available: false,
        lineup_status: "unconfirmed",
        player_starting: null,
        player_availability: "not_listed",
        minutes_restriction: false,
        current_season_sample: 20,
        bookCount: 5,
        marketDataQuality: "medium",
      },
      currentEdgeCount: 0,
      edgeCap: 4,
      finalized: play,
    });
    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("wnba_injury_source_unavailable");
    expect(result.finalTier).toBe("daily");
  });

  it("allows a fully evidenced WNBA prop to reach Edge only after calibration", () => {
    const play: ScoredPlay = {
      sport: "wnba", bet_type: "prop", player_name: "Player", team: "LV", opponent: "MIN",
      prop_type: "points", line: 25.5, direction: "over", odds: -110,
      projected_prob: 0.65, implied_prob: 0.524, raw_implied_prob: 0.524, edge: 0.126,
      ev_pct: 20, confidence: 0.65, raw_confidence: 0.7, reliability: 0.8,
      score: 0.08, quality_score: 0.08, verdict: "Lean", reasoning: "verified",
      model_diagnostics: {
        probability_supported: true,
        score_kind: "calibrated_probability",
        calibration_status: "validated",
        edge_evidence_validated: true,
        evaluation_status: "validated",
      },
    };
    const result = buildWnbaQueueFinalization({
      baseDiagnostics: {
        wnba_data_quality: "high",
        injury_source_available: true,
        lineup_status: "confirmed",
        player_starting: true,
        player_availability: "not_listed",
        minutes_restriction: false,
        current_season_sample: 20,
        bookCount: 5,
        marketDataQuality: "medium",
      },
      currentEdgeCount: 0,
      edgeCap: 4,
      finalized: play,
    });
    expect(result.canPromote).toBe(true);
    expect(result.finalTier).toBe("edge");
  });

  it("blocks a WNBA team market until the matchup and both lineups are confirmed", () => {
    const play: ScoredPlay = {
      sport: "wnba", bet_type: "spread", player_name: "", team: "LV", opponent: "MIN",
      prop_type: "spread", line: -3.5, spread_line: -3.5, direction: "home", odds: -110,
      projected_prob: 0.65, implied_prob: 0.524, raw_implied_prob: 0.524, edge: 0.126,
      ev_pct: 20, confidence: 0.65, raw_confidence: 0.7, reliability: 0.8,
      score: 0.08, quality_score: 0.08, verdict: "Lean", reasoning: "verified",
      model_diagnostics: {
        probability_supported: true,
        score_kind: "calibrated_probability",
        calibration_status: "validated",
      },
    };
    const result = buildWnbaQueueFinalization({
      baseDiagnostics: {
        wnba_data_quality: "medium",
        injury_source_available: true,
        bookCount: 5,
        marketDataQuality: "high",
        selected_side_confirmed: true,
        current_season_samples: { selected: 20, opponent: 20 },
        matchup_confirmed: true,
        lineup_status: "unconfirmed",
      },
      currentEdgeCount: 0,
      edgeCap: 4,
      finalized: play,
    });

    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("wnba_starting_lineups_unconfirmed");
  });
});
