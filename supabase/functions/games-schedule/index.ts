const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── ESPN API (free, no API key, high volume) ──
const ESPN_SPORT_MAP: Record<string, { sport: string; league: string }> = {
  basketball_nba: { sport: "basketball", league: "nba" },
  basketball_wnba: { sport: "basketball", league: "wnba" },
  baseball_mlb: { sport: "baseball", league: "mlb" },
  icehockey_nhl: { sport: "hockey", league: "nhl" },
  americanfootball_nfl: { sport: "football", league: "nfl" },
};

// ESPN's legacy site.api host began returning HTTP 403 in August 2026 while
// the current site.web.api host continued serving the same scoreboard schema.
// Keep the legacy host only as a failover so a single ESPN host change cannot
// silently empty every scheduled sport.
const ESPN_SCOREBOARD_BASE_URLS = [
  "https://site.web.api.espn.com/apis/site/v2",
  "https://site.api.espn.com/apis/site/v2",
];

async function fetchEspnScoreboard(
  mapping: { sport: string; league: string },
  dateStr: string,
): Promise<any | null> {
  for (const baseUrl of ESPN_SCOREBOARD_BASE_URLS) {
    const url = `${baseUrl}/sports/${mapping.sport}/${mapping.league}/scoreboard?dates=${dateStr}`;
    try {
      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!resp.ok) {
        console.warn(`ESPN scoreboard failed (${resp.status}) for ${baseUrl}`);
        continue;
      }

      const data = await resp.json();
      if (data) return data;
    } catch (error) {
      console.warn(`ESPN scoreboard request failed for ${baseUrl}:`, error);
    }
  }

  return null;
}

function parseEspnEvents(data: any, sportKey: string): any[] {
  const games: any[] = [];
  for (const event of data?.events || []) {
    const comp = event?.competitions?.[0];
    if (!comp) continue;
    const teams = comp.competitors || [];
    const home = teams.find((t: any) => t.homeAway === "home");
    const away = teams.find((t: any) => t.homeAway === "away");

    const status = comp?.status?.type?.name || "";
    const statusDetail = comp?.status?.type?.description || "";
    const shortDetail = comp?.status?.type?.shortDetail || comp?.status?.shortDetail || "";
    const displayClock = comp?.status?.displayClock || "";
    const period = comp?.status?.period || 0;
    const score = {
      home: home?.score || null,
      away: away?.score || null,
    };

    games.push({
      id: event.id,
      sport_key: sportKey,
      sport_title: event.shortName || sportKey,
      commence_time: event.date || comp.date,
      home_team: home?.team?.displayName || "TBD",
      away_team: away?.team?.displayName || "TBD",
      home_logo: home?.team?.logo || null,
      away_logo: away?.team?.logo || null,
      status,
      status_detail: statusDetail,
      short_detail: shortDetail,
      display_clock: displayClock,
      period,
      score,
    });
  }
  return games;
}

async function fetchFromEspn(sportKey: string): Promise<any[] | null> {
  const mapping = ESPN_SPORT_MAP[sportKey];
  if (!mapping) return null;

  try {
    const allGames: any[] = [];
    const seenIds = new Set<string>();

    // Fetch today + next 6 days (7 days total)
    const promises: Promise<void>[] = [];
    for (let d = -1; d < 6; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
      promises.push(
        fetchEspnScoreboard(mapping, dateStr)
          .then((data) => {
            if (!data) return;
            for (const g of parseEspnEvents(data, sportKey)) {
              if (!seenIds.has(g.id)) {
                seenIds.add(g.id);
                allGames.push(g);
              }
            }
          })
      );
    }
    await Promise.all(promises);

    // Sort by commence_time
    allGames.sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());
    return allGames.length > 0 ? allGames : null;
  } catch (e) {
    console.error("ESPN error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let sport = "basketball_nba";

    if (req.method === "POST") {
      const body = await req.json();
      sport = body.sport || sport;
    } else {
      const url = new URL(req.url);
      sport = url.searchParams.get("sport") || sport;
    }

    const validSports = ["basketball_nba", "basketball_wnba", "baseball_mlb", "icehockey_nhl", "americanfootball_nfl"];
    if (!validSports.includes(sport)) {
      return new Response(
        JSON.stringify({ error: "Invalid sport" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use ESPN directly — free, no API key, reliable under high volume
    const espnGames = await fetchFromEspn(sport);

    if (espnGames && espnGames.length > 0) {
      return new Response(JSON.stringify(espnGames), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `No ${sport} games found today` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
