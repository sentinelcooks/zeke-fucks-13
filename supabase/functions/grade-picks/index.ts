import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PROP_TO_STAT: Record<string, string[]> = {
  points: ["points"],
  rebounds: ["rebounds"],
  assists: ["assists"],
  "3-pointers": ["threePointFieldGoalsMade"],
  threes: ["threePointFieldGoalsMade"],
  steals: ["steals"],
  blocks: ["blocks"],
};

function normalise(name: string): string {
  return name.replace(/[.']/g, "").toLowerCase().trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Get yesterday's pending picks
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const { data: picks } = await supabase
      .from("daily_picks")
      .select("*")
      .eq("pick_date", yesterday)
      .eq("result", "pending");

    if (!picks || picks.length === 0) {
      return new Response(JSON.stringify({ message: "No pending picks to grade", graded: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Grading ${picks.length} pending picks for ${yesterday}`);

    // Fetch yesterday's NBA scoreboard from ESPN
    const dateStr = yesterday.replace(/-/g, "");
    const scoreboardResp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`
    );
    if (!scoreboardResp.ok) throw new Error(`ESPN scoreboard error: ${scoreboardResp.status}`);
    const scoreboard = await scoreboardResp.json();

    // Only process completed games (status "post" = final)
    const completedGameIds: string[] = [];
    for (const e of scoreboard.events || []) {
      const status = e.status?.type?.state; // "pre", "in", "post"
      if (status === "post") {
        completedGameIds.push(e.id);
      } else {
        console.log(`Skipping game ${e.id} (${e.shortName}) — status: ${status}`);
      }
    }
    console.log(`Found ${completedGameIds.length} completed games out of ${(scoreboard.events || []).length} total for ${yesterday}`);

    if (completedGameIds.length === 0) {
      return new Response(JSON.stringify({ message: "No completed games yet", graded: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch box scores for each completed game and build player stats map
    const playerStats: Record<string, Record<string, number>> = {};

    await Promise.all(
      completedGameIds.map(async (gid) => {
        try {
          const boxResp = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gid}`
          );
          if (!boxResp.ok) return;
          const box = await boxResp.json();

          for (const team of box.boxscore?.players || []) {
            for (const statGroup of team.statistics || []) {
              const labels = statGroup.labels || [];
              for (const athlete of statGroup.athletes || []) {
                const name = normalise(athlete.athlete?.displayName || "");
                if (!name) continue;
                const stats: Record<string, number> = {};
                (athlete.stats || []).forEach((val: string, idx: number) => {
                  const label = labels[idx];
                  if (label) stats[label] = parseFloat(val) || 0;
                });

                // Map ESPN labels to our stat keys
                playerStats[name] = {
                  points: stats["PTS"] || 0,
                  rebounds: stats["REB"] || 0,
                  assists: stats["AST"] || 0,
                  threePointFieldGoalsMade: stats["3PM"] || parseFloat((stats["3PT"] || "0").toString().split("-")[0]) || 0,
                  steals: stats["STL"] || 0,
                  blocks: stats["BLK"] || 0,
                };
              }
            }
          }
        } catch (e) {
          console.error(`Error fetching box score for game ${gid}:`, e);
        }
      })
    );

    console.log(`Collected stats for ${Object.keys(playerStats).length} players`);

    // Grade each pick
    let graded = 0;
    for (const pick of picks) {
      const normName = normalise(pick.player_name);
      const stats = playerStats[normName];
      if (!stats) {
        console.warn(`No stats found for ${pick.player_name} (${normName})`);
        continue;
      }

      const statKeys = PROP_TO_STAT[pick.prop_type?.toLowerCase()] || [];
      let actualValue = 0;
      for (const key of statKeys) {
        actualValue += stats[key] || 0;
      }

      let result: string;
      if (pick.direction === "over") {
        result = actualValue > pick.line ? "hit" : "miss";
      } else {
        result = actualValue < pick.line ? "hit" : "miss";
      }

      console.log(`${pick.player_name} ${pick.prop_type} ${pick.direction} ${pick.line} → actual ${actualValue} → ${result}`);

      await supabase
        .from("daily_picks")
        .update({ result, avg_value: actualValue })
        .eq("id", pick.id);

      graded++;
    }

    return new Response(
      JSON.stringify({ message: "Picks graded", graded, total: picks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Grade picks error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
