import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeNbaPropType } from "../_shared/prop_normalization.ts";
import {
  espnSportPath,
  getMlbPlayerStat as getVerifiedMlbPlayerStat,
  gradeGameBet as gradeVerifiedGameBet,
  gradeOverUnder as gradeVerifiedOverUnder,
  marketKeyForPick,
  MLB_PROP_TO_STAT as VERIFIED_MLB_PROP_TO_STAT,
  probabilityClvPercentagePoints,
  profitUnits as verifiedProfitUnits,
  selectClosingSnapshot,
  type EspnGradingSport,
  type MarketOddsSnapshot,
} from "../_shared/pick_grading.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-grade-picks-secret",
};

// Mirrors src/lib/odds.ts + admin-onboarding/index.ts profitUnits — kept in sync
// so cron-graded rows compute profit identically to manually-graded ones.
// Keys are the canonical output of normalizeNbaPropType (see
// _shared/prop_normalization.ts). Combo props sum the listed stats — the
// loop at the use-site adds each box-score key into actualValue, so
// "pts+reb+ast" naturally evaluates to points + rebounds + assists.
const PROP_TO_STAT: Record<string, string[]> = {
  points: ["points"],
  rebounds: ["rebounds"],
  assists: ["assists"],
  "3-pointers": ["threePointFieldGoalsMade"],
  threes: ["threePointFieldGoalsMade"],
  steals: ["steals"],
  blocks: ["blocks"],
  turnovers: ["turnovers"],
  "pts+reb+ast": ["points", "rebounds", "assists"],
  "pts+reb": ["points", "rebounds"],
  "pts+ast": ["points", "assists"],
  "reb+ast": ["rebounds", "assists"],
  "stl+blk": ["steals", "blocks"],
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
// Return candidate ESPN scoreboard dates to query for a pick, ET-game-day
// first. The scanner stores `game_date` as the UTC date of commence_time —
// for an 8pm+ ET tipoff that's tomorrow's UTC date, NOT the actual game
// day. ESPN's scoreboard is keyed by ET calendar date, so we must convert
// commence_time to America/New_York first. We still include `game_date`
// as a fallback so daytime games (where ET-date == UTC-date) work
// identically, and dedup the list to keep the cron path fast.
function gradingDatesForPick(pick: Pick): string[] {
  const out: string[] = [];
  if (pick.commence_time) {
    const d = new Date(pick.commence_time);
    if (!Number.isNaN(d.getTime())) {
      const ymdET = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      out.push(ymdET);
    }
  }
  if (pick.game_date) {
    const gd = String(pick.game_date).slice(0, 10);
    if (!out.includes(gd)) out.push(gd);
  }
  if (out.length > 0) return out;
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
  // Raw ESPN status state for diagnostics ("pre", "in", "post", ...).
  // Surfaced on skipped-pick logs so we can tell at a glance whether a
  // pending pick is waiting on the game to actually finish.
  state: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeWin: boolean;
  awayWin: boolean;
}

async function fetchScoreboard(
  sport: EspnGradingSport,
  dateStr: string,
): Promise<ScoreboardGame[]> {
  const path = espnSportPath(sport);
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
      state: String(state ?? ""),
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

function legacyGradeGameBet(pick: Pick, g: ScoreboardGame): "hit" | "miss" | "push" | null {
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

async function gradeBasketballProps(
  supabase: ReturnType<typeof createClient>,
  sport: "nba" | "wnba",
  picks: Pick[],
  scoreDate: string,
  ctx: GradeCtx,
): Promise<{ graded: number; skippedNoData: number }> {
  if (picks.length === 0) return { graded: 0, skippedNoData: 0 };

  const dateStr = compactDate(scoreDate);
  const scoreboardResp = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath(sport)}/scoreboard?dates=${dateStr}`,
  );
  if (!scoreboardResp.ok) {
    for (const p of picks) {
      recordSkip(ctx, p, "no_data", { date_used: scoreDate });
    }
    return { graded: 0, skippedNoData: picks.length };
  }
  const scoreboard = await scoreboardResp.json();

  // Build a quick lookup of each pick's game state in the ESPN scoreboard
  // so we can categorize skips precisely (not_final vs no_event vs no_data).
  type EventInfo = { id: string; state: string; home: string; away: string };
  const events: EventInfo[] = (scoreboard.events || []).map((e: any) => {
    const comp = e.competitions?.[0]?.competitors ?? [];
    const home = comp.find((c: any) => c.homeAway === "home")?.team?.displayName ?? "";
    const away = comp.find((c: any) => c.homeAway === "away")?.team?.displayName ?? "";
    return {
      id: String(e.id),
      state: String(e.status?.type?.state ?? ""),
      home,
      away,
    };
  });

  const completedGameIds: string[] = [];
  for (const e of events) {
    if (e.state === "post") {
      completedGameIds.push(e.id);
      ctx.finalGamesFound.add(`${sport}:${e.id}`);
    }
  }
  if (completedGameIds.length === 0) {
    // Categorize: did each pick's team appear in scoreboard but not final?
    for (const p of picks) {
      const ev = events.find(
        (e) => teamMatch(p.home_team, e.home) && teamMatch(p.away_team, e.away),
      );
      if (ev) {
        recordSkip(ctx, p, "not_final", {
          date_used: scoreDate,
          espn_state: ev.state,
          found_in_scoreboard: true,
          teams: `${ev.home}@${ev.away}`,
        });
      } else {
        recordSkip(ctx, p, "no_event", { date_used: scoreDate });
      }
    }
    return { graded: 0, skippedNoData: picks.length };
  }

  const playerStats: Record<string, Record<string, number>> = {};
  await Promise.all(
    completedGameIds.map(async (gid) => {
      try {
        const boxResp = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath(sport)}/summary?event=${gid}`,
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
                turnovers: stats["TO"] || 0,
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
    // Categorize before checking player stats: if the pick's game wasn't in
    // the completed list, the right reason is not_final/no_event, NOT
    // player_not_found. Without this branch we'd mis-attribute every
    // pending-game NBA pick as a missing-player issue.
    const ev = events.find(
      (e) => teamMatch(pick.home_team, e.home) && teamMatch(pick.away_team, e.away),
    );
    if (!ev) {
      skippedNoData++;
      recordSkip(ctx, pick, "no_event", { date_used: scoreDate });
      continue;
    }
    if (ev.state !== "post") {
      skippedNoData++;
      recordSkip(ctx, pick, "not_final", {
        date_used: scoreDate,
        espn_state: ev.state,
        found_in_scoreboard: true,
        teams: `${ev.home}@${ev.away}`,
      });
      continue;
    }
    const stats = playerStats[normalise(pick.player_name)];
    if (!stats) {
      skippedNoData++;
      recordSkip(ctx, pick, "player_not_found", {
        date_used: scoreDate,
        espn_state: ev.state,
        found_in_scoreboard: true,
        teams: `${ev.home}@${ev.away}`,
      });
      continue;
    }
    // Normalize through the canonical NBA prop key so any DB row variant
    // ("PRA", "Points + Rebounds + Assists", "points_rebounds_assists",
    // "pts_reb_ast", …) resolves to the same lookup key the scanner stores.
    const canonicalProp = normalizeNbaPropType(pick.prop_type || "");
    const statKeys = PROP_TO_STAT[canonicalProp] || [];
    if (statKeys.length === 0) {
      skippedNoData++;
      recordSkip(ctx, pick, "unsupported_prop", {
        date_used: scoreDate,
        espn_state: ev.state,
        found_in_scoreboard: true,
        teams: `${ev.home}@${ev.away}`,
      });
      continue;
    }
    let actualValue = 0;
    for (const key of statKeys) actualValue += stats[key] || 0;

    const result = gradeVerifiedOverUnder(pick.direction || "", actualValue, Number(pick.line));
    if (!result) {
      skippedNoData++;
      recordSkip(ctx, pick, "invalid_direction", { date_used: scoreDate });
      continue;
    }

    const ok = await writeGrade(
      supabase,
      {
        pick,
        result,
        actualValue,
        line: Number(pick.line),
        direction: pick.direction ?? null,
        source: `espn:${sport}`,
        sport,
        betType: (pick.bet_type || "prop").toLowerCase(),
      },
      ctx,
    );
    if (!ok) {
      recordSkip(ctx, pick, "update_failed", { date_used: scoreDate });
      continue;
    }
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

function legacyGetMlbPlayerStat(
  summary: any,
  playerName: string,
  propType: string,
): { found: boolean; actual: number | null; reason?: string } {
  const key = VERIFIED_MLB_PROP_TO_STAT[(propType || "").toLowerCase()];
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

function legacyGradeOverUnder(
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
  ctx: GradeCtx,
): Promise<PropGradeCounters> {
  const counters = emptyCounters();
  if (picks.length === 0) return counters;

  const summaryCache = new Map<string, any | null>();
  const scoreboardCache = new Map<string, ScoreboardGame[]>();
  const getScoreboard = async (d: string): Promise<ScoreboardGame[]> => {
    if (!scoreboardCache.has(d)) {
      scoreboardCache.set(d, await fetchScoreboard(sport, d));
    }
    return scoreboardCache.get(d) || [];
  };

  for (const pick of picks) {
    const propTypeLower = (pick.prop_type || "").toLowerCase();
    if (!propMap[propTypeLower]) {
      counters.skippedUnsupportedProp++;
      recordSkip(ctx, pick, "unsupported_prop", { date_used: gradingDatesForPick(pick)[0] ?? null });
      continue;
    }

    // Try every candidate date for this pick — ET-game-day first, then any
    // alternate (game_date when stored as UTC date) — so we don't miss
    // games where commence_time straddles midnight UTC.
    const candidateDates = gradingDatesForPick(pick);
    let game: ScoreboardGame | null = null;
    let dateStr: string = candidateDates[0] ?? "";
    for (const d of candidateDates) {
      const scoreboard = await getScoreboard(d);
      let found = findGameForPick(pick, scoreboard);
      if (!found && pick.event_id) {
        const matched = scoreboard.find((g) => g.id === String(pick.event_id));
        if (matched) found = matched;
      }
      if (found) {
        game = found;
        dateStr = d;
        break;
      }
    }
    {
      if (!game) {
        counters.skippedNoEvent++;
        recordSkip(ctx, pick, "no_event", { date_used: dateStr });
        continue;
      }
      if (!game.final) {
        counters.skippedNotFinal++;
        recordSkip(ctx, pick, "not_final", {
          date_used: dateStr,
          espn_state: game.state ?? null,
          found_in_scoreboard: true,
          teams: `${game.home}@${game.away}`,
        });
        continue;
      }
      ctx.finalGamesFound.add(`${sport}:${game.id}`);

      let summary = summaryCache.get(game.id);
      if (summary === undefined) {
        summary = await fetchSummary(sport, game.id);
        summaryCache.set(game.id, summary);
      }
      if (!summary) {
        counters.skippedNoData++;
        recordSkip(ctx, pick, "no_data", {
          date_used: dateStr,
          espn_state: game.state ?? null,
          found_in_scoreboard: true,
          teams: `${game.home}@${game.away}`,
        });
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
        const skipReason: PerPickDiag["reason"] =
          reason === "ambiguous_player" ? "ambiguous_player"
            : reason === "unsupported_prop" ? "unsupported_prop"
            : reason === "player_not_found" ? "player_not_found"
            : "no_data";
        recordSkip(ctx, pick, skipReason, {
          date_used: dateStr,
          espn_state: game.state ?? null,
          found_in_scoreboard: true,
          teams: `${game.home}@${game.away}`,
        });
        continue;
      }

      const line = Number(pick.line);
      if (!Number.isFinite(line)) {
        counters.skippedNoData++;
        recordSkip(ctx, pick, "no_data", { date_used: dateStr });
        continue;
      }
      const result = gradeVerifiedOverUnder(pick.direction || "", actual, line);
      if (!result) {
        counters.skippedNoData++;
        recordSkip(ctx, pick, "invalid_direction", { date_used: dateStr });
        continue;
      }
      const ok = await writeGrade(
        supabase,
        {
          pick,
          result,
          actualValue: actual,
          line,
          direction: pick.direction ?? null,
          source: `espn:${sport}`,
          sport,
          betType: (pick.bet_type || "prop").toLowerCase(),
        },
        ctx,
      );
      if (!ok) {
        counters.skippedNoData++;
        recordSkip(ctx, pick, "update_failed", { date_used: dateStr });
        continue;
      }
      counters.graded++;
    }
  }

  return counters;
}

// Per-pick diagnostic record for every pick that did NOT transition to a
// terminal result this run. Pushed to a single shared array (built at the
// top of Deno.serve) and surfaced both in the HTTP response (metrics
// rollup) and as one structured log line each. Keeps the cron path quiet
// for picks that grade cleanly — only "stuck" picks generate entries.
interface PerPickDiag {
  pick_id: string;
  sport: string;
  player_name: string | null;
  prop_type: string | null;
  direction: string | null;
  line: number | null;
  date_used: string | null;
  reason:
    | "not_final"
    | "no_event"
    | "player_not_found"
    | "ambiguous_player"
    | "unsupported_prop"
    | "invalid_direction"
    | "no_data"
    | "update_failed";
  espn_state: string | null;
  found_in_scoreboard: boolean;
  teams: string | null;
}

// Shared accumulator passed into per-sport graders so they can record the
// "why" alongside the existing skipped* counter increments.
interface GradeSample {
  pick_id: string;
  sport: string;
  bet_type: string;
  result: "hit" | "miss" | "push";
  profit_units: number | null;
  actual_value: number | null;
  line: number | null;
  direction: string | null;
}

interface GradeCtx {
  diagnostics: PerPickDiag[];
  finalGamesFound: Set<string>;
  updateFailedCount: number;
  hits: number;
  misses: number;
  pushes: number;
  sampleGraded: GradeSample[];
  dryRun: boolean;
}

interface GradeWritePayload {
  pick: Pick;
  result: "hit" | "miss" | "push";
  actualValue?: number | null;
  line?: number | null;
  direction?: string | null;
  source: string;
  sport: string;
  betType: string;
  reason?: string | null;
}

interface ClosingLineCapture {
  odds: number;
  line: number | null;
  capturedAt: string;
  book: string;
  source: "selected_book" | "consensus_median";
  clv: number | null;
}

async function loadClosingLine(
  supabase: ReturnType<typeof createClient>,
  pick: Pick,
): Promise<ClosingLineCapture | null> {
  const market = marketKeyForPick(pick.bet_type || "");
  if (!market || !pick.event_id || !pick.commence_time) return null;

  const { data, error } = await supabase
    .from("market_odds_snapshots")
    .select("book,market,outcome_name,outcome_description,price,line,snapshot_at")
    .eq("event_id", String(pick.event_id))
    .eq("sport", String(pick.sport || "").toLowerCase())
    .eq("market", market)
    .lte("snapshot_at", String(pick.commence_time))
    .order("snapshot_at", { ascending: false })
    .limit(250);

  if (error) {
    // A migration may not be applied yet during a staged rollout. Grading is
    // still correct; the missing verified close is explicitly recorded.
    console.warn(`[GradePicks] closing snapshot query failed pick=${pick.id}: ${error.message}`);
    return null;
  }

  const selection = selectClosingSnapshot(
    (data ?? []) as MarketOddsSnapshot[],
    pick,
    pick.selected_book ?? null,
  );
  if (!selection.snapshot || selection.source === "unavailable") return null;
  return {
    odds: selection.snapshot.price,
    line: selection.snapshot.line ?? null,
    capturedAt: selection.snapshot.snapshot_at,
    book: selection.snapshot.book,
    source: selection.source,
    clv: probabilityClvPercentagePoints(
      pick.opening_odds ?? pick.odds,
      selection.snapshot.price,
    ),
  };
}

async function writeGrade(
  supabase: ReturnType<typeof createClient>,
  payload: GradeWritePayload,
  ctx: GradeCtx,
): Promise<boolean> {
  const { pick, result, actualValue, line, direction, source, sport, betType, reason } = payload;
  const stake = Number(pick.stake_units);
  const stakeUnits = Number.isFinite(stake) && stake > 0 ? stake : 1;
  const profit = verifiedProfitUnits(pick.odds, result, stakeUnits);
  const gradedAt = new Date().toISOString();
  const closing = ctx.dryRun ? null : await loadClosingLine(supabase, pick);

  const existingDiag =
    pick.model_diagnostics && typeof pick.model_diagnostics === "object"
      ? pick.model_diagnostics as Record<string, unknown>
      : {};
  const nextDiag = {
    ...existingDiag,
    auto_grade: {
      graded_by: "grade-picks",
      graded_at: gradedAt,
      actual_value: actualValue ?? null,
      line: line ?? (typeof pick.line === "number" ? pick.line : null),
      direction: direction ?? (pick.direction ?? null),
      source,
      sport,
      bet_type: betType,
      reason: reason ?? null,
      closing_line: closing
        ? {
          source: closing.source,
          book: closing.book,
          captured_at: closing.capturedAt,
          odds: closing.odds,
          line: closing.line,
          clv_method: "american_implied_probability_percentage_points",
        }
        : {
          source: "unavailable",
          reason: marketKeyForPick(pick.bet_type || "")
            ? "no_verified_pre_commence_snapshot"
            : "unsupported_market",
        },
    },
  };

  // Tally + sample regardless of dry-run.
  if (result === "hit") ctx.hits++;
  else if (result === "miss") ctx.misses++;
  else ctx.pushes++;
  if (ctx.sampleGraded.length < 10) {
    ctx.sampleGraded.push({
      pick_id: pick.id,
      sport,
      bet_type: betType,
      result,
      profit_units: profit,
      actual_value: actualValue ?? null,
      line: line ?? (typeof pick.line === "number" ? pick.line : null),
      direction: direction ?? (pick.direction ?? null),
    });
  }

  if (ctx.dryRun) return true;

  // For game bets (no actualValue), don't clobber any prior avg_value.
  const update: Record<string, unknown> = {
    result,
    profit_units: profit,
    graded_at: gradedAt,
    grading_source: source,
    opening_odds: pick.opening_odds ?? pick.odds ?? null,
    opening_line: pick.opening_line ?? pick.line ?? null,
    opening_captured_at: pick.opening_captured_at ?? pick.created_at ?? null,
    model_diagnostics: nextDiag,
  };
  if (actualValue !== undefined && actualValue !== null) {
    update.actual_value = actualValue;
  }
  if (closing) {
    update.closing_odds = closing.odds > 0 ? `+${closing.odds}` : String(closing.odds);
    update.closing_line = closing.line;
    update.closing_captured_at = closing.capturedAt;
    update.closing_line_source = `${closing.source}:${closing.book}`;
    update.clv = closing.clv;
    update.clv_method = "american_implied_probability_percentage_points";
  }

  const { error } = await supabase
    .from("daily_picks")
    .update(update)
    .eq("id", pick.id);
  if (error) {
    ctx.updateFailedCount++;
    // Roll back counter we optimistically incremented.
    if (result === "hit") ctx.hits--;
    else if (result === "miss") ctx.misses--;
    else ctx.pushes--;
    ctx.sampleGraded.pop();
    console.error(`[GradePicks] update failed pick=${pick.id}`, error);
    return false;
  }
  return true;
}

function recordSkip(
  ctx: GradeCtx,
  pick: Pick,
  reason: PerPickDiag["reason"],
  opts: {
    date_used?: string | null;
    espn_state?: string | null;
    found_in_scoreboard?: boolean;
    teams?: string | null;
  } = {},
): void {
  const entry: PerPickDiag = {
    pick_id: pick.id,
    sport: (pick.sport || "").toLowerCase(),
    player_name: pick.player_name ?? null,
    prop_type: pick.prop_type ?? null,
    direction: pick.direction ?? null,
    line: typeof pick.line === "number" ? pick.line : null,
    date_used: opts.date_used ?? null,
    reason,
    espn_state: opts.espn_state ?? null,
    found_in_scoreboard: opts.found_in_scoreboard ?? false,
    teams: opts.teams ?? null,
  };
  ctx.diagnostics.push(entry);
  console.log(
    `[GradePicks][skipped] pick_id=${entry.pick_id} sport=${entry.sport} ` +
      `player=${entry.player_name ?? ""} prop_type=${entry.prop_type ?? ""} ` +
      `dir=${entry.direction ?? ""} line=${entry.line ?? ""} ` +
      `date_used=${entry.date_used ?? ""} reason=${entry.reason} ` +
      `espn_state=${entry.espn_state ?? ""} teams=${entry.teams ?? ""}`,
  );
}

function isPlayerProp(pick: Pick): boolean {
  const betType = (pick.bet_type || "").toLowerCase();
  if (["moneyline", "spread", "total", "over_under"].includes(betType)) return false;
  if (betType === "prop") return true;
  // Fall back: treat picks with player_name + prop_type as props.
  return !!(pick.player_name && pick.prop_type);
}

async function gradeBasketballSportProps(
  supabase: ReturnType<typeof createClient>,
  sport: "nba" | "wnba",
  picks: Pick[],
  ctx: GradeCtx,
): Promise<{ graded: number; skippedNoData: number }> {
  const byDate: Record<string, Pick[]> = {};
  for (const pick of picks) {
    const primaryDate = gradingDatesForPick(pick)[0];
    (byDate[primaryDate] ||= []).push(pick);
  }
  let graded = 0;
  let skippedNoData = 0;
  for (const [date, datePicks] of Object.entries(byDate)) {
    const result = await gradeBasketballProps(supabase, sport, datePicks, date, ctx);
    graded += result.graded;
    skippedNoData += result.skippedNoData;
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

  console.log(`[grade-picks] request received | method=${req.method}`);

  // Auth: service-role bearer (cron + admin-onboarding proxy) OR
  // GRADE_PICKS_SECRET (manual invoke). Never publicly callable.
  const authHeader = req.headers.get("authorization") ?? "";
  const xSecret = req.headers.get("x-grade-picks-secret") ?? "";
  const gradeSecret = Deno.env.get("GRADE_PICKS_SECRET") ?? "";
  const viaServiceRole = !!serviceKey && authHeader === `Bearer ${serviceKey}`;
  const viaGradeSecret = !!gradeSecret && (xSecret === gradeSecret || authHeader === `Bearer ${gradeSecret}`);
  const authOk = viaServiceRole || viaGradeSecret;

  console.log(
    `[grade-picks] auth check` +
    ` | has_service_key=${!!serviceKey}` +
    ` | has_grade_secret=${!!gradeSecret}` +
    ` | auth_header_present=${authHeader.length > 0}` +
    ` | x_secret_present=${xSecret.length > 0}` +
    ` | via_service_role=${viaServiceRole}` +
    ` | via_grade_secret=${viaGradeSecret}` +
    ` | ok=${authOk}`,
  );

  if (!authOk) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        reason: "missing service role bearer or grade secret",
        hint: "pass Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> and apikey: <key>",
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // Optional body:
    //   { force_regrade?, pick_ids?, pick_date?, start_date?, end_date?,
    //     sport?, tier?, dry_run? }
    // force_regrade ONLY widens the candidate set — it NEVER overrides the
    // result-null-or-pending filter, so already-graded hit/miss/push rows can
    // never be retroactively changed. Default cron path (no body) is unchanged.
    let body: {
      force_regrade?: boolean;
      pick_ids?: unknown;
      pick_date?: unknown;
      start_date?: unknown;
      end_date?: unknown;
      sport?: unknown;
      tier?: unknown;
      dry_run?: unknown;
    } = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const forceRegrade = body?.force_regrade === true;
    const dryRun = body?.dry_run === true;
    const forcePickIds = Array.isArray(body?.pick_ids)
      ? (body!.pick_ids as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const forcePickDate = typeof body?.pick_date === "string" ? body!.pick_date as string : null;
    const startDate = typeof body?.start_date === "string" ? body!.start_date as string : null;
    const endDate = typeof body?.end_date === "string" ? body!.end_date as string : null;
    const sportFilter = typeof body?.sport === "string" ? body!.sport as string : null;
    const tierFilter = typeof body?.tier === "string" ? body!.tier as string : null;

    // 3-day lookback by default; widen to start/end if provided, capped at 14d.
    const defaultCutoff = ymd(new Date(Date.now() - 3 * 86400000));
    // Only the result-pending filter stays at SQL level — it's the INVARIANT
    // that protects already-graded rows from being overwritten. Status/tier
    // exclusions are done in JS below: chained .or()s in supabase-js can
    // mis-render in PostgREST, AND .neq() in SQL silently excludes NULL rows
    // (NULL <> 'x' is NULL, not true), so they'd drop most of our pending set.
    //
    // Narrow column list + hard limit avoid statement timeouts caused by
    // pulling the model_diagnostics jsonb for every pending row.
    const GRADE_COLUMNS = [
      "id", "sport", "pick_date", "created_at", "commence_time", "game_date",
      "home_team", "away_team", "team", "opponent",
      "player_name", "prop_type", "line", "direction",
      "bet_type", "spread_line", "total_line",
      "event_id", "odds", "opening_odds", "opening_line", "opening_captured_at",
      "selected_book", "stake_units",
      "result", "tier", "status", "avg_value", "model_diagnostics",
    ].join(",");

    const MAX_PICKS_PER_RUN = 500;

    let query = supabase
      .from("daily_picks")
      .select(GRADE_COLUMNS)
      .or("result.is.null,result.eq.pending")
      .order("pick_date", { ascending: false })
      .limit(MAX_PICKS_PER_RUN);

    if (forcePickIds.length > 0) {
      query = query.in("id", forcePickIds);
    } else if (forceRegrade && forcePickDate) {
      query = query.eq("pick_date", forcePickDate);
    } else if (startDate || endDate) {
      // Cap window at 14 days to avoid all-time scans.
      const start = startDate ?? ymd(new Date(Date.now() - 14 * 86400000));
      const end = endDate ?? ymd(new Date());
      const startMs = new Date(start + "T00:00:00Z").getTime();
      const endMs = new Date(end + "T00:00:00Z").getTime();
      const capped =
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs > 14 * 86400000
          ? ymd(new Date(endMs - 14 * 86400000))
          : start;
      query = query.gte("pick_date", capped).lte("pick_date", end);
    } else {
      query = query.gte("pick_date", defaultCutoff);
    }

    if (sportFilter) query = query.eq("sport", sportFilter.toLowerCase());
    if (tierFilter) query = query.eq("tier", tierFilter.toLowerCase());

    const { data: rawPicks, error: queryErr } = await query;
    if (queryErr) {
      console.error(`[grade-picks] query failed`, queryErr);
      return new Response(
        JSON.stringify({ error: "query failed", reason: queryErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // JS-side filter for status/tier — Postgres .neq() silently excludes NULL
    // rows, and most picks have NULL status, so doing this at the SQL layer
    // dropped 100% of the pending set.
    const picks = (rawPicks ?? []).filter((p: any) => {
      const status = String(p.status ?? "").toLowerCase().trim();
      const tier = String(p.tier ?? "").toLowerCase().trim();
      if (status === "empty_slate") return false;
      if (tier === "_pending") return false;
      return true;
    });

    console.log(
      `[grade-picks] query returned ${rawPicks?.length ?? 0} rows, ${picks.length} after status/tier filter`,
    );

    if (!picks || picks.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No pending picks to grade",
          scanned: 0,
          graded: 0,
          skipped: 0,
          hits: 0,
          misses: 0,
          pushes: 0,
          update_failed_count: 0,
          by_sport: {},
          sample_graded: [],
          sample_skipped: [],
          dry_run: dryRun,
          force_regrade: forceRegrade,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Shared accumulator threaded into every per-sport grader.
    const ctx: GradeCtx = {
      diagnostics: [],
      finalGamesFound: new Set<string>(),
      updateFailedCount: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      sampleGraded: [],
      dryRun,
    };

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
        const r1 = await gradeBasketballProps(supabase, "nba", stillPending, date, ctx);
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
            const r2 = await gradeBasketballProps(supabase, "nba", ndPicks, nd, ctx);
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
    const wnbaProps = (bySport.wnba ?? []).filter(isPlayerProp);
    if (wnbaProps.length > 0) {
      const wnbaResult = await gradeBasketballSportProps(
        supabase,
        "wnba",
        wnbaProps,
        ctx,
      );
      totalGraded += wnbaResult.graded;
      skippedNoData += wnbaResult.skippedNoData;
      sportSummary.wnba = {
        total: bySport.wnba.length,
        graded: wnbaResult.graded,
        skipped_no_data: wnbaResult.skippedNoData,
        props: wnbaProps.length,
        game_bets: 0,
      };
    }

    // WNBA props are graded above through the league-specific basketball
    // endpoint. Its game markets share the generic scoreboard grader.
    for (const sport of ["mlb", "nhl", "wnba"] as const) {
      const sportPicks = bySport[sport];
      if (!sportPicks?.length) continue;

      const props = sport === "wnba" ? [] : sportPicks.filter(isPlayerProp);
      const games = sportPicks.filter((p) => !isPlayerProp(p));

      let propCounters = emptyCounters();
      if (props.length > 0 && sport !== "wnba") {
        propCounters = await gradePlayerPropsForSport(
          supabase,
          sport,
          props,
          sport === "mlb" ? getVerifiedMlbPlayerStat : getNhlPlayerStat,
          sport === "mlb" ? VERIFIED_MLB_PROP_TO_STAT : NHL_PROP_TO_STAT,
          ctx,
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
        if (!["moneyline", "spread", "total", "over_under"].includes(betType)) {
          gameUnsupported++;
          recordSkip(ctx, pick, "unsupported_prop", { date_used: gradingDatesForPick(pick)[0] ?? null });
          continue;
        }

        const candidateDates = gradingDatesForPick(pick);

        let graded: "hit" | "miss" | "push" | null = null;
        let foundFinal = false;
        let foundGame: ScoreboardGame | null = null;
        let dateUsed: string | null = null;
        for (const d of candidateDates) {
          const gs = await dateOf(d);
          const g = findGameForPick(pick, gs);
          if (!g) continue;
          foundGame = g;
          dateUsed = d;
          if (!g.final) continue;
          foundFinal = true;
          const r = gradeVerifiedGameBet(pick, g);
          if (r) {
            graded = r;
          }
          break;
        }

        if (graded && foundGame) {
          ctx.finalGamesFound.add(`${sport}:${foundGame.id}`);
          const betType = (pick.bet_type || "").toLowerCase();
          const storedBetType = betType === "total" ? "over_under" : betType;
          const ok = await writeGrade(
            supabase,
            {
              pick,
              result: graded,
              actualValue: null,
              line:
                betType === "spread" ? Number(pick.spread_line ?? pick.line)
                  : betType === "total" || betType === "over_under"
                    ? Number(pick.total_line ?? pick.line)
                  : null,
              direction: pick.direction ?? null,
              source: `espn:${sport}`,
              sport,
              betType: storedBetType,
            },
            ctx,
          );
          if (!ok) {
            recordSkip(ctx, pick, "update_failed", { date_used: dateUsed });
            continue;
          }
          gameGraded++;
        } else if (foundGame && foundFinal) {
          gameNoData++;
          const direction = String(pick.direction ?? "").toLowerCase();
          const invalidDirection =
            (betType === "total" || betType === "over_under") &&
            direction !== "over" && direction !== "under";
          recordSkip(ctx, pick, invalidDirection ? "invalid_direction" : "no_data", {
            date_used: dateUsed,
            espn_state: foundGame.state ?? null,
            found_in_scoreboard: true,
            teams: `${foundGame.home}@${foundGame.away}`,
          });
        } else if (foundGame) {
          gameNotFinal++;
          recordSkip(ctx, pick, "not_final", {
            date_used: dateUsed,
            espn_state: foundGame.state ?? null,
            found_in_scoreboard: true,
            teams: `${foundGame.home}@${foundGame.away}`,
          });
        } else {
          gameNoData++;
          recordSkip(ctx, pick, "no_event", { date_used: dateUsed });
        }
      }

      totalGraded += propCounters.graded + gameGraded;
      skippedNotFinal += propCounters.skippedNotFinal + gameNotFinal;
      skippedNoData += propCounters.skippedNoData + gameNoData;
      skippedUnsupportedProp += propCounters.skippedUnsupportedProp + gameUnsupported;
      skippedPlayerNotFound += propCounters.skippedPlayerNotFound;
      skippedAmbiguousPlayer += propCounters.skippedAmbiguousPlayer;
      skippedNoEvent += propCounters.skippedNoEvent;

      const priorSportSummary = sportSummary[sport] ?? {};
      sportSummary[sport] = {
        ...priorSportSummary,
        total: sportPicks.length,
        graded: Number(priorSportSummary.graded ?? 0) + propCounters.graded + gameGraded,
        skipped_not_final:
          Number(priorSportSummary.skipped_not_final ?? 0) +
          propCounters.skippedNotFinal + gameNotFinal,
        skipped_no_data:
          Number(priorSportSummary.skipped_no_data ?? 0) +
          propCounters.skippedNoData + gameNoData,
        skipped_unsupported_prop: propCounters.skippedUnsupportedProp + gameUnsupported,
        skipped_player_not_found: propCounters.skippedPlayerNotFound,
        skipped_ambiguous_player: propCounters.skippedAmbiguousPlayer,
        skipped_no_event: propCounters.skippedNoEvent,
        props: sport === "wnba" ? Number(priorSportSummary.props ?? 0) : props.length,
        game_bets: games.length,
      };
    }

    if (bySport.ufc?.length) {
      console.log(
        `[GradePicks] skipping ufc — manual grade only (${bySport.ufc.length} pending)`,
      );
      sportSummary.ufc = { total: bySport.ufc.length, graded: 0, skipped_manual_only: bySport.ufc.length };
    }

    const totalSkipped =
      skippedNotFinal + skippedNoData + skippedUnsupportedProp +
      skippedPlayerNotFound + skippedAmbiguousPlayer + skippedNoEvent;

    const sampleSkipped = ctx.diagnostics.slice(0, 10).map((d) => ({
      pick_id: d.pick_id,
      sport: d.sport,
      reason: d.reason,
      player_name: d.player_name,
      prop_type: d.prop_type,
      date_used: d.date_used,
      espn_state: d.espn_state,
    }));

    const responseBody = {
      message: "Picks graded",
      scanned: picks.length,
      graded: totalGraded,
      skipped: totalSkipped,
      hits: ctx.hits,
      misses: ctx.misses,
      pushes: ctx.pushes,
      update_failed_count: ctx.updateFailedCount,
      by_sport: sportSummary,
      sample_graded: ctx.sampleGraded,
      sample_skipped: sampleSkipped,
      dry_run: dryRun,
      force_regrade: forceRegrade,
      // Legacy fields kept for log-aggregation compatibility.
      total: picks.length,
      bySport: sportSummary,
      metrics: {
        pending_picks_found: picks.length,
        final_games_found: ctx.finalGamesFound.size,
        picks_graded: totalGraded,
        skipped_not_final: skippedNotFinal,
        skipped_no_player_stats: skippedPlayerNotFound + skippedNoData,
        skipped_unknown_prop_type: skippedUnsupportedProp,
        update_failed_count: ctx.updateFailedCount,
        skipped_no_event: skippedNoEvent,
        skipped_ambiguous_player: skippedAmbiguousPlayer,
        by_sport: sportSummary,
        provider_game_status: ctx.diagnostics,
      },
    };

    // Skip-reason rollup keyed by (sport, reason) so a single grep on
    // `[grade-picks] skip_summary` answers "why did N picks not grade?"
    // without scanning every per-pick line.
    const skipBreakdown: Record<string, Record<string, number>> = {};
    for (const d of ctx.diagnostics) {
      const sport = d.sport || "unknown";
      const reason = d.reason || "unknown";
      (skipBreakdown[sport] ||= {})[reason] =
        (skipBreakdown[sport]?.[reason] ?? 0) + 1;
    }
    console.log(
      `[grade-picks] skip_summary ${JSON.stringify(skipBreakdown)}`,
    );

    console.log(
      `[grade-picks] done` +
      ` | scanned=${responseBody.scanned}` +
      ` | graded=${responseBody.graded}` +
      ` | skipped=${responseBody.skipped}` +
      ` | hits=${responseBody.hits}` +
      ` | misses=${responseBody.misses}` +
      ` | pushes=${responseBody.pushes}` +
      ` | update_failed=${responseBody.update_failed_count}` +
      ` | dry_run=${responseBody.dry_run}`,
    );

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
