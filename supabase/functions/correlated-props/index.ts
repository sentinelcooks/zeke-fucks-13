import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba";

const PROP_STAT_LABEL: Record<string, string> = {
  points: "PTS",
  rebounds: "REB",
  assists: "AST",
  "3-pointers": "3PT",
  steals: "STL",
  blocks: "BLK",
  turnovers: "TO",
};

const PROP_DISPLAY: Record<string, string> = {
  points: "Points",
  rebounds: "Rebounds",
  assists: "Assists",
  "3-pointers": "3-Pointers",
  steals: "Steals",
  blocks: "Blocks",
  turnovers: "Turnovers",
};

interface GameRow {
  eventId: string;
  stats: Record<string, number>;
}

function parseStat(label: string, value: string): number {
  if (label === "3PT" || label === "FG" || label === "FT") {
    const parts = value.split("-");
    return parseFloat(parts[0]) || 0;
  }
  return parseFloat(value) || 0;
}

async function getTeamRoster(teamAbbr: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const resp = await fetch(`${ESPN_BASE}/teams`);
    const data = await resp.json();
    const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
    const team = teams.find(
      (t: any) => t.team.abbreviation?.toLowerCase() === teamAbbr.toLowerCase()
    );
    if (!team) return [];

    const rosterResp = await fetch(`${ESPN_BASE}/teams/${team.team.id}/roster`);
    const rosterData = await rosterResp.json();
    const rawAthletes = rosterData.athletes || [];

    const athletes: Array<{ id: string; name: string }> = [];
    for (const a of rawAthletes) {
      if (a.id && (a.fullName || a.displayName)) {
        athletes.push({ id: String(a.id), name: a.fullName || a.displayName });
      } else if (a.items) {
        for (const item of a.items) {
          athletes.push({ id: String(item.id), name: item.fullName || item.displayName || "" });
        }
      }
    }
    return athletes;
  } catch (e) {
    console.error("getTeamRoster error:", e);
    return [];
  }
}

async function getOpponentTeam(sourceTeam: string): Promise<string> {
  try {
    const resp = await fetch(`${ESPN_BASE}/scoreboard`);
    const data = await resp.json();
    const events = data.events || [];
    for (const event of events) {
      const competitors = event.competitions?.[0]?.competitors || [];
      const teamAbbrs = competitors.map((c: any) => c.team?.abbreviation?.toLowerCase());
      if (teamAbbrs.includes(sourceTeam.toLowerCase())) {
        const opp = competitors.find((c: any) => c.team?.abbreviation?.toLowerCase() !== sourceTeam.toLowerCase());
        if (opp) return opp.team.abbreviation;
      }
    }
  } catch (e) {
    console.error("getOpponentTeam error:", e);
  }
  return "";
}

async function getPlayerGameLog(playerId: string): Promise<{ labels: string[]; games: GameRow[] }> {
  try {
    const resp = await fetch(`${ESPN_WEB}/athletes/${playerId}/gamelog`);
    const data = await resp.json();

    const labels: string[] = data.labels || [];
    if (labels.length === 0) return { labels: [], games: [] };

    const games: GameRow[] = [];
    const regularSeason = data.seasonTypes?.find((st: any) =>
      st.displayName?.toLowerCase().includes("regular")
    ) || data.seasonTypes?.[0];

    if (!regularSeason) return { labels, games: [] };

    for (const cat of regularSeason.categories || []) {
      for (const evt of cat.events || []) {
        const stats: Record<string, number> = {};
        for (let i = 0; i < labels.length; i++) {
          stats[labels[i]] = parseStat(labels[i], evt.stats?.[i] || "0");
        }
        games.push({ eventId: evt.eventId, stats });
      }
    }

    return { labels, games };
  } catch (e) {
    console.error(`getPlayerGameLog error for ${playerId}:`, e);
    return { labels: [], games: [] };
  }
}

function getStatValue(stats: Record<string, number>, prop: string): number {
  const label = PROP_STAT_LABEL[prop];
  if (!label) return 0;
  return stats[label] || 0;
}

