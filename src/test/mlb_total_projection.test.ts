import { describe, expect, it } from "vitest";
import {
  buildMlbTotalProjection,
  describeMlbTotalProjection,
  normalizeMlbScheduleDate,
  normalizeMlbScoreboardDate,
  scoreMlbTotalSide,
} from "../../supabase/functions/_shared/mlb_total_projection";

const baseInput = {
  homeRunsPerGame: 4.5,
  awayRunsPerGame: 4.5,
  homeStarterEra: 4.2,
  awayStarterEra: 4.2,
  homeBullpenEra: 4,
  awayBullpenEra: 4,
  parkFactor: null,
  temperatureF: null,
  windMph: null,
  windDirection: null,
  roofClosed: false,
};

describe("MLB total projection", () => {
  it.each([
    ["formats an ISO date for ESPN", "2026-09-04T18:10:00Z", "20260904"],
    ["keeps an evening Eastern game on its official game day", "2026-09-05T00:05:00Z", "20260904"],
    ["formats a plain game date for ESPN", "2026-09-05", "20260905"],
    ["rejects invalid scoreboard dates", "not-a-date", null],
  ])("%s", (_label, sourceDate, expectedDate) => {
    expect(normalizeMlbScoreboardDate(sourceDate)).toBe(expectedDate);
  });

  it("uses the official Eastern date format required by the MLB Stats API", () => {
    expect(normalizeMlbScheduleDate("2026-09-05T00:05:00Z")).toBe("2026-09-04");
  });

  it("keeps the neutral baseline equal to combined team scoring", () => {
    expect(buildMlbTotalProjection(baseInput)).toMatchObject({ predictedTotal: 9, missingInputs: [] });
  });

  it("raises the projection for weaker starting pitchers", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeStarterEra: 5.2, awayStarterEra: 5.2 });
    expect(result.predictedTotal).toBeGreaterThan(9);
  });

  it("lowers the projection for stronger starting pitchers", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeStarterEra: 3.2, awayStarterEra: 3.2 });
    expect(result.predictedTotal).toBeLessThan(9);
  });

  it("raises the projection for weak bullpens", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeBullpenEra: 5, awayBullpenEra: 5 });
    expect(result.predictedTotal).toBeGreaterThan(9);
  });

  it("lowers the projection for strong bullpens", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeBullpenEra: 3, awayBullpenEra: 3 });
    expect(result.predictedTotal).toBeLessThan(9);
  });

  it("applies run-friendly park context", () => {
    const result = buildMlbTotalProjection({ ...baseInput, parkFactor: 1.1 });
    expect(result.predictedTotal).toBeGreaterThan(9);
  });

  it("applies run-suppressing park context", () => {
    const result = buildMlbTotalProjection({ ...baseInput, parkFactor: 0.9 });
    expect(result.predictedTotal).toBeLessThan(9);
  });

  it("applies warm-weather context at open-air parks", () => {
    const result = buildMlbTotalProjection({ ...baseInput, temperatureF: 85 });
    expect(result.predictedTotal).toBeGreaterThan(9);
  });

  it("applies cold-weather context at open-air parks", () => {
    const result = buildMlbTotalProjection({ ...baseInput, temperatureF: 50 });
    expect(result.predictedTotal).toBeLessThan(9);
  });

  it("raises the projection for an out-blowing wind", () => {
    const result = buildMlbTotalProjection({ ...baseInput, windMph: 12, windDirection: "out to center" });
    expect(result.predictedTotal).toBeGreaterThan(9);
  });

  it("lowers the projection for an in-blowing wind", () => {
    const result = buildMlbTotalProjection({ ...baseInput, windMph: 12, windDirection: "in from center" });
    expect(result.predictedTotal).toBeLessThan(9);
  });

  it("does not apply weather at a closed-roof park", () => {
    const result = buildMlbTotalProjection({ ...baseInput, roofClosed: true, temperatureF: 85, windMph: 20, windDirection: "out" });
    expect(result.predictedTotal).toBe(9);
  });

  it("keeps a partial bullpen input out of the projection", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeBullpenEra: 5, awayBullpenEra: null });
    expect(result.predictedTotal).toBe(9);
    expect(result.missingInputs).toContain("bullpen_era");
  });

  it("returns no projection without both current scoring baselines", () => {
    const result = buildMlbTotalProjection({ ...baseInput, homeRunsPerGame: null });
    expect(result.predictedTotal).toBeNull();
    expect(result.missingInputs).toContain("runs_per_game");
  });

  it("scores a projection above the line toward the over", () => {
    expect(scoreMlbTotalSide({ predictedTotal: 10, totalLine: 9, side: "over" })).toBeGreaterThan(50);
  });

  it("scores a projection above the line away from the under", () => {
    expect(scoreMlbTotalSide({ predictedTotal: 10, totalLine: 9, side: "under" })).toBeLessThan(50);
  });

  it("scores a projection below the line toward the under", () => {
    expect(scoreMlbTotalSide({ predictedTotal: 8, totalLine: 9, side: "under" })).toBeGreaterThan(50);
  });

  it("keeps over and under scores complementary", () => {
    const over = scoreMlbTotalSide({ predictedTotal: 9.6, totalLine: 9, side: "over" });
    const under = scoreMlbTotalSide({ predictedTotal: 9.6, totalLine: 9, side: "under" });
    expect(over + under).toBe(100);
  });

  it("rejects invalid total lines", () => {
    expect(scoreMlbTotalSide({ predictedTotal: 9, totalLine: 0, side: "over" })).toBeNull();
  });

  it("rejects an unsupported total side", () => {
    expect(scoreMlbTotalSide({ predictedTotal: 9, totalLine: 9, side: "sideways" })).toBeNull();
  });

  it("describes a verified total from its real inputs without claiming a probability", () => {
    expect(describeMlbTotalProjection({
      predictedTotal: 9.2,
      totalLine: 8.5,
      side: "over",
      projectionInputs: ["official_current_season_team_runs_per_game"],
      missingInputs: ["bullpen_era"],
    })).toContain("The verified total projection is 9.2 runs against over 8.5.");
  });
});
