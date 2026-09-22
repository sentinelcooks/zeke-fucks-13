import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GAME_ANALYSIS_TIERS, tierForScore } from "@/lib/gameAnalysisTiers";
import { formatCountdown } from "@/components/game-analysis/useFirstPitchCountdown";

describe("game analysis tiers", () => {
  it("cuts at the same places the backend does", () => {
    // The mockup shipped with placeholder cutoffs (60 / 74 / 75). The real
    // thresholds already exist server-side, and a UI that tiers a 70 as LEAN
    // while the model calls it RISKY is worse than no tier at all.
    const thresholds = readFileSync("supabase/functions/_shared/thresholds.ts", "utf8");
    const value = (name: string) => {
      const match = thresholds.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
      if (!match) throw new Error(`${name} not found in thresholds.ts`);
      return Math.round(Number(match[1]) * 100);
    };

    expect(GAME_ANALYSIS_TIERS.STRONG).toBe(value("PROB_STRONG"));
    expect(GAME_ANALYSIS_TIERS.LEAN).toBe(value("PROB_LEAN"));
    expect(GAME_ANALYSIS_TIERS.RISKY).toBe(value("PROB_FLOOR"));
  });

  it("places each score in its tier, boundaries included", () => {
    expect(tierForScore(100).tier).toBe("STRONG");
    expect(tierForScore(72).tier).toBe("STRONG");
    expect(tierForScore(71.9).tier).toBe("LEAN");
    expect(tierForScore(58).tier).toBe("LEAN");
    expect(tierForScore(57.9).tier).toBe("RISKY");
    expect(tierForScore(42).tier).toBe("RISKY");
    expect(tierForScore(41.9).tier).toBe("PASS");
    expect(tierForScore(0).tier).toBe("PASS");
  });

  it("only calls a score actionable once it clears LEAN", () => {
    expect(tierForScore(80).actionable).toBe(true);
    expect(tierForScore(58).actionable).toBe(true);
    expect(tierForScore(57).actionable).toBe(false);
    expect(tierForScore(20).actionable).toBe(false);
  });

  it("reads RISKY and PASS in the same colour, but keeps the verdict honest", () => {
    // The design has three colours; the model has four verdicts. Sharing a
    // colour must not collapse the labels — a RISKY game still says RISKY.
    expect(tierForScore(50).color).toBe(tierForScore(10).color);
    expect(tierForScore(50).label).toBe("RISKY");
    expect(tierForScore(10).label).toBe("PASS");
  });

  it("falls back to PASS when the model returned no score", () => {
    expect(tierForScore(null).tier).toBe("PASS");
    expect(tierForScore(undefined).tier).toBe("PASS");
    expect(tierForScore(Number.NaN).tier).toBe("PASS");
  });
});

describe("first pitch countdown", () => {
  const start = Date.parse("2026-09-16T23:40:00Z");

  it("counts down in HH:MM:SS", () => {
    const result = formatCountdown("2026-09-16T23:40:00Z", start - (5 * 3600 + 12 * 60 + 7) * 1000);
    expect(result.display).toBe("05:12:07");
    expect(result.phase).toBe("upcoming");
    expect(result.label).toBe("First pitch");
  });

  it("pads every field", () => {
    expect(formatCountdown("2026-09-16T23:40:00Z", start - 9 * 1000).display).toBe("00:00:09");
  });

  it("switches to Live once first pitch passes", () => {
    // A countdown frozen at 00:00:00 reads as a broken timer, not as a game
    // that has started.
    const result = formatCountdown("2026-09-16T23:40:00Z", start + 60_000);
    expect(result.display).toBe("Live");
    expect(result.phase).toBe("live");
  });

  it("shows the final state when the feed says the game is over", () => {
    const result = formatCountdown("2026-09-16T23:40:00Z", start + 3 * 3600_000, "Final");
    expect(result.display).toBe("Final");
    expect(formatCountdown("2026-09-16T23:40:00Z", start + 3 * 3600_000, "Game Over").display).toBe("Final");
  });

  it("does not invent a clock without a usable start time", () => {
    expect(formatCountdown(null, Date.now()).display).toBe("--:--:--");
    expect(formatCountdown("not a date", Date.now()).phase).toBe("unknown");
  });
});
