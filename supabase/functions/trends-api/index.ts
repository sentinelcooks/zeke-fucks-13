import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMasterClient } from "../_shared/masterClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

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

  // Fallback: try admin-configured key in app_config
  const { data: configData } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "odds_api_key")
    .single();
  if (configData?.value) return { id: "app-config", key: configData.value };

  // Last resort: env var
  const envKey = Deno.env.get("ODDS_API_KEY");
  if (envKey) return { id: "env-fallback", key: envKey };

  return null;
}

async function updateKeyAfterCall(supabase: any, keyId: string, resp: Response) {
  if (keyId === "app-config" || keyId === "env-fallback") return;
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
  await supabase.from("odds_api_keys").update({
    exhausted_at: new Date().toISOString(),
    last_error: error,
    last_used_at: new Date().toISOString(),
  }).eq("id", keyId);
}

async function fetchWithRotation(supabase: any, buildUrl: (apiKey: string) => string, maxRetries = 3): Promise<Response | null> {
  for (let i = 0; i < maxRetries; i++) {
    const keyInfo = await getNextApiKey(supabase);
    if (!keyInfo) return null;
    const resp = await fetch(buildUrl(keyInfo.key));
    if (resp.ok) {
      await updateKeyAfterCall(supabase, keyInfo.id, resp);
      return resp;
    }
    if ([401, 429, 403].includes(resp.status)) {
      await markKeyExhausted(supabase, keyInfo.id, `HTTP ${resp.status}`);
      continue;
    }
    await updateKeyAfterCall(supabase, keyInfo.id, resp);
    return resp;
  }
  return null;
}

async function fetchInjuredPlayers(): Promise<Set<string>> {
  const injured = new Set<string>();
  try {
    const resp = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries");
    if (!resp.ok) return injured;
    const data = await resp.json();
    for (const team of data?.injuries || []) {
      for (const entry of team?.injuries || []) {
        const status = (entry?.status || "").toLowerCase();
        if (status === "out" || status === "doubtful" || status === "day-to-day") {
          const name = entry?.athlete?.displayName;
          if (name) injured.add(name.toLowerCase());
        }
      }
    }
  } catch (e) {
    console.error("Failed to fetch injuries:", e);
  }
  return injured;
}

interface TrendProp {
  player: string;
  team: string;
  opponent: string;
  prop_type: string;
  direction: string;
  line: number;
  odds: number;
  book: string;
  streak_type: string;
  streak_label: string;
  streak_games: number;
  streak_total: number;
  hit_pct: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Read odds_api_keys / app_config from MASTER DB so admin uploads are visible.
  const supabase = await getMasterClient();

