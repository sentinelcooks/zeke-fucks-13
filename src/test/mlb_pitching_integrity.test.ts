import { describe, expect, it } from "vitest";
import {
  buildLineupContext,
  buildPitcherProfileFromStats,
  calculateBullpenUsage,
  calculateCurrentParkFactors,
  calculatePitchTypeMatchup,
  emptyPitchSample,
  inningsToOuts,
  mlbStatValue,
  parseMlbLabeledStatLine,
  type ParkFactorAggregateInput,
} from "../../supabase/functions/_shared/mlb_data";
import {
  isMlbPitchingProp,
  normalizeMlbPropType,
  validateMlbPropLine,
} from "../../supabase/functions/_shared/prop_normalization";
import { applyGenericQualityPenalty } from "../../supabase/functions/_shared/model_confidence";

describe("MLB prop routing integrity", () => {
  it("routes ambiguous strikeouts from the verified player role", () => {
    expect(normalizeMlbPropType("strikeouts", "pitcher")).toBe("pitcher_strikeouts");
    expect(normalizeMlbPropType("strikeouts", "batter")).toBe("batter_strikeouts");
    expect(normalizeMlbPropType("pitcher strikeouts", "batter")).toBe("pitcher_strikeouts");
    expect(isMlbPitchingProp("pitcher_strikeouts")).toBe(true);
    expect(isMlbPitchingProp("batter_strikeouts")).toBe(false);
  });

  it("rejects impossible manual-analyzer lines before they reach the model", () => {
    const impossibleEarnedRuns = validateMlbPropLine("earned_runs", 700);

    expect(validateMlbPropLine("earned_runs", 2.5)).toMatchObject({ valid: true });
    expect(validateMlbPropLine("earned_runs", 9.5)).toMatchObject({ valid: true });
    expect(validateMlbPropLine("earned_runs", 15)).toMatchObject({ valid: false });
    expect(impossibleEarnedRuns).toMatchObject({
      valid: false,
      code: "INVALID_MLB_PROP_LINE",
      propType: "earned_runs",
    });
    if (!impossibleEarnedRuns.valid) {
      expect(impossibleEarnedRuns.error).toContain("not a realistic single-game MLB Earned Runs line");
    }
    expect(validateMlbPropLine("outs_recorded", 27)).toMatchObject({ valid: true });
    expect(validateMlbPropLine("outs_recorded", 27.5)).toMatchObject({ valid: false });
  });

  it("does not apply the generic data-quality penalty twice to verified MLB props", () => {
    expect(applyGenericQualityPenalty({
      rawConfidence: 69,
      confidencePenalty: 12,
      sport: "mlb",
      model: "mlb-verified-context-props-v2",
    })).toEqual({
      confidence: 69,
      appliedPenalty: 0,
      skippedDuplicatePenalty: true,
    });

    expect(applyGenericQualityPenalty({
      rawConfidence: 69,
      confidencePenalty: 12,
      sport: "nba",
      model: "nba-player-props",
    })).toEqual({
      confidence: 57,
      appliedPenalty: 12,
      skippedDuplicatePenalty: false,
    });
  });

  it("keeps pitching and batting rows from substituting for each other", () => {
    const pitcher = parseMlbLabeledStatLine(
      ["IP", "H", "R", "ER", "BB", "K", "P-S", "BF"],
      ["6.2", "5", "2", "2", "1", "8", "101-67", "25"],
    );
    const batter = parseMlbLabeledStatLine(
      ["AB", "R", "H", "2B", "RBI", "BB", "K", "TB", "SB"],
      ["4", "1", "2", "1", "3", "1", "1", "5", "0"],
    );

    expect(pitcher.profile).toBe("pitching");
    expect(pitcher.outsRecorded).toBe(20);
    expect(pitcher.pitches).toBe(101);
    expect(mlbStatValue(pitcher, "pitcher_strikeouts")).toBe(8);
    expect(mlbStatValue(pitcher, "innings_pitched")).toBeCloseTo(20 / 3);
    expect(mlbStatValue(pitcher, "hits")).toBeNull();
    expect(batter.profile).toBe("batting");
    expect(mlbStatValue(batter, "batter_strikeouts")).toBe(1);
    expect(mlbStatValue(batter, "doubles")).toBe(1);
    expect(mlbStatValue(batter, "hits_allowed")).toBeNull();
  });

  it("converts baseball innings notation to exact recorded outs", () => {
    expect(inningsToOuts("5.0")).toBe(15);
    expect(inningsToOuts("5.1")).toBe(16);
    expect(inningsToOuts("5.2")).toBe(17);
    expect(inningsToOuts("5.3")).toBeNull();
  });
});

