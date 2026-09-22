/**
 * Builds the Spread / Total / ML grid shown on each matchup card in the Game
 * Lines list.
 *
 * Pure so the sportsbook conventions it encodes are unit-tested rather than
 * eyeballed: a spread cell carries its signed handicap, a total cell shows
 * Over on the away row and Under on the home row (how every book lays it out),
 * and a moneyline cell is just the price. A market the book has not posted
 * yields empty cells, never a zero.
 */

export interface GridQuote {
  side: "home" | "away" | "over" | "under";
  price: number;
  point?: number;
}

export interface GridSnapshot {
  quotes: GridQuote[];
}

export interface GridCell {
  /** Top line: the handicap or total, e.g. "-1.5" or "O 8.5". Empty for moneyline. */
  line: string;
  /** Bottom line: the American price, pre-formatting. Null when the market is missing. */
  price: number | null;
}

export interface GameLineGridRow {
  spread: GridCell;
  total: GridCell;
  moneyline: GridCell;
}

export interface GameLineGrid {
  away: GameLineGridRow;
  home: GameLineGridRow;
  /** How many of the three markets the book has posted. */
  liveMarkets: number;
}

const EMPTY: GridCell = { line: "", price: null };

function find(snapshot: GridSnapshot | null | undefined, side: GridQuote["side"]): GridQuote | undefined {
  return snapshot?.quotes.find((quote) => quote.side === side);
}

function signed(point: number): string {
  if (point === 0) return "PK";
  return point > 0 ? `+${point}` : String(point);
}

function spreadCell(quote: GridQuote | undefined): GridCell {
  if (!quote || !Number.isFinite(quote.price) || quote.point == null || !Number.isFinite(quote.point)) return EMPTY;
  return { line: signed(quote.point), price: quote.price };
}

function totalCell(quote: GridQuote | undefined, prefix: "O" | "U"): GridCell {
  if (!quote || !Number.isFinite(quote.price) || quote.point == null || !Number.isFinite(quote.point)) return EMPTY;
  // A total is a threshold, not a handicap, so it never carries a sign.
  return { line: `${prefix} ${quote.point}`, price: quote.price };
}

function moneylineCell(quote: GridQuote | undefined): GridCell {
  if (!quote || !Number.isFinite(quote.price)) return EMPTY;
  return { line: "", price: quote.price };
}

export function buildGameLineGrid(markets: {
  spreads?: GridSnapshot | null;
  totals?: GridSnapshot | null;
  h2h?: GridSnapshot | null;
}): GameLineGrid {
  return {
    away: {
      spread: spreadCell(find(markets.spreads, "away")),
      total: totalCell(find(markets.totals, "over"), "O"),
      moneyline: moneylineCell(find(markets.h2h, "away")),
    },
    home: {
      spread: spreadCell(find(markets.spreads, "home")),
      total: totalCell(find(markets.totals, "under"), "U"),
      moneyline: moneylineCell(find(markets.h2h, "home")),
    },
    liveMarkets: [markets.spreads, markets.totals, markets.h2h].filter(Boolean).length,
  };
}

/**
 * Splits a full club name into the small city line and the bold nickname.
 *
 * "Chicago Cubs" + "Cubs" → { city: "Chicago", nickname: "Cubs" }. When the
 * short name is not a suffix of the full name (or is missing), the full name
 * becomes the nickname and the city line is left empty — better one accurate
 * line than a guessed split like "Chicago White" / "Sox".
 */
export function splitTeamName(fullName: string, shortName?: string | null): { city: string; nickname: string } {
  const name = String(fullName ?? "").trim();
  const short = String(shortName ?? "").trim();
  if (!short || short === name || !name.toLowerCase().endsWith(short.toLowerCase())) {
    return { city: "", nickname: name };
  }
  return { city: name.slice(0, name.length - short.length).trim(), nickname: short };
}
