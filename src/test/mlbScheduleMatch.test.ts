import { describe, expect, it } from "vitest";
import {
  findExactMlbScheduledGame,
  mlbScheduleDatesForExpectedEvent,
  mlbScheduleTeamMatchesIdentifier,
} from "../../supabase/functions/_shared/mlb_schedule_match";

const yankeesAtPadres = {
  gamePk: 823256,
  gameDate: "2026-09-05T01:40:00Z",
  teams: {
    away: { team: { name: "New York Yankees", abbreviation: "NYY" } },
    home: { team: { name: "San Diego Padres", abbreviation: "SD" } },
  },
};

describe("MLB official schedule matcher", () => {
  it("checks both MLB local and UTC dates for a night game", () => {
    expect(mlbScheduleDatesForExpectedEvent("2026-09-05T01:40:00Z")).toEqual(
      expect.arrayContaining(["2026-09-04", "2026-09-05"]),
    );
  });

  it("matches the exact teams and start time without relying on ESPN IDs", () => {
    expect(findExactMlbScheduledGame({
      games: [yankeesAtPadres],
      team1: { name: "New York Yankees", abbr: "NYY" },
      team2: { name: "San Diego Padres", abbr: "SD" },
      expectedCommenceTime: "2026-09-05T01:40:00Z",
    })).toEqual({
      gameId: "823256",
      gameDate: "2026-09-05T01:40:00Z",
      team1IsHome: false,
    });
  });

  it("rejects a game outside the strict start-time window", () => {
    expect(findExactMlbScheduledGame({
      games: [yankeesAtPadres],
      team1: { name: "New York Yankees", abbr: "NYY" },
      team2: { name: "San Diego Padres", abbr: "SD" },
      expectedCommenceTime: "2026-09-05T03:11:00Z",
    })).toBeNull();
  });
});

const whiteSox = { name: "Chicago White Sox", teamName: "White Sox", abbreviation: "CWS" };
const guardians = { name: "Cleveland Guardians", teamName: "Guardians", abbreviation: "CLE" };

describe("MLB team identity matcher", () => {
  // The bug this covers: the odds feed sends full names, so matching on the
  // StatsAPI abbreviation alone left every MLB moneyline/spread request
  // unmatched and the analysis screen blank.
  it("matches the full team name the odds feed sends", () => {
    expect(mlbScheduleTeamMatchesIdentifier(guardians, "Cleveland Guardians")).toBe(true);
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "Chicago White Sox")).toBe(true);
  });

  it("matches the StatsAPI abbreviation", () => {
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "CWS")).toBe(true);
    expect(mlbScheduleTeamMatchesIdentifier(guardians, "cle")).toBe(true);
  });

  it("matches the ESPN abbreviations that disagree with StatsAPI", () => {
    // ESPN says CHW/ARI where StatsAPI says CWS/AZ — the only two of 30 clubs
    // where the feeds differ, and both used to fail verification outright.
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "CHW")).toBe(true);
    expect(mlbScheduleTeamMatchesIdentifier(
      { name: "Arizona Diamondbacks", teamName: "D-backs", abbreviation: "AZ" },
      "ARI",
    )).toBe(true);
  });

  it("matches a nickname-only name against a feed that includes the city", () => {
    expect(mlbScheduleTeamMatchesIdentifier(
      { name: "Athletics", teamName: "Athletics", abbreviation: "ATH" },
      "Oakland Athletics",
    )).toBe(true);
  });

  it("does not match a different club in the same city", () => {
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "Chicago Cubs")).toBe(false);
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "CHC")).toBe(false);
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "Boston Red Sox")).toBe(false);
  });

  it("treats an empty identifier as no match", () => {
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, "")).toBe(false);
    expect(mlbScheduleTeamMatchesIdentifier(whiteSox, null)).toBe(false);
  });

  it("matches a scheduled game when only the ESPN abbreviation is known", () => {
    expect(findExactMlbScheduledGame({
      games: [{
        gamePk: 824384,
        gameDate: "2026-09-15T22:40:00Z",
        teams: { away: { team: whiteSox }, home: { team: guardians } },
      }],
      team1: { name: "Chicago White Sox", abbr: "CHW" },
      team2: { name: "Cleveland Guardians", abbr: "CLE" },
      expectedCommenceTime: "2026-09-15T22:40:00Z",
    })).toEqual({
      gameId: "824384",
      gameDate: "2026-09-15T22:40:00Z",
      team1IsHome: false,
    });
  });
});
