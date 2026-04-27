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

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Pick the date(s) ESPN's scoreboard should be queried for to grade a pick.
// Prefer the actual game_date / commence_time captured at scan time. Fall
// back to pick_date and pick_date+1 only for legacy rows missing those.
function gradingDatesForPick(pick: Pick): string[] {
  if (pick.game_date) return [String(pick.game_date).slice(0, 10)];
  if (pick.commence_time) {
    const d = new Date(pick.commence_time);
    if (!Number.isNaN(d.getTime())) {
      const ymdET = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      return [ymdET];
    }
  }
  return [pick.pick_date, ymd(new Date(new Date(pick.pick_date).getTime() + 86400000))];
}

function compactDate(s: string): string {
  return s.replace(/-/g, "");
}

function teamMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const an = norm(a);
  const bn = norm(b);
  return an === bn || an.includes(bn) || bn.includes(an);
}

type Pick = Record<string, any>;

interface ScoreboardGame {
  date: string;          // YYYY-MM-DD
  final: boolean;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeWin: boolean;
  awayWin: boolean;
}

async function fetchScoreboard(
  sport: "nba" | "mlb" | "nhl",
  dateStr: string,
): Promise<ScoreboardGame[]> {
  const path =
    sport === "nba" ? "basketball/nba" :
    sport === "mlb" ? "baseball/mlb"   :
    "hockey/nhl";
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${compactDate(dateStr)}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const json = await resp.json();
  const games: ScoreboardGame[] = [];
  for (const e of json.events || []) {
    const state = e.status?.type?.state;
    const competitors = e.competitions?.[0]?.competitors || [];
    const home = competitors.find((c: any) => c.homeAway === "home");
    const away = competitors.find((c: any) => c.homeAway === "away");
    if (!home || !away) continue;
    const homeScore = parseFloat(home.score ?? "0") || 0;
    const awayScore = parseFloat(away.score ?? "0") || 0;
    games.push({
      date: dateStr,
      final: state === "post",
      home: home.team?.displayName || home.team?.name || "",
      away: away.team?.displayName || away.team?.name || "",
      homeScore,
      awayScore,
      homeWin: !!home.winner,
      awayWin: !!away.winner,
    });
  }
  return games;
}

function findGameForPick(pick: Pick, games: ScoreboardGame[]): ScoreboardGame | null {
  for (const g of games) {
    if (
      (teamMatch(pick.home_team, g.home) && teamMatch(pick.away_team, g.away)) ||
      (teamMatch(pick.home_team, g.away) && teamMatch(pick.away_team, g.home))
    ) {
      return g;
    }
    if (pick.team && (teamMatch(pick.team, g.home) || teamMatch(pick.team, g.away))) {
      return g;
    }
  }
  return null;
}

function gradeGameBet(pick: Pick, g: ScoreboardGame): "hit" | "miss" | "push" | null {
  if (!g.final) return null;
  const betType = (pick.bet_type || "").toLowerCase();
  const dir = (pick.direction || "").toLowerCase();

  if (betType === "moneyline") {
    const pickedHome =
      teamMatch(pick.team, g.home) ||
      dir === "home" ||
      (dir === "win" && teamMatch(pick.player_name, g.home));
    const pickedAway =
      teamMatch(pick.team, g.away) ||
      dir === "away" ||
      (dir === "win" && teamMatch(pick.player_name, g.away));
    if (pickedHome) return g.homeWin ? "hit" : "miss";
    if (pickedAway) return g.awayWin ? "hit" : "miss";
    return null;
  }

  if (betType === "spread") {
    const line = Number(pick.spread_line ?? pick.line);
    if (!Number.isFinite(line)) return null;
    // Convention: spread_line positive = underdog +X, negative = favourite −X.
    // direction tells us which side: "home" or "away".
    const homeIsPick = dir === "home" || teamMatch(pick.team, g.home);
    const awayIsPick = dir === "away" || teamMatch(pick.team, g.away);
    if (!homeIsPick && !awayIsPick) return null;
    const teamScore = homeIsPick ? g.homeScore : g.awayScore;
    const oppScore  = homeIsPick ? g.awayScore : g.homeScore;
    const adjusted  = teamScore + line;
    if (adjusted > oppScore) return "hit";
    if (adjusted < oppScore) return "miss";
    return "push";
  }

  if (betType === "total") {
    const total = Number(pick.total_line ?? pick.line);
    if (!Number.isFinite(total)) return null;
    const sum = g.homeScore + g.awayScore;
    if (sum === total) return "push";
    if (dir === "over")  return sum > total ? "hit" : "miss";
    if (dir === "under") return sum < total ? "hit" : "miss";
    return null;
  }

  return null;
}

