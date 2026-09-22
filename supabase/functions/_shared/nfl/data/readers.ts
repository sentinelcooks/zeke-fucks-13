/**
 * NFL shared RAW-data readers for edge functions (Postgres + odds snapshots +
 * weather). Used by nfl-game-edge, nfl-player-prop-edge and nfl-grade.
 *
 * Returns observed data only — no predictions. Both engines may use these;
 * neither engine's output is ever read here.
 */

import type {
  NflGameRow,
  NflInjuryRow,
  NflMarketQuote,
  NflPlayerWeekRow,
  NflTeamWeekRow,
} from "./types.ts";
import type { NflPositionAllowedRow } from "./position_allowed.ts";
import { NFL_TEAMS, resolveNflTeam } from "./teams.ts";
import { normalizePlayerName } from "./aggregate.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const PAGE = 1000;

async function selectAll<T>(query: () => { range: (a: number, b: number) => Promise<{ data: T[] | null; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const numify = <T>(rows: T[]): T[] =>
  rows.map((r) => {
    const o: Record<string, unknown> = { ...(r as Record<string, unknown>) };
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v) && k !== "game_id" && k !== "player_id") o[k] = Number(v);
    }
    return o as T;
  });

// ─── Feature store ────────────────────────────────────────────────────────

export async function loadGame(db: Db, gameId: string): Promise<NflGameRow | null> {
  const { data, error } = await db.from("nfl_games").select("*").eq("game_id", gameId).maybeSingle();
  if (error) throw new Error(`nfl_games: ${error.message}`);
  return data ? numify([data as NflGameRow])[0] : null;
}

/** Games kicking off in [from, to). */
export async function loadUpcomingGames(db: Db, fromIso: string, toIso: string): Promise<NflGameRow[]> {
  const { data, error } = await db.from("nfl_games").select("*")
    .gte("kickoff", fromIso).lt("kickoff", toIso).order("kickoff");
  if (error) throw new Error(`nfl_games: ${error.message}`);
  return numify((data ?? []) as NflGameRow[]);
}

/** League team-week rows for `season` and `season − 1`. */
export async function loadTeamWeeks(db: Db, season: number): Promise<NflTeamWeekRow[]> {
  return numify(await selectAll<NflTeamWeekRow>(() =>
    db.from("nfl_team_week_features").select("*").gte("season", season - 1).lte("season", season)
      .order("season").order("week").order("team")));
}

export async function loadPlayerWeeks(
  db: Db,
  season: number,
  filter: { teams?: string[]; positions?: string[]; playerIds?: string[]; nameLike?: string },
): Promise<NflPlayerWeekRow[]> {
  return numify(await selectAll<NflPlayerWeekRow>(() => {
    let q = db.from("nfl_player_week").select("*").gte("season", season - 1).lte("season", season);
    if (filter.teams) q = q.in("team", filter.teams);
    if (filter.positions) q = q.in("position", filter.positions);
    if (filter.playerIds) q = q.in("player_id", filter.playerIds);
    if (filter.nameLike) q = q.ilike("player_name", `%${filter.nameLike.replace(/[%_]/g, "")}%`);
    return q.order("season").order("week").order("player_id");
  }));
}

export async function loadInjuries(db: Db, season: number, week: number, teams: string[]): Promise<NflInjuryRow[]> {
  const { data, error } = await db.from("nfl_injuries").select("*")
    .eq("season", season).eq("week", week).in("team", teams);
  if (error) throw new Error(`nfl_injuries: ${error.message}`);
  return numify((data ?? []) as NflInjuryRow[]);
}

export async function loadPositionAllowed(db: Db, season: number, position: string): Promise<NflPositionAllowedRow[]> {
  return numify(await selectAll<NflPositionAllowedRow>(() =>
    db.from("nfl_position_allowed").select("*").gte("season", season - 1).lte("season", season)
      .eq("position", position).order("season").order("week").order("defense")));
}

// ─── Market snapshots ─────────────────────────────────────────────────────

interface SnapshotRow {
  event_id: string;
  book: string;
  market: string;
  outcome_name: string;
  outcome_description: string;
  price: number;
  line: number | null;
  commence_time: string | null;
  snapshot_at: string;
}

/** Find the Odds API event for a game by team names and kickoff (±12 h). */
export async function findOddsEvent(db: Db, game: NflGameRow): Promise<string | null> {
  if (!game.kickoff) return null;
  const k = new Date(game.kickoff).getTime();
  const { data, error } = await db.from("market_odds_snapshots")
    .select("event_id, outcome_name, commence_time")
    .eq("sport", "nfl").eq("market", "h2h")
    .gte("commence_time", new Date(k - 12 * 3600e3).toISOString())
    .lte("commence_time", new Date(k + 12 * 3600e3).toISOString())
    .limit(500);
  if (error) throw new Error(`market_odds_snapshots: ${error.message}`);
  const byEvent = new Map<string, Set<string>>();
  for (const r of (data ?? []) as SnapshotRow[]) {
    const t = resolveNflTeam(r.outcome_name);
    if (!t) continue;
    byEvent.set(r.event_id, (byEvent.get(r.event_id) ?? new Set()).add(t));
  }
  for (const [id, teams] of byEvent) if (teams.has(game.home_team) && teams.has(game.away_team)) return id;
  return null;
}

