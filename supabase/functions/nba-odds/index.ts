import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function getLocalClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Master DB — tries MASTER_SUPABASE_URL first, validates, falls back to local
async function getMasterClient(): Promise<SupabaseClient> {
  const masterUrl = Deno.env.get("MASTER_SUPABASE_URL");
  const masterKey = Deno.env.get("MASTER_SUPABASE_SERVICE_KEY");
  if (masterUrl && masterKey) {
    try {
      const client = createClient(masterUrl, masterKey);
      const { error } = await client.from("odds_api_keys").select("id").limit(1);
      if (!error) return client;
      console.warn("Master DB failed, falling back to local:", error.message);
    } catch (e) {
      console.warn("Master DB connection failed, falling back to local:", e);
    }
  }
  return getLocalClient();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-token, x-device-fingerprint, x-request-timestamp, x-request-nonce, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Region configs — each region has its own set of bookmakers
const REGION_CONFIGS = [
  { region: "us", bookmakers: "fanduel,draftkings,betmgm,betonlineag" },
  { region: "us2", bookmakers: "espnbet,fliff,betrivers,novig" },
  { region: "us_dfs", bookmakers: "prizepicks,underdog,betr_us_dfs" },
  { region: "us_ex", bookmakers: "kalshi,polymarket" },
];

// Sport key mapping
const SPORT_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  ufc: "mma_mixed_martial_arts",
  nhl: "icehockey_nhl",
  nfl: "americanfootball_nfl",
  soccer: "soccer_usa_mls",
};

const NBA_PROP_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_steals",
  "player_blocks",
  "player_turnovers",
  "player_points_rebounds_assists",
].join(",");

const MLB_PROP_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_home_runs",
  "batter_total_bases",
  "batter_rbis",
  "batter_runs",
  "batter_walks",
  "batter_stolen_bases",
].join(",");

const NHL_PROP_MARKETS = [
  "player_points",
  "player_goals",
  "player_assists",
  "player_shots_on_goal",
  "player_blocked_shots",
  "player_power_play_points",
].join(",");

const NFL_PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_rush_yds",
  "player_reception_yds",
  "player_receptions",
  "player_anytime_td",
  "player_kicking_points",
].join(",");

function getSportKey(sport?: string | null): string {
  return SPORT_KEYS[(sport || "nba").toLowerCase()] || SPORT_KEYS.nba;
}

