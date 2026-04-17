import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Snapshot logging — fire and forget ──
async function logSnapshot(payload: Record<string, any>): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("logSnapshot: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return;
    }
    const r = await fetch(`${supabaseUrl}/rest/v1/prediction_snapshots`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error(`logSnapshot insert failed ${r.status}:`, text);
    }
  } catch (e) {
    console.error("logSnapshot failed:", (e as Error).message);
  }
}

// ── ESPN API helpers ──
const ESPN_NBA = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_NCAAB = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
const ESPN_MLB = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const ESPN_NHL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

function getEspnBase(sport: string) {
  if (sport === "ncaab") return ESPN_NCAAB;
  if (sport === "mlb") return ESPN_MLB;
  if (sport === "nhl") return ESPN_NHL;
  return ESPN_NBA;
}

async function fetchJSON(url: string) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "PrimalAnalytics/1.0" },
  });
  if (!resp.ok) throw new Error(`ESPN fetch failed: ${resp.status}`);
  return resp.json();
}

// Common nicknames/aliases for NBA teams
const TEAM_ALIASES: Record<string, string[]> = {
  "ATL": ["hawks", "atlanta", "atl"],
  "BOS": ["celtics", "boston", "bos"],
  "BKN": ["nets", "brooklyn", "bkn"],
  "CHA": ["hornets", "charlotte", "cha"],
  "CHI": ["bulls", "chicago", "chi"],
  "CLE": ["cavaliers", "cavs", "cleveland", "cle"],
  "DAL": ["mavericks", "mavs", "dallas", "dal"],
  "DEN": ["nuggets", "denver", "den"],
  "DET": ["pistons", "detroit", "det"],
  "GS": ["warriors", "golden state", "gsw", "gs", "dubs"],
  "HOU": ["rockets", "houston", "hou"],
  "IND": ["pacers", "indiana", "ind"],
  "LAC": ["clippers", "la clippers", "lac"],
  "LAL": ["lakers", "la lakers", "lal", "los angeles lakers"],
  "MEM": ["grizzlies", "memphis", "mem", "grizz"],
  "MIA": ["heat", "miami", "mia"],
  "MIL": ["bucks", "milwaukee", "mil"],
  "MIN": ["timberwolves", "wolves", "minnesota", "min"],
  "NO": ["pelicans", "new orleans", "nop", "pels"],
  "NY": ["knicks", "new york", "nyk", "ny knicks"],
  "OKC": ["thunder", "oklahoma city", "okc"],
  "ORL": ["magic", "orlando", "orl"],
  "PHI": ["76ers", "sixers", "philadelphia", "philly", "phi"],
  "PHX": ["suns", "phoenix", "phx"],
  "POR": ["trail blazers", "blazers", "portland", "por"],
  "SAC": ["kings", "sacramento", "sac"],
  "SA": ["spurs", "san antonio", "sas"],
  "TOR": ["raptors", "toronto", "tor"],
  "UTAH": ["jazz", "utah", "uta"],
  "WAS": ["wizards", "washington", "wiz", "was"],
};

async function getTeamsList(sport = "nba") {
  const base = getEspnBase(sport);
  const limit = sport === "ncaab" ? 500 : 100;
  const data = await fetchJSON(`${base}/teams?limit=${limit}`);
  const teamsRaw = data.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = teamsRaw.map((t: any) => {
    const abbr = t.team.abbreviation;
    const aliases = (sport === "nba" ? TEAM_ALIASES[abbr] : null) || [];
    return {
      id: t.team.id,
      abbr,
      name: t.team.displayName,
      shortName: t.team.shortDisplayName,
      logo: t.team.logos?.[0]?.href || "",
      record: t.team.record?.items?.[0]?.summary || "",
      color: t.team.color ? `#${t.team.color}` : "#666",
      aliases: [
        t.team.displayName.toLowerCase(),
        t.team.shortDisplayName.toLowerCase(),
        abbr.toLowerCase(),
        ...aliases,
      ],
    };
  });
  return teams;
}

function getSeasonForSport(sport: string, date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  if (sport === "mlb") return year;
  if (sport === "nba" || sport === "nhl" || sport === "ncaab") {
    return month >= 9 ? year + 1 : year;
  }

  return year;
}

async function getTeamSchedule(teamId: string, sport = "nba") {
  const base = getEspnBase(sport);
  const season = getSeasonForSport(sport);
  const previousSeason = season - 1;
  const urls = [
    `${base}/teams/${teamId}/schedule?season=${season}&seasontype=2`,
    `${base}/teams/${teamId}/schedule?season=${season}`,
    `${base}/teams/${teamId}/schedule?season=${previousSeason}&seasontype=2`,
    `${base}/teams/${teamId}/schedule?season=${previousSeason}`,
    `${base}/teams/${teamId}/schedule`,
  ];

  let bestEvents: any[] = [];
  for (const url of urls) {
    try {
      const data = await fetchJSON(url);
      const events = data.events || [];
      if (events.length > bestEvents.length) bestEvents = events;
      if (events.length > 10) return events;
    } catch {
      // try next fallback URL
    }
  }

  return bestEvents;
}

async function getTeamStats(teamId: string, sport = "nba") {
  try {
    const base = getEspnBase(sport);
    const data = await fetchJSON(`${base}/teams/${teamId}/statistics`);
    const stats: Record<string, number> = {};
    const categories = data.results?.stats?.categories || data.statistics?.splits?.categories || [];
    for (const cat of categories) {
      for (const stat of cat.stats || []) {
        stats[stat.name] = stat.value;
      }
    }
    return stats;
  } catch {
    return {};
  }
}

async function getScoreboard(sport = "nba") {
  const base = getEspnBase(sport);
  const data = await fetchJSON(`${base}/scoreboard`);
  return data.events || [];
}

// ── Resolve real scheduled venue (HOME/AWAY for tonight's matchup) ──
async function resolveMatchupVenue(team1Id: string, team2Id: string, sport: string): Promise<{ team1IsHome: boolean; gameDate: string } | null> {
  try {
    const base = getEspnBase(sport);
    const t1 = String(team1Id), t2 = String(team2Id);
    for (let d = 0; d < 3; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
      const data = await fetchJSON(`${base}/scoreboard?dates=${ymd}`).catch(() => null);
      for (const ev of data?.events || []) {
        const comp = ev?.competitions?.[0];
        if (!comp) continue;
        const ids = (comp.competitors || []).map((c: any) => String(c.id || c.team?.id));
        if (ids.includes(t1) && ids.includes(t2)) {
          const home = comp.competitors.find((c: any) => c.homeAway === "home");
          const homeId = String(home?.id || home?.team?.id);
          return { team1IsHome: homeId === t1, gameDate: ev.date };
        }
      }
    }
  } catch (e) {
    console.error("resolveMatchupVenue error:", e);
  }
  return null;
}

// ── Injuries ──
let _injuryCache: Record<string, { data: any[]; ts: number }> = {};

async function getAllInjuries(sport = "nba") {
  const base = getEspnBase(sport);
  if (_injuryCache[sport] && Date.now() - _injuryCache[sport].ts < 300_000) return _injuryCache[sport].data;
  try {
    const data = await fetchJSON(`${base}/injuries`);
    _injuryCache[sport] = { data: data.injuries || [], ts: Date.now() };
    return _injuryCache[sport].data;
  } catch {
    return [];
  }
}

