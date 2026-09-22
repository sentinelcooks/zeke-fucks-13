/**
 * Maps a stored pick's `bet_type` onto the market key the game-lines browser
 * uses, so tapping Details on a lineup card opens the market that card was
 * actually about.
 *
 * Totals arrive under two spellings and both are live: the scanner produces
 * `total` (see evaluateGameLines in supabase/functions/_shared/sport_scan.ts),
 * while `buildDailyPickRow` rewrites it to `over_under` on the way into
 * daily_picks. A mapping that handles only one of them silently drops half the
 * totals back onto the default market.
 */
export type PickMarketKey = "h2h" | "spreads" | "totals";

const BET_TYPE_TO_MARKET: Record<string, PickMarketKey> = {
  moneyline: "h2h",
  ml: "h2h",
  h2h: "h2h",
  spread: "spreads",
  spreads: "spreads",
  runline: "spreads",
  run_line: "spreads",
  puckline: "spreads",
  puck_line: "spreads",
  total: "totals",
  totals: "totals",
  over_under: "totals",
  overunder: "totals",
};

/**
 * The market a pick belongs to, or null when it is not a game market at all
 * (player props have no market tab to open).
 */
export function marketKeyForBetType(
  betType: string | null | undefined,
): PickMarketKey | null {
  const key = String(betType ?? "").trim().toLowerCase();
  if (!key || key === "prop") return null;
  return BET_TYPE_TO_MARKET[key] ?? null;
}

/** True when a pick is a game market rather than a player prop. */
export function isGameMarketPick(betType: string | null | undefined): boolean {
  return marketKeyForBetType(betType) !== null;
}

/**
 * The line a pick was written at, picking the market-specific column first.
 * Spreads and totals each have a dedicated column and fall back to `line`.
 */
export function pickMarketLine(pick: {
  bet_type?: string | null;
  line?: number | string | null;
  spread_line?: number | string | null;
  total_line?: number | string | null;
}): number | null {
  const market = marketKeyForBetType(pick.bet_type);
  const candidates =
    market === "spreads" ? [pick.spread_line, pick.line]
      : market === "totals" ? [pick.total_line, pick.line]
      : [pick.line];

  for (const raw of candidates) {
    // Number(null) and Number("") are both 0, so an absent line would read as a
    // real 0 and pin a spread at pick'em. Reject the empties explicitly.
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}