interface Correlation {
  correlated_player: string;
  correlated_prop: string;
  correlated_team: string;
  hit_rate: number;
  sample_size: number;
  is_opponent: boolean;
  reasoning: string;
}

function generateReasoning(
  sourcePlayer: string,
  sourceProp: string,
  corrPlayer: string,
  corrProp: string,
  hitRate: number,
  isOpponent: boolean,
  sampleSize: number
): string {
  const sourceShort = sourcePlayer.split(" ").pop();
  const corrShort = corrPlayer.split(" ").pop();
  const propDisplay = PROP_DISPLAY[corrProp] || corrProp;
  const sourcePropDisplay = PROP_DISPLAY[sourceProp] || sourceProp;

  if (isOpponent) {
    if (hitRate >= 80) {
      return `When ${sourceShort} dominates in ${sourcePropDisplay}, opposing defenses shift focus — ${corrShort} capitalizes with higher ${propDisplay} production.`;
    } else if (hitRate >= 70) {
      return `High-scoring games where ${sourceShort} hits ${sourcePropDisplay} tend to be up-tempo, boosting ${corrShort}'s ${propDisplay} on the other side.`;
    } else {
      return `Game flow favors ${corrShort}'s ${propDisplay} when ${sourceShort} is active — both benefit from faster pace and more possessions.`;
    }
  } else {
    if (corrProp === sourceProp) {
      if (hitRate >= 80) {
        return `${sourceShort} and ${corrShort} feed off each other — when one hits ${sourcePropDisplay}, the team's offensive rhythm lifts both.`;
      }
      return `Strong team synergy: ${sourceShort}'s ${sourcePropDisplay} production correlates with ${corrShort}'s output in the same category.`;
    }
    if (hitRate >= 80) {
      return `Elite correlation — ${sourceShort}'s ${sourcePropDisplay} success signals high-volume offensive games where ${corrShort} thrives in ${propDisplay}.`;
    } else if (hitRate >= 70) {
      return `When ${sourceShort} hits ${sourcePropDisplay}, the offense opens up for ${corrShort} to produce in ${propDisplay}.`;
    } else {
      return `Positive team trend: games where ${sourceShort} clears ${sourcePropDisplay} often see ${corrShort} exceed ${propDisplay} lines too.`;
    }
  }
}

