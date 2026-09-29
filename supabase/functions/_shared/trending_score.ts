// supabase/functions/_shared/trending_score.ts
//
// "Trending tonight" = market heat, NOT bet volume.
//
// No data source available to Sentinel reports how many bets a prop takes
// (the Odds API publishes prices, not handle or ticket counts). What sportsbook
// prices DO reveal is where money is moving: books move a line or shade a price
// when one side takes action. So a prop is "hot" when
//   1. many books post it       — mainstream, liquid market
//   2. its line has moved       — books were forced to adjust
//   3. its Over price has moved — books shaded the juice without moving the line
//
// Pure module (no Deno / network APIs) so vitest can import it directly.
// It is display-only: heat never feeds a model score, confidence or pick.

/** One outcome row as stored in market_odds_snapshots. */
export interface PropSnapshotRow {
  event_id: string;
  book: string;
  market: string;
  outcome_name: string;          // "Over" | "Under"
  outcome_description: string;   // player name
  price: number;                 // American odds
  line: number | null;
  snapshot_at: string;
  commence_time?: string | null;
}

export interface TrendingProp {
  event_id: string;
  player: string;
  market: string;
  /** Median Over line across books in the latest snapshot. */
  line: number;
  books: number;
  /** Median current line minus median opening line. */
  line_move: number;
  /** Mean change in Over implied probability, percentage points, same-line books only. */
  price_move_pp: number;
  /** 0–100 display score. Relative within one slate only. */
  heat: number;
  /** Side the movement points to, or null when nothing moved. */
  lean: "over" | "under" | null;
  commence_time: string | null;
}

// Heat weights. Line movement dominates because a moved line is the strongest
// public evidence that one side took money; price-only moves are weaker (books
// also shade juice to balance their own exposure); book count keeps a liquid,
// widely-posted market above an obscure one that moved on a single book.
export const HEAT_WEIGHT_BOOKS = 0.3;
export const HEAT_WEIGHT_LINE = 0.4;
export const HEAT_WEIGHT_PRICE = 0.3;

/** Books posting a prop at which the book-count component saturates. */
export const HEAT_BOOKS_FULL = 5;
/** A prop posted by fewer books is too thin to call trending. */
export const HEAT_MIN_BOOKS = 2;
/** Over implied-probability move (pp) at which the price component saturates. */
export const HEAT_PRICE_MOVE_FULL_PP = 8;
/**
 * Line move at which the line component saturates, scaled to the size of the
 * line: half a point is a big move on a 0.5 strikeout line and noise on a
 * 24.5 points line.
 */
export function lineMoveFullScale(openLine: number): number {
  return 0.5 + 0.08 * Math.abs(openLine);
}

export const TRENDING_LIMIT = 5;
/** Same cap idea as Today's Edge: the list must not be five points props. */
export const TRENDING_MAX_PER_MARKET = 2;

