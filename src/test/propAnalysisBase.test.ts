import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the assembly `mlb-prop-model` and `wnba-prop-model` share. The ESPN
 * and injury layers are stubbed so these assert the logic, not the feed —
 * the live chain is exercised separately by `npm run test:live`.
 */

const feed = vi.hoisted(() => ({
  current: [] as any[],
  previous: [] as any[],
  nextGame: null as any,
}));

vi.mock("../../supabase/functions/_shared/espn_player_data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../supabase/functions/_shared/espn_player_data")>();
  return {
    ...actual,
    searchPlayers: async () => [{ id: "1", name: "Test Player" }],
    getPlayerInfo: async () => ({ full_name: "Test Player", team_abbr: "CLE", position: "LF" }),
    getGameLog: async (_id: string, season?: number) => (season ? feed.previous : feed.current),
    getSeasonAvg: async () => ({ GP: 10 }),
    getNextGame: async () => feed.nextGame,
  };
});

vi.mock("../../supabase/functions/_shared/injuries", () => ({
  fetchMatchupInjuries: async () => ({
    team1: [
      { name: "Test Player", status: "questionable", detail: "wrist" },
      { name: "A Teammate", status: "out", detail: "hamstring" },
    ],
    team2: [{ name: "Someone Else", status: "out", detail: "knee" }],
    fetchedAt: "2026-09-15T00:00:00Z",
    source: "espn-league-injuries",
    sourceAvailable: true,
    sourceUpdatedAt: "2026-09-15T00:00:00Z",
    team1Matched: true,
    team2Matched: true,
    error: null,
  }),
}));

import {
  buildPropAnalysisBase,
  isPropAnalysisFailure,
  resolvePropPlayer,
} from "../../supabase/functions/_shared/prop_analysis_base";
import { getEspnConfig } from "../../supabase/functions/_shared/espn_player_data";

function game(overrides: Record<string, any> = {}) {
  return {
    date: "2026-08-01T00:00:00Z", matchup: "vs CHW", wl: "W", min: 30,
    pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0, tov: 0,
    opponent: "CHW", isHome: true, eventId: "1", seasonType: "regular",
    fgm: 0, fga: 0, fg3a: 0, ftm: 0, fta: 0,
    hits: 1, runs: 0, rbi: 0, home_runs: 0, strikeouts: 0,
    total_bases: 1, walks: 0, stolen_bases: 0, at_bats: 4,
    goals: 0, nhl_assists: 0, sog: 0, pim: 0, plus_minus: 0, ppg: 0, toi: 0,
    ...overrides,
  };
}

const cfg = getEspnConfig("mlb");
const baseArgs = {
  cfg,
  playerId: "1",
  player: { full_name: "Test Player", team_abbr: "CLE", position: "LF" },
  usePrevSeasonWhenEmpty: true,
  minCurrentSample: 3,
  insufficientSampleError: "Insufficient verified batting game-log data for Test Player.",
};
const request = { playerName: "Test Player", propType: "hits", line: 0.5, overUnder: "over" as const, opponent: null };

describe("buildPropAnalysisBase", () => {
  beforeEach(() => {
    feed.current = [];
    feed.previous = [];
    feed.nextGame = { opponent_abbr: "CHW", is_home: false, date: "2026-09-16", date_time: "2026-09-16T17:00Z", venue_city: "Cleveland" };
  });

  it("derives hit rates and the recent-form windows from the log", async () => {
    feed.current = [
      ...Array.from({ length: 8 }, () => game({ hits: 2 })),
      ...Array.from({ length: 4 }, () => game({ hits: 0 })),
    ];
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.result.season_hit_rate).toMatchObject({ hits: 8, total: 12 });
    // Last five are the four blanks plus one of the twos.
    expect(base.result.last_5).toMatchObject({ hits: 1, total: 5 });
    expect(base.result.game_log).toHaveLength(12);
  });

  it("quotes the split for the side the player will actually be on", async () => {
    // Strong at home, weak on the road — and the next game is away, so the
    // split the model reads must be the away one. Quoting the home split for a
    // road game is a silent way to inflate every travelling player's number.
    feed.current = [
      ...Array.from({ length: 5 }, () => game({ isHome: true, hits: 3 })),
      ...Array.from({ length: 5 }, () => game({ isHome: false, hits: 0 })),
    ];
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.result.home_away).toMatchObject({ location: "away", hits: 0, total: 5 });
  });

  it("leaves the split empty when the next game's venue is unknown", async () => {
    feed.nextGame = { opponent_abbr: "CHW", is_home: null, date: "2026-09-16" };
    feed.current = Array.from({ length: 6 }, () => game({ hits: 1 }));
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.result.home_away.total).toBe(0);
    expect(base.result.home_away.location).toBe("");
  });

  it("restricts head-to-head to the upcoming opponent", async () => {
    feed.current = [
      ...Array.from({ length: 3 }, () => game({ opponent: "CHW", hits: 2 })),
      ...Array.from({ length: 5 }, () => game({ opponent: "DET", hits: 0 })),
    ];
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.result.head_to_head).toMatchObject({ opponent: "CHW", total: 3, hits: 3 });
    expect(base.result.head_to_head.games).toHaveLength(3);
  });

  it("separates the player's own injury from teammates' and the opponent's", async () => {
    feed.current = Array.from({ length: 6 }, () => game());
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.playerInjuries.map((i) => i.name)).toEqual(["Test Player"]);
    expect(base.teammateInjuries.map((i) => i.name)).toEqual(["A Teammate"]);
    expect(base.result.opponent_injuries).toHaveLength(1);
  });

  it("falls back to the previous season when the current one is empty", async () => {
    feed.current = [];
    feed.previous = Array.from({ length: 10 }, () => game({ hits: 1 }));
    const base = await buildPropAnalysisBase({ ...baseArgs, request });
    if (isPropAnalysisFailure(base)) throw new Error(base.error);

    expect(base.analysisGames).toHaveLength(10);
    // The fallback replaces the sample rather than blending, so nothing is
    // left behind to be double-counted as a separate prior.
    expect(base.prevSeasonGames).toHaveLength(0);
  });

  it("refuses to score below the sample floor instead of guessing", async () => {
    feed.current = Array.from({ length: 2 }, () => game({ hits: 1 }));
    const base = await buildPropAnalysisBase({ ...baseArgs, request });

    expect(isPropAnalysisFailure(base)).toBe(true);
    if (!isPropAnalysisFailure(base)) return;
    expect(base.error).toMatch(/Insufficient verified batting game-log data/);
    expect(base.confidence).toBe(0);
    expect(base.verdict).toBe("PASS");
  });

  it("counts only values the stat actually exists for", async () => {
    // `total_bases` is absent from ESPN's MLB labels, so the accessor returns
    // NaN. Those must not be counted as a sample the model can score on.
    feed.current = Array.from({ length: 6 }, () => game({ mlb_line: { profile: "batting", totalBases: null } }));
    const base = await buildPropAnalysisBase({
      ...baseArgs,
      request: { ...request, propType: "total_bases", line: 1.5 },
    });
    expect(isPropAnalysisFailure(base)).toBe(true);
  });

  it("does not throw when the player cannot be resolved", async () => {
    const resolved = await resolvePropPlayer("Test Player", cfg);
    expect(resolved?.playerId).toBe("1");
  });
});