describe("MLB verified pitcher profiles", () => {
  const split = (
    date: string,
    inningsPitched: string,
    strikeOuts: number,
    earnedRuns: number,
    hits: number,
    baseOnBalls: number,
    numberOfPitches?: number,
  ) => ({
    date,
    game: { gamePk: Number(date.replaceAll("-", "")) },
    opponent: { name: "Opponent" },
    stat: { gamesStarted: 1, inningsPitched, strikeOuts, earnedRuns, hits, baseOnBalls, numberOfPitches },
  });

  it("uses real pregame starts and excludes the target game from form", () => {
    const profile = buildPitcherProfileFromStats(
      { id: 7, name: "Verified Starter", hand: "R" },
      [
        split("2026-08-01", "6.0", 8, 2, 5, 1, 95),
        split("2026-08-07", "5.2", 6, 3, 6, 2, 88),
        split("2026-08-13", "7.0", 9, 1, 4, 1, 101),
        { ...split("2026-08-15", "1.0", 3, 0, 0, 0, 15), stat: { ...split("2026-08-15", "1.0", 3, 0, 0, 0, 15).stat, gamesStarted: 0 } },
        split("2026-08-19", "9.0", 20, 0, 0, 0, 110),
      ],
      "2026-08-19",
    );

    expect(profile.games).toHaveLength(3);
    expect(profile.season?.starts).toBe(3);
    expect(profile.season?.era).toBe(2.89);
    expect(profile.recent?.k9).toBe(11.1);
    expect(profile.workload.lastStartDate).toBe("2026-08-13");
    expect(profile.workload.daysRest).toBe(5);
    expect(profile.workload.avgPitchesLast3).toBe(95);
    expect(profile.workload.avgOutsLast3).toBe(18.7);
  });

  it("does not turn missing pitching inputs into zero-valued performance", () => {
    const incomplete = {
      date: "2026-08-10",
      stat: {
        gamesStarted: 1,
        inningsPitched: "6.0",
        strikeOuts: 7,
        earnedRuns: 2,
        hits: 5,
        numberOfPitches: 90,
      },
    };
    const profile = buildPitcherProfileFromStats(
      { id: 8, name: "Incomplete Starter", hand: "L" },
      [incomplete],
      "2026-08-17",
    );

    expect(profile.season).toBeNull();
    expect(profile.recent).toBeNull();
    expect(profile.workload.avgPitchesLast3).toBeNull();
  });
});

describe("MLB verified matchup inputs", () => {
  it("builds a confirmed lineup without treating missing player stats as zero", () => {
    const players: Record<string, unknown> = {};
    const gamePlayers: Record<string, unknown> = {};
    for (let order = 1; order <= 9; order++) {
      const id = 100 + order;
      players[`ID${id}`] = {
        person: { id, fullName: `Batter ${order}` },
        battingOrder: order * 100,
        seasonStats: {
          batting: order === 9
            ? { plateAppearances: 100 }
            : { plateAppearances: 100, strikeOuts: 20, baseOnBalls: 8, ops: ".750" },
        },
      };
      gamePlayers[`ID${id}`] = { batSide: { code: order % 2 ? "R" : "L" } };
    }
    const lineup = buildLineupContext({
      liveData: { boxscore: { teams: { away: { players } } } },
      gameData: { players: gamePlayers },
    }, "away");

    expect(lineup.confirmed).toBe(true);
    expect(lineup.batters).toHaveLength(9);
    expect(lineup.strikeoutRate).toBe(20);
    expect(lineup.walkRate).toBe(8);
    expect(lineup.ops).toBe(0.75);
    expect(lineup.handedness).toEqual({ left: 4, right: 5, switch: 0, unknown: 0 });
  });

  it("calculates actual reliever workload across the two prior days", () => {
    const bullpen = calculateBullpenUsage([
      { id: 1, name: "Reliever One", date: "2026-08-16", pitches: 25 },
      { id: 2, name: "Reliever Two", date: "2026-08-16", pitches: 15 },
      { id: 2, name: "Reliever Two", date: "2026-08-15", pitches: 25 },
      { id: 3, name: "Old Appearance", date: "2026-08-14", pitches: 40 },
    ], "2026-08-17", 2);

    expect(bullpen.pitchesYesterday).toBe(40);
    expect(bullpen.pitchesLastTwoDays).toBe(65);
    expect(bullpen.taxedRelievers.map((row) => row.id)).toEqual([1, 2]);
    expect(bullpen.freshnessScore).toBe(44);
  });

  it("scores pitch mix only when real pitch and swing samples are sufficient", () => {
    const pitcher = emptyPitchSample();
    pitcher.pitches.set("FF", 60);
    pitcher.pitches.set("SL", 40);
    const opponent = emptyPitchSample();
    opponent.swings.set("FF", 30);
    opponent.whiffs.set("FF", 6);
    opponent.swings.set("SL", 20);
    opponent.whiffs.set("SL", 8);
    opponent.swings.set("CH", 50);
    opponent.whiffs.set("CH", 5);

    const matchup = calculatePitchTypeMatchup(pitcher, opponent);
    expect(matchup?.opponentWhiffRateOnMix).toBe(28);
    expect(matchup?.opponentOverallWhiffRate).toBe(19);
    expect(matchup?.score).toBe(68);
    expect(calculatePitchTypeMatchup(emptyPitchSample(), opponent)).toBeNull();
  });

  it("requires mature current-season samples before emitting a park factor", () => {
    const games: ParkFactorAggregateInput[] = [];
    for (let i = 0; i < 60; i++) {
      games.push({ venueId: 1, venueName: "Park One", homeTeamId: 10, awayTeamId: 20, homeRuns: 5, awayRuns: 5 });
      games.push({ venueId: 2, venueName: "Park Two", homeTeamId: 20, awayTeamId: 10, homeRuns: 4, awayRuns: 4 });
    }
    const factors = calculateCurrentParkFactors(games, 2026, "2026-08-17");
    expect(factors.find((factor) => factor.venueId === 1)?.runFactor).toBe(1.25);

    const immature = games.filter((game) => game.venueId === 1).slice(0, 19);
    expect(calculateCurrentParkFactors(immature, 2026, "2026-04-20")).toEqual([]);
  });
});
