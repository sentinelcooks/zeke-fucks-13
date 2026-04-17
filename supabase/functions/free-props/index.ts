import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const NBA_PROP_MARKETS = [
  "player_points", "player_rebounds", "player_assists",
  "player_threes", "player_blocks", "player_steals",
];

const MLB_PROP_MARKETS = [
  "batter_hits", "batter_runs_scored", "batter_rbis",
  "batter_home_runs", "batter_total_bases", "pitcher_strikeouts",
];

const UFC_PROP_MARKETS = [
  "fighter_moneylines",
];

const MARKET_TO_PROP: Record<string, string> = {
  player_points: "points", player_rebounds: "rebounds", player_assists: "assists",
  player_threes: "3-pointers", player_blocks: "blocks", player_steals: "steals",
  batter_hits: "hits", batter_runs_scored: "runs", batter_rbis: "rbi",
  batter_home_runs: "home_runs", batter_total_bases: "total_bases",
  pitcher_strikeouts: "strikeouts",
  fighter_moneylines: "moneyline",
};

async function getNextApiKey(supabase: any) {
  const { data } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .single();
  if (data) return { id: data.id, key: data.api_key };
  
  // Fallback to env var
  const envKey = Deno.env.get("ODDS_API_KEY");
  if (envKey) return { id: "__env__", key: envKey };
  return null;
}

async function updateKeyUsage(supabase: any, keyId: string, resp: Response) {
  if (keyId === "__env__") return;
  const remaining = resp.headers.get("x-requests-remaining");
  const used = resp.headers.get("x-requests-used");
  const updates: any = { last_used_at: new Date().toISOString() };
  if (remaining) updates.requests_remaining = parseInt(remaining);
  if (used) updates.requests_used = parseInt(used);
  await supabase.from("odds_api_keys").update(updates).eq("id", keyId);
}

async function markKeyExhausted(supabase: any, keyId: string, error: string) {
  if (keyId === "__env__") return;
  await supabase.from("odds_api_keys").update({
    exhausted_at: new Date().toISOString(),
    last_error: error,
  }).eq("id", keyId);
}