export function impliedProbability(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Snapshot times arrive as "…Z" from code, "…+00:00" from PostgREST and
 * "… +00" from psql. Comparing them as strings misorders the same instant, so
 * every comparison goes through epoch milliseconds.
 */
export function snapshotEpoch(value: string): number {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
}

interface BookQuote {
  open: PropSnapshotRow;
  openAt: number;
  current: PropSnapshotRow;
  currentAt: number;
}

/**
 * Scores every player prop in `rows` and returns the hottest, capped at one
 * prop per player and TRENDING_MAX_PER_MARKET per market.
 *
 * `rows` may hold several snapshots; for each book the earliest row is the
 * opening quote and the latest is the current one. Only Over outcomes are read
 * — the Under is the same market's mirror and would double-count it.
 */
export function scoreTrendingProps(rows: PropSnapshotRow[], limit = TRENDING_LIMIT): TrendingProp[] {
  const groups = new Map<string, Map<string, BookQuote>>();

  for (const row of rows) {
    if (String(row.outcome_name).toLowerCase() !== "over") continue;
    if (!row.outcome_description || row.line === null || !Number.isFinite(row.line)) continue;
    if (!Number.isFinite(row.price)) continue;
    const at = snapshotEpoch(row.snapshot_at);
    if (!Number.isFinite(at)) continue;

    const key = `${row.event_id}|${row.market}|${row.outcome_description}`;
    let books = groups.get(key);
    if (!books) {
      books = new Map();
      groups.set(key, books);
    }
    const quote = books.get(row.book);
    if (!quote) {
      books.set(row.book, { open: row, openAt: at, current: row, currentAt: at });
      continue;
    }
    if (at < quote.openAt) Object.assign(quote, { open: row, openAt: at });
    if (at > quote.currentAt) Object.assign(quote, { current: row, currentAt: at });
  }

  // Only an event's latest snapshot counts as "posted now": a book that pulled
  // the prop hours ago must not keep propping up its book count. Per event, so
  // one event missing from the newest run does not wipe out its props.
  const latestByEvent = new Map<string, number>();
  for (const books of groups.values()) {
    for (const quote of books.values()) {
      const eventId = quote.current.event_id;
      if (quote.currentAt > (latestByEvent.get(eventId) ?? -Infinity)) latestByEvent.set(eventId, quote.currentAt);
    }
  }

  const scored: TrendingProp[] = [];
  for (const books of groups.values()) {
    const quotes = [...books.values()].filter(
      (q) => q.currentAt === latestByEvent.get(q.current.event_id),
    );
    if (quotes.length < HEAT_MIN_BOOKS) continue;

    const currentLine = median(quotes.map((q) => q.current.line as number));
    const openLine = median(quotes.map((q) => q.open.line as number));
    if (currentLine === null || openLine === null) continue;
    const lineMove = currentLine - openLine;

    // A price change only means something when the line did not move with it.
    const priceMoves = quotes
      .filter((q) => q.open.line === q.current.line)
      .map((q) => {
        const open = impliedProbability(q.open.price);
        const current = impliedProbability(q.current.price);
        return open === null || current === null ? null : (current - open) * 100;
      })
      .filter((value): value is number => value !== null);
    const priceMove = priceMoves.length ? priceMoves.reduce((a, b) => a + b, 0) / priceMoves.length : 0;

    const heat =
      HEAT_WEIGHT_BOOKS * clamp01(quotes.length / HEAT_BOOKS_FULL) +
      HEAT_WEIGHT_LINE * clamp01(Math.abs(lineMove) / lineMoveFullScale(openLine)) +
      HEAT_WEIGHT_PRICE * clamp01(Math.abs(priceMove) / HEAT_PRICE_MOVE_FULL_PP);

    // A raised line or a pricier Over both mean the Over took the money.
    const signal = lineMove !== 0 ? lineMove : priceMove;
    const sample = quotes[0].current;
    scored.push({
      event_id: sample.event_id,
      player: sample.outcome_description,
      market: sample.market,
      line: currentLine,
      books: quotes.length,
      line_move: Math.round(lineMove * 100) / 100,
      price_move_pp: Math.round(priceMove * 10) / 10,
      heat: Math.round(heat * 100),
      lean: signal > 0 ? "over" : signal < 0 ? "under" : null,
      commence_time: sample.commence_time ?? null,
    });
  }

  scored.sort((a, b) =>
    b.heat - a.heat ||
    b.books - a.books ||
    a.player.localeCompare(b.player) ||
    a.market.localeCompare(b.market)
  );

  const players = new Set<string>();
  const perMarket = new Map<string, number>();
  const picked: TrendingProp[] = [];
  for (const prop of scored) {
    if (picked.length >= limit) break;
    if (players.has(prop.player)) continue;
    if ((perMarket.get(prop.market) ?? 0) >= TRENDING_MAX_PER_MARKET) continue;
    players.add(prop.player);
    perMarket.set(prop.market, (perMarket.get(prop.market) ?? 0) + 1);
    picked.push(prop);
  }
  return picked;
}
