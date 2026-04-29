import { describe, it, expect } from "vitest";
import { selectBestBookLine, type BookLine } from "./bestBookLine";

// ── Moneyline ──────────────────────────────────────────────────────────────

describe("moneyline", () => {
  it("picks highest EV book (not just highest raw odds)", () => {
    // With modelProb = 0.60, a -110 line gives EV ≈ +9.1%
    // A +130 line gives EV ≈ +38%
    const lines: BookLine[] = [
      { book: "FanDuel",    bookKey: "fanduel",    odds: -110 },
      { book: "BetAnything", bookKey: "betanything", odds: -115 },
      { book: "DraftKings", bookKey: "draftkings",  odds: +130 },
    ];
    const r = selectBestBookLine(lines, "moneyline", "team1", 0.60);
    expect(r.bestBook?.bookKey).toBe("draftkings"); // highest EV
  });

  it("tiebreaks on odds then bookKey", () => {
    const lines: BookLine[] = [
      { book: "BookB", bookKey: "bookb", odds: -110 },
      { book: "BookA", bookKey: "booka", odds: -110 },
    ];
    const r = selectBestBookLine(lines, "moneyline", "team1", 0.55);
    expect(r.bestBook?.bookKey).toBe("booka"); // alphabetical
  });

  it("returns no_lines when empty", () => {
    const r = selectBestBookLine([], "moneyline", "team1", 0.55);
    expect(r.reason).toBe("no_lines");
    expect(r.bestBook).toBeNull();
  });

  it("filters out invalid odds", () => {
    const lines: BookLine[] = [
      { book: "Bad",  bookKey: "bad",     odds: NaN },
      { book: "Good", bookKey: "good",    odds: -110 },
    ];
    const r = selectBestBookLine(lines, "moneyline", "team1", 0.55);
    expect(r.bestBook?.bookKey).toBe("good");
    expect(r.comparisonRows).toHaveLength(1);
  });
});

// ── Spread ─────────────────────────────────────────────────────────────────

describe("spread", () => {
  it("prefers better handicap (more points) over better odds", () => {
    // BetAnything: -2.5 @ -110  (worse line, better odds)
    // BetMGM:      -3.0 @ -115  (wait, -2.5 is better for the bettor than -3.0)
    // team1 is giving points; -2.5 means they only give 2.5, better than -3.5
    const lines: BookLine[] = [
      { book: "BetAnything", bookKey: "betanything", odds: -110, point: -2.5 },
      { book: "BetMGM",      bookKey: "betmgm",      odds: -115, point: -3.5 },
    ];
    const r = selectBestBookLine(lines, "spread", "team1", 0.60);
    // -2.5 lineScore = -2.5 > -3.5 → BetAnything wins (better line)
    expect(r.bestBook?.bookKey).toBe("betanything");
    expect(r.bestBook?.point).toBe(-2.5);
  });

  it("uses odds as tiebreaker when lines are equal", () => {
    const lines: BookLine[] = [
      { book: "FanDuel",    bookKey: "fanduel",    odds: -112, point: -3.5 },
      { book: "DraftKings", bookKey: "draftkings", odds: -108, point: -3.5 },
    ];
    const r = selectBestBookLine(lines, "spread", "team1", 0.60);
    expect(r.bestBook?.bookKey).toBe("draftkings"); // same point, better odds
  });

  it("regression: BetAnything worse spread loses to BetMGM better spread", () => {
    // BetAnything: -3.5 @ -110 (worse line for team1 bettors)
    // BetMGM:      -2.5 @ -115 (better line for team1 bettors)
    const lines: BookLine[] = [
      { book: "BetAnything", bookKey: "betanything", odds: -110, point: -3.5 },
      { book: "BetMGM",      bookKey: "betmgm",      odds: -115, point: -2.5 },
    ];
    const r = selectBestBookLine(lines, "spread", "team1", 0.60);
    expect(r.bestBook?.bookKey).toBe("betmgm");        // best line wins
    expect(r.bestOdds?.bookKey).toBe("betanything");   // best raw odds differs
    expect(r.agree).toBe(false);                        // they disagree
  });
});

// ── Total ──────────────────────────────────────────────────────────────────

describe("total Over", () => {
  it("prefers lower total (easier to clear)", () => {
    const lines: BookLine[] = [
      { book: "FanDuel",    bookKey: "fanduel",    odds: -110, point: 225.5 },
      { book: "DraftKings", bookKey: "draftkings", odds: -115, point: 222.5 },
    ];
    const r = selectBestBookLine(lines, "total", "over", 0.58);
    expect(r.bestBook?.bookKey).toBe("draftkings"); // 222.5 easier to go Over
  });
});

describe("total Under", () => {
  it("prefers higher total (easier to stay under)", () => {
    const lines: BookLine[] = [
      { book: "FanDuel",    bookKey: "fanduel",    odds: -110, point: 225.5 },
      { book: "DraftKings", bookKey: "draftkings", odds: -115, point: 228.5 },
    ];
    const r = selectBestBookLine(lines, "total", "under", 0.58);
    expect(r.bestBook?.bookKey).toBe("draftkings"); // 228.5 easier to stay Under
  });
});

// ── Prop ───────────────────────────────────────────────────────────────────

describe("prop Over", () => {
  it("prefers lower line among alt lines", () => {
    const lines: BookLine[] = [
      { book: "PrizePicks", bookKey: "prizepicks", odds: -110, point: 24.5 },
      { book: "Underdog",   bookKey: "underdog",   odds: -115, point: 23.5 },
    ];
    const r = selectBestBookLine(lines, "prop", "over", 0.62);
    expect(r.bestBook?.bookKey).toBe("underdog"); // 23.5 easier to go Over
  });
});

// ── agree flag ─────────────────────────────────────────────────────────────

describe("agree flag", () => {
  it("is true when one book dominates all criteria", () => {
    // DraftKings: best line, best odds, best EV all in one
    const lines: BookLine[] = [
      { book: "DraftKings",  bookKey: "draftkings",  odds: -105, point: -2.5 },
      { book: "FanDuel",     bookKey: "fanduel",     odds: -112, point: -3.5 },
    ];
    const r = selectBestBookLine(lines, "spread", "team1", 0.60);
    expect(r.agree).toBe(true);
  });

  it("is false when best-odds and best-line differ", () => {
    const lines: BookLine[] = [
      { book: "BetAnything", bookKey: "betanything", odds: -110, point: -3.5 }, // best odds
      { book: "BetMGM",      bookKey: "betmgm",      odds: -115, point: -2.5 }, // best line
    ];
    const r = selectBestBookLine(lines, "spread", "team1", 0.60);
    expect(r.agree).toBe(false);
    expect(r.bestBook?.bookKey).toBe("betmgm");      // line-first
    expect(r.bestOdds?.bookKey).toBe("betanything"); // best raw odds
  });
});
