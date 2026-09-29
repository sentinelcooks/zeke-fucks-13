// supabase/functions/_shared/trending_props.ts
//
// Builds the Analyze tab's "Trending tonight" list for one sport and stores it
// in public.trending_props. Called only by the per-sport trending-props-*
// functions on cron — never on a user request, so browsing the Analyze tab can
// never spend Odds API credits.
//
// "Trending" is market heat (see trending_score.ts), not bet volume: no source
// available to Sentinel reports bet counts.
//
// NBA / WNBA / MLB / NHL: fetches tonight's prop odds (a small market set, a
//   capped number of events), appends them to market_odds_snapshots, and scores
//   them against the earliest snapshot captured for each event.
// NFL: makes NO Odds API calls. odds-snapshot already snapshots NFL props for
//   the NFL Player Prop Edge engine; this only reads those rows. It does not
//   import or touch either NFL edge engine.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getMasterClient } from "./masterClient.ts";
import { checkOddsQuota, recordOddsApiUsage } from "./odds_intelligence.ts";
import { scoreTrendingProps, type PropSnapshotRow, type TrendingProp } from "./trending_score.ts";

export type TrendingSport = "nba" | "wnba" | "mlb" | "nhl" | "nfl";

interface SportConfig {
  oddsSport: string;
  /** Odds API market key → the Analyze tab's prop value for that stat. */
  markets: Record<string, string>;
  /** false = read existing snapshots only (NFL). */
  fetchOdds: boolean;
}

const SPORTS: Record<TrendingSport, SportConfig> = {
  nba: {
    oddsSport: "basketball_nba",
    fetchOdds: true,
    markets: {
      player_points: "points",
      player_rebounds: "rebounds",
      player_assists: "assists",
      player_threes: "3-pointers",
      player_points_rebounds_assists: "pts+reb+ast",
    },
  },
  wnba: {
    oddsSport: "basketball_wnba",
    fetchOdds: true,
    markets: {
      player_points: "points",
      player_rebounds: "rebounds",
      player_assists: "assists",
      player_threes: "3-pointers",
      player_points_rebounds_assists: "pts+reb+ast",
    },
  },
  mlb: {
    oddsSport: "baseball_mlb",
    fetchOdds: true,
    markets: {
      pitcher_strikeouts: "pitcher_strikeouts",
      pitcher_earned_runs: "earned_runs",
      batter_hits: "hits",
      batter_total_bases: "total_bases",
      batter_hits_runs_rbis: "h+r+rbi",
    },
  },
  nhl: {
    oddsSport: "icehockey_nhl",
    fetchOdds: true,
    markets: {
      player_points: "nhl_points",
      player_shots_on_goal: "sog",
      player_goals: "goals",
    },
  },
  nfl: {
    oddsSport: "americanfootball_nfl",
    fetchOdds: false,
    markets: {
      player_pass_yds: "pass_yds",
      player_pass_tds: "pass_tds",
      player_rush_yds: "rush_yds",
      player_reception_yds: "rec_yds",
      player_receptions: "receptions",
    },
  },
};

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle"];
/** Credit cap: one request per event, billed per market. */
const MAX_EVENTS = 12;
/** Opening quotes older than this belong to a previous slate. */
const OPEN_LOOKBACK_MS = 36 * 3600e3;
/** NFL snapshots are taken up to a week ahead. */
const NFL_LOOKAHEAD_MS = 7 * 86400e3;
const APP_TZ = "America/New_York";
/**
 * "Tonight" runs until 4am ET the next morning — the same slate boundary the
 * app uses (src/lib/gameDate.ts SLATE_ROLLOVER_HOUR_ET), so slate_date matches
 * the date the frontend asks for.
 */
const SLATE_ROLLOVER_HOUR_ET = 4;

export interface TrendingItem extends TrendingProp {
  prop_type: string;
  matchup: string | null;
}

export interface RefreshResult {
  ok: boolean;
  sport: TrendingSport;
  skipped?: string;
  events_scanned: number;
  items: number;
  snapshots_written: number;
  requests_remaining?: number | null;
  error?: string;
}

interface OddsEvent {
  id: string;
  commence_time: string;
  home_team?: string;
  away_team?: string;
}

