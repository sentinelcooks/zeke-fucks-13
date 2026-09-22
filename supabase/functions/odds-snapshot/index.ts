// ─────────────────────────────────────────────────────────────
// Snapshot edge function — NHL line history
// Pulls Odds API once per scheduled invocation, writes to odds_history.
// Honors quota guard: skips if remainingPct < 20%.
// Schedule controlled by ODDS_SNAPSHOT_INTERVAL_MIN (default 60).
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkOddsQuota, recordOddsApiUsage } from "../_shared/odds_intelligence.ts";
import { getMasterClient } from "../_shared/masterClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-odds-snapshot-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SPORT_KEYS: Record<string, string> = {
  nhl: "icehockey_nhl",
  nba: "basketball_nba",
  wnba: "basketball_wnba",
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl",
};

// NFL player-prop markets snapshotted for the NFL Player Prop Edge engine
// (opening / current / best / closing prices). Opt-in via { props: true }
// because per-event prop requests cost one credit per market per event.
const NFL_PROP_SNAPSHOT_MARKETS = [
  "player_pass_yds", "player_pass_attempts", "player_pass_completions", "player_pass_tds",
  "player_pass_interceptions", "player_rush_yds", "player_rush_attempts", "player_reception_yds",
  "player_receptions", "player_anytime_td", "player_field_goals", "player_pats", "player_kicking_points",
];
const NFL_PROP_SNAPSHOT_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle"];
const NFL_PROP_MAX_EVENTS = 16;
const NFL_PROP_LOOKAHEAD_MS = 7 * 86400e3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const pathSport = url.pathname.split("/").filter(Boolean).pop() || "";
  let bodySport = "";
  let wantProps = false;
  if (req.method === "POST") {
    try {
      const body = await req.clone().json();
      bodySport = typeof body?.sport === "string" ? body.sport.toLowerCase() : "";
      wantProps = body?.props === true;
    } catch {
      bodySport = "";
    }
  }
  const requestedSport = (url.searchParams.get("sport") || bodySport || pathSport || "nhl").toLowerCase();
  const sport = SPORT_KEYS[requestedSport] ? requestedSport : "nhl";
  const oddsSport = SPORT_KEYS[sport];

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const snapshotSecret = Deno.env.get("ODDS_SNAPSHOT_SECRET") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const suppliedSecret = req.headers.get("x-odds-snapshot-secret") ?? "";
  const authorized =
    (!!serviceRoleKey && authorization === `Bearer ${serviceRoleKey}`) ||
    (!!snapshotSecret && (suppliedSecret === snapshotSecret || authorization === `Bearer ${snapshotSecret}`));
  if (!authorized) return json({ error: "unauthorized" }, 401);

  // Local client for odds_history (per-project history table).
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );
  // Master client for the rotation pool (odds_api_keys / app_config),
  // shared with the Admin Dashboard.
  const keysDb = await getMasterClient();

  // Quota guard — skip if low
  const quota = await checkOddsQuota(keysDb);
  if (!quota.ok) {
    const msg = `WARN: skipping ${sport} snapshot, quota at ${(quota.remainingPct * 100).toFixed(1)}% (${quota.remaining} remaining)`;
    console.warn(msg);
    return json({ skipped: true, reason: "quota_low", quota });
  }

  // Pick the freshest active key
  const { data: keys } = await keysDb
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1);

  let apiKey: string | undefined = keys?.[0]?.api_key;
  let keyId: string | null = keys?.[0]?.id || null;

  if (!apiKey) {
    // Fallback: try admin-configured key in app_config
    const { data: configData } = await keysDb
      .from("app_config")
      .select("value")
      .eq("key", "odds_api_key")
      .single();
    if (configData?.value) {
      apiKey = configData.value;
      keyId = "app-config";
    }
  }

  if (!apiKey) apiKey = Deno.env.get("ODDS_API_KEY");
  if (!apiKey) return json({ error: "no_api_key" }, 500);

  // ── NFL player-prop snapshots (separate mode; game markets untouched) ──
  if (sport === "nfl" && wantProps) {
    const eventsResp = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsSport}/events?apiKey=${apiKey}`);
    if (!eventsResp.ok) return json({ error: "odds_api_failed", status: eventsResp.status }, 502);
    const now = Date.now();
    const upcoming = ((await eventsResp.json()) as any[])
      .filter((e) => {
        const t = new Date(e.commence_time).getTime();
        return t > now && t - now < NFL_PROP_LOOKAHEAD_MS;
      })
      .slice(0, NFL_PROP_MAX_EVENTS);
    const snapshotAt = new Date().toISOString();
    const propRows: any[] = [];
    let remainingP: number | null = null;
    let usedP: number | null = null;
    let failedEvents = 0;
    for (const ev of upcoming) {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/${oddsSport}/events/${ev.id}/odds?apiKey=${apiKey}` +
        `&regions=us&markets=${NFL_PROP_SNAPSHOT_MARKETS.join(",")}&bookmakers=${NFL_PROP_SNAPSHOT_BOOKS.join(",")}&oddsFormat=american`,
      );
      remainingP = parseInt(r.headers.get("x-requests-remaining") || "0", 10) || remainingP;
      usedP = parseInt(r.headers.get("x-requests-used") || "0", 10) || usedP;
      if (!r.ok) { failedEvents++; continue; }
      const data = await r.json();
      for (const bm of data.bookmakers || []) {
        for (const mkt of bm.markets || []) {
          for (const o of mkt.outcomes || []) {
            if (!o?.name || !Number.isFinite(Number(o.price))) continue;
            propRows.push({
              event_id: String(ev.id), sport, book: bm.key, market: mkt.key,
              outcome_name: String(o.name), outcome_description: o.description ? String(o.description) : "",
              price: Number(o.price), line: Number.isFinite(Number(o.point)) ? Number(o.point) : null,
              commence_time: ev.commence_time ?? null, snapshot_at: snapshotAt,
            });
          }
        }
      }
    }
    for (let i = 0; i < propRows.length; i += 1000) {
      const { error } = await supabase.from("market_odds_snapshots").upsert(propRows.slice(i, i + 1000), {
        onConflict: "event_id,book,market,outcome_name,outcome_description,snapshot_at",
      });
      if (error) console.error("nfl prop snapshots insert failed:", error.message);
    }
    if (keyId && keyId !== "app-config" && remainingP != null) {
      await keysDb.from("odds_api_keys")
        .update({ requests_remaining: remainingP, requests_used: usedP, last_used_at: new Date().toISOString() })
        .eq("id", keyId);
    }
    await recordOddsApiUsage(keysDb, {
      endpoint: `/v4/sports/${oddsSport}/events/{id}/odds`,
      sport,
      markets: NFL_PROP_SNAPSHOT_MARKETS,
      regions: ["us"],
      booksCount: NFL_PROP_SNAPSHOT_BOOKS.length,
      requestsRemaining: remainingP,
      requestsUsed: usedP,
      keyId,
    });
    return json({ ok: failedEvents === 0, sport, mode: "props", events: upcoming.length, failed_events: failedEvents, snapshots_written: propRows.length, requests_remaining: remainingP });
  }

  const markets = ["h2h", "spreads", "totals"];
  const regions = ["us", "us2", "eu"];
  const books = ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"];

  const apiUrl =
    `https://api.the-odds-api.com/v4/sports/${oddsSport}/odds/?apiKey=${apiKey}` +
    `&regions=${regions.join(",")}&markets=${markets.join(",")}` +
    `&bookmakers=${books.join(",")}&oddsFormat=american`;

  const resp = await fetch(apiUrl);
  const remaining = parseInt(resp.headers.get("x-requests-remaining") || "0", 10) || null;
  const used = parseInt(resp.headers.get("x-requests-used") || "0", 10) || null;

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`Odds API ${resp.status}:`, text);
    await recordOddsApiUsage(keysDb, {
      endpoint: `/v4/sports/${oddsSport}/odds`,
      sport,
      markets,
      regions,
      booksCount: 0,
      requestsRemaining: remaining,
      requestsUsed: used,
      keyId,
    });
    return json({ error: "odds_api_failed", status: resp.status }, 502);
  }

  const events: any[] = await resp.json();

  // Track unique books seen for cost calc
  const allBooks = new Set<string>();
  const rows: any[] = [];
  const outcomeRows: any[] = [];
  const snapshot_at = new Date().toISOString();
  for (const ev of events) {
    for (const bm of ev.bookmakers || []) {
      allBooks.add(bm.key);
      for (const mkt of bm.markets || []) {
        // Average outcome price/line per market into one row per (game, book, market)
        const outcomes = mkt.outcomes || [];
        const homeOutcome = outcomes.find((o: any) => o.name === ev.home_team) || outcomes[0];
        const awayOutcome = outcomes.find((o: any) => o.name === ev.away_team) || outcomes[1];
        rows.push({
          game_id: String(ev.id),
          sport,
          book: bm.key,
          market: mkt.key,
          price: Math.round(((homeOutcome?.price || 0) + (awayOutcome?.price || 0)) / 2) || null,
          line: homeOutcome?.point ?? null,
          snapshot_at,
        });
        for (const outcome of outcomes) {
          if (!outcome?.name || !Number.isFinite(Number(outcome.price))) continue;
          outcomeRows.push({
            event_id: String(ev.id),
            sport,
            book: bm.key,
            market: mkt.key,
            outcome_name: String(outcome.name),
            outcome_description: outcome.description ? String(outcome.description) : "",
            price: Number(outcome.price),
            line: Number.isFinite(Number(outcome.point)) ? Number(outcome.point) : null,
            commence_time: ev.commence_time ?? null,
            snapshot_at,
          });
        }
      }
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("odds_history").upsert(rows, {
      onConflict: "game_id,book,market,snapshot_at",
    });
    if (error) console.error("odds_history insert failed:", error.message);
  }

  if (outcomeRows.length > 0) {
    const { error } = await supabase.from("market_odds_snapshots").upsert(outcomeRows, {
      onConflict: "event_id,book,market,outcome_name,outcome_description,snapshot_at",
    });
    if (error) console.error("market_odds_snapshots insert failed:", error.message);
  }

  // Update key usage (skip non-DB sources)
  if (keyId && keyId !== "app-config" && remaining != null) {
    await keysDb.from("odds_api_keys")
      .update({ requests_remaining: remaining, requests_used: used, last_used_at: new Date().toISOString() })
      .eq("id", keyId);
    if (remaining <= 0) {
      await keysDb.from("odds_api_keys")
        .update({ exhausted_at: new Date().toISOString() })
        .eq("id", keyId);
    }
  }

  await recordOddsApiUsage(keysDb, {
    endpoint: `/v4/sports/${oddsSport}/odds`,
    sport,
    markets,
    regions,
    booksCount: allBooks.size,
    requestsRemaining: remaining,
    requestsUsed: used,
    keyId,
  });

  return json({
    ok: true,
    sport,
    snapshots_written: outcomeRows.length,
    legacy_snapshots_written: rows.length,
    books_seen: allBooks.size,
    requests_remaining: remaining,
  });
});