async function getTeamInjuries(teamId: string, sport = "nba") {
  try {
    const allTeams = await getAllInjuries(sport);
    const teamEntry = allTeams.find((t: any) => t.id === teamId);
    if (!teamEntry) return [];
    return (teamEntry.injuries || []).map((inj: any) => ({
      name: inj.athlete?.displayName || "Unknown",
      position: inj.athlete?.position?.abbreviation || "",
      status: inj.status || "Unknown",
      type: inj.shortComment || inj.longComment || "",
      details: inj.longComment || inj.shortComment || "",
    }));
  } catch {
    return [];
  }
}

function getCompetitorId(competitor: any) {
  return String(competitor?.team?.id || competitor?.id || "");
}

function isFinalCompetition(comp: any) {
  return comp?.status?.type?.completed === true || comp?.status?.type?.name === "STATUS_FINAL";
}

// ── Home/Away splits from schedule ──
function computeHomeAwaySplits(events: any[], teamId: string) {
  const teamIdStr = String(teamId);
  let homeW = 0, homeL = 0, awayW = 0, awayL = 0;
  let homePF = 0, homePA = 0, awayPF = 0, awayPA = 0;

  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const isFinal = isFinalCompetition(comp);
    if (!comp || !isFinal) continue;

    const competitors = comp.competitors || [];
    const team = competitors.find((c: any) => getCompetitorId(c) === teamIdStr);
    const opp = competitors.find((c: any) => getCompetitorId(c) && getCompetitorId(c) !== teamIdStr);
    if (!team || !opp) continue;

    const teamScore = parseInt(team.score?.value ?? team.score) || 0;
    const oppScore = parseInt(opp.score?.value ?? opp.score) || 0;
    if (teamScore === 0 && oppScore === 0) continue;

    const isHome = team.homeAway === "home";
    const won = team.winner === true || teamScore > oppScore;

    if (isHome) {
      if (won) homeW++; else homeL++;
      homePF += teamScore;
      homePA += oppScore;
    } else {
      if (won) awayW++; else awayL++;
      awayPF += teamScore;
      awayPA += oppScore;
    }
  }

  const homeGames = homeW + homeL;
  const awayGames = awayW + awayL;

  return {
    home: {
      wins: homeW, losses: homeL, games: homeGames,
      winPct: homeGames > 0 ? homeW / homeGames : 0,
      ppg: homeGames > 0 ? homePF / homeGames : 0,
      oppPpg: homeGames > 0 ? homePA / homeGames : 0,
    },
    away: {
      wins: awayW, losses: awayL, games: awayGames,
      winPct: awayGames > 0 ? awayW / awayGames : 0,
      ppg: awayGames > 0 ? awayPF / awayGames : 0,
      oppPpg: awayGames > 0 ? awayPA / awayGames : 0,
    },
  };
}

