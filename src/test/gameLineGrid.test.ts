import { describe, expect, it } from "vitest";
import { buildGameLineGrid, splitTeamName } from "@/lib/gameLineGrid";

const spreads = { quotes: [
  { side: "home" as const, price: 125, point: -1.5 },
  { side: "away" as const, price: -155, point: 1.5 },
] };
const totals = { quotes: [
  { side: "over" as const, price: -110, point: 8.5 },
  { side: "under" as const, price: -110, point: 8.5 },
] };
const h2h = { quotes: [
  { side: "home" as const, price: -175 },
  { side: "away" as const, price: 145 },
] };

describe("buildGameLineGrid", () => {
  it("lays out a full slate the way a sportsbook does", () => {
    const grid = buildGameLineGrid({ spreads, totals, h2h });
    expect(grid.liveMarkets).toBe(3);

    expect(grid.away.spread).toEqual({ line: "+1.5", price: -155 });
    expect(grid.home.spread).toEqual({ line: "-1.5", price: 125 });
    // Over on the away row, Under on the home row.
    expect(grid.away.total).toEqual({ line: "O 8.5", price: -110 });
    expect(grid.home.total).toEqual({ line: "U 8.5", price: -110 });
    expect(grid.away.moneyline).toEqual({ line: "", price: 145 });
    expect(grid.home.moneyline).toEqual({ line: "", price: -175 });
  });

  it("never signs a total — it is a threshold, not a handicap", () => {
    const grid = buildGameLineGrid({ totals });
    expect(grid.away.total.line).not.toContain("+");
  });

  it("shows a pick'em spread as PK rather than +0", () => {
    const grid = buildGameLineGrid({ spreads: { quotes: [{ side: "away", price: -110, point: 0 }] } });
    expect(grid.away.spread.line).toBe("PK");
  });

  it("leaves unposted markets empty instead of zero", () => {
    const grid = buildGameLineGrid({ h2h });
    expect(grid.liveMarkets).toBe(1);
    expect(grid.away.spread).toEqual({ line: "", price: null });
    expect(grid.home.total).toEqual({ line: "", price: null });
    expect(grid.away.moneyline.price).toBe(145);
  });

  it("handles a scheduled game with no book at all", () => {
    const grid = buildGameLineGrid({ spreads: null, totals: null, h2h: null });
    expect(grid.liveMarkets).toBe(0);
    expect(grid.home.moneyline.price).toBeNull();
  });
});

describe("splitTeamName", () => {
  it("splits city from nickname using the short name", () => {
    expect(splitTeamName("Chicago Cubs", "Cubs")).toEqual({ city: "Chicago", nickname: "Cubs" });
    expect(splitTeamName("Kansas City Royals", "Royals")).toEqual({ city: "Kansas City", nickname: "Royals" });
    expect(splitTeamName("Chicago White Sox", "White Sox")).toEqual({ city: "Chicago", nickname: "White Sox" });
  });

  it("keeps the full name when there is nothing reliable to split on", () => {
    expect(splitTeamName("Athletics", "Athletics")).toEqual({ city: "", nickname: "Athletics" });
    expect(splitTeamName("Toronto Tempo", undefined)).toEqual({ city: "", nickname: "Toronto Tempo" });
    // A short name that isn't a suffix must not produce a mangled split.
    expect(splitTeamName("Chicago White Sox", "CWS")).toEqual({ city: "", nickname: "Chicago White Sox" });
  });
});