async function gradeNbaProps(
  supabase: ReturnType<typeof createClient>,
  picks: Pick[],
  scoreDate: string,
): Promise<{ graded: number; skippedNoData: number }> {
  if (picks.length === 0) return { graded: 0, skippedNoData: 0 };

  const dateStr = compactDate(scoreDate);
  const scoreboardResp = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`,
  );
  if (!scoreboardResp.ok) return { graded: 0, skippedNoData: picks.length };
  const scoreboard = await scoreboardResp.json();

  const completedGameIds: string[] = [];
  for (const e of scoreboard.events || []) {
    if (e.status?.type?.state === "post") completedGameIds.push(e.id);
  }
  if (completedGameIds.length === 0) return { graded: 0, skippedNoData: picks.length };

  const playerStats: Record<string, Record<string, number>> = {};
  await Promise.all(
    completedGameIds.map(async (gid) => {
      try {
        const boxResp = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gid}`,
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
              playerStats[name] = {
                points: stats["PTS"] || 0,
                rebounds: stats["REB"] || 0,
                assists: stats["AST"] || 0,
                threePointFieldGoalsMade:
                  stats["3PM"] ||
                  parseFloat((stats["3PT"] || "0").toString().split("-")[0]) ||
                  0,
                steals: stats["STL"] || 0,
                blocks: stats["BLK"] || 0,
              };
            }
          }
        }
      } catch (e) {
        console.error(`Error fetching box score for game ${gid}:`, e);
      }
    }),
  );

  let graded = 0;
  let skippedNoData = 0;
  for (const pick of picks) {
    const stats = playerStats[normalise(pick.player_name)];
    if (!stats) {
      skippedNoData++;
      continue;
    }
    const statKeys = PROP_TO_STAT[(pick.prop_type || "").toLowerCase()] || [];
    if (statKeys.length === 0) {
      skippedNoData++;
      continue;
    }
    let actualValue = 0;
    for (const key of statKeys) actualValue += stats[key] || 0;

    const result =
      pick.direction === "over"
        ? actualValue > pick.line ? "hit" : "miss"
        : actualValue < pick.line ? "hit" : "miss";

    await supabase
      .from("daily_picks")
      .update({ result, avg_value: actualValue })
      .eq("id", pick.id);
    graded++;
  }
  return { graded, skippedNoData };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // 3-day lookback, accept null result as pending
    const cutoff = ymd(new Date(Date.now() - 3 * 86400000));
    const { data: picks } = await supabase
      .from("daily_picks")
      .select("*")
      .gte("pick_date", cutoff)
      .or("result.is.null,result.eq.pending");

    if (!picks || picks.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending picks to grade", graded: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bySport: Record<string, Pick[]> = {};
    for (const p of picks as Pick[]) {
      const s = (p.sport || "").toLowerCase();
      (bySport[s] ||= []).push(p);
    }

    console.log(
      `[GradePicks] pending=${picks.length} sports=${JSON.stringify(
        Object.fromEntries(Object.entries(bySport).map(([k, v]) => [k, v.length])),
      )}`,
    );

    let totalGraded = 0;
    let skippedNotFinal = 0;
    let skippedNoData = 0;

    // ── NBA: preserve existing prop grading. Group by pick_date and run the
    // original NBA path against each date in the pending set (covers 3-day
    // lookback without changing the grading logic itself).
    if (bySport.nba?.length) {
      // Group by primary grading date — prefer game_date, fall back to pick_date.
      const byDate: Record<string, Pick[]> = {};
      const fallbackDates = new Map<string, string[]>();
      for (const p of bySport.nba) {
        const dates = gradingDatesForPick(p);
        const primary = dates[0];
        (byDate[primary] ||= []).push(p);
        if (dates.length > 1) fallbackDates.set(p.id, dates.slice(1));
      }
      const remaining = new Map<string, Pick>();
      for (const p of bySport.nba) remaining.set(p.id, p);

      for (const [date, datePicks] of Object.entries(byDate)) {
        const stillPending = datePicks.filter((p) => remaining.has(p.id));
        if (stillPending.length === 0) continue;
        const r1 = await gradeNbaProps(supabase, stillPending, date);
        totalGraded += r1.graded;

        // Legacy fallback (rows missing game_date): try next calendar day.
        const after = stillPending.filter(
          (p) => remaining.has(p.id) && fallbackDates.has(p.id),
        );
        const todayStr = ymd(new Date());
        if (after.length) {
          const { data: rows } = await supabase
            .from("daily_picks")
            .select("id")
            .in("id", after.map((p) => p.id))
            .or("result.is.null,result.eq.pending");
          const stillIds = new Set((rows || []).map((r: any) => r.id));
          const groupedNext: Record<string, Pick[]> = {};
          for (const p of after) {
            if (!stillIds.has(p.id)) continue;
            for (const nd of fallbackDates.get(p.id) || []) {
              if (nd > todayStr) continue;
              (groupedNext[nd] ||= []).push(p);
            }
          }
          for (const [nd, ndPicks] of Object.entries(groupedNext)) {
            const r2 = await gradeNbaProps(supabase, ndPicks, nd);
            totalGraded += r2.graded;
            skippedNoData += r2.skippedNoData;
          }
        } else {
          skippedNoData += r1.skippedNoData;
        }
      }
    }

    // ── MLB / NHL: game bets only (moneyline / spread / total).
    for (const sport of ["mlb", "nhl"] as const) {
      const sportPicks = bySport[sport];
      if (!sportPicks?.length) continue;

      // Cache scoreboards by date so we don't refetch.
      const scoreboards = new Map<string, ScoreboardGame[]>();
      const dateOf = async (d: string) => {
        if (!scoreboards.has(d)) scoreboards.set(d, await fetchScoreboard(sport, d));
        return scoreboards.get(d)!;
      };

      for (const pick of sportPicks) {
        const betType = (pick.bet_type || "").toLowerCase();
        if (!["moneyline", "spread", "total"].includes(betType)) {
          skippedNoData++;
          continue;
        }

        const candidateDates = gradingDatesForPick(pick);

        let graded: "hit" | "miss" | "push" | null = null;
        let foundFinal = false;
        let foundGame = false;
        for (const d of candidateDates) {
          const games = await dateOf(d);
          const g = findGameForPick(pick, games);
          if (!g) continue;
          foundGame = true;
          const r = gradeGameBet(pick, g);
          if (r) {
            graded = r;
            foundFinal = true;
            break;
          }
        }

        if (graded) {
          await supabase
            .from("daily_picks")
            .update({ result: graded })
            .eq("id", pick.id);
          totalGraded++;
        } else if (foundGame && !foundFinal) {
          skippedNotFinal++;
        } else {
          skippedNoData++;
        }
      }
    }

    if (bySport.ufc?.length) {
      console.log(
        `[GradePicks] skipping ufc — manual grade only (${bySport.ufc.length} pending)`,
      );
    }

    console.log(
      `[GradePicks] graded=${totalGraded} skipped_not_final=${skippedNotFinal} skipped_no_data=${skippedNoData}`,
    );

    return new Response(
      JSON.stringify({
        message: "Picks graded",
        graded: totalGraded,
        skipped_not_final: skippedNotFinal,
        skipped_no_data: skippedNoData,
        total: picks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Grade picks error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
