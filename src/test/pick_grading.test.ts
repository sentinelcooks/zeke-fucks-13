import { describe, expect, it } from "vitest";
import {
  espnSportPath,
  getMlbPlayerStat,
  gradeGameBet,
  gradeOverUnder,
  probabilityClvPercentagePoints,
  profitUnits,
  selectClosingSnapshot,
} from "../../supabase/functions/_shared/pick_grading";

function mlbSummary(group: "batting" | "pitching", labels: string[], stats: string[]) {
  return {
    boxscore: {
      players: [{
        statistics: [{
          name: group,
          labels,
          athletes: [{
            athlete: { displayName: "Shohei Ohtani" },
            stats,
          }],
        }],
      }],
    },
  };
}

describe("verified pick grading", () => {
  it("uses the WNBA ESPN endpoint rather than the NBA endpoint", () => {
    expect(espnSportPath("wnba")).toBe("basketball/wnba");
    expect(espnSportPath("nba")).toBe("basketball/nba");
  });

  it("does not silently grade an unknown direction as under", () => {
    expect(gradeOverUnder("", 4, 5.5)).toBeNull();
    expect(gradeOverUnder("higher", 4, 5.5)).toBeNull();
    expect(gradeOverUnder("under", 4, 5.5)).toBe("hit");
  });

  it("grades stored over_under game rows", () => {
    expect(gradeGameBet(
      { bet_type: "over_under", direction: "over", total_line: 161.5 },
      {
        final: true,
        home: "Las Vegas Aces",
        away: "Minnesota Lynx",
        homeScore: 88,
        awayScore: 79,
        homeWin: true,
        awayWin: false,
      },
    )).toBe("hit");
  });

  it("grades MLB H+R+RBI from the three verified box-score fields", () => {
    const result = getMlbPlayerStat(
      mlbSummary("batting", ["H", "R", "RBI"], ["2", "1", "3"]),
      "Shohei Ohtani",
      "h+r+rbi",
    );
    expect(result).toEqual({ found: true, actual: 6 });
  });

  it("never substitutes a batter strikeout row for pitcher strikeouts", () => {
    const result = getMlbPlayerStat(
      mlbSummary("batting", ["SO"], ["2"]),
      "Shohei Ohtani",
      "pitcher_strikeouts",
    );
    expect(result).toEqual({
      found: false,
      actual: null,
      reason: "player_stat_group_missing",
    });
  });

  it("reads pitcher strikeouts from the pitching profile", () => {
    const result = getMlbPlayerStat(
      mlbSummary("pitching", ["K"], ["9"]),
      "Shohei Ohtani",
      "pitcher_strikeouts",
    );
    expect(result).toEqual({ found: true, actual: 9 });
  });

  it("does not turn a missing box-score field into a zero", () => {
    const result = getMlbPlayerStat(
      mlbSummary("batting", ["H", "R"], ["2", "1"]),
      "Shohei Ohtani",
      "h+r+rbi",
    );
    expect(result).toEqual({ found: false, actual: null, reason: "no_data" });
  });
});

describe("measurement math", () => {
  const snapshots = [
    { book: "book-a", market: "h2h", outcome_name: "Los Angeles Dodgers", price: -125, line: null, snapshot_at: "2026-08-17T22:00:00Z" },
    { book: "book-b", market: "h2h", outcome_name: "Los Angeles Dodgers", price: -135, line: null, snapshot_at: "2026-08-17T22:01:00Z" },
    { book: "book-c", market: "h2h", outcome_name: "Los Angeles Dodgers", price: -145, line: null, snapshot_at: "2026-08-17T22:02:00Z" },
  ];

  it("uses the persisted sportsbook when available", () => {
    const selected = selectClosingSnapshot(
      snapshots,
      { bet_type: "moneyline", team: "Los Angeles Dodgers", direction: "away" },
      "book-a",
    );
    expect(selected.source).toBe("selected_book");
    expect(selected.snapshot?.price).toBe(-125);
  });

  it("uses a median market close when the original book was not persisted", () => {
    const selected = selectClosingSnapshot(
      snapshots,
      { bet_type: "moneyline", team: "Los Angeles Dodgers", direction: "away" },
    );
    expect(selected.source).toBe("consensus_median");
    expect(selected.snapshot?.price).toBe(-135);
  });

  it("reports CLV as implied-probability percentage points", () => {
    expect(probabilityClvPercentagePoints(-110, -130)).toBeCloseTo(4.14, 2);
    expect(probabilityClvPercentagePoints(null, -130)).toBeNull();
  });

  it("computes unit profit from the recorded opening price", () => {
    expect(profitUnits("+125", "hit", 1)).toBeCloseTo(1.25);
    expect(profitUnits("-110", "miss", 1)).toBe(-1);
  });
});
