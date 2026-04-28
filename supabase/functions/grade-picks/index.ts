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

type MlbStatKey =
  | "hits"
  | "rbi"
  | "home_runs"
  | "runs"
  | "total_bases"
  | "strikeouts_pit"
  | "strikeouts_bat"
  | "walks"
  | "stolen_bases";

const MLB_PROP_TO_STAT: Record<string, MlbStatKey> = {
  hits: "hits",
  hit: "hits",
  mlb_hits: "hits",
  rbi: "rbi",
  rbis: "rbi",
  mlb_rbi: "rbi",
  hr: "home_runs",
  home_runs: "home_runs",
  mlb_hr: "home_runs",
  runs: "runs",
  mlb_runs: "runs",
  tb: "total_bases",
  total_bases: "total_bases",
  mlb_total_bases: "total_bases",
  k: "strikeouts_pit",
  ks: "strikeouts_pit",
  strikeouts: "strikeouts_pit",
  mlb_strikeouts: "strikeouts_pit",
  bb: "walks",
  walks: "walks",
  mlb_walks: "walks",
  sb: "stolen_bases",
  stolen_bases: "stolen_bases",
};

type NhlStatKey = "sog" | "assists" | "points" | "goals" | "saves";

const NHL_PROP_TO_STAT: Record<string, NhlStatKey> = {
  sog: "sog",
  nhl_sog: "sog",
  shots_on_goal: "sog",
  assists: "assists",
  nhl_assists: "assists",
  points: "points",
  nhl_points: "points",
  goals: "goals",
  nhl_goals: "goals",
  saves: "saves",
  nhl_saves: "saves",
};

