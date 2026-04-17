// ─────────────────────────────────────────────────────────────
// Shared Odds Intelligence — line movement, RLM, sharp divergence,
// quota guard, and credit-cost recording for The Odds API.
// Reusable across NHL/NBA/MLB lines modules.
// ─────────────────────────────────────────────────────────────

export interface BookPrice {
  book: string;
  price: number;
  line?: number;
  market: string;
}

export interface LineMovementResult {
  openLine: number | null;
  currentLine: number | null;
  steamMove: boolean;
  freeze: boolean;
  side: "home" | "away" | "neutral";
  delta: number;
}

export interface RLMResult {
  triggered: boolean;
  sharpSide: "home" | "away" | "neutral";
  magnitude: number;
}

const SHARP_BOOKS = ["pinnacle", "circa", "circasports"];
const PUBLIC_THRESHOLD_PCT = 65;

// ── Pull line history from odds_history table ───────────────
export async function pullOddsHistory(
  supabase: any,
  gameId: string,
  market: string,
  windowMinutes = 240,
): Promise<any[]> {
  try {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("odds_history")
      .select("*")
      .eq("game_id", gameId)
      .eq("market", market)
      .gte("snapshot_at", since)
      .order("snapshot_at", { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

// ── Steam detection: 3+ books moving same direction within 30 min ──
export function computeLineMovement(
  history: any[],
  current: BookPrice[],
): LineMovementResult {
  if (history.length < 2) {
    const avgCur = current.length > 0
      ? current.reduce((s, c) => s + (c.line ?? c.price), 0) / current.length
      : null;
    return {
      openLine: avgCur,
      currentLine: avgCur,
      steamMove: false,
      freeze: false,
      side: "neutral",
      delta: 0,
    };
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime(),
  );
  const opening = sorted[0];
  const openLine = opening.line ?? opening.price;
  const currentAvg = current.length > 0
    ? current.reduce((s, c) => s + (c.line ?? c.price), 0) / current.length
    : openLine;
  const delta = currentAvg - openLine;

  // Steam: count books that moved >= 5 cents in same direction in last 30 min
  const cutoff = Date.now() - 30 * 60 * 1000;
  const recentBookMoves: Record<string, number> = {};
  for (const row of sorted) {
    if (new Date(row.snapshot_at).getTime() < cutoff) continue;
    const cur = current.find((c) => c.book.toLowerCase() === (row.book || "").toLowerCase());
    if (!cur) continue;
    const moved = (cur.line ?? cur.price) - (row.line ?? row.price);
    if (Math.abs(moved) >= 5) recentBookMoves[row.book] = moved;
  }
  const sameDir = Object.values(recentBookMoves).filter((m) => Math.sign(m) === Math.sign(delta));
  const steamMove = sameDir.length >= 3;

  // Freeze: very small delta but high volume of consensus
  const freeze = Math.abs(delta) < 1 && current.length >= 5;

  const side: "home" | "away" | "neutral" =
    delta > 1 ? "home" : delta < -1 ? "away" : "neutral";

  return { openLine, currentLine: currentAvg, steamMove, freeze, side, delta };
}

export function scoreLineMovement19(r: LineMovementResult): number {
  let s = 50;
  if (r.steamMove) s += 5;
  if (r.freeze) s += 4;
  s += Math.max(-10, Math.min(10, r.delta * 0.4));
  return Math.max(0, Math.min(100, s));
}

// ── RLM: line moves opposite of public bet % ───────────────
export function computeRLM(
  history: any[],
  publicHomePct: number | null,
  current: BookPrice[],
  market: string,
): RLMResult {
  if (history.length < 2 || publicHomePct == null) {
    return { triggered: false, sharpSide: "neutral", magnitude: 0 };
  }
  const sorted = [...history].sort(
    (a, b) => new Date(a.snapshot_at).getTime() - new Date(b.snapshot_at).getTime(),
  );
  const opening = sorted[0];
  const openLine = opening.line ?? opening.price;
  const currentAvg = current.length > 0
    ? current.reduce((s, c) => s + (c.line ?? c.price), 0) / current.length
    : openLine;
  const delta = currentAvg - openLine;
  const threshold = market === "h2h" ? 15 : 0.5;

  if (Math.abs(delta) < threshold) {
    return { triggered: false, sharpSide: "neutral", magnitude: Math.abs(delta) };
  }

  // Public on home (publicHomePct > 65) but line moves toward away → RLM toward away
  const publicSide: "home" | "away" = publicHomePct >= 50 ? "home" : "away";
  const lineSide: "home" | "away" = delta > 0 ? "home" : "away";
  if (
    publicHomePct >= PUBLIC_THRESHOLD_PCT &&
    publicSide !== lineSide
  ) {
    return { triggered: true, sharpSide: lineSide, magnitude: Math.abs(delta) };
  }
  return { triggered: false, sharpSide: "neutral", magnitude: Math.abs(delta) };
}

export function scoreRLM20(r: RLMResult): number {
  if (r.triggered) return Math.min(100, 50 + 6 + Math.min(10, r.magnitude * 0.3));
  return 50;
}

// ── Sharp book vs consensus divergence (Pinnacle/Circa) ────
export function sharpBookDivergence(current: BookPrice[]): {
  diverges: boolean;
  sharpSide: "home" | "away" | "neutral";
  diff: number;
} {
  const sharps = current.filter((c) =>
    SHARP_BOOKS.some((s) => c.book.toLowerCase().includes(s)),
  );
  const others = current.filter((c) =>
    !SHARP_BOOKS.some((s) => c.book.toLowerCase().includes(s)),
  );
  if (sharps.length === 0 || others.length === 0) {
    return { diverges: false, sharpSide: "neutral", diff: 0 };
  }
  const sharpAvg = sharps.reduce((s, c) => s + (c.line ?? c.price), 0) / sharps.length;
  const otherAvg = others.reduce((s, c) => s + (c.line ?? c.price), 0) / others.length;
  const diff = sharpAvg - otherAvg;
  return {
    diverges: Math.abs(diff) >= 10,
    sharpSide: diff > 0 ? "home" : diff < 0 ? "away" : "neutral",
    diff,
  };
}

// ── Quota guard ────────────────────────────────────────────
export interface QuotaStatus {
  ok: boolean;
  remainingPct: number;
  remaining: number | null;
}

export async function checkOddsQuota(supabase: any): Promise<QuotaStatus> {
  try {
    const { data } = await supabase
      .from("odds_api_keys")
      .select("requests_remaining,requests_used")
      .eq("is_active", true)
      .order("requests_remaining", { ascending: false, nullsFirst: false })
      .limit(1);
    const row = data?.[0];
    if (!row || row.requests_remaining == null) {
      return { ok: true, remainingPct: 1, remaining: null };
    }
    const total = (row.requests_remaining || 0) + (row.requests_used || 0);
    const pct = total > 0 ? row.requests_remaining / total : 1;
    return { ok: pct >= 0.20, remainingPct: pct, remaining: row.requests_remaining };
  } catch {
    return { ok: true, remainingPct: 1, remaining: null };
  }
}

// ── Record API call cost ───────────────────────────────────
export async function recordOddsApiUsage(
  supabase: any,
  args: {
    endpoint: string;
    sport: string;
    markets: string[];
    regions: string[];
    booksCount: number;
    requestsRemaining: number | null;
    requestsUsed: number | null;
    keyId?: string | null;
  },
): Promise<void> {
  const creditCost = args.markets.length * args.regions.length * Math.max(args.booksCount, 1);
  try {
    await supabase.from("odds_api_usage").insert({
      endpoint: args.endpoint,
      sport: args.sport,
      markets: args.markets,
      regions: args.regions,
      books_count: args.booksCount,
      credit_cost: creditCost,
      requests_remaining: args.requestsRemaining,
      requests_used: args.requestsUsed,
      key_id: args.keyId || null,
    });
  } catch (e) {
    console.error("recordOddsApiUsage failed:", (e as Error).message);
  }
}