// ── Back-to-back detection ──
async function detectBackToBack(events: any[], teamId: string, sport = "nba") {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const sorted = [...events]
    .filter(ev => ev.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let nextGameDate: string | null = null;
  for (const ev of sorted) {
    const evDate = new Date(ev.date).toISOString().slice(0, 10);
    if (evDate >= todayStr) {
      nextGameDate = evDate;
      break;
    }
  }

  if (!nextGameDate) return { isB2B: false, lastGameDate: null, b2bRisk: null as null | "low" | "medium" | "high" };

  const dayBefore = new Date(nextGameDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayBeforeStr = dayBefore.toISOString().slice(0, 10);

  const prevGame = sorted.find(ev => {
    const evDate = new Date(ev.date).toISOString().slice(0, 10);
    return evDate === dayBeforeStr;
  });
  const isB2B = !!prevGame;

  let b2bRisk: "low" | "medium" | "high" | null = null;
  if (isB2B) {
    b2bRisk = "medium"; // default
    // Only NBA tracks starter minutes meaningfully via boxscore
    if (sport === "nba" && prevGame?.id) {
      try {
        const base = getEspnBase(sport);
        const summary = await fetchJSON(`${base}/summary?event=${prevGame.id}`);
        const boxTeams = summary?.boxscore?.players || [];
        const teamBox = boxTeams.find((t: any) => String(t?.team?.id) === String(teamId));
        const athletes = teamBox?.statistics?.[0]?.athletes || [];
        const labels: string[] = teamBox?.statistics?.[0]?.labels || [];
        const minIdx = labels.findIndex(l => /^min$/i.test(l));
        let heavyStarters = 0;
        for (const a of athletes) {
          if (!a?.starter) continue;
          const mins = parseInt(a?.stats?.[minIdx >= 0 ? minIdx : 0] ?? "0") || 0;
          if (mins > 35) heavyStarters++;
        }
        if (heavyStarters >= 3) b2bRisk = "high";
        else if (heavyStarters >= 1) b2bRisk = "medium";
        else b2bRisk = "low";
      } catch (_e) {
        // keep default medium
      }
    }
  }

  return { isB2B, lastGameDate: dayBeforeStr, nextGameDate, b2bRisk };
}

// ── Pace of play ──
function computePace(stats: Record<string, number>, events: any[], teamId: string) {
  const teamIdStr = String(teamId);
  const pace = stats.pace || stats.possessions || 0;

  const completed = events
    .filter(ev => isFinalCompetition(ev.competitions?.[0]))
    .slice(-10);

  let totalPF = 0, totalPA = 0, gameCount = 0;
  for (const ev of completed) {
    const comp = ev.competitions?.[0];
    const team = comp?.competitors?.find((c: any) => getCompetitorId(c) === teamIdStr);
    const opp = comp?.competitors?.find((c: any) => getCompetitorId(c) && getCompetitorId(c) !== teamIdStr);
    if (!team || !opp) continue;
    const ts = parseInt(team.score?.value ?? team.score) || 0;
    const os = parseInt(opp.score?.value ?? opp.score) || 0;
    if (ts === 0 && os === 0) continue;
    totalPF += ts;
    totalPA += os;
    gameCount++;
  }

  const recentPpg = gameCount > 0 ? totalPF / gameCount : 0;
  const recentOppPpg = gameCount > 0 ? totalPA / gameCount : 0;
  const estimatedPace = pace || (recentPpg > 0 ? Math.round((recentPpg + recentOppPpg) / 2.1) : 0);

  return {
    pace: estimatedPace,
    recentPpg: Math.round(recentPpg * 10) / 10,
    recentOppPpg: Math.round(recentOppPpg * 10) / 10,
    recentGames: gameCount,
  };
}

async function getHeadToHead(team1Id: string, team2Id: string, sport = "nba") {
  try {
    const events = await getTeamSchedule(team1Id, sport);
    const h2h = extractH2HFromEvents(events, team1Id, team2Id, sport);

    // Fallback to previous season if no H2H found
    if (h2h.length === 0) {
      try {
        const base = getEspnBase(sport);
        const prevSeason = getSeasonForSport(sport) - 1;
        const prevData = await fetchJSON(`${base}/teams/${team1Id}/schedule?season=${prevSeason}&seasontype=2`);
        const prevEvents = prevData.events || [];
        const prevH2H = extractH2HFromEvents(prevEvents, team1Id, team2Id, sport);
        return prevH2H;
      } catch {
        return [];
      }
    }
    return h2h;
  } catch {
    return [];
  }
}

function extractH2HFromEvents(events: any[], team1Id: string, team2Id: string, sport: string) {
  const team1IdStr = String(team1Id);
  const team2IdStr = String(team2Id);
  const h2h: any[] = [];

  for (const ev of events) {
    const comps = ev.competitions?.[0];
    if (!comps) continue;

    const teams = comps.competitors || [];
    const isMatchup = teams.some((t: any) => getCompetitorId(t) === team2IdStr);
    if (!isMatchup) continue;

    const isFinalH2H = isFinalCompetition(comps);
    if (!isFinalH2H) continue;

    const t1 = teams.find((t: any) => getCompetitorId(t) === team1IdStr);
    const t2 = teams.find((t: any) => getCompetitorId(t) === team2IdStr);
    if (!t1 || !t2) continue;

    const t1Score = parseInt(t1.score?.value ?? t1.score) || 0;
    const t2Score = parseInt(t2.score?.value ?? t2.score) || 0;

    let finalT1 = t1Score;
    let finalT2 = t2Score;
    if (t1Score === 0 && t2Score === 0) {
      try {
        const base = getEspnBase(sport);
        void base;
        // Synchronous fallback not possible here, skip detail fetch for extracted helper
      } catch {}
    }

    h2h.push({
      date: ev.date,
      name: ev.name || ev.shortName,
      team1_score: finalT1,
      team2_score: finalT2,
      team1_winner: t1.winner === true,
      team2_winner: t2.winner === true,
      venue: comps.venue?.fullName || "",
    });
  }

  return h2h;
}

function resolveTeam(teams: any[], input: string) {
  const q = input.toLowerCase().trim();
  // 1. Exact abbreviation match first (prevents "SA" matching Sacramento before San Antonio)
  const exactAbbr = teams.find((t: any) => t.abbr.toLowerCase() === q);
  if (exactAbbr) return exactAbbr;
  // 2. Exact alias match
  const aliasMatch = teams.find((t: any) => t.aliases?.some((a: string) => a.toLowerCase() === q));
  if (aliasMatch) return aliasMatch;
  // 3. Exact name/shortName match
  const exactName = teams.find((t: any) =>
    t.name.toLowerCase() === q || t.shortName.toLowerCase() === q
  );
  if (exactName) return exactName;
  // 4. Fuzzy includes match (fallback)
  return teams.find((t: any) =>
    t.name.toLowerCase().includes(q) ||
    t.shortName.toLowerCase().includes(q)
  );
}

// ── Factor-to-insight helper ──
interface Factor {
  label: string;
  team1Score: number;
  team2Score: number;
  weight: number;
}

function factorToInsight(f: Factor, team1Name: string, team2Name: string): string {
  const diff = f.team1Score - f.team2Score;
  const favored = diff > 0 ? team1Name : team2Name;
  const absDiff = Math.abs(diff);
  if (absDiff < 3) return `${f.label} is essentially even between both teams.`;
  const strength = absDiff >= 25 ? "strongly" : absDiff >= 12 ? "notably" : "slightly";
  return `${f.label} ${strength} favors ${favored}.`;
}

// ── 20-Factor NBA Analysis Engine ──

function analyzeMoneyline(
  team1: any, team2: any, h2h: any[],
  team1Stats: any, team2Stats: any,
  extras: { injuries1: any[]; injuries2: any[]; splits1: any; splits2: any; b2b1: any; b2b2: any; pace1: any; pace2: any }
) {
  const factors: string[] = [];
  const factorBreakdown: Factor[] = [];

  function addFactor(label: string, t1: number, t2: number, weight: number, desc: string) {
    factorBreakdown.push({ label, team1Score: t1, team2Score: t2, weight });
    factors.push(desc);
  }

  // Parse records
  const t1Record = team1.record || "";
  const t2Record = team2.record || "";
  const [t1w, t1l] = t1Record.split("-").map(Number);
  const [t2w, t2l] = t2Record.split("-").map(Number);
  const t1pct = !isNaN(t1w) && !isNaN(t1l) ? t1w / (t1w + t1l) : 0.5;
  const t2pct = !isNaN(t2w) && !isNaN(t2l) ? t2w / (t2w + t2l) : 0.5;

  // Factor 1: Overall Win Rate (8%)
  addFactor("Overall Win Rate", Math.round(t1pct * 100), Math.round(t2pct * 100), 8,
    `${team1.shortName} is ${t1w}-${t1l} (${(t1pct * 100).toFixed(1)}%) vs ${team2.shortName} at ${t2w}-${t2l} (${(t2pct * 100).toFixed(1)}%)`);

  // Factor 2: Head-to-Head Record (7%)
  const t1Wins = h2h.filter(g => g.team1_winner).length;
  const t2Wins = h2h.filter(g => g.team2_winner).length;
  const h2hPct1 = h2h.length > 0 ? Math.round((t1Wins / h2h.length) * 100) : 50;
  addFactor("Head-to-Head Record", h2hPct1, 100 - h2hPct1, 7,
    h2h.length > 0 ? `H2H this season: ${team1.shortName} ${t1Wins}-${t2Wins} ${team2.shortName} (${h2h.length} meetings)` : "No head-to-head meetings found this season");

  // Factor 3: Average Score Differential in H2H (5%)
  const avgDiff = h2h.length > 0 ? h2h.reduce((acc, g) => acc + (g.team1_score - g.team2_score), 0) / h2h.length : 0;
  addFactor("H2H Score Differential", avgDiff > 0 ? 65 : avgDiff < 0 ? 35 : 50, avgDiff > 0 ? 35 : avgDiff < 0 ? 65 : 50, 5,
    h2h.length > 0 ? `Average score diff in matchups: ${avgDiff > 0 ? "+" : ""}${avgDiff.toFixed(1)} for ${avgDiff > 0 ? team1.shortName : team2.shortName}` : "No H2H data for differential");

  // Factor 4: Points Per Game (6%)
  const t1ppg = team1Stats.avgPoints || team1Stats.pointsPerGame || 0;
  const t2ppg = team2Stats.avgPoints || team2Stats.pointsPerGame || 0;
  const ppgScore1 = t1ppg && t2ppg ? Math.round((t1ppg / (t1ppg + t2ppg)) * 100) : 50;
  addFactor("Points Per Game", ppgScore1, 100 - ppgScore1, 6,
    t1ppg && t2ppg ? `${team1.shortName} averages ${t1ppg.toFixed(1)} PPG vs ${team2.shortName} at ${t2ppg.toFixed(1)} PPG` : "PPG data unavailable");

  // Factor 5: Recent Form (L10) (7%)
  const rf1 = extras.pace1.recentPpg - extras.pace1.recentOppPpg;
  const rf2 = extras.pace2.recentPpg - extras.pace2.recentOppPpg;
  const rfScore1 = rf1 !== 0 || rf2 !== 0 ? Math.max(20, Math.min(80, 50 + (rf1 - rf2) * 2)) : 50;
  addFactor("Recent Form (L10 Net)", Math.round(rfScore1), Math.round(100 - rfScore1), 7,
    `${team1.shortName} recent: ${extras.pace1.recentPpg} PPG, ${extras.pace1.recentOppPpg} opp | ${team2.shortName}: ${extras.pace2.recentPpg} PPG, ${extras.pace2.recentOppPpg} opp`);

  // Factor 6: Home/Away Splits (6%)
  const homeAdv1 = extras.splits1.home.winPct;
  const awayAdv2 = extras.splits2.away.winPct;
  const splitsScore1 = homeAdv1 > 0 || awayAdv2 > 0 ? Math.round(Math.max(20, Math.min(80, 50 + (homeAdv1 - awayAdv2) * 40))) : 50;
  addFactor("Home/Away Splits", splitsScore1, 100 - splitsScore1, 6,
    `🏠 ${team1.shortName} ${extras.splits1.home.wins}-${extras.splits1.home.losses} at home (${(homeAdv1 * 100).toFixed(0)}%), ${team2.shortName} ${extras.splits2.away.wins}-${extras.splits2.away.losses} on road (${(awayAdv2 * 100).toFixed(0)}%)`);

  // Factor 7: Injuries Impact (8%)
  const majorStatuses = ["out", "doubtful"];
  const impactful1 = extras.injuries1.filter(i => majorStatuses.includes(i.status?.toLowerCase()));
  const impactful2 = extras.injuries2.filter(i => majorStatuses.includes(i.status?.toLowerCase()));
  const injScore = Math.max(15, Math.min(85, 50 + (impactful2.length - impactful1.length) * 8));
  addFactor("Injury Impact", Math.round(injScore), Math.round(100 - injScore), 8, (() => {
    const parts: string[] = [];
    if (impactful1.length > 0) parts.push(`🚨 ${team1.shortName} OUT/Doubtful (${impactful1.length}): ${impactful1.map(i => `${i.name} (${i.position})`).join(", ")}`);
    if (impactful2.length > 0) parts.push(`🚨 ${team2.shortName} OUT/Doubtful (${impactful2.length}): ${impactful2.map(i => `${i.name} (${i.position})`).join(", ")}`);
    return parts.length > 0 ? parts.join(" | ") : "Both teams relatively healthy";
  })());

  // Factor 8: Back-to-Back (4%)
  const b2bScore = extras.b2b1.isB2B && !extras.b2b2.isB2B ? 35 : extras.b2b2.isB2B && !extras.b2b1.isB2B ? 65 : 50;
  addFactor("Back-to-Back Fatigue", b2bScore, 100 - b2bScore, 4,
    extras.b2b1.isB2B && !extras.b2b2.isB2B ? `😴 ${team1.shortName} on B2B — fatigue favors ${team2.shortName}` :
    extras.b2b2.isB2B && !extras.b2b1.isB2B ? `😴 ${team2.shortName} on B2B — fatigue favors ${team1.shortName}` :
    extras.b2b1.isB2B && extras.b2b2.isB2B ? "Both on B2B — neutral" : "Neither team on B2B");

  // Factor 9: Pace of Play (4%)
  const paceAdv = extras.pace1.pace > 0 && extras.pace2.pace > 0 ? Math.max(30, Math.min(70, 50 + (extras.pace1.pace - extras.pace2.pace) * 0.5)) : 50;
  addFactor("Pace of Play", Math.round(paceAdv), Math.round(100 - paceAdv), 4,
    extras.pace1.pace > 0 && extras.pace2.pace > 0 ? `⚡ ${team1.shortName} ~${extras.pace1.pace} poss vs ${team2.shortName} ~${extras.pace2.pace} poss` : "Pace data unavailable");

  // Factor 10: Recent H2H Momentum (5%)
  const recentH2H = h2h.slice(0, 3);
  const recentT1Wins = recentH2H.filter(g => g.team1_winner).length;
  const momentumScore = recentH2H.length > 0 ? Math.round(Math.max(25, Math.min(75, 50 + (recentT1Wins - (recentH2H.length - recentT1Wins)) * 10))) : 50;
  addFactor("Recent H2H Momentum", momentumScore, 100 - momentumScore, 5,
    recentH2H.length > 0 ? `Last ${recentH2H.length} meetings: ${team1.shortName} won ${recentT1Wins}` : "No recent meetings");

  // Factor 11: Offensive Rating (5%)
  const oRtg1 = team1Stats.offensiveRating || team1Stats.offRating || t1ppg || 0;
  const oRtg2 = team2Stats.offensiveRating || team2Stats.offRating || t2ppg || 0;
  const oRtgScore = oRtg1 + oRtg2 > 0 ? Math.round((oRtg1 / (oRtg1 + oRtg2)) * 100) : 50;
  addFactor("Offensive Rating", oRtgScore, 100 - oRtgScore, 5,
    `${team1.shortName} ORtg ~${oRtg1.toFixed(1)} vs ${team2.shortName} ~${oRtg2.toFixed(1)}`);

  // Factor 12: Defensive Rating (5%)
  const dRtg1 = team1Stats.defensiveRating || team1Stats.defRating || extras.pace1.recentOppPpg || 0;
  const dRtg2 = team2Stats.defensiveRating || team2Stats.defRating || extras.pace2.recentOppPpg || 0;
  // Lower defensive rating is better
  const dRtgScore = dRtg1 + dRtg2 > 0 ? Math.round((dRtg2 / (dRtg1 + dRtg2)) * 100) : 50;
  addFactor("Defensive Rating", dRtgScore, 100 - dRtgScore, 5,
    `${team1.shortName} DRtg ~${dRtg1.toFixed(1)} (lower=better) vs ${team2.shortName} ~${dRtg2.toFixed(1)}`);

  // Factor 13: Rebound Rate (3%)
  const reb1 = team1Stats.avgRebounds || team1Stats.reboundsPerGame || 0;
  const reb2 = team2Stats.avgRebounds || team2Stats.reboundsPerGame || 0;
  const rebScore = reb1 + reb2 > 0 ? Math.round((reb1 / (reb1 + reb2)) * 100) : 50;
  addFactor("Rebound Rate", rebScore, 100 - rebScore, 3,
    `${team1.shortName} ${reb1.toFixed(1)} RPG vs ${team2.shortName} ${reb2.toFixed(1)} RPG`);

  // Factor 14: Turnover Differential (3%)
  const tov1 = team1Stats.avgTurnovers || team1Stats.turnoversPerGame || 0;
  const tov2 = team2Stats.avgTurnovers || team2Stats.turnoversPerGame || 0;
  // Fewer turnovers is better
  const tovScore = tov1 + tov2 > 0 ? Math.round((tov2 / (tov1 + tov2)) * 100) : 50;
  addFactor("Turnover Discipline", tovScore, 100 - tovScore, 3,
    `${team1.shortName} ${tov1.toFixed(1)} TOV/G vs ${team2.shortName} ${tov2.toFixed(1)} TOV/G (fewer=better)`);

  // Factor 15: 3-Point Shooting (4%)
  const fg3pct1 = team1Stats.threePointFieldGoalPct || team1Stats.threePointPct || 0;
  const fg3pct2 = team2Stats.threePointFieldGoalPct || team2Stats.threePointPct || 0;
  // ESPN returns percentages as whole numbers (e.g. 35.6), not decimals
  const fg3Display1 = fg3pct1 > 1 ? fg3pct1 : fg3pct1 * 100;
  const fg3Display2 = fg3pct2 > 1 ? fg3pct2 : fg3pct2 * 100;
  const fg3Score = fg3pct1 + fg3pct2 > 0 ? Math.round((fg3pct1 / (fg3pct1 + fg3pct2)) * 100) : 50;
  addFactor("3-Point Shooting", fg3Score, 100 - fg3Score, 4,
    `${team1.shortName} ${fg3Display1.toFixed(1)}% 3PT vs ${team2.shortName} ${fg3Display2.toFixed(1)}%`);

  // Factor 16: Free Throw Rate (3%)
  const ftpct1 = team1Stats.freeThrowPct || 0;
  const ftpct2 = team2Stats.freeThrowPct || 0;
  const ftDisplay1 = ftpct1 > 1 ? ftpct1 : ftpct1 * 100;
  const ftDisplay2 = ftpct2 > 1 ? ftpct2 : ftpct2 * 100;
  const ftScore = ftpct1 + ftpct2 > 0 ? Math.round((ftpct1 / (ftpct1 + ftpct2)) * 100) : 50;
  addFactor("Free Throw Shooting", ftScore, 100 - ftScore, 3,
    `${team1.shortName} ${ftDisplay1.toFixed(1)}% FT vs ${team2.shortName} ${ftDisplay2.toFixed(1)}%`);

  // Factor 17: Assists Per Game (3%)
  const ast1 = team1Stats.avgAssists || team1Stats.assistsPerGame || 0;
  const ast2 = team2Stats.avgAssists || team2Stats.assistsPerGame || 0;
  const astScore = ast1 + ast2 > 0 ? Math.round((ast1 / (ast1 + ast2)) * 100) : 50;
  addFactor("Ball Movement (AST/G)", astScore, 100 - astScore, 3,
    `${team1.shortName} ${ast1.toFixed(1)} AST/G vs ${team2.shortName} ${ast2.toFixed(1)} AST/G`);

  // Factor 18: Day-to-Day Injuries (3%)
  const dtd1 = extras.injuries1.filter(i => i.status?.toLowerCase() === "day-to-day");
  const dtd2 = extras.injuries2.filter(i => i.status?.toLowerCase() === "day-to-day");
  const dtdScore = Math.max(30, Math.min(70, 50 + (dtd2.length - dtd1.length) * 5));
  addFactor("Day-to-Day Uncertainty", dtdScore, 100 - dtdScore, 3,
    `${team1.shortName} ${dtd1.length} DTD | ${team2.shortName} ${dtd2.length} DTD`);

  // Factor 19: Strength of Schedule (3%)
  // Approximate via opponent PPG allowed
  const sos1 = extras.pace1.recentOppPpg > 0 ? Math.max(30, Math.min(70, 50 + (extras.pace1.recentOppPpg - extras.pace2.recentOppPpg) * 0.8)) : 50;
  addFactor("Strength of Schedule", Math.round(sos1), Math.round(100 - sos1), 3,
    `Opponent quality based on recent PPG allowed: ${team1.shortName} face ~${extras.pace1.recentOppPpg} vs ${team2.shortName} ~${extras.pace2.recentOppPpg}`);

  // Factor 20: Home PPG Advantage (2%)
  const homePpg1 = extras.splits1.home.ppg;
  const awayPpg2 = extras.splits2.away.ppg;
  const hpScore = homePpg1 + awayPpg2 > 0 ? Math.round((homePpg1 / (homePpg1 + awayPpg2)) * 100) : 50;
  addFactor("Home PPG vs Away PPG", hpScore, 100 - hpScore, 2,
    `${team1.shortName} ${homePpg1.toFixed(1)} PPG at home vs ${team2.shortName} ${awayPpg2.toFixed(1)} PPG on road`);

  // Calculate weighted composite
  let team1Score = 0;
  let totalWeight = 0;
  for (const f of factorBreakdown) {
    team1Score += f.team1Score * f.weight;
    totalWeight += f.weight;
  }
  team1Score = Math.max(10, Math.min(90, Math.round(team1Score / totalWeight)));
  const team2Score = 100 - team1Score;

  const verdict =
    team1Score >= 65 ? `STRONG ${team1.shortName}` :
    team1Score >= 55 ? `LEAN ${team1.shortName}` :
    team2Score >= 65 ? `STRONG ${team2.shortName}` :
    team2Score >= 55 ? `LEAN ${team2.shortName}` :
    "TOSS-UP";

  return { team1_pct: team1Score, team2_pct: team2Score, verdict, factors, factorBreakdown };
}

function analyzeSpread(team1: any, team2: any, spreadTeam: string, spreadLine: number, h2h: any[], team1Stats: any, team2Stats: any, extras: any) {
  // Run full 20-factor moneyline model first to get base assessment
  const mlResult = analyzeMoneyline(team1, team2, h2h, team1Stats, team2Stats, extras);
  const factors: string[] = [...mlResult.factors];
  const isTeam1 = spreadTeam.toLowerCase() === team1.abbr.toLowerCase() || spreadTeam.toLowerCase().includes(team1.shortName.toLowerCase());

  // Add spread-specific factors
  let coverCount = 0;
  if (h2h.length > 0) {
    for (const g of h2h) {
      const margin = isTeam1 ? g.team1_score - g.team2_score : g.team2_score - g.team1_score;
      if (margin + spreadLine > 0) coverCount++;
    }
    const coverPct = (coverCount / h2h.length) * 100;
    factors.push(`📐 ${isTeam1 ? team1.shortName : team2.shortName} covers ${spreadLine > 0 ? "+" : ""}${spreadLine} in ${coverCount}/${h2h.length} H2H meetings (${coverPct.toFixed(0)}%)`);
  }

  if (h2h.length > 0) {
    const avgMargin = h2h.reduce((acc: number, g: any) => {
      return acc + (isTeam1 ? g.team1_score - g.team2_score : g.team2_score - g.team1_score);
    }, 0) / h2h.length;
    factors.push(`Average margin for ${isTeam1 ? team1.shortName : team2.shortName}: ${avgMargin > 0 ? "+" : ""}${avgMargin.toFixed(1)}`);
  }

  // Base confidence from the 20-factor model
  const basePct = isTeam1 ? mlResult.team1_pct : mlResult.team2_pct;
  let confidence = basePct;

  // Adjust for actual spread cover rate from H2H
  if (h2h.length > 0) {
    const coverRate = (coverCount / h2h.length) * 100;
    confidence = Math.round(confidence * 0.6 + coverRate * 0.4);
  }

  // B2B adjustment
  const spreadTeamB2B = isTeam1 ? extras.b2b1 : extras.b2b2;
  const oppB2B = isTeam1 ? extras.b2b2 : extras.b2b1;
  if (spreadTeamB2B.isB2B && !oppB2B.isB2B) {
    confidence = Math.max(15, confidence - 5);
    factors.push(`😴 Spread team on B2B — historically teams cover 5-7% less on back-to-backs`);
  }

  // Injury adjustments
  const spreadInjuries = isTeam1 ? extras.injuries1 : extras.injuries2;
  const oppInjuries = isTeam1 ? extras.injuries2 : extras.injuries1;
  const outPlayers = spreadInjuries.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  const oppOutPlayers = oppInjuries.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  
  if (outPlayers.length >= 4) {
    confidence = Math.max(15, confidence - 15);
    factors.push(`💀 Spread team severely depleted (${outPlayers.length} OUT)`);
  } else if (outPlayers.length >= 2) {
    confidence = Math.max(15, confidence - 7);
  }
  if (oppOutPlayers.length >= 6) {
    confidence = Math.min(90, Math.max(confidence, 70) + 10);
    factors.push(`💀 Opponent missing ${oppOutPlayers.length} players — effectively a G-League squad`);
  } else if (oppOutPlayers.length >= 4) {
    confidence = Math.min(90, confidence + 20);
  }

  confidence = Math.max(15, Math.min(90, confidence));

  const verdict =
    confidence >= 65 ? "STRONG COVER" :
    confidence >= 55 ? "LEAN COVER" :
    confidence <= 35 ? "FADE" :
    "TOSS-UP";

  return { confidence, verdict, factors, factorBreakdown: mlResult.factorBreakdown };
}

function analyzeTotal(team1: any, team2: any, totalLine: number, overUnder: string, h2h: any[], team1Stats: any, team2Stats: any, extras: any) {
  // Run full 20-factor model for base context
  const mlResult = analyzeMoneyline(team1, team2, h2h, team1Stats, team2Stats, extras);
  const factors: string[] = [];

  let hitCount = 0;
  const totals: number[] = [];

  if (h2h.length > 0) {
    for (const g of h2h) {
      const total = g.team1_score + g.team2_score;
      totals.push(total);
      if (overUnder === "over" ? total > totalLine : total < totalLine) hitCount++;
    }
    const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
    factors.push(`H2H average combined score: ${avgTotal.toFixed(1)} (line: ${totalLine})`);
    factors.push(`${overUnder.toUpperCase()} ${totalLine} hits in ${hitCount}/${h2h.length} H2H meetings (${((hitCount / h2h.length) * 100).toFixed(0)}%)`);
  }

  const t1ppg = team1Stats.avgPoints || team1Stats.pointsPerGame || 0;
  const t2ppg = team2Stats.avgPoints || team2Stats.pointsPerGame || 0;
  if (t1ppg && t2ppg) {
    const projected = t1ppg + t2ppg;
    factors.push(`Combined PPG projection: ${projected.toFixed(1)} (${team1.shortName}: ${t1ppg.toFixed(1)}, ${team2.shortName}: ${t2ppg.toFixed(1)})`);
    const diff = overUnder === "over" ? projected - totalLine : totalLine - projected;
    if (diff > 10) factors.push("Projection strongly favors the " + overUnder);
    else if (diff > 3) factors.push("Projection slightly favors the " + overUnder);
    else if (diff < -3) factors.push("Projection leans against the " + overUnder);
  }

  if (extras.pace1.pace > 0 && extras.pace2.pace > 0) {
    const avgPace = (extras.pace1.pace + extras.pace2.pace) / 2;
    factors.push(`⚡ Combined pace: ~${avgPace.toFixed(0)} possessions — ${avgPace > 100 ? "fast-paced, favors OVER" : avgPace < 95 ? "slow-paced, favors UNDER" : "average pace"}`);
  }

  if (extras.b2b1.isB2B || extras.b2b2.isB2B) {
    const b2bTeam = extras.b2b1.isB2B ? team1.shortName : team2.shortName;
    factors.push(`😴 ${b2bTeam} on B2B — fatigued teams historically score ~3-5 fewer points`);
  }

  const out1 = extras.injuries1.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  const out2 = extras.injuries2.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  if (out1.length > 0 || out2.length > 0) {
    if (out1.length > 0) factors.push(`🚨 ${team1.shortName} OUT/Doubtful (${out1.length}): ${out1.map((i: any) => `${i.name} (${i.position})`).join(", ")}`);
    if (out2.length > 0) factors.push(`🚨 ${team2.shortName} OUT/Doubtful (${out2.length}): ${out2.map((i: any) => `${i.name} (${i.position})`).join(", ")}`);
    const totalOut = out1.length + out2.length;
    if (totalOut >= 6) factors.push(`💀 Combined ${totalOut} players OUT — depleted rosters historically produce lower-scoring games, favors UNDER`);
  }

  const basePct = h2h.length > 0 ? (hitCount / h2h.length) * 100 : 50;
  const confidence = Math.max(15, Math.min(90, Math.round(basePct)));

  const verdict =
    confidence >= 65 ? `STRONG ${overUnder.toUpperCase()}` :
    confidence >= 55 ? `LEAN ${overUnder.toUpperCase()}` :
    confidence <= 35 ? `LEAN ${overUnder === "over" ? "UNDER" : "OVER"}` :
    "TOSS-UP";

  return { confidence, verdict, factors, totals, factorBreakdown: mlResult.factorBreakdown };
}

// ── Odds API: fetch live odds for any sport ──
const SPORT_ODDS_KEYS: Record<string, string> = {
  nba: "basketball_nba",
  ncaab: "basketball_ncaab",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  nfl: "americanfootball_nfl",
};

async function getNextOddsKey(supabase: any): Promise<{ id: string; key: string } | null> {
  const { data, error } = await supabase
    .from("odds_api_keys")
    .select("id, api_key")
    .eq("is_active", true)
    .is("exhausted_at", null)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .single();
  if (!error && data) return { id: data.id, key: data.api_key };
  const envKey = Deno.env.get("ODDS_API_KEY");
  if (envKey) return { id: "env-fallback", key: envKey };
  return null;
}

async function updateOddsKeyUsage(supabase: any, keyId: string, resp: Response) {
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

async function markOddsKeyExhausted(supabase: any, keyId: string, error: string) {
  if (keyId === "env-fallback") return;
  await supabase.from("odds_api_keys").update({
    exhausted_at: new Date().toISOString(),
    last_error: error,
    last_used_at: new Date().toISOString(),
  }).eq("id", keyId);
}

async function fetchOddsWithRotation(supabase: any, url: string, maxRetries = 3): Promise<Response | null> {
  for (let i = 0; i < maxRetries; i++) {
    const keyInfo = await getNextOddsKey(supabase);
    if (!keyInfo) return null;
    const fullUrl = url.replace("__API_KEY__", keyInfo.key);
    const resp = await fetch(fullUrl);
    if (resp.ok) {
      await updateOddsKeyUsage(supabase, keyInfo.id, resp);
      return resp;
    }
    if (resp.status === 401 || resp.status === 403) {
      await markOddsKeyExhausted(supabase, keyInfo.id, `HTTP ${resp.status}`);
      continue;
    }
    return null;
  }
  return null;
}

async function fetchOddsForMatchup(team1Name: string, team2Name: string, sport: string, supabaseClient?: any) {
  try {
    const sb = supabaseClient || createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const sportKey = SPORT_ODDS_KEYS[sport] || SPORT_ODDS_KEYS.nba;
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=__API_KEY__&regions=us,us2&markets=h2h,spreads,totals&oddsFormat=american`;

    const resp = await fetchOddsWithRotation(sb, url);
    if (!resp) return null;
    const events = await resp.json();

    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const t1 = norm(team1Name);
    const t2 = norm(team2Name);

    const matchesTeam = (haystack: string, needle: string) => {
      if (haystack.includes(needle) || needle.includes(haystack)) return true;
      const hWords = haystack.replace(/[^a-z]/g, "");
      const nWords = needle.replace(/[^a-z]/g, "");
      if (hWords.length >= 4 && nWords.length >= 4) {
        return hWords.endsWith(nWords.slice(-Math.min(nWords.length, 8))) || 
               nWords.endsWith(hWords.slice(-Math.min(hWords.length, 8)));
      }
      return false;
    };

    const match = events.find((e: any) => {
      const h = norm(e.home_team || "");
      const a = norm(e.away_team || "");
      return (matchesTeam(h, t1) && matchesTeam(a, t2)) ||
             (matchesTeam(h, t2) && matchesTeam(a, t1));
    });

    if (!match) return null;

    const result: Record<string, any[]> = {};
    for (const bm of match.bookmakers || []) {
      for (const mkt of bm.markets || []) {
        if (!result[mkt.key]) result[mkt.key] = [];
        for (const o of mkt.outcomes || []) {
          result[mkt.key].push({ ...o, book: bm.title, bookKey: bm.key });
        }
      }
    }
    return result;
  } catch { return null; }
}

function americanToDecimal(american: number): number {
  if (american > 0) return +(american / 100 + 1).toFixed(4);
  return +(100 / Math.abs(american) + 1).toFixed(4);
}

function computeEV(modelConfidence: number, bestOddsAmerican: number): number {
  const impliedProb = modelConfidence / 100;
  const decimalOdds = americanToDecimal(bestOddsAmerican);
  return +((impliedProb * decimalOdds - 1) * 100).toFixed(2);
}

function buildOddsPayload(
  oddsData: Record<string, any[]> | null,
  betType: string,
  modelConfidence: number,
  team1Name: string,
  team2Name: string,
  overUnder?: string,
) {
  if (!oddsData) return null;

  const marketKey = betType === "moneyline" ? "h2h" : betType === "spread" ? "spreads" : "totals";
  const entries = oddsData[marketKey] || [];
  if (entries.length === 0) return null;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const t1n = norm(team1Name);

  // Determine which side is the model's pick
  const matchName = (entryName: string, teamName: string) => {
    const n = norm(entryName);
    const t = norm(teamName);
    return n.includes(t) || t.includes(n) || 
           (n.length >= 4 && t.length >= 4 && (n.endsWith(t.slice(-Math.min(t.length, 8))) || t.endsWith(n.slice(-Math.min(n.length, 8)))));
  };

  let pickEntries: any[];
  if (marketKey === "totals") {
    pickEntries = entries.filter((e: any) => norm(e.name) === (overUnder || "over"));
  } else {
    // For h2h/spreads, pick = team1 (the team the model confidence refers to)
    pickEntries = entries.filter((e: any) => matchName(e.name, team1Name));
    // If model says team2 is stronger (confidence < 50), flip
    if (modelConfidence < 50) {
      pickEntries = entries.filter((e: any) => matchName(e.name, team2Name));
    }
  }

  if (pickEntries.length === 0) pickEntries = entries;

  // Find best odds (highest american odds = best payout)
  let best = pickEntries[0];
  for (const e of pickEntries) {
    if ((e.price || 0) > (best.price || 0)) best = e;
  }

  const bestOdds = best.price || -110;
  const effectiveConf = betType === "moneyline" ? Math.max(modelConfidence, 100 - modelConfidence) : modelConfidence;
  const ev = computeEV(effectiveConf, bestOdds);

  // Get all unique books for this side
  const allBooks = pickEntries.map((e: any) => ({
    book: e.book,
    bookKey: e.bookKey,
    odds: e.price,
    point: e.point,
  }));

  // Deduplicate by book
  const seenBooks = new Set<string>();
  const uniqueBooks = allBooks.filter((b: any) => {
    if (seenBooks.has(b.bookKey)) return false;
    seenBooks.add(b.bookKey);
    return true;
  }).sort((a: any, b: any) => b.odds - a.odds);

  return {
    market: marketKey,
    bestLine: { book: best.book, odds: bestOdds, point: best.point },
    impliedProb: effectiveConf,
    ev,
    allBooks: uniqueBooks.slice(0, 8),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  try {
    if (path === "teams" && (req.method === "GET" || req.method === "POST")) {
      let sport = "nba";
      if (req.method === "POST") {
        try { const b = await req.json(); sport = b.sport || "nba"; } catch {}
      } else {
        sport = url.searchParams.get("sport") || "nba";
      }
      const teams = await getTeamsList(sport);
      return json(teams);
    }

    if (path === "scoreboard" && req.method === "GET") {
      const sport = url.searchParams.get("sport") || "nba";
      const events = await getScoreboard(sport);
      return json(events);
    }

    if (path === "analyze" && req.method === "POST") {
      const body = await req.json();
      const { bet_type, team1: t1Input, team2: t2Input, spread_team, spread_line, total_line, over_under, sport: reqSport } = body;
      const sport = reqSport || "nba";

      if (!t1Input || !t2Input) return json({ error: "Both teams are required" }, 400);
      if (!bet_type) return json({ error: "bet_type is required (moneyline|spread|total)" }, 400);

      const teams = await getTeamsList(sport);
      const team1 = resolveTeam(teams, t1Input);
      const team2 = resolveTeam(teams, t2Input);

      if (!team1) return json({ error: `Team not found: ${t1Input}` }, 400);
      if (!team2) return json({ error: `Team not found: ${t2Input}` }, 400);

      // Resolve real scheduled venue (which team is HOME tonight) — never guess
      const venue = await resolveMatchupVenue(team1.id, team2.id, sport);
      const team1HomeAway: "home" | "away" | null = venue ? (venue.team1IsHome ? "home" : "away") : null;
      const team2HomeAway: "home" | "away" | null = venue ? (venue.team1IsHome ? "away" : "home") : null;

      const [h2h, team1Stats, team2Stats, injuries1, injuries2, schedule1, schedule2] = await Promise.all([
        getHeadToHead(team1.id, team2.id, sport),
        getTeamStats(team1.id, sport),
        getTeamStats(team2.id, sport),
        getTeamInjuries(team1.id, sport),
        getTeamInjuries(team2.id, sport),
        getTeamSchedule(team1.id, sport),
        getTeamSchedule(team2.id, sport),
      ]);

      const splits1 = computeHomeAwaySplits(schedule1, team1.id);
      const splits2 = computeHomeAwaySplits(schedule2, team2.id);
      const [b2b1, b2b2] = await Promise.all([
        detectBackToBack(schedule1, team1.id, sport),
        detectBackToBack(schedule2, team2.id, sport),
      ]);
      const pace1 = computePace(team1Stats, schedule1, team1.id);
      const pace2 = computePace(team2Stats, schedule2, team2.id);

      const extras = { injuries1, injuries2, splits1, splits2, b2b1, b2b2, pace1, pace2 };

      // Fetch live odds for all sports (using rotating key pool)
      const masterUrl = Deno.env.get("MASTER_SUPABASE_URL");
      const masterKey = Deno.env.get("MASTER_SUPABASE_SERVICE_KEY");
      const oddsDb = (masterUrl && masterKey)
        ? createClient(masterUrl, masterKey)
        : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const oddsData = await fetchOddsForMatchup(team1.name, team2.name, sport, oddsDb);

      // MLB: delegate to 20-factor model for superior analysis
      if (sport === "mlb") {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          try {
            const mlbBetType = bet_type === "spread" ? "runline" : bet_type;
            const mlbResp = await fetch(`${supabaseUrl}/functions/v1/mlb-model/analyze`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
              body: JSON.stringify({
                team1_id: team1.id,
                team2_id: team2.id,
                bet_type: mlbBetType,
                over_under,
              }),
            });

            if (mlbResp.ok) {
              const mlbResult = await mlbResp.json();
              const factors: string[] = [];
              for (const w of mlbResult.injuries?.warnings || []) factors.push(w);
              if (mlbResult.writeup) factors.push(`🤖 ${mlbResult.writeup}`);

              let analysis: any;
              const conf = mlbResult.confidence;
              if (bet_type === "moneyline") {
                analysis = { team1_pct: conf, team2_pct: 100 - conf, verdict: mlbResult.verdict, factors };
              } else {
                analysis = { confidence: conf, verdict: mlbResult.verdict, factors };
              }

              const odds = buildOddsPayload(oddsData, bet_type, conf, team1.name, team2.name, over_under);

              return json({
                bet_type, sport, model: "mlb-20-factor",
                team1: { ...team1, stats: team1Stats },
                team2: { ...team2, stats: team2Stats },
                head_to_head: h2h,
                injuries: { team1: injuries1, team2: injuries2 },
                splits: { team1: splits1, team2: splits2 },
                back_to_back: { team1: b2b1, team2: b2b2 },
                pace: { team1: pace1, team2: pace2 },
                factorBreakdown: mlbResult.factorBreakdown,
                writeup: mlbResult.writeup,
                pitchers: mlbResult.pitchers,
                odds,
                ...analysis,
              });
            }
          } catch (e: any) {
            console.error("MLB model delegation failed, falling back to generic:", e.message);
          }
        }
      }

      // NHL: delegate to 20-factor model for superior analysis
      if (sport === "nhl") {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceKey) {
          try {
            const nhlBetType = bet_type === "spread" ? "puckline" : bet_type;
            const nhlResp = await fetch(`${supabaseUrl}/functions/v1/nhl-model/analyze`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
              body: JSON.stringify({
                team1_id: team1.id,
                team2_id: team2.id,
                bet_type: nhlBetType,
                over_under,
              }),
            });

            if (nhlResp.ok) {
              const nhlResult = await nhlResp.json();
              const factors: string[] = [];
              for (const w of nhlResult.injuries?.warnings || []) factors.push(w);
              if (nhlResult.writeup) factors.push(`🤖 ${nhlResult.writeup}`);

              let analysis: any;
              const conf = nhlResult.confidence;
              if (bet_type === "moneyline") {
                analysis = { team1_pct: conf, team2_pct: 100 - conf, verdict: nhlResult.verdict, factors };
              } else {
                analysis = { confidence: conf, verdict: nhlResult.verdict, factors };
              }

              const odds = buildOddsPayload(oddsData, bet_type, conf, team1.name, team2.name, over_under);

              return json({
                bet_type, sport, model: "nhl-20-factor",
                team1: { ...team1, stats: team1Stats },
                team2: { ...team2, stats: team2Stats },
                head_to_head: h2h,
                injuries: { team1: injuries1, team2: injuries2 },
                splits: { team1: splits1, team2: splits2 },
                back_to_back: { team1: b2b1, team2: b2b2 },
                pace: { team1: pace1, team2: pace2 },
                factorBreakdown: nhlResult.factorBreakdown,
                writeup: nhlResult.writeup,
                goalies: nhlResult.goalies,
                context: nhlResult.context,
                odds,
                ...analysis,
              });
            }
          } catch (e: any) {
            console.error("NHL model delegation failed, falling back to generic:", e.message);
          }
        }
      }

      let analysis: any;

      if (bet_type === "moneyline") {
        analysis = analyzeMoneyline(team1, team2, h2h, team1Stats, team2Stats, extras);
      } else if (bet_type === "spread") {
        if (spread_line === undefined) return json({ error: "spread_line is required" }, 400);
        analysis = analyzeSpread(team1, team2, spread_team || t1Input, parseFloat(spread_line), h2h, team1Stats, team2Stats, extras);
      } else if (bet_type === "total") {
        if (!total_line) return json({ error: "total_line is required" }, 400);
        if (!over_under) return json({ error: "over_under is required" }, 400);
        analysis = analyzeTotal(team1, team2, parseFloat(total_line), over_under, h2h, team1Stats, team2Stats, extras);
      } else {
        return json({ error: "Invalid bet_type. Use: moneyline, spread, or total" }, 400);
      }

      // Keep only special emoji-prefixed lines in factors array; factorBreakdown is passed raw
      const specialLines = (analysis.factors || []).filter((f: string) =>
        f.startsWith("🤖") || f.startsWith("🚨") || f.startsWith("😴") || f.startsWith("💀") || f.startsWith("📐") || f.startsWith("⚡")
      );
      analysis.factors = specialLines;

      // Compute odds/EV for generic model
      const modelConf = bet_type === "moneyline" ? analysis.team1_pct : analysis.confidence;
      const odds = buildOddsPayload(oddsData, bet_type, modelConf, team1.name, team2.name, over_under);

      // Snapshot logging — fire and forget (only generic path; mlb/nhl delegations log on their side)
      logSnapshot({
        sport,
        market_type: bet_type,
        player_or_team: `${team1.name} vs ${team2.name}`,
        line: bet_type === "spread" ? (spread_line ? parseFloat(spread_line) : null)
            : bet_type === "total" ? (total_line ? parseFloat(total_line) : null)
            : null,
        direction: over_under || null,
        confidence: modelConf,
        verdict: analysis.verdict || null,
        odds_at_time: odds?.bestOdds?.american ?? null,
        ev_percent: odds?.ev_percent ?? null,
        top_factors: (analysis.factorBreakdown || []).slice(0, 5),
      }).catch((err) => console.error("logSnapshot failed:", err));

      return json({
        bet_type,
        sport,
        model: `${sport}-20-factor`,
        team1: { ...team1, stats: team1Stats },
        team2: { ...team2, stats: team2Stats },
        head_to_head: h2h,
        injuries: { team1: injuries1, team2: injuries2 },
        splits: { team1: splits1, team2: splits2 },
        back_to_back: { team1: b2b1, team2: b2b2 },
        pace: { team1: pace1, team2: pace2 },
        odds,
        ...analysis,
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (e: any) {
    console.error("moneyline-api error:", e);
    return json({ error: e.message || "Internal error" }, 500);
  }
});