function normalise(name: string): string {
  return name.replace(/[.']/g, "").toLowerCase().trim();
}

// Stricter normalization for MLB/NHL player matching: lowercase, strip
// punctuation, strip Jr/Sr/II/III/IV suffixes, collapse whitespace.
function normalizePlayerName(name: string): string {
  if (!name) return "";
  const lowered = name.toLowerCase();
  const stripped = lowered.replace(/[^a-z0-9\s]/g, " ");
  const tokens = stripped
    .split(/\s+/)
    .filter((t) => t.length > 0 && !["jr", "sr", "ii", "iii", "iv"].includes(t));
  return tokens.join(" ").trim();
}

function lastToken(name: string): string {
  const norm = normalizePlayerName(name);
  const parts = norm.split(/\s+/);
  return parts[parts.length - 1] || "";
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
  id: string;
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
      id: String(e.id || ""),
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

// ────────────────────────────────────────────────────────────────────
// MLB / NHL player prop grading

interface PropPlayerEntry {
  rawName: string;
  normName: string;
  lastName: string;
  group: string;          // "batting" | "pitching" | "skater" | "goalie" | etc.
  stats: Record<string, number>;
}

interface SummaryIndex {
  final: boolean;
  players: PropPlayerEntry[];
}

function indexSummary(box: any): PropPlayerEntry[] {
  const out: PropPlayerEntry[] = [];
  const teams = box?.boxscore?.players || [];
  for (const team of teams) {
    for (const statGroup of team.statistics || []) {
      const groupName = String(statGroup.name || statGroup.type || "").toLowerCase();
      const labels: string[] = (statGroup.labels || []).map((l: any) => String(l));
      for (const athlete of statGroup.athletes || []) {
        const rawName: string =
          athlete.athlete?.displayName ||
          athlete.athlete?.fullName ||
          athlete.athlete?.name ||
          "";
        if (!rawName) continue;
        const values: string[] = (athlete.stats || []).map((v: any) => String(v));
        const stats: Record<string, number> = {};
        labels.forEach((label, idx) => {
          if (!label) return;
          const num = parseFloat(values[idx] ?? "");
          stats[label.toUpperCase()] = Number.isFinite(num) ? num : 0;
        });
        out.push({
          rawName,
          normName: normalizePlayerName(rawName),
          lastName: lastToken(rawName),
          group: groupName,
          stats,
        });
      }
    }
  }
  return out;
}

function findPlayerEntries(
  index: PropPlayerEntry[],
  playerName: string,
  preferredGroups: string[],
): { entries: PropPlayerEntry[]; reason?: "ambiguous_player" | "player_not_found" } {
  const target = normalizePlayerName(playerName);
  if (!target) return { entries: [], reason: "player_not_found" };

  const exact = index.filter((e) => e.normName === target);
  if (exact.length > 0) {
    const preferred = exact.filter((e) => preferredGroups.includes(e.group));
    return { entries: preferred.length > 0 ? preferred : exact };
  }

  const last = lastToken(playerName);
  if (last) {
    const lastMatches = index.filter((e) => e.lastName === last);
    const uniqueByName = new Set(lastMatches.map((e) => e.normName));
    if (uniqueByName.size === 1 && lastMatches.length > 0) {
      const preferred = lastMatches.filter((e) => preferredGroups.includes(e.group));
      return { entries: preferred.length > 0 ? preferred : lastMatches };
    }
    if (uniqueByName.size > 1) {
      return { entries: [], reason: "ambiguous_player" };
    }
  }
  return { entries: [], reason: "player_not_found" };
}

function getMlbPlayerStat(
  summary: any,
  playerName: string,
  propType: string,
): { found: boolean; actual: number | null; reason?: string } {
  const key = MLB_PROP_TO_STAT[(propType || "").toLowerCase()];
  if (!key) return { found: false, actual: null, reason: "unsupported_prop" };

  const index = indexSummary(summary);
  if (index.length === 0) return { found: false, actual: null, reason: "no_data" };

  const preferred =
    key === "strikeouts_pit" ? ["pitching"] : ["batting"];
  const { entries, reason } = findPlayerEntries(index, playerName, preferred);
  if (entries.length === 0) {
    return { found: false, actual: null, reason: reason || "player_not_found" };
  }

  // Pick best entry from results (preferred group first; if strikeouts_pit and
  // no pitching entry exists, fall back to batting K/SO).
  let entry = entries.find((e) => preferred.includes(e.group));
  if (!entry) entry = entries[0];

  const s = entry.stats;
  const pick = (...candidates: string[]): number => {
    for (const c of candidates) {
      const v = s[c.toUpperCase()];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  };

  let actual: number | null = null;
  switch (key) {
    case "hits":
      actual = pick("H");
      break;
    case "rbi":
      actual = pick("RBI");
      break;
    case "home_runs":
      actual = pick("HR");
      break;
    case "runs":
      actual = pick("R");
      break;
    case "walks":
      actual = pick("BB");
      break;
    case "stolen_bases":
      actual = pick("SB");
      break;
    case "total_bases": {
      const h = pick("H");
      const d = pick("2B");
      const t = pick("3B");
      const hr = pick("HR");
      // singles = h - d - t - hr; TB = singles + 2d + 3t + 4hr = h + d + 2t + 3hr
      actual = h + d + 2 * t + 3 * hr;
      break;
    }
    case "strikeouts_pit":
      if (entry.group === "pitching") {
        actual = pick("K", "SO");
      } else {
        // Player wasn't a pitcher — fall back to batter SO/K.
        actual = pick("SO", "K");
      }
      break;
    case "strikeouts_bat":
      actual = pick("SO", "K");
      break;
  }

  if (actual == null || !Number.isFinite(actual)) {
    return { found: false, actual: null, reason: "no_data" };
  }
  return { found: true, actual };
}

function getNhlPlayerStat(
  summary: any,
  playerName: string,
  propType: string,
): { found: boolean; actual: number | null; reason?: string } {
  const key = NHL_PROP_TO_STAT[(propType || "").toLowerCase()];
  if (!key) return { found: false, actual: null, reason: "unsupported_prop" };

  const index = indexSummary(summary);
  if (index.length === 0) return { found: false, actual: null, reason: "no_data" };

  // Goalie groups commonly named "goalies"; skater groups "skaters" / "forwards" / "defense".
  const goalieGroups = ["goalies", "goalie", "goaltenders"];
  const skaterGroups = ["skaters", "forwards", "defense", "defensemen"];
  const preferred = key === "saves" ? goalieGroups : skaterGroups;

  const { entries, reason } = findPlayerEntries(index, playerName, preferred);
  if (entries.length === 0) {
    return { found: false, actual: null, reason: reason || "player_not_found" };
  }
  let entry = entries.find((e) => preferred.includes(e.group));
  if (!entry) entry = entries[0];
  const s = entry.stats;
  const pick = (...candidates: string[]): number => {
    for (const c of candidates) {
      const v = s[c.toUpperCase()];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  };

  let actual: number | null = null;
  switch (key) {
    case "sog":
      actual = pick("SOG", "S");
      break;
    case "goals":
      actual = pick("G");
      break;
    case "assists":
      actual = pick("A");
      break;
    case "points":
      actual = pick("PTS") || pick("G") + pick("A");
      break;
    case "saves":
      actual = pick("SV", "SVS");
      break;
  }

  if (actual == null || !Number.isFinite(actual)) {
    return { found: false, actual: null, reason: "no_data" };
  }
  return { found: true, actual };
}

interface PropGradeCounters {
  graded: number;
  skippedNotFinal: number;
  skippedNoData: number;
  skippedUnsupportedProp: number;
  skippedPlayerNotFound: number;
  skippedAmbiguousPlayer: number;
  skippedNoEvent: number;
}

function emptyCounters(): PropGradeCounters {
  return {
    graded: 0,
    skippedNotFinal: 0,
    skippedNoData: 0,
    skippedUnsupportedProp: 0,
    skippedPlayerNotFound: 0,
    skippedAmbiguousPlayer: 0,
    skippedNoEvent: 0,
  };
}

function gradeOverUnder(
  direction: string,
  actual: number,
  line: number,
): "hit" | "miss" | "push" {
  const dir = (direction || "").toLowerCase();
  if (actual === line) return "push";
  if (dir === "over") return actual > line ? "hit" : "miss";
  // default to under semantics
  return actual < line ? "hit" : "miss";
}

async function fetchSummary(
  sport: "mlb" | "nhl",
  eventId: string,
): Promise<any | null> {
  const path = sport === "mlb" ? "baseball/mlb" : "hockey/nhl";
  try {
    const resp = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${eventId}`,
    );
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.error(`[GradePicks] summary fetch failed sport=${sport} event=${eventId}`, e);
    return null;
  }
}

async function gradePlayerPropsForSport(
  supabase: ReturnType<typeof createClient>,
  sport: "mlb" | "nhl",
  picks: Pick[],
  getStat: (
    summary: any,
    playerName: string,
    propType: string,
  ) => { found: boolean; actual: number | null; reason?: string },
  propMap: Record<string, string>,
): Promise<PropGradeCounters> {
  const counters = emptyCounters();
  if (picks.length === 0) return counters;

  // Group by primary grading date so we cache scoreboard fetches per date.
  const byDate: Record<string, Pick[]> = {};
  for (const p of picks) {
    const primary = gradingDatesForPick(p)[0];
    (byDate[primary] ||= []).push(p);
  }

  const summaryCache = new Map<string, any | null>();
  const scoreboardCache = new Map<string, ScoreboardGame[]>();

  for (const [dateStr, datePicks] of Object.entries(byDate)) {
    if (!scoreboardCache.has(dateStr)) {
      scoreboardCache.set(dateStr, await fetchScoreboard(sport, dateStr));
    }
    const scoreboard = scoreboardCache.get(dateStr) || [];

    for (const pick of datePicks) {
      const propTypeLower = (pick.prop_type || "").toLowerCase();
      if (!propMap[propTypeLower]) {
        counters.skippedUnsupportedProp++;
        continue;
      }

      // Resolve event_id: prefer pick.event_id only if it matches a scoreboard
      // entry for this sport/date (Odds-API event_id ≠ ESPN id, so we cannot
      // call summary with it directly).
      let game = findGameForPick(pick, scoreboard);
      if (!game && pick.event_id) {
        const matched = scoreboard.find((g) => g.id === String(pick.event_id));
        if (matched) game = matched;
      }
      if (!game) {
        counters.skippedNoEvent++;
        continue;
      }
      if (!game.final) {
        counters.skippedNotFinal++;
        continue;
      }

      let summary = summaryCache.get(game.id);
      if (summary === undefined) {
        summary = await fetchSummary(sport, game.id);
        summaryCache.set(game.id, summary);
      }
      if (!summary) {
        counters.skippedNoData++;
        continue;
      }

      const { found, actual, reason } = getStat(
        summary,
        pick.player_name || "",
        pick.prop_type || "",
      );
      if (!found || actual == null) {
        if (reason === "ambiguous_player") counters.skippedAmbiguousPlayer++;
        else if (reason === "unsupported_prop") counters.skippedUnsupportedProp++;
        else if (reason === "player_not_found") counters.skippedPlayerNotFound++;
        else counters.skippedNoData++;
        continue;
      }

      const line = Number(pick.line);
      if (!Number.isFinite(line)) {
        counters.skippedNoData++;
        continue;
      }
      const result = gradeOverUnder(pick.direction || "", actual, line);
      const { error } = await supabase
        .from("daily_picks")
        .update({ result, avg_value: actual })
        .eq("id", pick.id);
      if (error) {
        console.error(`[GradePicks] update failed pick=${pick.id}`, error);
        counters.skippedNoData++;
        continue;
      }
      counters.graded++;
    }
  }

  return counters;
}

function isPlayerProp(pick: Pick): boolean {
  const betType = (pick.bet_type || "").toLowerCase();
  if (["moneyline", "spread", "total"].includes(betType)) return false;
  if (betType === "prop") return true;
  // Fall back: treat picks with player_name + prop_type as props.
  return !!(pick.player_name && pick.prop_type);
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
    let skippedUnsupportedProp = 0;
    let skippedPlayerNotFound = 0;
    let skippedAmbiguousPlayer = 0;
    let skippedNoEvent = 0;

    const sportSummary: Record<string, any> = {};

    // ── NBA: preserve existing prop grading. Group by pick_date and run the
    // original NBA path against each date in the pending set (covers 3-day
    // lookback without changing the grading logic itself).
    if (bySport.nba?.length) {
      const nbaCount = bySport.nba.length;
      let nbaGraded = 0;
      let nbaSkippedNoData = 0;
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
        nbaGraded += r1.graded;

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
            nbaGraded += r2.graded;
            nbaSkippedNoData += r2.skippedNoData;
          }
        } else {
          nbaSkippedNoData += r1.skippedNoData;
        }
      }
      totalGraded += nbaGraded;
      skippedNoData += nbaSkippedNoData;
      sportSummary.nba = {
        total: nbaCount,
        graded: nbaGraded,
        skipped_no_data: nbaSkippedNoData,
      };
    }

    // ── MLB / NHL: split into player props vs game bets.
    for (const sport of ["mlb", "nhl"] as const) {
      const sportPicks = bySport[sport];
      if (!sportPicks?.length) continue;

      const props = sportPicks.filter(isPlayerProp);
      const games = sportPicks.filter((p) => !isPlayerProp(p));

      let propCounters = emptyCounters();
      if (props.length > 0) {
        propCounters = await gradePlayerPropsForSport(
          supabase,
          sport,
          props,
          sport === "mlb" ? getMlbPlayerStat : getNhlPlayerStat,
          sport === "mlb" ? MLB_PROP_TO_STAT : NHL_PROP_TO_STAT,
        );
      }

      // Game bets — preserve original behaviour exactly.
      const scoreboards = new Map<string, ScoreboardGame[]>();
      const dateOf = async (d: string) => {
        if (!scoreboards.has(d)) scoreboards.set(d, await fetchScoreboard(sport, d));
        return scoreboards.get(d)!;
      };

      let gameGraded = 0;
      let gameNotFinal = 0;
      let gameNoData = 0;
      let gameUnsupported = 0;

      for (const pick of games) {
        const betType = (pick.bet_type || "").toLowerCase();
        if (!["moneyline", "spread", "total"].includes(betType)) {
          gameUnsupported++;
          continue;
        }

        const candidateDates = gradingDatesForPick(pick);

        let graded: "hit" | "miss" | "push" | null = null;
        let foundFinal = false;
        let foundGame = false;
        for (const d of candidateDates) {
          const gs = await dateOf(d);
          const g = findGameForPick(pick, gs);
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
          gameGraded++;
        } else if (foundGame && !foundFinal) {
          gameNotFinal++;
        } else {
          gameNoData++;
        }
      }

      totalGraded += propCounters.graded + gameGraded;
      skippedNotFinal += propCounters.skippedNotFinal + gameNotFinal;
      skippedNoData += propCounters.skippedNoData + gameNoData;
      skippedUnsupportedProp += propCounters.skippedUnsupportedProp + gameUnsupported;
      skippedPlayerNotFound += propCounters.skippedPlayerNotFound;
      skippedAmbiguousPlayer += propCounters.skippedAmbiguousPlayer;
      skippedNoEvent += propCounters.skippedNoEvent;

      sportSummary[sport] = {
        total: sportPicks.length,
        graded: propCounters.graded + gameGraded,
        skipped_not_final: propCounters.skippedNotFinal + gameNotFinal,
        skipped_no_data: propCounters.skippedNoData + gameNoData,
        skipped_unsupported_prop: propCounters.skippedUnsupportedProp + gameUnsupported,
        skipped_player_not_found: propCounters.skippedPlayerNotFound,
        skipped_ambiguous_player: propCounters.skippedAmbiguousPlayer,
        skipped_no_event: propCounters.skippedNoEvent,
        props: props.length,
        game_bets: games.length,
      };
    }

    if (bySport.ufc?.length) {
      console.log(
        `[GradePicks] skipping ufc — manual grade only (${bySport.ufc.length} pending)`,
      );
      sportSummary.ufc = { total: bySport.ufc.length, graded: 0, skipped_manual_only: bySport.ufc.length };
    }

    const responseBody = {
      message: "Picks graded",
      graded: totalGraded,
      total: picks.length,
      skipped_not_final: skippedNotFinal,
      skipped_no_data: skippedNoData,
      skipped_unsupported_prop: skippedUnsupportedProp,
      skipped_player_not_found: skippedPlayerNotFound,
      skipped_ambiguous_player: skippedAmbiguousPlayer,
      skipped_no_event: skippedNoEvent,
      bySport: sportSummary,
    };

    console.log(`[GradePicks] ${JSON.stringify(responseBody)}`);

    return new Response(
      JSON.stringify(responseBody),
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