async function fetchWithRotation(supabase: any, buildUrl: (key: string) => string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const apiKey = await getNextApiKey(supabase);
    if (!apiKey) {
      console.log("No API key available");
      return null;
    }
    try {
      const url = buildUrl(apiKey.key);
      console.log(`Fetching: ${url.replace(apiKey.key, "***")}`);
      const resp = await fetch(url);
      console.log(`Response status: ${resp.status}`);
      if (resp.ok) {
        await updateKeyUsage(supabase, apiKey.id, resp);
        return resp;
      }
      if ([401, 429, 403].includes(resp.status)) {
        const body = await resp.text();
        console.log(`Key exhausted: HTTP ${resp.status} - ${body.slice(0, 200)}`);
        await markKeyExhausted(supabase, apiKey.id, `HTTP ${resp.status}`);
        continue;
      }
      const body = await resp.text();
      console.log(`Unexpected status ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    } catch (e) {
      console.error(`Fetch error: ${e}`);
      await markKeyExhausted(supabase, apiKey.id, String(e));
    }
  }
  return null;
}

// Proper edge: compare the best odds across all books for a player/prop.
// Edge = (Model implied probability - Market average probability) as percentage.
// We use cross-book comparison: if one book has better odds than the consensus, that's edge.
function impliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

interface BookLine {
  book: string;
  over: number;
  under: number;
  line: number;
}

interface BestProp {
  player: string;
  opponent: string;
  prop: string;
  line: number;
  direction: string;
  odds: number;
  edge: number;
  confidence: number;
  book: string;
}

function findBestEdge(books: BookLine[]): BestProp | null {
  if (books.length < 1) return null;

  // Get average implied probabilities across all books (consensus/market line)
  let totalOverProb = 0, totalUnderProb = 0;
  for (const b of books) {
    const op = impliedProb(b.over);
    const up = impliedProb(b.under);
    // Remove vig proportionally
    const total = op + up;
    totalOverProb += op / total;
    totalUnderProb += up / total;
  }
  const avgOverProb = totalOverProb / books.length;
  const avgUnderProb = totalUnderProb / books.length;

  let bestResult: { direction: string; odds: number; edge: number; book: string; confidence: number } | null = null;
  let bestEdge = 0;

  for (const b of books) {
    // Over edge: book's fair over prob vs consensus
    const bookOverProb = impliedProb(b.over);
    const bookUnderProb = impliedProb(b.under);
    const vigTotal = bookOverProb + bookUnderProb;
    const fairOverProb = bookOverProb / vigTotal;
    const fairUnderProb = bookUnderProb / vigTotal;

    // Edge = consensus says X% but this book prices it at Y%, if Y < X that's edge
    // Or more simply: if this book offers better odds than the average
    const overEdge = (avgOverProb - fairOverProb) * 100; // positive = this book thinks it's less likely = better odds for over
    const underEdge = (avgUnderProb - fairUnderProb) * 100;

      // Confidence = avg fair prob + 0.5 * edgeFraction (clamped 0-1).
      // Stored on 0-1 scale so downstream gates compare apples-to-apples.
      if (overEdge > bestEdge) {
        bestEdge = overEdge;
        const conf01 = Math.max(0, Math.min(1, avgOverProb + 0.5 * (overEdge / 100)));
        bestResult = {
          direction: "over", odds: b.over,
          edge: Math.round(overEdge * 10) / 10,
          book: b.book, confidence: Math.round(conf01 * 1000) / 1000,
        };
      }
      if (underEdge > bestEdge) {
        bestEdge = underEdge;
        const conf01 = Math.max(0, Math.min(1, avgUnderProb + 0.5 * (underEdge / 100)));
        bestResult = {
          direction: "under", odds: b.under,
          edge: Math.round(underEdge * 10) / 10,
          book: b.book, confidence: Math.round(conf01 * 1000) / 1000,
        };
      }
  }

  return bestResult ? { player: "", opponent: "", prop: "", line: books[0].line, ...bestResult } : null;
}

interface PropLine {
  player: string; team: string; opponent: string; prop: string;
  line: number; direction: string; odds: number; edge: number;
  confidence: number; book: string; sport: string;
}

async function fetchSportProps(supabase: any, sportKey: string, markets: string[], sport: string, maxGames = 6, maxProps = 40): Promise<PropLine[]> {
  const eventsResp = await fetchWithRotation(supabase, (key) =>
    `${ODDS_API_BASE}/sports/${sportKey}/events?apiKey=${key}`
  );
  if (!eventsResp) return [];
  const events = await eventsResp.json();
  if (!Array.isArray(events) || events.length === 0) return [];

  const props: PropLine[] = [];
  const gamesToFetch = events.slice(0, maxGames);

  for (const event of gamesToFetch) {
    const marketsStr = markets.join(",");
    const resp = await fetchWithRotation(supabase, (key) =>
      `${ODDS_API_BASE}/sports/${sportKey}/events/${event.id}/odds?apiKey=${key}&regions=us,us2,us_dfs&markets=${marketsStr}&oddsFormat=american`
    );
    if (!resp) continue;
    const data = await resp.json();
    if (!data.bookmakers) continue;

    // Build player -> market -> books array
    const playerMap: Record<string, Record<string, BookLine[]>> = {};

    for (const bm of data.bookmakers) {
      for (const market of bm.markets) {
        const propType = MARKET_TO_PROP[market.key];
        if (!propType) continue;

        const byPlayer: Record<string, { over?: number; under?: number; line?: number }> = {};
        for (const o of market.outcomes) {
          const name = o.description || o.name;
          if (!byPlayer[name]) byPlayer[name] = {};
          if (o.name === "Over") { byPlayer[name].over = o.price; byPlayer[name].line = o.point; }
          if (o.name === "Under") { byPlayer[name].under = o.price; byPlayer[name].line = o.point; }
        }

        for (const [player, vals] of Object.entries(byPlayer)) {
          if (vals.over == null || vals.under == null || vals.line == null) continue;
          if (!playerMap[player]) playerMap[player] = {};
          if (!playerMap[player][propType]) playerMap[player][propType] = [];
          playerMap[player][propType].push({
            book: bm.title, over: vals.over, under: vals.under, line: vals.line,
          });
        }
      }
    }

    for (const [player, propTypes] of Object.entries(playerMap)) {
      for (const [propType, books] of Object.entries(propTypes)) {
        // Need at least 2 books to compute meaningful edge
        if (books.length < 2) continue;

        const best = findBestEdge(books);
        if (best && best.edge >= 1.5) {
          props.push({
            player, team: "", opponent: `${event.away_team} vs ${event.home_team}`,
            prop: propType, line: best.line,
            direction: best.direction, odds: best.odds,
            edge: best.edge, confidence: best.confidence,
            book: best.book, sport,
          });
        }
      }
    }
  }

  props.sort((a, b) => b.edge - a.edge);
  return props.slice(0, maxProps);
}

// UFC: fetch fight moneylines from multiple books and find edge
async function fetchUfcProps(supabase: any): Promise<PropLine[]> {
  const eventsResp = await fetchWithRotation(supabase, (key) =>
    `${ODDS_API_BASE}/sports/mma_mixed_martial_arts/events?apiKey=${key}`
  );
  if (!eventsResp) return [];
  const events = await eventsResp.json();
  if (!Array.isArray(events) || events.length === 0) return [];

  const props: PropLine[] = [];
  const gamesToFetch = events.slice(0, 10);

  for (const event of gamesToFetch) {
    const resp = await fetchWithRotation(supabase, (key) =>
      `${ODDS_API_BASE}/sports/mma_mixed_martial_arts/events/${event.id}/odds?apiKey=${key}&regions=us,us2&markets=h2h&oddsFormat=american`
    );
    if (!resp) continue;
    const data = await resp.json();
    if (!data.bookmakers || data.bookmakers.length < 2) continue;

    // Collect all ML odds per fighter
    const fighterOdds: Record<string, Array<{ book: string; odds: number }>> = {};

    for (const bm of data.bookmakers) {
      for (const market of bm.markets) {
        if (market.key !== "h2h") continue;
        for (const o of market.outcomes) {
          if (!fighterOdds[o.name]) fighterOdds[o.name] = [];
          fighterOdds[o.name].push({ book: bm.title, odds: o.price });
        }
      }
    }

    // For each fighter, find best odds vs consensus
    for (const [fighter, bookOdds] of Object.entries(fighterOdds)) {
      if (bookOdds.length < 2) continue;

      const probs = bookOdds.map(b => impliedProb(b.odds));
      const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length;

      let bestEdge = 0;
      let bestBook = bookOdds[0];

      for (let i = 0; i < bookOdds.length; i++) {
        const thisProb = probs[i];
        const edge = (avgProb - thisProb) * 100; // lower implied = better odds = edge
        if (edge > bestEdge) {
          bestEdge = edge;
          bestBook = bookOdds[i];
        }
      }

      if (bestEdge >= 1.5) {
        const conf01 = Math.max(0, Math.min(1, avgProb + 0.5 * (bestEdge / 100)));
        props.push({
          player: fighter, team: "", opponent: `${event.home_team} vs ${event.away_team}`,
          prop: "moneyline", line: 0,
          direction: "win", odds: bestBook.odds,
          edge: Math.round(bestEdge * 10) / 10,
          confidence: Math.round(conf01 * 1000) / 1000,
          book: bestBook.book, sport: "ufc",
        });
      }
    }
  }

  props.sort((a, b) => b.edge - a.edge);
  return props.slice(0, 20);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    let path = url.pathname.split("/").pop();

    // Support path via request body for clients that can't use sub-paths
    if (req.method === "POST" && (!path || path === "free-props")) {
      try {
        const body = await req.json();
        if (body.path) path = body.path;
      } catch { /* no body */ }
    }

    if (path === "generate") {
      // Single source of truth: delegate to daily-picks (full-slate deterministic scan)
      // which writes both daily_picks AND free_props in one pass with strict gating.
      console.log("free-props/generate → proxying to daily-picks");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const resp = await fetch(`${supabaseUrl}/functions/v1/daily-picks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({}),
      });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "today") {
      const today = new Date().toISOString().slice(0, 10);
      const sport = url.searchParams.get("sport");

      let query = supabase
        .from("free_props")
        .select("*")
        .eq("prop_date", today)
        .order("edge", { ascending: false });

      if (sport && sport !== "all") query = query.eq("sport", sport);

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (path === "correlated") {
      const today = new Date().toISOString().slice(0, 10);
      const player = url.searchParams.get("player");
      const prop = url.searchParams.get("prop");

      if (!player || !prop) {
        return new Response(JSON.stringify({ error: "player and prop required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data } = await supabase
        .from("correlated_props")
        .select("*")
        .eq("prop_date", today)
        .eq("source_player", player)
        .eq("source_prop", prop)
        .order("hit_rate", { ascending: false });

      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown path" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("free-props error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
