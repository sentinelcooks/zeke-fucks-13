import { describe, expect, it } from "vitest";
import {
  impliedProbability,
  scoreTrendingProps,
  type PropSnapshotRow,
} from "../../supabase/functions/_shared/trending_score";

const OPEN = "2026-09-29T15:40:00Z";
const NOW = "2026-09-29T21:40:00Z";
const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle"];

function quote(
  player: string,
  market: string,
  line: number,
  price: number,
  snapshot_at: string,
  book: string,
  event_id = "evt-1",
): PropSnapshotRow {
  return { event_id, book, market, outcome_name: "Over", outcome_description: player, price, line, snapshot_at };
}

/** Every book quotes the same open and current Over line/price. */
function prop(
  player: string,
  market: string,
  open: [number, number],
  current: [number, number],
  books = BOOKS,
  event_id = "evt-1",
): PropSnapshotRow[] {
  return books.flatMap((book) => [
    quote(player, market, open[0], open[1], OPEN, book, event_id),
    quote(player, market, current[0], current[1], NOW, book, event_id),
  ]);
}

describe("scoreTrendingProps", () => {
  it("ranks the prop whose line moved above one that sat still", () => {
    const ranked = scoreTrendingProps([
      ...prop("Still Player", "player_points", [20.5, -110], [20.5, -110]),
      ...prop("Moved Player", "player_points", [22.5, -110], [24.5, -110]),
    ]);
    expect(ranked.map((p) => p.player)).toEqual(["Moved Player", "Still Player"]);
    expect(ranked[0]).toMatchObject({ line: 24.5, line_move: 2, books: 5, lean: "over" });
  });

  it("reads a price-only move and its direction", () => {
    const [top] = scoreTrendingProps([
      ...prop("Juiced Under", "player_rebounds", [8.5, -110], [8.5, +120]),
    ]);
    // Over got cheaper (-110 → +120), so the money came in on the Under.
    expect(top.line_move).toBe(0);
    expect(top.price_move_pp).toBeLessThan(0);
    expect(top.lean).toBe("under");
  });

  it("ignores a price change on a book whose line also moved", () => {
    const rows = [
      // Same line, same price everywhere except one book that moved line AND price.
      ...prop("Player", "player_assists", [6.5, -110], [6.5, -110], BOOKS.slice(0, 4)),
      quote("Player", "player_assists", 6.5, -110, OPEN, "pinnacle"),
      quote("Player", "player_assists", 7.5, +150, NOW, "pinnacle"),
    ];
    const [top] = scoreTrendingProps(rows);
    expect(top.price_move_pp).toBe(0);
  });

  it("falls back to book count when nothing moved", () => {
    const ranked = scoreTrendingProps([
      ...prop("Two Books", "player_points", [18.5, -110], [18.5, -110], BOOKS.slice(0, 2)),
      ...prop("Five Books", "player_points", [18.5, -110], [18.5, -110]),
    ]);
    expect(ranked.map((p) => p.player)).toEqual(["Five Books", "Two Books"]);
    expect(ranked.every((p) => p.lean === null)).toBe(true);
  });

  it("drops props posted by fewer than two books", () => {
    expect(scoreTrendingProps(prop("Thin", "player_points", [10.5, -110], [14.5, -110], ["draftkings"]))).toEqual([]);
  });

  it("keeps one prop per player and at most two per market", () => {
    const rows = [
      ...prop("A", "player_points", [20.5, -110], [23.5, -110]),
      ...prop("A", "player_rebounds", [7.5, -110], [9.5, -110]),
      ...prop("B", "player_points", [20.5, -110], [23.0, -110]),
      ...prop("C", "player_points", [20.5, -110], [22.5, -110]),
      ...prop("D", "player_assists", [5.5, -110], [5.5, -110]),
    ];
    const ranked = scoreTrendingProps(rows);
    expect(new Set(ranked.map((p) => p.player)).size).toBe(ranked.length);
    expect(ranked.filter((p) => p.market === "player_points").length).toBeLessThanOrEqual(2);
    expect(ranked.map((p) => p.player)).toContain("D");
  });

  it("only counts books still posting in the event's latest snapshot", () => {
    const rows = [
      ...prop("Player", "player_points", [20.5, -110], [20.5, -110], BOOKS.slice(0, 3)),
      // Two books quoted at the open, then pulled the prop.
      quote("Player", "player_points", 20.5, -110, OPEN, "caesars"),
      quote("Player", "player_points", 20.5, -110, OPEN, "pinnacle"),
    ];
    expect(scoreTrendingProps(rows)[0].books).toBe(3);
  });

  it("does not drop an event that is missing from the newest run", () => {
    const rows = [
      ...prop("Early Game", "player_points", [20.5, -110], [21.5, -110], BOOKS, "evt-1"),
      // evt-2 was only captured at the open.
      ...BOOKS.map((book) => quote("Late Game", "player_points", 19.5, -110, OPEN, book, "evt-2")),
    ];
    expect(scoreTrendingProps(rows).map((p) => p.player).sort()).toEqual(["Early Game", "Late Game"]);
  });

  it("ignores Under outcomes so a market is not counted twice", () => {
    const rows = prop("Player", "player_points", [20.5, -110], [20.5, -110]).map((row) => ({
      ...row,
      outcome_name: "Under",
    }));
    expect(scoreTrendingProps(rows)).toEqual([]);
  });

  it("treats the same instant in different timestamp formats as one snapshot", () => {
    const rows = [
      ...BOOKS.map((book) => quote("Player", "player_points", 20.5, -110, "2026-09-29T15:40:00.000+00:00", book)),
      ...BOOKS.map((book) => quote("Player", "player_points", 22.5, -110, "2026-09-29T17:40:00Z", book)),
      // Same instant as the open, written the way psql prints it.
      quote("Player", "player_points", 20.5, -110, "2026-09-29 15:40:00+00", "draftkings"),
    ];
    const [top] = scoreTrendingProps(rows);
    expect(top).toMatchObject({ books: 5, line: 22.5, line_move: 2 });
  });

  it("returns an empty list for an empty slate", () => {
    expect(scoreTrendingProps([])).toEqual([]);
  });

  it("converts American odds to implied probability", () => {
    expect(impliedProbability(-110)).toBeCloseTo(0.5238, 4);
    expect(impliedProbability(150)).toBeCloseTo(0.4, 4);
    expect(impliedProbability(0)).toBeNull();
  });
});