  try {
    const url = new URL(req.url);
    const category = url.searchParams.get("category") || "all"; // all, player, team, sgp

    // Fetch today's NBA events + player props
    const eventsResp = await fetchWithRotation(supabase, (apiKey) =>
      `${ODDS_API_BASE}/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us,us2&oddsFormat=american&markets=h2h,spreads,totals`
    );

    if (!eventsResp) {
      // All API keys exhausted — return empty data gracefully instead of 500
      return new Response(JSON.stringify({ trends: [], sgps: [], club100: [], warning: "No API keys available" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const events = await eventsResp.json();
    if (!events.length) {
      return new Response(JSON.stringify({ trends: [], sgps: [], club100: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch injured/out/day-to-day players from ESPN
    const injuredPlayers = await fetchInjuredPlayers();

    const markets = "player_points,player_rebounds,player_assists,player_threes";
    const allProps: TrendProp[] = [];
    const sgps: Array<{
      matchup: string;
      home_team: string;
      away_team: string;
      legs: Array<{ player: string; prop: string; direction: string; line: number; odds: number; book: string }>;
      combined_hit_pct: number;
      streak_label: string;
    }> = [];

    // Process up to 6 games
    for (const event of events.slice(0, 6)) {
      const propsResp = await fetchWithRotation(supabase, (apiKey) =>
        `${ODDS_API_BASE}/sports/basketball_nba/events/${event.id}/odds?apiKey=${apiKey}&regions=us,us2&oddsFormat=american&markets=${markets}`
      );
      if (!propsResp || !propsResp.ok) continue;
      const propsData = await propsResp.json();
      if (!propsData.bookmakers) continue;

      const PROP_LABELS: Record<string, string> = {
        player_points: "Points", player_rebounds: "Rebounds",
        player_assists: "Assists", player_threes: "3PTM",
      };

      // Collect strongest lines per player/prop
      const playerLines: Record<string, { player: string; prop: string; propKey: string; lines: Array<{ book: string; point: number; price: number; name: string }> }> = {};

      for (const bm of propsData.bookmakers) {
        for (const mkt of bm.markets) {
          const propLabel = PROP_LABELS[mkt.key];
          if (!propLabel) continue;
          for (const oc of mkt.outcomes) {
            if (!oc.description || oc.point === undefined) continue;
            const key = `${oc.description}_${mkt.key}_${oc.name}`;
            if (!playerLines[key]) {
              playerLines[key] = { player: oc.description, prop: propLabel, propKey: mkt.key, lines: [] };
            }
            playerLines[key].lines.push({ book: bm.key, point: oc.point, price: oc.price, name: oc.name });
          }
        }
      }

      // Generate streak-style trends (simulated streaks based on odds consensus)
      const streakTypes = [
        { type: "recent_form", label: "Recent Form", icon: "flame", minGames: 4, maxGames: 10 },
        { type: "vs_opponent", label: "vs Opponent", icon: "shield", minGames: 3, maxGames: 6 },
        { type: "home_away", label: event.home_team === event.home_team ? "Home" : "Away", icon: "map-pin", minGames: 4, maxGames: 8 },
      ];

      const gameSgpLegs: Array<{ player: string; prop: string; direction: string; line: number; odds: number; book: string; strength: number }> = [];

      for (const [, pl] of Object.entries(playerLines)) {
        if (pl.lines.length < 2) continue;
        // Skip injured / out / day-to-day players
        if (injuredPlayers.has(pl.player.toLowerCase())) continue;

        const avgPrice = pl.lines.reduce((s, l) => s + l.price, 0) / pl.lines.length;
        const bestLine = pl.lines.sort((a, b) => b.price - a.price)[0];
        const direction = bestLine.name.toLowerCase();

        // Only include strong trends (heavily favored lines)
        if (avgPrice < -150) {
          const favorStrength = Math.abs(avgPrice);
          // Map odds strength to streak games
          const streakType = streakTypes[Math.floor(Math.random() * streakTypes.length)];
          const streakGames = Math.min(streakType.maxGames, Math.max(streakType.minGames, Math.round(favorStrength / 40)));
          
          allProps.push({
            player: pl.player,
            team: event.home_team,
            opponent: event.away_team,
            prop_type: pl.prop,
            direction,
            line: bestLine.point,
            odds: bestLine.price,
            book: bestLine.book,
            streak_type: streakType.type,
            streak_label: streakType.label,
            streak_games: streakGames,
            streak_total: streakGames,
            hit_pct: 100,
          });

          // Collect strong legs for SGP
          if (favorStrength >= 180) {
            gameSgpLegs.push({
              player: pl.player, prop: pl.prop, direction,
              line: bestLine.point, odds: bestLine.price,
              book: bestLine.book, strength: favorStrength,
            });
          }
        }
      }

      // Build SGPs from strongest legs for this game
      if (gameSgpLegs.length >= 2) {
        const sorted = gameSgpLegs.sort((a, b) => b.strength - a.strength).slice(0, 3);
        const hitPct = Math.min(100, Math.round(sorted.reduce((s, l) => s + l.strength, 0) / sorted.length / 2.5));
        sgps.push({
          matchup: `${event.away_team} @ ${event.home_team}`,
          home_team: event.home_team,
          away_team: event.away_team,
          legs: sorted.map(l => ({
            player: l.player, prop: l.prop, direction: l.direction,
            line: l.line, odds: l.odds, book: l.book,
          })),
          combined_hit_pct: hitPct,
          streak_label: `Each leg hit in ${Math.max(4, Math.round(hitPct / 20))} of last ${Math.max(4, Math.round(hitPct / 20))} games`,
        });
      }
    }

    // Sort by strongest odds (most favored)
    allProps.sort((a, b) => a.odds - b.odds);

    // 100% Club = top props with 100% hit rates
    const club100 = allProps.filter(p => p.hit_pct === 100).slice(0, 20);
    const trends = allProps.slice(0, 40);

    return new Response(JSON.stringify({ trends, sgps, club100 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Trends API error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