async function loadSnapshots(db: Db, eventId: string, markets: string[], before: string | null): Promise<SnapshotRow[]> {
  return numify(await selectAll<SnapshotRow>(() => {
    let q = db.from("market_odds_snapshots").select("*").eq("event_id", eventId).in("market", markets);
    if (before) q = q.lt("snapshot_at", before);
    return q.order("snapshot_at");
  }));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const mode = (xs: number[]): number => {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0];
};

/**
 * Collapse snapshot rows for one two-way market into a quote. `sideA`/`sideB`
 * pick each outcome row; `lineOf` reads side A's line (null for moneylines).
 * Consensus = median price at the modal line across books' latest snapshot;
 * best = highest price at that line; opening = consensus of the first snapshot.
 */
export function buildQuote(
  rows: SnapshotRow[],
  sideA: (r: SnapshotRow) => boolean,
  sideB: (r: SnapshotRow) => boolean,
  hasLine: boolean,
): NflMarketQuote | null {
  if (!rows.length) return null;
  const times = [...new Set(rows.map((r) => r.snapshot_at))].sort();
  const latestPerBook = (list: SnapshotRow[]) => {
    const m = new Map<string, SnapshotRow>();
    for (const r of list) {
      const prev = m.get(r.book);
      if (!prev || r.snapshot_at > prev.snapshot_at) m.set(r.book, r);
    }
    return [...m.values()];
  };
  const pairAt = (list: SnapshotRow[]) => {
    const a = latestPerBook(list.filter(sideA));
    const b = latestPerBook(list.filter(sideB));
    if (!a.length || !b.length) return null;
    const line = hasLine ? mode(a.map((r) => r.line ?? 0)) : null;
    const aAt = hasLine ? a.filter((r) => r.line === line) : a;
    // Side B's line is the negation for spreads, the same number for totals/props.
    const bAt = hasLine ? b.filter((r) => r.line === line || r.line === -(line as number)) : b;
    if (!aAt.length || !bAt.length) return null;
    return { line, aAt, bAt };
  };
  const current = pairAt(rows);
  if (!current) return null;
  const firstTime = times[0];
  const opening = pairAt(rows.filter((r) => r.snapshot_at === firstTime));
  const best = (list: SnapshotRow[]) => list.reduce((x, y) => (y.price > x.price ? y : x));
  const bestA = best(current.aAt);
  const bestB = best(current.bAt);
  return {
    current: { line: current.line, price_a: median(current.aAt.map((r) => r.price)), price_b: median(current.bAt.map((r) => r.price)) },
    opening: opening
      ? { line: opening.line, price_a: median(opening.aAt.map((r) => r.price)), price_b: median(opening.bAt.map((r) => r.price)) }
      : null,
    best_price_a: bestA.price,
    best_book_a: bestA.book,
    best_price_b: bestB.price,
    best_book_b: bestB.book,
    books: new Set([...current.aAt, ...current.bAt].map((r) => r.book)).size,
    snapshot_at: times[times.length - 1],
  };
}

export interface GameMarketQuotes {
  event_id: string | null;
  moneyline: NflMarketQuote | null;
  spread: NflMarketQuote | null;
  total: NflMarketQuote | null;
}

/** Game markets from odds snapshots, optionally only snapshots before `before` (closing lines). */
export async function loadGameQuotes(db: Db, game: NflGameRow, before: string | null = null): Promise<GameMarketQuotes> {
  const eventId = await findOddsEvent(db, game);
  if (!eventId) return { event_id: null, moneyline: null, spread: null, total: null };
  const rows = await loadSnapshots(db, eventId, ["h2h", "spreads", "totals"], before);
  const isTeam = (abbr: string) => (r: SnapshotRow) => resolveNflTeam(r.outcome_name) === abbr;
  return {
    event_id: eventId,
    moneyline: buildQuote(rows.filter((r) => r.market === "h2h"), isTeam(game.home_team), isTeam(game.away_team), false),
    spread: buildQuote(rows.filter((r) => r.market === "spreads"), isTeam(game.home_team), isTeam(game.away_team), true),
    total: buildQuote(rows.filter((r) => r.market === "totals"), (r) => r.outcome_name === "Over", (r) => r.outcome_name === "Under", true),
  };
}

