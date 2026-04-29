/**
 * Shared best-book selector — mirrored from supabase/functions/_shared/bestBookLine.ts.
 * Keep both files in sync.
 *
 * Ranking rules per market type:
 *   moneyline : EV primary → odds secondary → bookKey tertiary
 *   spread    : best handicap primary → odds secondary → bookKey tertiary
 *   total     : best line for direction primary → odds secondary → bookKey tertiary
 *   prop      : best line for direction primary → odds secondary → bookKey tertiary
 */

export interface BookLine {
  book: string;
  bookKey: string;
  odds: number;   // American odds
  point?: number | null;
}

export type MarketType = "moneyline" | "spread" | "total" | "prop";
export type Direction = "team1" | "team2" | "over" | "under";

export interface EnrichedBookLine extends BookLine {
  ev: number;
  implied: number; // 0..1 ratio
}

export interface BestBookResult {
  bestBook: EnrichedBookLine | null;
  bestLine: EnrichedBookLine | null;
  bestOdds: EnrichedBookLine | null;
  bestEv: EnrichedBookLine | null;
  agree: boolean;
  reason: string;
  comparisonRows: EnrichedBookLine[];
}

function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

function impliedProb(american: number): number {
  if (american < 0) return Math.abs(american) / (Math.abs(american) + 100);
  return 100 / (american + 100) / 100;
}

function computeEV(modelProb: number, american: number): number {
  return (modelProb * americanToDecimal(american) - 1) * 100;
}

/**
 * Returns a score where HIGHER = BETTER LINE for the bettor.
 *
 *   spread team1/team2 : higher point is always better (more points = easier cover)
 *   total/prop Over    : lower line is easier to clear → negate so lower → higher score
 *   total/prop Under   : higher line is easier to miss → raw point, higher → higher score
 */
function lineScore(point: number, direction: Direction): number {
  if (direction === "team1" || direction === "team2") return point;
  if (direction === "over") return -point;
  return point; // under
}

export function selectBestBookLine(
  lines: BookLine[],
  marketType: MarketType,
  direction: Direction,
  modelProbability: number, // 0..1 for the chosen direction
): BestBookResult {
  const empty: BestBookResult = {
    bestBook: null,
    bestLine: null,
    bestOdds: null,
    bestEv: null,
    agree: false,
    reason: "no_lines",
    comparisonRows: [],
  };

  const valid = lines.filter((l) => {
    if (typeof l.odds !== "number" || !isFinite(l.odds)) return false;
    if (marketType !== "moneyline" && (l.point == null || !isFinite(l.point!))) return false;
    return true;
  });

  if (valid.length === 0) return empty;

  const enriched: EnrichedBookLine[] = valid.map((l) => ({
    ...l,
    implied: impliedProb(l.odds),
    ev: computeEV(modelProbability, l.odds),
  }));

  // bestOdds: highest American odds (best payout), tiebreak by bookKey
  const bestOdds = [...enriched].sort((a, b) =>
    b.odds !== a.odds ? b.odds - a.odds : a.bookKey.localeCompare(b.bookKey),
  )[0];

  // bestEv: highest EV, tiebreak by odds, then bookKey
  const bestEv = [...enriched].sort((a, b) =>
    b.ev !== a.ev
      ? b.ev - a.ev
      : b.odds !== a.odds
      ? b.odds - a.odds
      : a.bookKey.localeCompare(b.bookKey),
  )[0];

  let bestBook: EnrichedBookLine;
  let bestLine: EnrichedBookLine;
  let reason: string;

  if (marketType === "moneyline") {
    bestBook = bestEv;
    bestLine = bestEv;
    reason = `Best EV (${bestBook.ev.toFixed(1)}%) at ${bestBook.book}`;
  } else {
    // Primary: line score; secondary: odds; tertiary: bookKey
    const sortedByLine = [...enriched].sort((a, b) => {
      const ls = lineScore(b.point!, direction) - lineScore(a.point!, direction);
      if (ls !== 0) return ls;
      if (b.odds !== a.odds) return b.odds - a.odds;
      return a.bookKey.localeCompare(b.bookKey);
    });
    bestLine = sortedByLine[0];
    bestBook = bestLine;
    const pt = bestBook.point != null ? `${bestBook.point > 0 ? "+" : ""}${bestBook.point}` : "";
    const od = `${bestBook.odds > 0 ? "+" : ""}${bestBook.odds}`;
    reason = `Best line (${pt}) with ${od} at ${bestBook.book}`;
  }

  // comparisonRows: EV desc → odds → bookKey
  const comparisonRows = [...enriched].sort((a, b) =>
    b.ev !== a.ev
      ? b.ev - a.ev
      : b.odds !== a.odds
      ? b.odds - a.odds
      : a.bookKey.localeCompare(b.bookKey),
  );

  const agree =
    bestBook.bookKey === bestLine.bookKey &&
    bestBook.bookKey === bestOdds.bookKey &&
    bestBook.bookKey === bestEv.bookKey;

  return { bestBook, bestLine, bestOdds, bestEv, agree, reason, comparisonRows };
}