async function computeCorrelations(
  sourcePlayerId: string,
  sourcePlayerName: string,
  sourceProp: string,
  sourceLine: number,
  players: Array<{ id: string; name: string; isOpponent: boolean; team: string }>,
): Promise<Correlation[]> {
  const sourceLog = await getPlayerGameLog(sourcePlayerId);
  if (sourceLog.games.length < 3) return [];

  const hitEventIds = new Set(
    sourceLog.games
      .filter(g => getStatValue(g.stats, sourceProp) > sourceLine)
      .map(g => g.eventId)
  );
  console.log(`Source hit ${hitEventIds.size}/${sourceLog.games.length} games`);

  const correlations: Correlation[] = [];
  const propsToCheck = Object.keys(PROP_STAT_LABEL);

  // Fetch player game logs in parallel (batches of 5)
  const checkPlayers = players.slice(0, 18);
  const playerLogs: Map<string, { name: string; games: GameRow[]; isOpponent: boolean; team: string }> = new Map();

  for (let i = 0; i < checkPlayers.length; i += 5) {
    const batch = checkPlayers.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (p) => {
        const log = await getPlayerGameLog(p.id);
        return { id: p.id, name: p.name, games: log.games, isOpponent: p.isOpponent, team: p.team };
      })
    );
    for (const r of results) {
      playerLogs.set(r.id, { name: r.name, games: r.games, isOpponent: r.isOpponent, team: r.team });
    }
  }

  for (const p of checkPlayers) {
    const pData = playerLogs.get(p.id);
    if (!pData || pData.games.length < 3) continue;

    for (const prop of propsToCheck) {
      const values = pData.games
        .map(g => getStatValue(g.stats, prop))
        .filter(v => v > 0);
      if (values.length < 3) continue;

      values.sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)];
      const line = Math.round((median - 0.5) * 2) / 2;
      if (line <= 0) continue;

      let coGames = 0;
      let coHits = 0;

      for (const g of pData.games) {
        if (hitEventIds.has(g.eventId)) {
          coGames++;
          if (getStatValue(g.stats, prop) > line) coHits++;
        }
      }

      if (coGames >= 2) {
        const hitRate = Math.round((coHits / coGames) * 100);
        if (hitRate >= 55) {
          correlations.push({
            correlated_player: p.name,
            correlated_prop: prop,
            correlated_team: p.team,
            hit_rate: hitRate,
            sample_size: coGames,
            is_opponent: p.isOpponent,
            reasoning: generateReasoning(sourcePlayerName, sourceProp, p.name, prop, hitRate, p.isOpponent, coGames),
          });
        }
      }
    }
  }

  correlations.sort((a, b) => b.hit_rate - a.hit_rate || b.sample_size - a.sample_size);
  return correlations.slice(0, 15);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { player, prop, line, team } = await req.json();

    if (!player || !prop || line == null) {
      return new Response(JSON.stringify({ error: "player, prop, line required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Check cache
    const { data: cached } = await supabase
      .from("correlated_props")
      .select("*")
      .eq("prop_date", today)
      .eq("source_player", player)
      .eq("source_prop", prop)
      .order("hit_rate", { ascending: false });

    if (cached && cached.length > 0) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find player on ESPN
    const searchResp = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(player)}&limit=5&type=player`
    );
    const searchData = await searchResp.json();
    let playerId = "";
    let detectedTeam = team || "";

    const items = searchData.items || searchData.results || [];
    if (items.length > 0) {
      const found = items[0];
      playerId = found.id || found.$ref?.match(/athletes\/(\d+)/)?.[1] || "";
      if (!detectedTeam) {
        detectedTeam = found.team?.abbreviation || found.teamAbbreviation || "";
      }
    }

    // Fallback: fetch athlete endpoint directly for team
    if (playerId && !detectedTeam) {
      try {
        const athResp = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/players/${playerId}`);
        const athData = await athResp.json();
        detectedTeam = athData.team?.abbreviation || "";
        console.log(`Athlete endpoint fallback team: ${detectedTeam}`);
      } catch (e) {
        console.error("Athlete endpoint fallback failed:", e);
      }
    }

    if (!playerId) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${player}: id=${playerId}, team=${detectedTeam}`);

    // Get teammates
    const roster = await getTeamRoster(detectedTeam);
    const teammates = roster
      .filter(r => r.id !== playerId)
      .map(r => ({ ...r, isOpponent: false, team: detectedTeam }));

    // Get opponent players
    const oppTeamAbbr = await getOpponentTeam(detectedTeam);
    let opponents: Array<{ id: string; name: string; isOpponent: boolean; team: string }> = [];
    if (oppTeamAbbr) {
      console.log(`Opponent team: ${oppTeamAbbr}`);
      const oppRoster = await getTeamRoster(oppTeamAbbr);
      opponents = oppRoster.slice(0, 8).map(r => ({ ...r, isOpponent: true, team: oppTeamAbbr }));
    }

    const allPlayers = [...teammates.slice(0, 10), ...opponents];
    const correlations = await computeCorrelations(playerId, player, prop, line, allPlayers);
    console.log(`Found ${correlations.length} correlations for ${player} ${prop} ${line}`);

    // Cache results
    if (correlations.length > 0) {
      await supabase.from("correlated_props")
        .delete()
        .eq("prop_date", today)
        .eq("source_player", player)
        .eq("source_prop", prop);

      const rows = correlations.map(c => ({
        source_player: player,
        source_prop: prop,
        correlated_player: c.correlated_player,
        correlated_prop: c.correlated_prop,
        correlated_team: c.correlated_team,
        hit_rate: c.hit_rate,
        sample_size: c.sample_size,
        sport: "nba",
        prop_date: today,
      }));
      await supabase.from("correlated_props").insert(rows);
    }

    return new Response(JSON.stringify(correlations), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("correlated-props error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