/** Sportsbook market key → engine prop type. Targets have no market (always NO PLAY). */
export const ODDS_PROP_MARKETS: Record<string, string> = {
  player_pass_yds: "pass_yds",
  player_pass_attempts: "pass_att",
  player_pass_completions: "pass_cmp",
  player_pass_tds: "pass_tds",
  player_pass_interceptions: "pass_ints",
  player_rush_yds: "rush_yds",
  player_rush_attempts: "rush_att",
  player_reception_yds: "rec_yds",
  player_receptions: "receptions",
  player_anytime_td: "anytime_td",
  player_field_goals: "fg_made",
  player_pats: "xp_made",
  player_kicking_points: "kicking_points",
};

export interface PropQuote {
  player_key: string; // normalised name
  player_label: string;
  prop_type: string;
  quote: NflMarketQuote | null; // two-way
  one_sided: { line: number; price: number; best: number; best_book: string; books: number; opening: number | null } | null;
}

/** Every priced player prop for one event, grouped by player + prop type. */
export async function loadPropQuotes(db: Db, eventId: string, before: string | null = null): Promise<PropQuote[]> {
  const rows = await loadSnapshots(db, eventId, Object.keys(ODDS_PROP_MARKETS), before);
  const groups = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    if (!r.outcome_description) continue;
    const k = `${r.market}|${normalizePlayerName(r.outcome_description)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: PropQuote[] = [];
  for (const [k, list] of groups) {
    const [market, playerKey] = k.split("|");
    const hasUnder = list.some((r) => r.outcome_name === "Under");
    const quote = hasUnder
      ? buildQuote(list, (r) => r.outcome_name === "Over", (r) => r.outcome_name === "Under", true)
      : null;
    let oneSided: PropQuote["one_sided"] = null;
    if (!hasUnder) {
      const yes = list.filter((r) => r.outcome_name === "Yes" || r.outcome_name === "Over");
      if (yes.length) {
        const latest = new Map<string, SnapshotRow>();
        for (const r of yes) if (!latest.has(r.book) || r.snapshot_at > latest.get(r.book)!.snapshot_at) latest.set(r.book, r);
        const cur = [...latest.values()];
        const bestRow = cur.reduce((x, y) => (y.price > x.price ? y : x));
        const first = yes.filter((r) => r.snapshot_at === yes[0].snapshot_at);
        oneSided = {
          line: cur[0].line ?? 0.5,
          price: median(cur.map((r) => r.price)),
          best: bestRow.price,
          best_book: bestRow.book,
          books: cur.length,
          opening: first.length ? median(first.map((r) => r.price)) : null,
        };
      }
    }
    out.push({ player_key: playerKey, player_label: list[0].outcome_description, prop_type: ODDS_PROP_MARKETS[market], quote, one_sided: oneSided });
  }
  return out;
}

// ─── Weather (Open-Meteo forecast, no key) ────────────────────────────────

export async function forecastWeather(homeTeam: string, kickoffIso: string | null): Promise<{
  temp: number | null; wind: number | null; precip_prob: number | null; source: "forecast" | "none";
}> {
  const t = NFL_TEAMS[homeTeam];
  if (!t || !kickoffIso) return { temp: null, wind: null, precip_prob: null, source: "none" };
  const kickoff = new Date(kickoffIso);
  if (kickoff.getTime() - Date.now() > 15 * 86400e3) return { temp: null, wind: null, precip_prob: null, source: "none" };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${t.lat}&longitude=${t.lon}` +
      `&hourly=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=16`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { temp: null, wind: null, precip_prob: null, source: "none" };
    const j = await res.json();
    const hour = kickoff.toISOString().slice(0, 13);
    const idx = (j.hourly?.time as string[] | undefined)?.findIndex((x) => x.startsWith(hour)) ?? -1;
    if (idx < 0) return { temp: null, wind: null, precip_prob: null, source: "none" };
    return {
      temp: j.hourly.temperature_2m[idx] ?? null,
      wind: j.hourly.wind_speed_10m[idx] ?? null,
      precip_prob: j.hourly.precipitation_probability?.[idx] != null ? j.hourly.precipitation_probability[idx] / 100 : null,
      source: "forecast",
    };
  } catch {
    return { temp: null, wind: null, precip_prob: null, source: "none" };
  }
}

// ─── Config ───────────────────────────────────────────────────────────────

export async function loadJsonConfig<T>(db: Db, key: string): Promise<Partial<T> | null> {
  const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(data.value) as Partial<T>;
  } catch {
    console.warn(`[nfl] app_config ${key} is not valid JSON; using defaults`);
    return null;
  }
}

/** Scan bucket: one prediction per market per hour keeps the table bounded but tracks movement. */
export function scanBucket(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}
