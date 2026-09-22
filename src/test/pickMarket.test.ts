import { describe, expect, it } from "vitest";
import { isGameMarketPick, marketKeyForBetType, pickMarketLine } from "@/lib/pickMarket";

describe("pick market routing", () => {
  it("routes each game market to its own tab", () => {
    expect(marketKeyForBetType("moneyline")).toBe("h2h");
    expect(marketKeyForBetType("spread")).toBe("spreads");
    expect(marketKeyForBetType("total")).toBe("totals");
  });

  it("accepts both spellings of a total", () => {
    // The scanner emits "total"; buildDailyPickRow rewrites it to "over_under"
    // on the way into daily_picks, so both reach the lineup card.
    expect(marketKeyForBetType("total")).toBe("totals");
    expect(marketKeyForBetType("over_under")).toBe("totals");
  });

  it("accepts the sport-specific names for a spread", () => {
    expect(marketKeyForBetType("run_line")).toBe("spreads");
    expect(marketKeyForBetType("puck_line")).toBe("spreads");
  });

  it("is case and whitespace insensitive", () => {
    expect(marketKeyForBetType("  Spread ")).toBe("spreads");
    expect(marketKeyForBetType("MONEYLINE")).toBe("h2h");
  });

  it("treats a player prop as having no market tab", () => {
    expect(marketKeyForBetType("prop")).toBeNull();
    expect(isGameMarketPick("prop")).toBe(false);
  });

  it("returns null for missing or unknown bet types rather than guessing", () => {
    // Guessing here is what sent a spread to the moneyline tab.
    expect(marketKeyForBetType(null)).toBeNull();
    expect(marketKeyForBetType(undefined)).toBeNull();
    expect(marketKeyForBetType("")).toBeNull();
    expect(marketKeyForBetType("first_basket")).toBeNull();
  });

  it("identifies game markets", () => {
    expect(isGameMarketPick("spread")).toBe(true);
    expect(isGameMarketPick("over_under")).toBe(true);
    expect(isGameMarketPick("h2h")).toBe(true);
  });
});

describe("pick market line", () => {
  it("prefers the spread column for a spread", () => {
    expect(pickMarketLine({ bet_type: "spread", spread_line: -1.5, line: 0 })).toBe(-1.5);
  });

  it("prefers the total column for a total", () => {
    expect(pickMarketLine({ bet_type: "over_under", total_line: 8.5, line: 0 })).toBe(8.5);
  });

  it("falls back to line when the market column is empty", () => {
    expect(pickMarketLine({ bet_type: "spread", spread_line: null, line: -1.5 })).toBe(-1.5);
    expect(pickMarketLine({ bet_type: "total", total_line: null, line: 7 })).toBe(7);
  });

  it("returns null when there is no usable number", () => {
    expect(pickMarketLine({ bet_type: "spread", spread_line: null, line: null })).toBeNull();
    expect(pickMarketLine({ bet_type: "moneyline", line: null })).toBeNull();
  });

  it("keeps a zero line, which is meaningful for a moneyline row", () => {
    expect(pickMarketLine({ bet_type: "moneyline", line: 0 })).toBe(0);
  });
});