function etParts(date: Date): { ymd: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ET date whose slate `date` belongs to (before 4am counts as the previous night). */
function slateDate(date: Date): string {
  const { ymd, hour } = etParts(date);
  return hour < SLATE_ROLLOVER_HOUR_ET ? addDays(ymd, -1) : ymd;
}

/** Last word of a team name: "Las Vegas Aces" → "Aces". */
function nickname(team: string | undefined): string | null {
  const words = String(team ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : null;
}

function matchupLabel(away?: string, home?: string, joiner = "@"): string | null {
  const a = nickname(away);
  const h = nickname(home);
  return a && h ? `${a} ${joiner} ${h}` : null;
}

function localClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Same key rotation as odds-snapshot: least-recently-used active key, then app_config, then env. */
async function pickOddsKey(keysDb: SupabaseClient): Promise<{ apiKey: string | null; keyId: string | null }> {
  const { data: keys } = await keysDb
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (keys?.[0]?.api_key) return { apiKey: keys[0].api_key, keyId: keys[0].id };

  const { data: configData } = await keysDb.from("app_config").select("value").eq("key", "odds_api_key").maybeSingle();
  if (configData?.value) return { apiKey: configData.value, keyId: "app-config" };

  return { apiKey: Deno.env.get("ODDS_API_KEY") ?? null, keyId: null };
}

async function readOverRows(
  db: SupabaseClient,
  sport: TrendingSport,
  eventId: string,
  markets: string[],
  snapshotAt: string,
): Promise<PropSnapshotRow[]> {
  const { data, error } = await db
    .from("market_odds_snapshots")
    .select("event_id,book,market,outcome_name,outcome_description,price,line,snapshot_at,commence_time")
    .eq("sport", sport)
    .eq("event_id", eventId)
    .in("market", markets)
    .eq("outcome_name", "Over")
    .eq("snapshot_at", snapshotAt)
    .limit(1000);
  if (error) throw new Error(`snapshot read failed: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row, price: Number(row.price), line: row.line === null ? null : Number(row.line) }));
}

/** Earliest (or latest) prop snapshot for an event inside the lookback window. */
async function edgeSnapshotAt(
  db: SupabaseClient,
  sport: TrendingSport,
  eventId: string,
  markets: string[],
  ascending: boolean,
): Promise<string | null> {
  const { data, error } = await db
    .from("market_odds_snapshots")
    .select("snapshot_at")
    .eq("sport", sport)
    .eq("event_id", eventId)
    .in("market", markets)
    .gte("snapshot_at", new Date(Date.now() - OPEN_LOOKBACK_MS).toISOString())
    .order("snapshot_at", { ascending })
    .limit(1);
  if (error) throw new Error(`snapshot lookup failed: ${error.message}`);
  return data?.[0]?.snapshot_at ?? null;
}

/** Tonight's events for daily sports: from now until 4am ET tomorrow. */
function tonightsEvents(events: OddsEvent[], now: Date): OddsEvent[] {
  const slate = slateDate(now);
  return events
    .filter((e) => {
      const start = new Date(e.commence_time);
      return start.getTime() > now.getTime() && slateDate(start) === slate;
    })
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time))
    .slice(0, MAX_EVENTS);
}

async function fetchTonightFromOdds(
  sport: TrendingSport,
  config: SportConfig,
  db: SupabaseClient,
): Promise<{ events: OddsEvent[]; currentRows: PropSnapshotRow[]; written: number; remaining: number | null; skipped?: string }> {
  const keysDb = await getMasterClient();
  const quota = await checkOddsQuota(keysDb);
  if (!quota.ok) return { events: [], currentRows: [], written: 0, remaining: quota.remaining, skipped: "quota_low" };

  const { apiKey, keyId } = await pickOddsKey(keysDb);
  if (!apiKey) throw new Error("no_api_key");

  // The events endpoint does not cost credits.
  const eventsResp = await fetch(`https://api.the-odds-api.com/v4/sports/${config.oddsSport}/events?apiKey=${apiKey}`);
  if (!eventsResp.ok) throw new Error(`odds_api_events_${eventsResp.status}`);
  const events = tonightsEvents((await eventsResp.json()) as OddsEvent[], new Date());

  const markets = Object.keys(config.markets);
  const snapshotAt = new Date().toISOString();
  const rows: Array<PropSnapshotRow & { sport: string }> = [];
  let remaining: number | null = null;
  let used: number | null = null;

  for (const ev of events) {
    const resp = await fetch(
      `https://api.the-odds-api.com/v4/sports/${config.oddsSport}/events/${ev.id}/odds?apiKey=${apiKey}` +
        `&regions=us&markets=${markets.join(",")}&bookmakers=${BOOKS.join(",")}&oddsFormat=american`,
    );
    remaining = parseInt(resp.headers.get("x-requests-remaining") || "", 10) || remaining;
    used = parseInt(resp.headers.get("x-requests-used") || "", 10) || used;
    if (!resp.ok) {
      console.warn(`[trending-${sport}] event ${ev.id} odds failed: HTTP ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    for (const bm of data.bookmakers ?? []) {
      for (const mkt of bm.markets ?? []) {
        for (const o of mkt.outcomes ?? []) {
          if (!o?.name || !Number.isFinite(Number(o.price))) continue;
          rows.push({
            event_id: String(ev.id),
            sport,
            book: bm.key,
            market: mkt.key,
            outcome_name: String(o.name),
            outcome_description: o.description ? String(o.description) : "",
            price: Number(o.price),
            line: Number.isFinite(Number(o.point)) ? Number(o.point) : null,
            commence_time: ev.commence_time ?? null,
            snapshot_at: snapshotAt,
          });
        }
      }
    }
  }

  // Same table and conflict key odds-snapshot uses, so these rows also build
  // the line history later runs measure movement against.
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("market_odds_snapshots").upsert(rows.slice(i, i + 1000), {
      onConflict: "event_id,book,market,outcome_name,outcome_description,snapshot_at",
    });
    if (error) console.error(`[trending-${sport}] snapshot insert failed:`, error.message);
  }

  if (keyId && keyId !== "app-config" && remaining != null) {
    await keysDb.from("odds_api_keys")
      .update({ requests_remaining: remaining, requests_used: used, last_used_at: new Date().toISOString() })
      .eq("id", keyId);
  }
  if (events.length > 0) {
    await recordOddsApiUsage(keysDb, {
      endpoint: `/v4/sports/${config.oddsSport}/events/{id}/odds`,
      sport,
      markets,
      regions: ["us"],
      booksCount: BOOKS.length,
      requestsRemaining: remaining,
      requestsUsed: used,
      keyId,
    });
  }

  return {
    events,
    currentRows: rows.filter((r) => r.outcome_name === "Over"),
    written: rows.length,
    remaining,
  };
}

/** NFL: next game day's events, read from snapshots odds-snapshot already took. */
async function nflEventsFromSnapshots(db: SupabaseClient, markets: string[]): Promise<OddsEvent[]> {
  const now = new Date();
  const { data, error } = await db
    .from("market_odds_snapshots")
    .select("event_id,commence_time")
    .eq("sport", "nfl")
    .in("market", markets)
    .gt("commence_time", now.toISOString())
    .lte("commence_time", new Date(now.getTime() + NFL_LOOKAHEAD_MS).toISOString())
    .gte("snapshot_at", new Date(now.getTime() - OPEN_LOOKBACK_MS).toISOString())
    .order("commence_time", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`nfl event lookup failed: ${error.message}`);

  const events = new Map<string, OddsEvent>();
  for (const row of data ?? []) {
    if (row.commence_time && !events.has(row.event_id)) {
      events.set(row.event_id, { id: row.event_id, commence_time: row.commence_time });
    }
  }
  const upcoming = [...events.values()];
  if (upcoming.length === 0) return [];
  const nextDay = slateDate(new Date(upcoming[0].commence_time));
  return upcoming.filter((e) => slateDate(new Date(e.commence_time)) === nextDay).slice(0, MAX_EVENTS);
}

/** NFL team names from the event's latest h2h snapshot (home/away order is not stored). */
async function nflMatchup(db: SupabaseClient, eventId: string): Promise<string | null> {
  const { data } = await db
    .from("market_odds_snapshots")
    .select("outcome_name")
    .eq("sport", "nfl")
    .eq("event_id", eventId)
    .eq("market", "h2h")
    .order("snapshot_at", { ascending: false })
    .limit(4);
  const teams = [...new Set((data ?? []).map((r) => r.outcome_name))].slice(0, 2);
  return teams.length === 2 ? matchupLabel(teams[0], teams[1], "vs") : null;
}

export async function refreshTrendingProps(sport: TrendingSport): Promise<RefreshResult> {
  const config = SPORTS[sport];
  const markets = Object.keys(config.markets);
  const db = localClient();

  let events: OddsEvent[];
  let currentRows: PropSnapshotRow[] = [];
  let written = 0;
  let remaining: number | null | undefined;

  if (config.fetchOdds) {
    const fetched = await fetchTonightFromOdds(sport, config, db);
    if (fetched.skipped) {
      // Keep the last good list rather than blanking it.
      return { ok: true, sport, skipped: fetched.skipped, events_scanned: 0, items: 0, snapshots_written: 0, requests_remaining: fetched.remaining };
    }
    ({ events, currentRows, written, remaining } = fetched);
  } else {
    events = await nflEventsFromSnapshots(db, markets);
  }

  const scoringRows: PropSnapshotRow[] = [];
  const matchups = new Map<string, string | null>();
  for (const ev of events) {
    const openAt = await edgeSnapshotAt(db, sport, ev.id, markets, true);
    if (openAt) scoringRows.push(...await readOverRows(db, sport, ev.id, markets, openAt));

    if (config.fetchOdds) {
      scoringRows.push(...currentRows.filter((r) => r.event_id === ev.id));
      matchups.set(ev.id, matchupLabel(ev.away_team, ev.home_team));
    } else {
      const latestAt = await edgeSnapshotAt(db, sport, ev.id, markets, false);
      if (latestAt && latestAt !== openAt) scoringRows.push(...await readOverRows(db, sport, ev.id, markets, latestAt));
      matchups.set(ev.id, await nflMatchup(db, ev.id));
    }
  }

  const items: TrendingItem[] = scoreTrendingProps(scoringRows).map((prop) => ({
    ...prop,
    prop_type: config.markets[prop.market] ?? prop.market,
    matchup: matchups.get(prop.event_id) ?? null,
  }));

  const { error } = await db.from("trending_props").upsert({
    sport,
    slate_date: slateDate(new Date()),
    generated_at: new Date().toISOString(),
    items,
    events_scanned: events.length,
  }, { onConflict: "sport" });
  if (error) throw new Error(`trending_props upsert failed: ${error.message}`);

  return {
    ok: true,
    sport,
    events_scanned: events.length,
    items: items.length,
    snapshots_written: written,
    requests_remaining: remaining,
  };
}