function getPropMarkets(sport?: string | null): string {
  const s = (sport || "nba").toLowerCase();
  if (s === "mlb") return MLB_PROP_MARKETS;
  if (s === "nhl") return NHL_PROP_MARKETS;
  if (s === "nfl") return NFL_PROP_MARKETS;
  if (s === "ufc") return "h2h";
  return NBA_PROP_MARKETS;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── In-memory cache ──
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ── API Key Rotation ──
async function getNextApiKey(supabase: any): Promise<{ id: string; key: string } | null> {
  const { data, error } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .single();
  if (!error && data) return { id: data.id, key: data.api_key };
  
  // Fallback: use ODDS_API_KEY env secret if no DB keys available
  const envKey = Deno.env.get("ODDS_API_KEY");
  if (envKey) return { id: "env-fallback", key: envKey };
  
  return null;
}

async function updateKeyUsage(supabase: any, keyId: string, resp: Response) {
  if (keyId === "env-fallback") return;
  const remaining = resp.headers.get("x-requests-remaining");
  const used = resp.headers.get("x-requests-used");
  const update: Record<string, any> = { last_used_at: new Date().toISOString() };
  if (remaining !== null) update.requests_remaining = parseInt(remaining, 10);
  if (used !== null) update.requests_used = parseInt(used, 10);
  if (remaining !== null && parseInt(remaining, 10) <= 0) {
    update.exhausted_at = new Date().toISOString();
  }
  await supabase.from("odds_api_keys").update(update).eq("id", keyId);
}

async function markKeyExhausted(supabase: any, keyId: string, error: string) {
  if (keyId === "env-fallback") return;
  await supabase.from("odds_api_keys").update({
    exhausted_at: new Date().toISOString(),
    last_error: error,
    last_used_at: new Date().toISOString(),
  }).eq("id", keyId);
}

async function fetchWithRotation(
  supabase: any,
  buildUrl: (apiKey: string) => string,
  maxRetries = 3
): Promise<{ resp: Response; keyId: string } | null> {
  for (let i = 0; i < maxRetries; i++) {
    const keyInfo = await getNextApiKey(supabase);
    if (!keyInfo) return null;
    const resp = await fetch(buildUrl(keyInfo.key));
    if (resp.ok) {
      await updateKeyUsage(supabase, keyInfo.id, resp);
      return { resp, keyId: keyInfo.id };
    }
    if (resp.status === 401 || resp.status === 403) {
      const errText = await resp.text();
      console.warn(`Key ${keyInfo.id} failed (${resp.status}), rotating...`);
      await markKeyExhausted(supabase, keyInfo.id, `HTTP ${resp.status}: ${errText}`);
      continue;
    }
    if (resp.status === 429) {
      console.warn(`Key ${keyInfo.id} rate-limited (429), backing off 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      continue; // retry without marking exhausted
    }
    if (resp.status === 422) {
      const errBody = await resp.text();
      console.warn(`Request returned 422 (invalid params): ${errBody.substring(0, 200)}`);
      return null;
    }
    await updateKeyUsage(supabase, keyInfo.id, resp);
    return { resp, keyId: keyInfo.id };
  }
  return null;
}

// ── Multi-region fetch: queries each region separately and merges bookmakers ──
function mergeUniqueBookmakers(existing: any[] = [], incoming: any[] = []) {
  const merged = [...existing];
  const seen = new Set(existing.map((bk) => `${bk?.key || ""}::${bk?.title || ""}`));

  for (const bookmaker of incoming) {
    const dedupeKey = `${bookmaker?.key || ""}::${bookmaker?.title || ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push(bookmaker);
  }

  return merged;
}

// Regions that support game-level markets (h2h, spreads, totals)
const GAME_MARKET_REGIONS = REGION_CONFIGS.filter(c => c.region === "us" || c.region === "us2");

async function fetchMultiRegion(
  supabase: any,
  buildUrl: (apiKey: string, region: string, bookmakers: string) => string,
  regionConfigs?: typeof REGION_CONFIGS,
): Promise<{ mergedBookmakers: any[]; events: any[]; quota: { remaining: string | null; used: string | null } } | null> {
  const configs = regionConfigs || REGION_CONFIGS;
  const allBookmakers: any[] = [];
  let baseData: any = null;
  let lastQuota = { remaining: null as string | null, used: null as string | null };

  for (const config of configs) {
    const result = await fetchWithRotation(supabase, (apiKey) =>
      buildUrl(apiKey, config.region, config.bookmakers)
    );

    if (!result) continue;
    if (!result.resp.ok) {
      console.warn(`Region ${config.region} failed: ${result.resp.status}`);
      continue;
    }

    const data = await result.resp.json();
    lastQuota.remaining = result.resp.headers.get("x-requests-remaining");
    lastQuota.used = result.resp.headers.get("x-requests-used");

    // Events endpoint returns an array
    if (Array.isArray(data)) {
      if (!baseData) {
        baseData = data.map((event: any) => ({
          ...event,
          bookmakers: [...(event.bookmakers || [])],
        }));
        continue;
      }

      for (const event of data) {
        const existing = baseData.find((e: any) => e.id === event.id);
        if (!existing) {
          baseData.push({
            ...event,
            bookmakers: [...(event.bookmakers || [])],
          });
          continue;
        }

        existing.bookmakers = mergeUniqueBookmakers(existing.bookmakers, event.bookmakers || []);
      }
    } else {
      // Single-event response (player props)
      if (!baseData) {
        baseData = {
          ...data,
          bookmakers: [...(data.bookmakers || [])],
        };
      } else {
        baseData.bookmakers = mergeUniqueBookmakers(baseData.bookmakers, data.bookmakers || []);
      }

      allBookmakers.push(...(data.bookmakers || []));
    }
  }

  if (!baseData) return null;

  return {
    mergedBookmakers: mergeUniqueBookmakers([], allBookmakers),
    events: Array.isArray(baseData) ? baseData : [baseData],
    quota: lastQuota,
  };
}

// Helper to build player map from bookmakers data
function buildPlayerMap(bookmakers: any[]): Record<string, Record<string, Array<{
  book: string; name: string; price: number; point: number;
}>>> {
  const playerMap: Record<string, Record<string, Array<{
    book: string; name: string; price: number; point: number;
  }>>> = {};

  for (const bk of bookmakers) {
    for (const market of (bk.markets || [])) {
      for (const outcome of (market.outcomes || [])) {
        const playerName = outcome.description || outcome.name;
        if (!playerName) continue;
        if (!playerMap[playerName]) playerMap[playerName] = {};
        if (!playerMap[playerName][market.key]) playerMap[playerName][market.key] = [];
        playerMap[playerName][market.key].push({
          book: bk.title || bk.key,
          name: outcome.name,
          price: outcome.price,
          point: outcome.point ?? 0,
        });
      }
    }
  }
  return playerMap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = await getMasterClient();

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const action = pathParts[pathParts.length - 1];

    // ────────────────────────────────────────────────────────────────
    // GET /nba-odds/events — game lines from ALL regions
    // ────────────────────────────────────────────────────────────────
    if (action === "events") {
      const sport = url.searchParams.get("sport") || "nba";
      const sportKey = getSportKey(sport);
      const cacheKey = `events-${sport}`;
      const cached = getCached(cacheKey);
      if (cached) return json(cached);

      const markets = url.searchParams.get("markets") || "h2h,spreads,totals";

      // Only use us/us2 regions for game-level markets (h2h, spreads, totals)
      // us_dfs and us_ex don't support these markets and return 422
      const isGameMarkets = markets.includes("h2h") || markets.includes("spreads") || markets.includes("totals");
      const regionConfigs = isGameMarkets ? GAME_MARKET_REGIONS : undefined;

      const multiResult = await fetchMultiRegion(supabase, (apiKey, region, bookmakers) =>
        `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=${region}&oddsFormat=american&bookmakers=${bookmakers}&markets=${markets}`,
        regionConfigs,
      );

      if (!multiResult) return json({ error: "All API keys exhausted" }, 503);

      const responseData = {
        events: multiResult.events,
        quota: multiResult.quota,
        regions_queried: REGION_CONFIGS.map(c => c.region),
        sport,
      };
      setCache(cacheKey, responseData);
      return json(responseData);
    }

    // ────────────────────────────────────────────────────────────────
    // GET /nba-odds/player-props?eventId=xxx — props from ALL regions
    // ────────────────────────────────────────────────────────────────
    if (action === "player-props") {
      const eventId = url.searchParams.get("eventId");
      if (!eventId) return json({ error: "eventId is required" }, 400);

      const sport = url.searchParams.get("sport") || "nba";
      const sportKey = getSportKey(sport);
      const cacheKey = `props-${sport}-${eventId}`;
      const cached = getCached(cacheKey);
      if (cached) return json(cached);

      const defaultMarkets = getPropMarkets(sport);
      const markets = url.searchParams.get("markets") || defaultMarkets;

      const multiResult = await fetchMultiRegion(supabase, (apiKey, region, bookmakers) =>
        `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=${region}&oddsFormat=american&bookmakers=${bookmakers}&markets=${markets}`
      );

      if (!multiResult) return json({ error: "All API keys exhausted" }, 503);

      const playerMap = buildPlayerMap(multiResult.mergedBookmakers);
      const eventData = multiResult.events[0] || {};

      const responseData = {
        event_id: eventData.id || eventId,
        home_team: eventData.home_team,
        away_team: eventData.away_team,
        commence_time: eventData.commence_time,
        players: playerMap,
        quota: multiResult.quota,
        sources: REGION_CONFIGS.map(c => c.region),
        sport,
      };
      setCache(cacheKey, responseData);
      return json(responseData);
    }

    // ────────────────────────────────────────────────────────────────
    // POST /nba-odds/player-odds — lookup specific player's odds
    // ────────────────────────────────────────────────────────────────
    if (action === "player-odds" && req.method === "POST") {
      const body = await req.json();
      const { playerName, propType, overUnder, sport: reqSport } = body;
      if (!playerName) return json({ error: "playerName required" }, 400);

      const sport = reqSport || "nba";
      const sportKey = getSportKey(sport);
      const propMarkets = getPropMarkets(sport);

      // Get events (cached or fresh)
      const eventsCacheKey = `events-${sport}`;
      let eventsData = getCached(eventsCacheKey) as any;

      if (!eventsData) {
        const multiResult = await fetchMultiRegion(supabase, (apiKey, region, bookmakers) =>
          `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=${region}&oddsFormat=american&bookmakers=${bookmakers}&markets=h2h`
        );
        if (!multiResult) return json({ error: "All API keys exhausted" }, 503);
        eventsData = { events: multiResult.events, quota: multiResult.quota, sport };
        setCache(eventsCacheKey, eventsData);
      }

      const events = eventsData.events || [];

      // For UFC, search h2h outcomes (fighter moneyline)
      if (sport === "ufc") {
        const normalizedSearch = playerName.toLowerCase().trim();
        for (const event of events) {
          for (const bk of (event.bookmakers || [])) {
            for (const market of (bk.markets || [])) {
              if (market.key !== "h2h") continue;
              for (const outcome of (market.outcomes || [])) {
                if (outcome.name.toLowerCase().includes(normalizedSearch) || normalizedSearch.includes(outcome.name.toLowerCase())) {
                  // Found the fighter - collect all books' h2h odds for this fighter
                  const bookOdds: Array<{ book: string; odds: number; line: number }> = [];
                  const seen = new Set<string>();
                  for (const b of (event.bookmakers || [])) {
                    for (const m of (b.markets || [])) {
                      if (m.key !== "h2h") continue;
                      for (const o of (m.outcomes || [])) {
                        if ((o.name.toLowerCase().includes(normalizedSearch) || normalizedSearch.includes(o.name.toLowerCase())) && !seen.has(b.title || b.key)) {
                          seen.add(b.title || b.key);
                          bookOdds.push({ book: b.title || b.key, odds: o.price, line: 0 });
                        }
                      }
                    }
                  }
                  bookOdds.sort((a, b) => b.odds - a.odds);
                  return json({
                    found: true, player: outcome.name, market: "h2h", direction: "win",
                    event: { id: event.id, home: event.home_team, away: event.away_team, time: event.commence_time },
                    books: bookOdds, all_markets: ["h2h"],
                  });
                }
              }
            }
          }
        }
        return json({ found: false, message: `No odds found for ${playerName} (h2h)`, events_checked: events.length });
      }

      // NBA / MLB / NHL player props flow
      // Normalize propType to valid Odds API market key
      // MLB uses pitcher_ and batter_ prefixes instead of player_
      const MLB_PROP_MAP: Record<string, string> = {
        strikeouts: "pitcher_strikeouts",
        hits: "batter_hits",
        home_runs: "batter_home_runs",
        total_bases: "batter_total_bases",
        rbis: "batter_rbis",
        runs: "batter_runs",
        walks: "batter_walks",
        stolen_bases: "batter_stolen_bases",
        hits_runs_rbis: "batter_hits_runs_rbis",
        singles: "batter_singles",
        doubles: "batter_doubles",
        outs: "pitcher_outs",
        earned_runs: "pitcher_earned_runs",
        hits_allowed: "pitcher_hits_allowed",
        walks_allowed: "pitcher_walks",
      };

      const validPrefixes = ["player_", "pitcher_", "batter_"];
      const alreadyPrefixed = validPrefixes.some(p => (propType || "").startsWith(p));
      let propMarketKey: string;
      if (alreadyPrefixed) {
        propMarketKey = propType.replace("pts+reb+ast", "points_rebounds_assists").replace("3-pointers", "threes");
      } else if (sport === "mlb" && MLB_PROP_MAP[(propType || "").toLowerCase()]) {
        propMarketKey = MLB_PROP_MAP[(propType || "").toLowerCase()];
      } else {
        propMarketKey = `player_${(propType || "points").replace("pts+reb+ast", "points_rebounds_assists").replace("3-pointers", "threes")}`;
      }

      let bestMatch: any = null;

      // Filter to only upcoming events (not started yet) — props unavailable for live games
      const now = Date.now();
      const upcomingEvents = events.filter((e: any) => {
        if (!e.commence_time) return true;
        return new Date(e.commence_time).getTime() > now;
      });

      // Use only us/us2 regions for props (us_dfs/us_ex don't support them)
      const PROP_REGIONS = REGION_CONFIGS.filter(c => c.region === "us" || c.region === "us2");
      const maxEvents = upcomingEvents.length;
      const FETCH_TIMEOUT_MS = 10_000;

      for (let ei = 0; ei < maxEvents; ei++) {
        const event = upcomingEvents[ei];
        const propsCacheKey = `props-${sport}-${event.id}`;
        let propsData = getCached(propsCacheKey) as any;

        if (!propsData) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

            const multiResult = await fetchMultiRegion(supabase, (apiKey, region, bookmakers) =>
              `${ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds?apiKey=${apiKey}&regions=${region}&oddsFormat=american&bookmakers=${bookmakers}&markets=${propMarkets}`,
              PROP_REGIONS,
            );

            clearTimeout(timeoutId);
            if (!multiResult) continue;

            const playerMap = buildPlayerMap(multiResult.mergedBookmakers);
            const evData = multiResult.events[0] || {};
            propsData = {
              event_id: evData.id, home_team: evData.home_team, away_team: evData.away_team,
              commence_time: evData.commence_time, players: playerMap, quota: multiResult.quota,
            };
            setCache(propsCacheKey, propsData);
          } catch (fetchErr) {
            console.warn(`Event ${event.id} prop fetch failed/timed out, skipping`);
            continue;
          }
        }

        const normalizedSearch = playerName.toLowerCase().trim();
        const matchedPlayer = Object.keys(propsData.players || {}).find((p) =>
          p.toLowerCase().includes(normalizedSearch) || normalizedSearch.includes(p.toLowerCase())
        );

        if (matchedPlayer && propsData.players[matchedPlayer]?.[propMarketKey]) {
          const marketOdds = propsData.players[matchedPlayer][propMarketKey];
          const direction = (overUnder || "over").toLowerCase();
          const bookOdds: Array<{ book: string; odds: number; line: number }> = [];
          const seen = new Set<string>();

          for (const entry of marketOdds) {
            if (entry.name.toLowerCase() === direction && !seen.has(entry.book)) {
              seen.add(entry.book);
              bookOdds.push({ book: entry.book, odds: entry.price, line: entry.point });
            }
          }
          bookOdds.sort((a, b) => b.odds - a.odds);

          bestMatch = {
            player: matchedPlayer, market: propMarketKey, direction,
            event: { id: propsData.event_id, home: propsData.home_team, away: propsData.away_team, time: propsData.commence_time },
            books: bookOdds,
            all_markets: Object.keys(propsData.players[matchedPlayer] || {}),
          };
          break;
        }
      }

      if (!bestMatch) {
        const liveCount = events.length - upcomingEvents.length;
        const msg = upcomingEvents.length === 0
          ? `No upcoming games found for ${sport.toUpperCase()} — all ${events.length} games are live or completed. Props are only available before game time.`
          : `No odds found for ${playerName} (${propMarketKey}). Checked ${upcomingEvents.length} upcoming events (${liveCount} live/completed skipped).`;
        return json({ found: false, message: msg, events_checked: events.length, upcoming_checked: upcomingEvents.length });
      }
      return json({ found: true, ...bestMatch });
    }

    // ────────────────────────────────────────────────────────────────
    // GET /nba-odds/sports
    // ────────────────────────────────────────────────────────────────
    if (action === "sports") {
      const result = await fetchWithRotation(supabase, (apiKey) =>
        `${ODDS_API_BASE}/sports/?apiKey=${apiKey}`
      );
      if (!result) return json({ error: "All API keys exhausted" }, 503);
      const data = await result.resp.json();
      return json(data);
    }

    // ────────────────────────────────────────────────────────────────
    // POST /nba-odds/scrape-dfs
    // ────────────────────────────────────────────────────────────────
    if (action === "scrape-dfs" && req.method === "POST") {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) return json({ error: "Firecrawl not configured" }, 500);

      const { playerName: pn, book } = await req.json();
      if (!pn || !book) return json({ error: "playerName and book are required" }, 400);

      const bookSearchUrls: Record<string, string> = {
        underdog: "https://underdogfantasy.com",
        parlayplay: "https://parlayplay.io",
        chalkboard: "https://chalkboard.io",
        betr: "https://betr.app",
        sleeper: "https://sleeper.com",
        stake: "https://stake.com",
      };

      const bookUrl = bookSearchUrls[book.toLowerCase()];
      if (!bookUrl) return json({ error: `Unknown book: ${book}` }, 400);

      const searchResp = await fetch("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${pn} NBA props site:${new URL(bookUrl).hostname}`,
          limit: 3,
          scrapeOptions: { formats: ["markdown"] },
        }),
      });

      const searchData = await searchResp.json();
      return json({ success: searchResp.ok, book, playerName: pn, results: searchData?.data || [] });
    }

    // ────────────────────────────────────────────────────────────────
    // GET /nba-odds/key-status
    // ────────────────────────────────────────────────────────────────
    if (action === "key-status") {
      const { data: keys } = await supabase
        .from("odds_api_keys")
        .select("is_active, exhausted_at, requests_remaining, requests_used, last_used_at")
        .order("last_used_at", { ascending: false });

      const active = (keys || []).filter((k: any) => k.is_active && !k.exhausted_at).length;
      const exhausted = (keys || []).filter((k: any) => k.exhausted_at).length;
      const inactive = (keys || []).filter((k: any) => !k.is_active).length;
      const totalRemaining = (keys || []).reduce((sum: number, k: any) => sum + (k.requests_remaining || 0), 0);

      return json({
        total: keys?.length || 0, active, exhausted, inactive,
        total_remaining_credits: totalRemaining,
        bookmakers: REGION_CONFIGS.flatMap(c => c.bookmakers.split(",")),
        regions: REGION_CONFIGS.map(c => c.region),
      });
    }

    return json({ error: "Unknown action. Use: events, player-props, player-odds, sports, scrape-dfs, key-status" }, 404);
  } catch (err) {
    console.error("nba-odds error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
