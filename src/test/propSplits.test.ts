import { describe, expect, it } from "vitest";
import { boxScoreColumns, dateLabel, formatLine, hitRate, lineStep, opponentOf, parseGames, splitGames } from "@/lib/propSplits";

describe("dateLabel", () => {
  it("shortens MM/DD from the analyzer", () => {
    expect(dateLabel("09/05")).toBe("9/5");
    expect(dateLabel("12/31")).toBe("12/31");
  });
  it("reads ISO dates without timezone drift", () => {
    expect(dateLabel("2026-09-15")).toBe("9/15");
    expect(dateLabel("2026-09-15T23:10:00Z")).toBe("9/15");
  });
  it("passes through anything else", () => {
    expect(dateLabel("Wk 3")).toBe("Wk 3");
    expect(dateLabel(undefined)).toBe("");
  });
});

describe("opponentOf", () => {
  it("parses home and away matchups", () => {
    expect(opponentOf("LAL vs. DEN")).toEqual({ opponent: "DEN", away: false });
    expect(opponentOf("LAL @ DEN")).toEqual({ opponent: "DEN", away: true });
  });
  it("handles missing matchups", () => {
    expect(opponentOf(undefined)).toEqual({ opponent: "", away: false });
  });
});

describe("parseGames", () => {
  it("keeps chronological order and drops rows without a finite stat", () => {
    const rows = [
      { date: "09/01", matchup: "DET vs. KC", result: "W", stat_value: 9 },
      { date: "09/06", matchup: "DET @ MIN", result: "L", stat_value: null },
      { date: "09/11", matchup: "DET @ CWS", result: "W", stat_value: "7" },
    ];
    const games = parseGames(rows);
    expect(games.map((g) => g.value)).toEqual([9, 7]);
    expect(games.map((g) => g.index)).toEqual([0, 2]);
    expect(games[1]).toMatchObject({ opponent: "CWS", away: true, result: "W", dateLabel: "9/11" });
  });
  it("returns [] for non-arrays", () => {
    expect(parseGames(undefined)).toEqual([]);
    expect(parseGames({})).toEqual([]);
  });
});

describe("hitRate", () => {
  it("matches the analyzer: strict over/under, pushes count as misses", () => {
    expect(hitRate([8, 7.5, 6, 9], 7.5, "over")).toEqual({ hits: 2, total: 4, pct: 50 });
    expect(hitRate([8, 7.5, 6, 9], 7.5, "under")).toEqual({ hits: 1, total: 4, pct: 25 });
  });
  it("returns a null percentage when there are no games", () => {
    expect(hitRate([], 7.5, "over")).toEqual({ hits: 0, total: 0, pct: null });
  });
});

describe("splitGames", () => {
  const games = parseGames(Array.from({ length: 25 }, (_, i) => ({ date: `09/${String(i + 1).padStart(2, "0")}`, stat_value: i })));
  const h2h = parseGames([{ date: "04/12", matchup: "DET vs. CLE", stat_value: 8 }]);
  it("takes the most recent N games for L5/L10/L20", () => {
    expect(splitGames(games, h2h, "l5").map((g) => g.value)).toEqual([20, 21, 22, 23, 24]);
    expect(splitGames(games, h2h, "l10")).toHaveLength(10);
    expect(splitGames(games, h2h, "l20")[0].value).toBe(5);
  });
  it("uses every game for the season and the h2h games for H2H", () => {
    expect(splitGames(games, h2h, "season")).toHaveLength(25);
    expect(splitGames(games, h2h, "h2h").map((g) => g.value)).toEqual([8]);
  });
});

describe("boxScoreColumns", () => {
  const keys = (cols: Array<[string, string]>) => cols.map(([k]) => k);
  it("shows pitching columns for pitcher props and hitting columns otherwise", () => {
    expect(keys(boxScoreColumns("mlb", "strikeouts"))).toEqual(["IP", "K", "ER", "BB", "OUTS", "PC"]);
    expect(keys(boxScoreColumns("mlb", "total_bases"))).toContain("TB");
    expect(keys(boxScoreColumns("mlb", "total_bases"))).not.toContain("IP");
  });
  it("covers NHL, first-quarter and basketball props", () => {
    expect(keys(boxScoreColumns("nhl", "sog"))).toContain("SOG");
    expect(keys(boxScoreColumns("nba", "1q_points"))[0]).toBe("Q1_PTS");
    expect(keys(boxScoreColumns("wnba", "points"))).toEqual(["MIN", "PTS", "REB", "AST", "FG3M", "STL", "BLK"]);
  });
});

describe("lineStep / formatLine", () => {
  it("steps by the size of the line", () => {
    expect(lineStep(7.5)).toBe(0.5);
    expect(lineStep(24.5)).toBe(1);
    expect(lineStep(243.5)).toBe(5);
  });
  it("formats whole and half lines", () => {
    expect(formatLine(7)).toBe("7");
    expect(formatLine(7.5)).toBe("7.5");
    expect(formatLine(0.30000000000000004)).toBe("0.3");
  });
});
