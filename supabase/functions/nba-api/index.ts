import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-session-token, x-device-fingerprint, x-request-nonce, x-request-timestamp",
};

// ─────────────────────────────────────────────────────────────
// PREDICTION / DECISION LAYER TYPES
// ─────────────────────────────────────────────────────────────
interface FactorBreakdown {
  name: string;
  label?: string;
  score: number;
  weight: number;
  detail?: string;
}

interface PredictionOutput {
  sport: string;
  market: string; // "player_prop" | "moneyline" | "spread" | "total"
  confidence: number; // 0-100, raw model output, no artificial floors
  factors: FactorBreakdown[];
  variance: "low" | "medium" | "high";
  dataQuality: "full" | "partial" | "estimated";
}

interface DecisionOutput {
  prediction: PredictionOutput;
  odds: number | null;
  impliedProbability: number | null;
  ev: number | null;
  evPercent: number | null;
  verdict: "STRONG" | "LEAN" | "SLIGHT" | "PASS";
  unitSize: number;
  juicePenaltyApplied: number;
  displayConfidence: number;
}

interface DataQualityReport {
  quality: "full" | "partial" | "estimated";
  flags: string[];
  lineupConfirmed: boolean;
  injuryDataFresh: boolean;
  sampleSize: "sufficient" | "small" | "insufficient";
  confidencePenalty: number;
}

// ─────────────────────────────────────────────────────────────
// Data quality validation (applies BEFORE final confidence)
// ─────────────────────────────────────────────────────────────
function validateDataQuality(playerData: any, injuryData: any, gameData: any): DataQualityReport {
  const flags: string[] = [];
  let penalty = 0;

  const seasonGames =
    playerData?.seasonGames ??
    playerData?.current_season_games?.length ??
    playerData?.season_hit_rate?.sample ??
    null;

  if (seasonGames !== null && seasonGames < 5) {
    flags.push("INSUFFICIENT_SAMPLE");
    penalty += 15;
  } else if (seasonGames !== null && seasonGames < 15) {
    flags.push("SMALL_SAMPLE");
    penalty += 7;
  }

  const lineupStatus = gameData?.lineupStatus ?? gameData?.lineup_status ?? null;
  const lineupConfirmed = lineupStatus === "confirmed";
  if (lineupStatus !== null && !lineupConfirmed) {
    flags.push("LINEUP_UNCONFIRMED");
    penalty += 5;
  }

  let injuryFresh = true;
  const injuryUpdatedAt = injuryData?.lastUpdated ?? injuryData?.last_updated ?? null;
  if (injuryUpdatedAt) {
    const age = Date.now() - new Date(injuryUpdatedAt).getTime();
    injuryFresh = age < 4 * 60 * 60 * 1000;
    if (!injuryFresh) {
      flags.push("STALE_INJURY_DATA");
      penalty += 3;
    }
  }

  const hasSeason = playerData?.season_hit_rate?.rate ?? playerData?.seasonHitRate ?? null;
  const hasL10 = playerData?.last_10?.rate ?? playerData?.l10 ?? null;
  if (hasSeason === null && hasL10 === null) {
    flags.push("NO_HISTORICAL_DATA");
    penalty += 20;
  }

  const quality: DataQualityReport["quality"] =
    flags.length === 0 ? "full" : penalty > 15 ? "estimated" : "partial";

  const sampleSize: DataQualityReport["sampleSize"] =
    seasonGames === null
      ? "sufficient"
      : seasonGames < 5
        ? "insufficient"
        : seasonGames < 15
          ? "small"
          : "sufficient";

  return {
    quality,
    flags,
    lineupConfirmed,
    injuryDataFresh: injuryFresh,
    sampleSize,
    confidencePenalty: penalty,
  };
}

function dataQualityWarnings(q: DataQualityReport, sampleSize: number | null): string[] {
  const out: string[] = [];
  if (q.flags.includes("LINEUP_UNCONFIRMED"))
    out.push("⚠️ Lineup not yet confirmed — confidence reduced by 5%");
  if (q.flags.includes("SMALL_SAMPLE"))
    out.push(`⚠️ Small sample size (${sampleSize ?? "<15"} games) — treat with caution`);
  if (q.flags.includes("INSUFFICIENT_SAMPLE"))
    out.push(`⚠️ Insufficient sample size (${sampleSize ?? "<5"} games) — high uncertainty`);
  if (q.flags.includes("STALE_INJURY_DATA"))
    out.push("⚠️ Injury data may be stale — verify before betting");
  if (q.flags.includes("NO_HISTORICAL_DATA"))
    out.push("⚠️ No historical data available — model is estimating");
  return out;
}

// ─────────────────────────────────────────────────────────────
// Variance from factor agreement
// ─────────────────────────────────────────────────────────────
function computeVariance(factors: FactorBreakdown[]): "low" | "medium" | "high" {
  if (!factors || factors.length < 2) return "high";
  const scores = factors.map((f) => Number(f.score) || 0).filter((s) => !Number.isNaN(s));
  if (scores.length < 2) return "high";
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);
  if (stddev < 10) return "low";
  if (stddev < 20) return "medium";
  return "high";
}

// ─────────────────────────────────────────────────────────────
// American odds → implied probability + EV
// ─────────────────────────────────────────────────────────────
function americanToImpliedProb(odds: number): number {
  if (!odds) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function americanToDecimal(odds: number): number {
  if (!odds) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

// Two-way no-vig: pass both sides' implied prob; we only have one side here so
// approximate vig by assuming a 5% market hold split symmetrically.
function removeVig(implied: number): number {
  // Simple normalization assuming a typical 5% hold (book holds ~5% on 2-way).
  // True devig would require both sides; for one-sided we shrink by half-hold.
  const HALF_HOLD = 0.025;
  return Math.max(0.01, Math.min(0.99, implied - HALF_HOLD));
}

function applyJuicePenalty(confidence: number, americanOdds: number): { adjusted: number; penalty: number } {
  if (!americanOdds) return { adjusted: confidence, penalty: 0 };
  let penalty = 0;
  if (americanOdds <= -200) penalty = 12;
  else if (americanOdds <= -170) penalty = 8;
  else if (americanOdds <= -150) penalty = 5;
  else if (americanOdds <= -130) penalty = 3;
  return { adjusted: Math.max(0, confidence - penalty), penalty };
}

function buildDecisionOutput(
  prediction: PredictionOutput,
  americanOdds: number | null | undefined,
  stake = 100,
): DecisionOutput {
  let impliedProbability: number | null = null;
  let ev: number | null = null;
  let evPercent: number | null = null;
  let verdict: DecisionOutput["verdict"] = "PASS";
  let unitSize = 0;
  let juicePenalty = 0;
  let displayConfidence = prediction.confidence;

  if (americanOdds !== null && americanOdds !== undefined && Number.isFinite(americanOdds) && americanOdds !== 0) {
    const rawImplied = americanToImpliedProb(americanOdds);
    impliedProbability = removeVig(rawImplied);
    const decimal = americanToDecimal(americanOdds);
    const winAmt = stake * (decimal - 1);
    const p = prediction.confidence / 100;
    ev = p * winAmt - (1 - p) * stake;
    evPercent = (ev / stake) * 100;

    const juice = applyJuicePenalty(prediction.confidence, americanOdds);
    displayConfidence = juice.adjusted;
    juicePenalty = juice.penalty;

    if (displayConfidence >= 70 && evPercent >= 5) verdict = "STRONG";
    else if (displayConfidence >= 60 && evPercent >= 2) verdict = "LEAN";
    else if (displayConfidence >= 55 && evPercent > 0) verdict = "SLIGHT";
    else verdict = "PASS";

    if (verdict === "STRONG" && evPercent >= 8) unitSize = 2;
    else if (verdict === "STRONG" || (verdict === "LEAN" && evPercent >= 5)) unitSize = 1.5;
    else if (verdict === "LEAN" || verdict === "SLIGHT") unitSize = 1;
    else unitSize = 0;
  } else {
    // No odds available — verdict from confidence alone
    if (prediction.confidence >= 70) verdict = "STRONG";
    else if (prediction.confidence >= 60) verdict = "LEAN";
    else if (prediction.confidence >= 55) verdict = "SLIGHT";
    else verdict = "PASS";
  }

  return {
    prediction,
    odds: americanOdds ?? null,
    impliedProbability,
    ev,
    evPercent,
    verdict,
    unitSize,
    juicePenaltyApplied: juicePenalty,
    displayConfidence,
  };
}

// ─────────────────────────────────────────────────────────────
// MLB prop-category specific weight overrides
// ─────────────────────────────────────────────────────────────
const MLB_PROP_WEIGHTS: Record<string, Record<string, number>> = {
  hits: {
    season_hit_rate: 0.22,
    last_10_trend: 0.18,
    last_5_hot_cold: 0.14,
    vs_opposing_sp_era: 0.12,
    platoon_advantage: 0.10,
    park_factor: 0.08,
    weather_temp: 0.06,
    h2h_vs_opponent: 0.10,
  },
  strikeouts: {
    vs_opposing_sp_k9: 0.25,
    season_hit_rate: 0.15,
    last_10_trend: 0.15,
    last_5_hot_cold: 0.20,
    platoon_advantage: 0.10,
    park_factor: 0.05,
    weather_temp: 0.05,
    h2h_vs_opponent: 0.05,
  },
  total_bases: {
    season_hit_rate: 0.18,
    last_10_trend: 0.16,
    vs_opposing_sp_era: 0.14,
    park_factor: 0.14,
    platoon_advantage: 0.12,
    weather_temp: 0.08,
    last_5_hot_cold: 0.10,
    h2h_vs_opponent: 0.08,
  },
  pitcher_strikeouts: {
    vs_opp_team_k_rate: 0.25,
    last_5_hot_cold: 0.20,
    vs_opp_team_ops: 0.20,
    park_factor: 0.08,
    weather_temp: 0.07,
    lineup_handedness: 0.08,
    h2h_vs_opponent: 0.07,
    rest_days: 0.05,
  },
};

function detectMlbPropCategory(propType: string | null | undefined): keyof typeof MLB_PROP_WEIGHTS {
  const p = (propType || "").toLowerCase();
  if (p.includes("strikeout") && (p.includes("pitcher") || p.includes("sp"))) return "pitcher_strikeouts";
  if (p.includes("strikeout") || p.match(/\bk\b|\bks\b/)) return "strikeouts";
  if (p.includes("total_base") || p.includes("total bases") || p.includes("tb")) return "total_bases";
  return "hits";
}

// ─────────────────────────────────────────────────────────────
// Snapshot logging — fire and forget
// ─────────────────────────────────────────────────────────────
async function logSnapshot(payload: Record<string, any>): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    await fetch(`${supabaseUrl}/rest/v1/prediction_snapshots`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("logSnapshot failed:", (e as Error).message);
  }
}

const NBA_TEAMS = [
  { abbr: "ATL", name: "Atlanta Hawks" }, { abbr: "BOS", name: "Boston Celtics" },
  { abbr: "BKN", name: "Brooklyn Nets" }, { abbr: "CHA", name: "Charlotte Hornets" },
  { abbr: "CHI", name: "Chicago Bulls" }, { abbr: "CLE", name: "Cleveland Cavaliers" },
  { abbr: "DAL", name: "Dallas Mavericks" }, { abbr: "DEN", name: "Denver Nuggets" },
  { abbr: "DET", name: "Detroit Pistons" }, { abbr: "GSW", name: "Golden State Warriors" },
  { abbr: "HOU", name: "Houston Rockets" }, { abbr: "IND", name: "Indiana Pacers" },
  { abbr: "LAC", name: "LA Clippers" }, { abbr: "LAL", name: "Los Angeles Lakers" },
  { abbr: "MEM", name: "Memphis Grizzlies" }, { abbr: "MIA", name: "Miami Heat" },
  { abbr: "MIL", name: "Milwaukee Bucks" }, { abbr: "MIN", name: "Minnesota Timberwolves" },
  { abbr: "NOP", name: "New Orleans Pelicans" }, { abbr: "NYK", name: "New York Knicks" },
  { abbr: "OKC", name: "Oklahoma City Thunder" }, { abbr: "ORL", name: "Orlando Magic" },
  { abbr: "PHI", name: "Philadelphia 76ers" }, { abbr: "PHX", name: "Phoenix Suns" },
  { abbr: "POR", name: "Portland Trail Blazers" }, { abbr: "SAC", name: "Sacramento Kings" },
  { abbr: "SAS", name: "San Antonio Spurs" }, { abbr: "TOR", name: "Toronto Raptors" },
  { abbr: "UTA", name: "Utah Jazz" }, { abbr: "WAS", name: "Washington Wizards" },
];

const MLB_TEAMS = [
  { abbr: "ARI", name: "Arizona Diamondbacks" }, { abbr: "ATL", name: "Atlanta Braves" },
  { abbr: "BAL", name: "Baltimore Orioles" }, { abbr: "BOS", name: "Boston Red Sox" },
  { abbr: "CHC", name: "Chicago Cubs" }, { abbr: "CWS", name: "Chicago White Sox" },
  { abbr: "CIN", name: "Cincinnati Reds" }, { abbr: "CLE", name: "Cleveland Guardians" },
  { abbr: "COL", name: "Colorado Rockies" }, { abbr: "DET", name: "Detroit Tigers" },
  { abbr: "HOU", name: "Houston Astros" }, { abbr: "KC", name: "Kansas City Royals" },
  { abbr: "LAA", name: "Los Angeles Angels" }, { abbr: "LAD", name: "Los Angeles Dodgers" },
  { abbr: "MIA", name: "Miami Marlins" }, { abbr: "MIL", name: "Milwaukee Brewers" },
  { abbr: "MIN", name: "Minnesota Twins" }, { abbr: "NYM", name: "New York Mets" },
  { abbr: "NYY", name: "New York Yankees" }, { abbr: "OAK", name: "Oakland Athletics" },
  { abbr: "PHI", name: "Philadelphia Phillies" }, { abbr: "PIT", name: "Pittsburgh Pirates" },
  { abbr: "SD", name: "San Diego Padres" }, { abbr: "SF", name: "San Francisco Giants" },
  { abbr: "SEA", name: "Seattle Mariners" }, { abbr: "STL", name: "St. Louis Cardinals" },
  { abbr: "TB", name: "Tampa Bay Rays" }, { abbr: "TEX", name: "Texas Rangers" },
  { abbr: "TOR", name: "Toronto Blue Jays" }, { abbr: "WSH", name: "Washington Nationals" },
];

const NHL_TEAMS = [
  { abbr: "ANA", name: "Anaheim Ducks" }, { abbr: "BOS", name: "Boston Bruins" },
  { abbr: "BUF", name: "Buffalo Sabres" }, { abbr: "CGY", name: "Calgary Flames" },
  { abbr: "CAR", name: "Carolina Hurricanes" }, { abbr: "CHI", name: "Chicago Blackhawks" },
  { abbr: "COL", name: "Colorado Avalanche" }, { abbr: "CBJ", name: "Columbus Blue Jackets" },
  { abbr: "DAL", name: "Dallas Stars" }, { abbr: "DET", name: "Detroit Red Wings" },
  { abbr: "EDM", name: "Edmonton Oilers" }, { abbr: "FLA", name: "Florida Panthers" },
  { abbr: "LA", name: "Los Angeles Kings" }, { abbr: "MIN", name: "Minnesota Wild" },
  { abbr: "MTL", name: "Montréal Canadiens" }, { abbr: "NSH", name: "Nashville Predators" },
  { abbr: "NJ", name: "New Jersey Devils" }, { abbr: "NYI", name: "New York Islanders" },
  { abbr: "NYR", name: "New York Rangers" }, { abbr: "OTT", name: "Ottawa Senators" },
  { abbr: "PHI", name: "Philadelphia Flyers" }, { abbr: "PIT", name: "Pittsburgh Penguins" },
  { abbr: "SJ", name: "San Jose Sharks" }, { abbr: "SEA", name: "Seattle Kraken" },
  { abbr: "STL", name: "St. Louis Blues" }, { abbr: "TB", name: "Tampa Bay Lightning" },
  { abbr: "TOR", name: "Toronto Maple Leafs" }, { abbr: "UTA", name: "Utah Hockey Club" },
  { abbr: "VAN", name: "Vancouver Canucks" }, { abbr: "VGK", name: "Vegas Golden Knights" },
  { abbr: "WSH", name: "Washington Capitals" }, { abbr: "WPG", name: "Winnipeg Jets" },
];

function getEspnConfig(sport: string) {
  if (sport === "mlb") {
    return {
      base: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb",
      core: "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb",
      searchSport: "baseball",
      searchLeague: "mlb",
      teams: MLB_TEAMS,
      sportKey: "mlb" as const,
    };
  }
  if (sport === "nhl") {
    return {
      base: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl",
      core: "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl",
      searchSport: "hockey",
      searchLeague: "nhl",
      teams: NHL_TEAMS,
      sportKey: "nhl" as const,
    };
  }
  return {
    base: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba",
    core: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba",
    searchSport: "basketball",
    searchLeague: "nba",
    teams: NBA_TEAMS,
    sportKey: "nba" as const,
  };
}

type EspnConfig = ReturnType<typeof getEspnConfig>;

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";

// ── Search Players via ESPN ─────────────────────────────────
async function searchPlayers(query: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  const results: { id: string; name: string }[] = [];
  const qLower = query.toLowerCase();

  try {
    const resp = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}&limit=25&mode=prefix&type=player&sport=${cfg.searchSport}&league=${cfg.searchLeague}`
    );
    const data = await resp.json();
    for (const item of data?.items || data?.results || []) {
      const athlete = item?.athlete || item;
      const name = athlete?.displayName || athlete?.fullName || item?.displayName || item?.name || "";
      if (name.toLowerCase().includes(qLower)) {
        const id = athlete?.id || item?.id || item?.uid?.split(":")?.[3];
        if (id) results.push({ id: String(id), name });
      }
    }
  } catch (e) {
    console.error("ESPN search error:", e);
  }

  if (results.length === 0) {
    try {
      const resp = await fetch(`${cfg.base}/athletes?limit=40`);
      const data = await resp.json();
      for (const item of data?.items || data?.athletes || []) {
        const name = item?.displayName || item?.fullName || "";
        if (name.toLowerCase().includes(qLower)) {
          results.push({ id: String(item.id), name });
        }
      }
    } catch (e) {
      console.error("ESPN athletes search error:", e);
    }
  }

  const unique = [...new Map(results.map(r => [r.id, r])).values()].slice(0, 10);
  
  // Enrich with headshots and team info
  const enriched = await Promise.all(
    unique.map(async (p) => {
      try {
        const resp = await fetch(`${cfg.core}/athletes/${p.id}`);
        const data = await resp.json();
        const teamRef = data?.team?.$ref?.replace("http://", "https://");
        let teamAbbr = "";
        let teamName = "";
        if (teamRef) {
          try {
            const tResp = await fetch(teamRef);
            const tData = await tResp.json();
            teamAbbr = tData?.abbreviation || "";
            teamName = tData?.shortDisplayName || tData?.displayName || "";
          } catch {}
        }
        return {
          id: p.id,
          name: p.name,
          headshot: data?.headshot?.href || `https://a.espncdn.com/i/headshots/${cfg.searchLeague}/players/full/${p.id}.png`,
          position: data?.position?.abbreviation || "",
          jersey: data?.jersey || "",
          team: teamAbbr,
          teamName,
        };
      } catch {
        return { ...p, headshot: `https://a.espncdn.com/i/headshots/${cfg.searchLeague}/players/full/${p.id}.png`, position: "", jersey: "", team: "", teamName: "" };
      }
    })
  );
  return enriched;
}

// ── Get Player Info ─────────────────────────────────────────
async function getPlayerInfo(playerId: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  const resp = await fetch(`${cfg.core}/athletes/${playerId}`);
  const data = await resp.json();

  const teamResp = data?.team?.$ref ? await fetch(data.team.$ref.replace("http://", "https://")) : null;
  const teamData = teamResp ? await teamResp.json() : {};

  return {
    id: playerId,
    full_name: data?.displayName || data?.fullName || "",
    first_name: data?.firstName || "",
    last_name: data?.lastName || "",
    team_name: teamData?.displayName || teamData?.name || "",
    team_abbr: teamData?.abbreviation || "",
    position: data?.position?.abbreviation || "",
    jersey: data?.jersey || "",
    headshot_url: data?.headshot?.href || `https://a.espncdn.com/i/headshots/${cfg.searchLeague}/players/full/${playerId}.png`,
  };
}

// ── Get Game Log from ESPN ──────────────────────────────────
interface GameRow {
  date: string;
  matchup: string;
  wl: string;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  stl: number;
  blk: number;
  tov: number;
  opponent: string;
  isHome: boolean;
  // Shooting splits
  fgm: number;
  fga: number;
  fg3a: number;
  ftm: number;
  fta: number;
  // MLB stats
  hits: number;
  runs: number;
  rbi: number;
  home_runs: number;
  strikeouts: number;
  total_bases: number;
  walks: number;
  stolen_bases: number;
  at_bats: number;
  // NHL stats
  goals: number;
  nhl_assists: number;
  sog: number; // shots on goal
  pim: number; // penalty minutes
  plus_minus: number;
  ppg: number; // power play goals
  toi: number; // time on ice (minutes)
  // Event ID for quarter-level lookups
  eventId?: string;
  // 1Q stats (populated separately)
  q1_pts?: number;
  q1_reb?: number;
  q1_ast?: number;
}

async function getGameLog(playerId: string, season?: number, config?: EspnConfig): Promise<GameRow[]> {
  const cfg = config || getEspnConfig("nba");
  const year = season || new Date().getFullYear();
  const games: GameRow[] = [];

  try {
    const resp = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.searchSport}/${cfg.searchLeague}/athletes/${playerId}/gamelog?season=${year}`
    );
    const data = await resp.json();

    // ESPN puts labels at the TOP LEVEL of the response
    // Labels: ["MIN","FG","FG%","3PT","3P%","FT","FT%","REB","AST","BLK","STL","PF","TO","PTS"]
    const topLabels: string[] = (data?.labels || []).map((l: string) => l.toUpperCase());
    const events: Record<string, any> = data?.events || {};
    const seasonTypes: any[] = data?.seasonTypes || [];

    // Build stat rows from seasonTypes -> categories -> events
    const statRows: Record<string, string[]> = {};

    for (const st of seasonTypes) {
      for (const cat of st?.categories || []) {
        for (const ev of cat?.events || []) {
          const eventId = String(ev?.eventId || ev?.id || "");
          if (eventId && ev?.stats) {
            statRows[eventId] = ev.stats;
          }
        }
      }
    }

    // Also try flat categories format if present
    if (Object.keys(statRows).length === 0 && data?.categories) {
      for (const cat of data.categories) {
        for (const ev of cat?.events || []) {
          const eventId = String(ev?.eventId || ev?.id || "");
          if (eventId && ev?.stats) {
            statRows[eventId] = ev.stats;
          }
        }
      }
    }

    // Helper to find label index
    const getIdx = (label: string) => topLabels.indexOf(label);

    // Parse a stat value - handles "10-18" (made-attempted) format by taking the first number
    const parseStat = (val: any): number => {
      if (val === null || val === undefined || val === "--" || val === "") return 0;
      const s = String(val);
      if (s.includes("-") && !s.startsWith("-")) {
        const parts = s.split("-");
        return parseFloat(parts[0]) || 0;
      }
      return parseFloat(s) || 0;
    };

    // Parse attempted (second number in "made-attempted" format)
    const parseAttempted = (val: any): number => {
      if (val === null || val === undefined || val === "--" || val === "") return 0;
      const s = String(val);
      if (s.includes("-") && !s.startsWith("-")) {
        const parts = s.split("-");
        return parseFloat(parts[1]) || 0;
      }
      return 0;
    };

    const minIdx = getIdx("MIN");
    const ptsIdx = getIdx("PTS");
    const rebIdx = getIdx("REB");
    const astIdx = getIdx("AST");
    const fgIdx = getIdx("FG");
    const fg3Idx = getIdx("3PT") !== -1 ? getIdx("3PT") : getIdx("3PM");
    const ftIdx = getIdx("FT");
    const stlIdx = getIdx("STL");
    const blkIdx = getIdx("BLK");
    const toIdx = getIdx("TO") !== -1 ? getIdx("TO") : getIdx("TOV");

    // MLB-specific indices
    const hIdx = getIdx("H");
    const rIdx = getIdx("R");
    const rbiIdx = getIdx("RBI");
    const hrIdx = getIdx("HR");
    const kIdx = getIdx("K") !== -1 ? getIdx("K") : getIdx("SO");
    const tbIdx = getIdx("TB");
    const bbIdx = getIdx("BB");
    const sbIdx = getIdx("SB");
    const abIdx = getIdx("AB");

    // NHL-specific indices
    const gIdx = getIdx("G");
    const aIdx = getIdx("A");
    const sogIdx = getIdx("SOG") !== -1 ? getIdx("SOG") : getIdx("S");
    const pimIdx = getIdx("PIM");
    const pmIdx = getIdx("+/-");
    const ppgIdx = getIdx("PPG") !== -1 ? getIdx("PPG") : getIdx("PPP");
    const toiIdx = getIdx("TOI") !== -1 ? getIdx("TOI") : getIdx("TOI/G");

    console.log("ESPN labels:", topLabels);
    console.log("Sport:", cfg.searchLeague, "Total events:", Object.keys(events).length, "Total stat rows:", Object.keys(statRows).length);

    for (const [eventId, eventInfo] of Object.entries(events)) {
      const stats = statRows[eventId];
      if (!stats) continue;

      const oppInfo = eventInfo?.opponent || {};
      const oppAbbr = oppInfo?.abbreviation || "";
      const atVs = eventInfo?.atVs || "";
      const homeAway = eventInfo?.homeAway || "";
      const isHome = homeAway === "home" || atVs === "vs";
      const matchup = isHome ? `vs ${oppAbbr}` : `@ ${oppAbbr}`;
      const gameDate = eventInfo?.gameDate || "";
      const result = eventInfo?.result || eventInfo?.gameResult || "";

      // Calculate total bases if not available
      let tbVal = tbIdx >= 0 ? parseStat(stats[tbIdx]) : 0;
      if (tbIdx < 0 && cfg.searchLeague === "mlb") {
        const h = hIdx >= 0 ? parseStat(stats[hIdx]) : 0;
        const hr = hrIdx >= 0 ? parseStat(stats[hrIdx]) : 0;
        tbVal = h + hr * 3;
      }

      // Parse TOI (time on ice) — ESPN formats as "MM:SS"
      let toiVal = 0;
      if (toiIdx >= 0 && stats[toiIdx]) {
        const toiStr = String(stats[toiIdx]);
        if (toiStr.includes(":")) {
          const [m, s] = toiStr.split(":");
          toiVal = (parseFloat(m) || 0) + (parseFloat(s) || 0) / 60;
          toiVal = Math.round(toiVal * 10) / 10;
        } else {
          toiVal = parseFloat(toiStr) || 0;
        }
      }

      games.push({
        date: gameDate,
        matchup,
        wl: result === "W" ? "W" : result === "L" ? "L" : result,
        min: minIdx >= 0 ? parseStat(stats[minIdx]) : toiVal, // NHL uses TOI instead of MIN
        pts: ptsIdx >= 0 ? parseStat(stats[ptsIdx]) : 0,
        reb: rebIdx >= 0 ? parseStat(stats[rebIdx]) : 0,
        ast: astIdx >= 0 ? parseStat(stats[astIdx]) : (aIdx >= 0 ? parseStat(stats[aIdx]) : 0),
        fg3m: fg3Idx >= 0 ? parseStat(stats[fg3Idx]) : 0,
        stl: stlIdx >= 0 ? parseStat(stats[stlIdx]) : 0,
        blk: blkIdx >= 0 ? parseStat(stats[blkIdx]) : 0,
        tov: toIdx >= 0 ? parseStat(stats[toIdx]) : 0,
        opponent: oppAbbr,
        isHome,
        eventId,
        // Shooting splits (NBA)
        fgm: fgIdx >= 0 ? parseStat(stats[fgIdx]) : 0,
        fga: fgIdx >= 0 ? parseAttempted(stats[fgIdx]) : 0,
        fg3a: fg3Idx >= 0 ? parseAttempted(stats[fg3Idx]) : 0,
        ftm: ftIdx >= 0 ? parseStat(stats[ftIdx]) : 0,
        fta: ftIdx >= 0 ? parseAttempted(stats[ftIdx]) : 0,
        // MLB stats
        hits: hIdx >= 0 ? parseStat(stats[hIdx]) : 0,
        runs: rIdx >= 0 ? parseStat(stats[rIdx]) : 0,
        rbi: rbiIdx >= 0 ? parseStat(stats[rbiIdx]) : 0,
        home_runs: hrIdx >= 0 ? parseStat(stats[hrIdx]) : 0,
        strikeouts: kIdx >= 0 ? parseStat(stats[kIdx]) : 0,
        total_bases: tbVal,
        walks: bbIdx >= 0 ? parseStat(stats[bbIdx]) : 0,
        stolen_bases: sbIdx >= 0 ? parseStat(stats[sbIdx]) : 0,
        at_bats: abIdx >= 0 ? parseStat(stats[abIdx]) : 0,
        // NHL stats
        goals: gIdx >= 0 ? parseStat(stats[gIdx]) : 0,
        nhl_assists: aIdx >= 0 ? parseStat(stats[aIdx]) : 0,
        sog: sogIdx >= 0 ? parseStat(stats[sogIdx]) : 0,
        pim: pimIdx >= 0 ? parseStat(stats[pimIdx]) : 0,
        plus_minus: pmIdx >= 0 ? parseStat(stats[pmIdx]) : 0,
        ppg: ppgIdx >= 0 ? parseStat(stats[ppgIdx]) : 0,
        toi: toiVal,
      });
    }

    if (games.length > 0) {
      console.log("Sample game stats:", JSON.stringify(games[0]));
    }
  } catch (e) {
    console.error("ESPN gamelog error:", e);
  }

  games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return games;
}

// ── Season Averages ─────────────────────────────────────────
async function getSeasonAvg(playerId: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  try {
    const resp = await fetch(
      `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.searchSport}/${cfg.searchLeague}/athletes/${playerId}/stats`
    );
    const data = await resp.json();
    const stats = data?.stats || [];
    for (const block of stats) {
      if (block?.type === "perGame" || block?.displayName?.includes("Per Game")) {
        const labels = (block?.labels || []).map((l: string) => l.toUpperCase());
        const values = block?.stats || [];
        const getV = (label: string) => {
          const idx = labels.indexOf(label);
          return idx >= 0 ? parseFloat(values[idx]) || 0 : 0;
        };
        return {
          GP: getV("GP"),
          PTS: getV("PTS"),
          REB: getV("REB"),
          AST: getV("AST"),
          FG3M: getV("3PM") || getV("3PT") || getV("FG3M"),
          STL: getV("STL"),
          BLK: getV("BLK"),
          TOV: getV("TO") || getV("TOV"),
          MIN: getV("MIN"),
        };
      }
    }
  } catch (e) {
    console.error("Season avg error:", e);
  }
  return {};
}

// ── Next Game ───────────────────────────────────────────────
async function getNextGame(teamAbbr: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  try {
    const resp = await fetch(`${cfg.base}/scoreboard`);
    const data = await resp.json();

    for (const event of data?.events || []) {
      const comp = event?.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      let homeTeam: any = null, awayTeam: any = null;
      for (const c of competitors) {
        if (c.homeAway === "home") homeTeam = c.team;
        else awayTeam = c.team;
      }
      if (!homeTeam || !awayTeam) continue;

      const isHome = homeTeam.abbreviation?.toUpperCase() === teamAbbr.toUpperCase();
      const isAway = awayTeam.abbreviation?.toUpperCase() === teamAbbr.toUpperCase();
      if (!isHome && !isAway) continue;

      const opponent = isHome ? awayTeam : homeTeam;
      return {
        date: event.date ? new Date(event.date).toISOString().split("T")[0] : "",
        opponent_abbr: opponent.abbreviation || "",
        opponent_name: opponent.displayName || "",
        is_home: isHome,
      };
    }

    // Try schedule endpoint
    const teamsResp = await fetch(`${cfg.base}/teams?limit=50`);
    const teamsData = await teamsResp.json();
    const allTeams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
    let espnTeamId = "";
    for (const t of allTeams) {
      if ((t.team?.abbreviation || t.abbreviation || "").toUpperCase() === teamAbbr.toUpperCase()) {
        espnTeamId = String(t.team?.id || t.id);
        break;
      }
    }
    if (!espnTeamId) return null;

    const schedResp = await fetch(`${cfg.base}/teams/${espnTeamId}/schedule`);
    const schedData = await schedResp.json();
    const now = Date.now();
    for (const event of schedData?.events || []) {
      const gameDate = new Date(event.date).getTime();
      if (gameDate < now - 3 * 3600000) continue;
      const status = event.status?.type?.name;
      if (status === "STATUS_FINAL" || status === "STATUS_POSTPONED") continue;

      const comp = event.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      let homeTeam: any = null, awayTeam: any = null;
      for (const c of competitors) {
        if (c.homeAway === "home") homeTeam = c.team;
        else awayTeam = c.team;
      }
      if (!homeTeam || !awayTeam) continue;

      const isHome = homeTeam.abbreviation?.toUpperCase() === teamAbbr.toUpperCase();
      const opponent = isHome ? awayTeam : homeTeam;
      return {
        date: new Date(event.date).toISOString().split("T")[0],
        opponent_abbr: opponent.abbreviation || "",
        opponent_name: opponent.displayName || "",
        is_home: isHome,
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ── Injuries ────────────────────────────────────────────────
async function getTeamInjuries(teamAbbr: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  const injuries: any[] = [];

  // Build a lookup: abbreviation -> full team name
  const abbrToName: Record<string, string> = {};
  for (const t of cfg.teams) {
    abbrToName[t.abbr.toUpperCase()] = t.name.toLowerCase();
  }
  const targetName = abbrToName[teamAbbr.toUpperCase()] || teamAbbr.toLowerCase();

  try {
    const resp = await fetch(`${cfg.base}/injuries`);
    const data = await resp.json();
    for (const teamData of data?.injuries || []) {
      // Match by team abbreviation in team object OR by displayName
      const teamAbbrVal = (teamData.team?.abbreviation || "").toUpperCase();
      const teamDisplayName = (teamData.displayName || "").toLowerCase();
      const isMatch = teamAbbrVal === teamAbbr.toUpperCase() || teamDisplayName.includes(targetName);
      if (!isMatch) continue;
      for (const item of teamData.injuries || []) {
        const athlete = item.athlete || {};
        injuries.push({
          player_name: athlete.displayName || "",
          position: athlete.position?.abbreviation || "",
          status: item.status || "Unknown",
          detail: item.type?.description || item.longComment || item.shortComment || "",
        });
      }
    }
  } catch { /* ignore */ }
  console.log(`Injuries for ${teamAbbr}: ${injuries.length} found (${injuries.filter(i => ["out","doubtful"].includes(i.status?.toLowerCase())).length} out/doubtful)`);
  return injuries;
}

// ── Fetch Team Roster & Identify Key Players ────────────────
async function getTeamRosterContext(
  teamAbbr: string,
  injuries: any[],
  config?: EspnConfig,
): Promise<{ keyOut: any[]; keyPlaying: any[] }> {
  const cfg = config || getEspnConfig("nba");
  const outNames = new Set(
    injuries
      .filter((i) => ["out", "doubtful"].includes(i.status?.toLowerCase()))
      .map((i) => i.player_name.toLowerCase()),
  );

  try {
    const teamsResp = await fetch(`${cfg.base}/teams?limit=50`);
    const teamsData = await teamsResp.json();
    const allTeams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
    let espnTeamId = "";
    for (const t of allTeams) {
      if ((t.team?.abbreviation || t.abbreviation || "").toUpperCase() === teamAbbr.toUpperCase()) {
        espnTeamId = String(t.team?.id || t.id);
        break;
      }
    }
    if (!espnTeamId) { console.log(`Roster: No ESPN team ID found for ${teamAbbr}`); return { keyOut: [], keyPlaying: [] }; }
    console.log(`Roster: Found team ${teamAbbr} → ESPN ID ${espnTeamId}`);

    const rosterResp = await fetch(`${cfg.base}/teams/${espnTeamId}/roster`);
    const rosterData = await rosterResp.json();
    console.log(`Roster API keys: ${Object.keys(rosterData || {}).join(', ')}`);

    const players: any[] = [];
    // ESPN roster API returns athletes as flat array of player objects
    const athleteList = rosterData?.athletes || [];
    for (const a of athleteList) {
      // Each athlete could be a direct player object or a group with items
      const items = a?.items ? a.items : [a];
      for (const item of items) {
        const athlete = item?.athlete || item;
        // Extract average minutes from athlete stats if available
        let avgMinutes = 0;
        try {
          const statsEntries = a?.statistics?.splits?.categories || [];
          for (const cat of statsEntries) {
            const minStat = (cat?.stats || []).find((s: any) => s?.abbreviation === "MIN" || s?.name === "minutes");
            if (minStat?.value) { avgMinutes = parseFloat(minStat.value) || 0; break; }
          }
        } catch {}
        // Fallback: try the simpler stats path
        if (!avgMinutes) {
          try {
            const simpleStats = a?.statistics?.[0]?.splits?.categories?.[0]?.stats || [];
            const minStat = simpleStats.find((s: any) => s?.abbreviation === "MIN");
            if (minStat?.value) avgMinutes = parseFloat(minStat.value) || 0;
          } catch {}
        }

        // Role classification: sport-aware
        let role: string;
        let impactWeight: number;
        if (cfg.searchLeague === "mlb") {
          // MLB: classify by position — SP/RP are pitchers, everyday starters vs bench
          const pos = (athlete.position?.abbreviation || a.position?.abbreviation || "").toUpperCase();
          const isPitcher = ["SP", "RP", "CP", "CL", "P"].includes(pos);
          if (isPitcher) {
            role = pos === "SP" ? "starter" : "reliever";
            impactWeight = pos === "SP" ? 1.0 : 0.4;
          } else {
            // Position players: starters vs bench based on typical lineup presence
            role = avgMinutes > 0 ? "everyday" : "bench";
            impactWeight = role === "everyday" ? 0.7 : 0.15;
          }
        } else {
          // NBA/NHL: minutes-based classification
          role = avgMinutes >= 28 ? "starter" : avgMinutes >= 15 ? "rotation" : avgMinutes > 0 ? "bench" : "unknown";
          impactWeight = role === "starter" ? 1.0 : role === "rotation" ? 0.5 : role === "bench" ? 0.15 : 0.3;
        }

        players.push({
          name: athlete.displayName || athlete.fullName || a.displayName || a.fullName || "",
          position: athlete.position?.abbreviation || a.position?.abbreviation || "",
          jersey: athlete.jersey || a.jersey || "",
          id: String(athlete.id || a.id || ""),
          avgMinutes: Math.round(avgMinutes * 10) / 10,
          role,
          impactWeight,
        });
      }
    }

    console.log(`Roster: ${players.length} players found, ${outNames.size} names to match: ${[...outNames].join(', ')}`);
    let keyOut = players.filter((p) => outNames.has(p.name.toLowerCase()));
    const keyPlaying = players.filter((p) => !outNames.has(p.name.toLowerCase()));

    // Fetch real avg minutes for OUT players from ESPN core stats API (parallel)
    if (keyOut.length > 0) {
      const year = new Date().getFullYear();
      const minutesFetches = await Promise.allSettled(
        keyOut.map(async (p) => {
          try {
            // Use season-specific stats endpoint to get per-game averages
            const resp = await fetch(`${cfg.core}/seasons/${year}/types/2/athletes/${p.id}/statistics`);
            if (!resp.ok) return { id: p.id, avgMinutes: 0 };
            const data = await resp.json();
            const cats = data?.splits?.categories || [];
            // Find the per-game MIN (the smaller value, typically <48)
            let perGameMin = 0;
            for (const c of cats) {
              const minStats = (c?.stats || []).filter((s: any) => s?.abbreviation === "MIN");
              for (const ms of minStats) {
                const val = parseFloat(ms.displayValue) || 0;
                // Per-game minutes are always < 48; totals are much higher
                if (val > 0 && val < 48 && (perGameMin === 0 || val < perGameMin)) {
                  perGameMin = val;
                }
              }
            }
            return { id: p.id, avgMinutes: perGameMin };
          } catch { return { id: p.id, avgMinutes: 0 }; }
        })
      );

      for (const result of minutesFetches) {
        if (result.status === "fulfilled" && result.value.avgMinutes > 0) {
          const p = keyOut.find((k) => k.id === result.value.id);
          if (p) {
            p.avgMinutes = Math.round(result.value.avgMinutes * 10) / 10;
            p.role = p.avgMinutes >= 28 ? "starter" : p.avgMinutes >= 15 ? "rotation" : "bench";
            p.impactWeight = p.role === "starter" ? 1.0 : p.role === "rotation" ? 0.5 : 0.15;
          }
        }
      }
    }

    console.log(`Roster matched: ${keyOut.length} OUT (${keyOut.map(p => `${p.name}:${p.role}:${p.avgMinutes}mpg`).join(', ')})`);

    return { keyOut, keyPlaying };
  } catch (e) {
    console.error("Roster fetch error:", e);
    return { keyOut: [], keyPlaying: [] };
  }
}

// ── Cross-Reference: Games Without Key Teammates ────────────
// Fetches injured teammates' game logs to find dates they missed,
// then calculates the analyzed player's stats in those games.
async function analyzeWithoutTeammates(
  playerGames: GameRow[],
  teammateInjuries: any[],
  teamRosterContext: { keyOut: any[]; keyPlaying: any[] },
  propType: string,
  line: number,
  overUnder: string,
  config?: EspnConfig,
): Promise<{
  withoutKeyPlayers: { avg: number; hitRate: number; hits: number; total: number; games: number; perMinRate: number; projectedMinutes: number; per36: number };
  withFullRoster: { avg: number; hitRate: number; hits: number; total: number; games: number };
  teammateBreakdown: { name: string; position: string; role: string; gamesWithout: number; avgWithout: number; avgWith: number; hitRateWithout: number; hitRateWith: number }[];
}> {
  const cfg = config || getEspnConfig("nba");
  const keyOut = teamRosterContext.keyOut || [];
  const sigInjured = teammateInjuries.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));

  // Combine roster context with injury list to get IDs
  const injuredWithIds = sigInjured.slice(0, 3).map((inj: any) => {
    const rosterMatch = keyOut.find((k: any) => k.name.toLowerCase() === inj.player_name.toLowerCase());
    return {
      name: inj.player_name,
      position: inj.position || rosterMatch?.position || "",
      id: rosterMatch?.id || "",
    };
  }).filter((t: any) => t.id);

  if (injuredWithIds.length === 0 || playerGames.length === 0) {
    return {
      withoutKeyPlayers: { avg: 0, hitRate: 0, hits: 0, total: 0, games: 0, perMinRate: 0, projectedMinutes: 0, per36: 0 },
      withFullRoster: { avg: 0, hitRate: 0, hits: 0, total: 0, games: 0 },
      teammateBreakdown: [],
    };
  }

  // Build player game date set for cross-referencing
  const playerGameDates = new Map<string, GameRow>();
  for (const g of playerGames) {
    if (g.date) {
      const dateKey = new Date(g.date).toISOString().split("T")[0];
      playerGameDates.set(dateKey, g);
    }
  }

  // Fetch each injured teammate's game log to find dates they MISSED
  const teammateAbsenceDates: Map<string, Set<string>> = new Map();
  const teammateBreakdown: any[] = [];

  const year = new Date().getFullYear();
  const fetchResults = await Promise.allSettled(
    injuredWithIds.map(async (teammate: any) => {
      try {
        const resp = await fetch(
          `https://site.web.api.espn.com/apis/common/v3/sports/${cfg.searchSport}/${cfg.searchLeague}/athletes/${teammate.id}/gamelog?season=${year}`
        );
        const data = await resp.json();
        const events = data?.events || {};
        const playedDates = new Set<string>();
        for (const [, eventInfo] of Object.entries(events) as [string, any][]) {
          const gameDate = eventInfo?.gameDate;
          if (gameDate) {
            playedDates.add(new Date(gameDate).toISOString().split("T")[0]);
          }
        }
        // Dates teammate missed = player's game dates minus teammate's played dates
        const missedDates = new Set<string>();
        for (const [dateKey] of playerGameDates) {
          if (!playedDates.has(dateKey)) {
            missedDates.add(dateKey);
          }
        }
        return { teammate, missedDates, playedDates };
      } catch (e) {
        console.error(`Error fetching gamelog for teammate ${teammate.name}:`, e);
        return { teammate, missedDates: new Set<string>(), playedDates: new Set<string>() };
      }
    })
  );

  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      const { teammate, missedDates, playedDates } = result.value;
      teammateAbsenceDates.set(teammate.name, missedDates);

      // Calculate player's stats with vs without this teammate
      const gamesWithout: GameRow[] = [];
      const gamesWith: GameRow[] = [];
      for (const [dateKey, game] of playerGameDates) {
        if (missedDates.has(dateKey)) {
          gamesWithout.push(game);
        } else if (playedDates.has(dateKey)) {
          gamesWith.push(game);
        }
      }

      const valsWithout = gamesWithout.map(g => getStatValue(g, propType));
      const valsWith = gamesWith.map(g => getStatValue(g, propType));
      const hrWithout = hitRate(valsWithout, line, overUnder);
      const hrWith = hitRate(valsWith, line, overUnder);

      // Determine role from roster context (uses real avg minutes)
      const rosterMatch = keyOut.find((k: any) => k.name.toLowerCase() === teammate.name.toLowerCase());
      const role = rosterMatch?.role || (playedDates.size > 0 ? "rotation" : "bench");

      teammateBreakdown.push({
        name: teammate.name,
        position: teammate.position,
        role,
        gamesWithout: gamesWithout.length,
        avgWithout: avg(valsWithout),
        avgWith: avg(valsWith),
        hitRateWithout: hrWithout.rate,
        hitRateWith: hrWith.rate,
      });

      console.log(`Without ${teammate.name}: ${gamesWithout.length} games, avg=${avg(valsWithout)}, HR=${hrWithout.rate}% | With: ${gamesWith.length} games, avg=${avg(valsWith)}, HR=${hrWith.rate}%`);
    }
  }

  // Compute combined "without ANY key player" stats
  // A game counts as "without key players" if ANY of the injured teammates missed it
  const allAbsentDates = new Set<string>();
  for (const [, dates] of teammateAbsenceDates) {
    for (const d of dates) allAbsentDates.add(d);
  }

  const gamesWithout: GameRow[] = [];
  const gamesFull: GameRow[] = [];
  for (const [dateKey, game] of playerGameDates) {
    if (allAbsentDates.has(dateKey)) {
      gamesWithout.push(game);
    } else {
      gamesFull.push(game);
    }
  }

  const valsWithout = gamesWithout.map(g => getStatValue(g, propType));
  const valsFull = gamesFull.map(g => getStatValue(g, propType));
  const hrWithout = hitRate(valsWithout, line, overUnder);
  const hrFull = hitRate(valsFull, line, overUnder);

  // Sport-aware rate projections
  const recentGames = playerGames.slice(-10);
  const totalMin = recentGames.reduce((s, g) => s + g.min, 0);
  const totalStat = recentGames.reduce((s, g) => s + getStatValue(g, propType), 0);

  let perMinRate = 0;
  let per36 = 0;
  let projectedMinutes = 0;
  const avgMinRecent = totalMin / Math.max(recentGames.length, 1);

  if (cfg.searchLeague === "mlb") {
    // MLB: use per-game average — no minutes concept in baseball
    per36 = recentGames.length > 0 ? Math.round(totalStat / recentGames.length * 10) / 10 : 0;
    projectedMinutes = 0; // not applicable
  } else {
    // NBA/NHL: per-minute rate projections
    perMinRate = totalMin > 0 ? totalStat / totalMin : 0;
    per36 = Math.round(perMinRate * (cfg.searchLeague === "nhl" ? 60 : 36) * 10) / 10;
    const minBoost = sigInjured.length >= 4 ? 6 : sigInjured.length >= 3 ? 4 : sigInjured.length >= 2 ? 3 : 1.5;
    const maxMin = cfg.searchLeague === "nhl" ? 25 : 42;
    projectedMinutes = Math.min(Math.round((avgMinRecent + minBoost) * 10) / 10, maxMin);
  }

  console.log(`Without key players: ${gamesWithout.length} games, avg=${avg(valsWithout)}, HR=${hrWithout.rate}% | Full roster: ${gamesFull.length} games, avg=${avg(valsFull)}, HR=${hrFull.rate}%`);
  console.log(`Per-36: ${per36}, Projected minutes: ${projectedMinutes} (current avg: ${Math.round(avgMinRecent * 10) / 10})`);

  return {
    withoutKeyPlayers: {
      avg: avg(valsWithout),
      hitRate: hrWithout.rate,
      hits: hrWithout.hits,
      total: hrWithout.total,
      games: gamesWithout.length,
      perMinRate: Math.round(perMinRate * 1000) / 1000,
      projectedMinutes,
      per36,
    },
    withFullRoster: {
      avg: avg(valsFull),
      hitRate: hrFull.rate,
      hits: hrFull.hits,
      total: hrFull.total,
      games: gamesFull.length,
    },
    teammateBreakdown,
  };
}

// ── Position-based Injury Impact Analysis ───────────────────
// Maps positions to position groups for overlap detection
const POSITION_GROUPS: Record<string, string[]> = {
  // NBA
  "PG": ["PG", "SG", "G"],
  "SG": ["PG", "SG", "G"],
  "G": ["PG", "SG", "G"],
  "SF": ["SF", "PF", "F"],
  "PF": ["SF", "PF", "F"],
  "F": ["SF", "PF", "F"],
  "C": ["C", "PF"],
  // NHL
  "LW": ["LW", "RW", "C", "W"],
  "RW": ["LW", "RW", "C", "W"],
  "W": ["LW", "RW", "W"],
  "D": ["D"],
  // MLB
  "SP": ["SP", "RP", "P"],
  "RP": ["SP", "RP", "P"],
  "P": ["SP", "RP", "P"],
  "1B": ["1B", "DH"],
  "2B": ["2B", "SS"],
  "SS": ["SS", "2B"],
  "3B": ["3B"],
  "LF": ["LF", "CF", "RF", "OF"],
  "CF": ["LF", "CF", "RF", "OF"],
  "RF": ["LF", "CF", "RF", "OF"],
  "OF": ["LF", "CF", "RF", "OF"],
  "DH": ["DH", "1B"],
};

function analyzeInjuryImpact(
  playerPosition: string,
  playerName: string,
  teammateInjuries: any[],
  opponentInjuries: any[],
  propType: string,
  sport: string = "nba",
) {
  const insights: string[] = [];
  const pos = playerPosition.toUpperCase();
  const sameGroupPositions = POSITION_GROUPS[pos] || [pos];
  const s = (sport || "nba").toLowerCase();

  // Sport-specific usage text
  const usageText = s === "mlb" ? "at-bats/plate appearances"
    : s === "nhl" ? "ice time/TOI"
    : s === "nfl" ? "snaps/targets"
    : s === "ufc" ? "striking/grappling volume"
    : "minutes/usage";

  // Sport-specific rotation text
  const rotationText = s === "mlb" ? "shift lineup/bullpen usage"
    : s === "nhl" ? "shift line combinations"
    : s === "nfl" ? "shift offensive scheme"
    : "shift rotations";

  // Teammate injuries — same position = more usage
  const samePosSig = teammateInjuries.filter(i => {
    const iPos = (i.position || "").toUpperCase();
    const isSameGroup = sameGroupPositions.includes(iPos) || iPos === pos;
    const isOut = ["out", "doubtful"].includes(i.status?.toLowerCase());
    return isSameGroup && isOut;
  });

  if (samePosSig.length > 0) {
    const names = samePosSig.map(i => `${i.player_name} (${i.position})`).join(", ");
    insights.push(`🔺 ${names} — same position group as ${playerName} (${pos}) — OUT/Doubtful`);
    insights.push(`📈 Expect increased ${usageText} for ${playerName} with ${samePosSig.length === 1 ? "this player" : "these players"} sidelined`);

    // NBA-specific prop insights
    if (s === "nba") {
      if (["points", "3-pointers", "pts+reb+ast"].includes(propType)) {
        insights.push(`🎯 More shot attempts likely → boost to scoring props`);
      }
      if (propType === "assists" && ["PG", "SG", "G"].includes(pos)) {
        insights.push(`🎯 May handle ball more → potential assist increase`);
      }
      if (propType === "rebounds" && ["PF", "SF", "C", "F"].includes(pos)) {
        insights.push(`🎯 More floor time at forward/center → rebounding boost`);
      }
    }

    // MLB-specific prop insights
    if (s === "mlb") {
      if (["hits", "total_bases", "home_runs"].includes(propType)) {
        insights.push(`🎯 Lineup adjustment likely → potential boost to plate appearances and run production`);
      }
      if (propType === "rbi" && ["1B", "3B", "DH", "LF", "RF", "CF", "OF"].includes(pos)) {
        insights.push(`🎯 Batting order shift possible → RBI opportunities may change`);
      }
      if (["strikeouts", "pitcher_strikeouts", "innings_pitched"].includes(propType)) {
        insights.push(`🎯 Depleted bullpen may extend starter's innings pitched`);
      }
    }

    // NHL-specific prop insights
    if (s === "nhl") {
      if (["goals", "points", "shots_on_goal"].includes(propType)) {
        insights.push(`🎯 More ice time on PP likely → increased SOG and scoring chances`);
      }
      if (propType === "assists") {
        insights.push(`🎯 Power play promotion possible → assist opportunities increase`);
      }
    }

    // NFL-specific prop insights
    if (s === "nfl") {
      if (["passing_yards", "passing_touchdowns"].includes(propType)) {
        insights.push(`🎯 More snaps under center → increased passing volume`);
      }
      if (["receptions", "receiving_yards"].includes(propType)) {
        insights.push(`🎯 Increased targets and routes run with fewer pass-catchers`);
      }
      if (["rushing_yards", "rushing_touchdowns"].includes(propType)) {
        insights.push(`🎯 More carries expected → red zone opportunities increase`);
      }
    }

    // UFC-specific insights
    if (s === "ufc") {
      insights.push(`🎯 More striking output expected with opponent adjustments`);
    }
  }

  // Any other significant teammate injuries (not same position)
  const otherSig = teammateInjuries.filter(i => {
    const iPos = (i.position || "").toUpperCase();
    const isSameGroup = sameGroupPositions.includes(iPos) || iPos === pos;
    const isOut = ["out", "doubtful"].includes(i.status?.toLowerCase());
    return !isSameGroup && isOut;
  });

  if (otherSig.length > 0) {
    const names = otherSig.map(i => `${i.player_name} (${i.position})`).join(", ");
    insights.push(`⚠️ Also OUT: ${names} — team short-handed, could ${rotationText}`);
  }

  // Opponent injuries — if their defenders at our position are out
  const oppSamePos = opponentInjuries.filter(i => {
    const iPos = (i.position || "").toUpperCase();
    const isOut = ["out", "doubtful"].includes(i.status?.toLowerCase());
    return sameGroupPositions.includes(iPos) && isOut;
  });

  if (oppSamePos.length > 0) {
    const names = oppSamePos.map(i => `${i.player_name} (${i.position})`).join(", ");
    insights.push(`✅ Opponent missing ${names} — weaker matchup defense for ${playerName}`);
    if (s === "nba" && ["points", "3-pointers", "pts+reb+ast"].includes(propType)) {
      insights.push(`🎯 Easier scoring matchup with primary defender(s) out`);
    }
    if (s === "nhl" && ["goals", "shots_on_goal", "points"].includes(propType)) {
      insights.push(`🎯 Weaker goaltending/defense → increased scoring opportunity`);
    }
    if (s === "mlb" && ["hits", "total_bases", "home_runs", "rbi"].includes(propType)) {
      insights.push(`🎯 Weakened pitching staff → better plate appearance outcomes`);
    }
    if (s === "nfl" && ["passing_yards", "receiving_yards", "rushing_yards"].includes(propType)) {
      insights.push(`🎯 Depleted secondary/front seven → easier matchup`);
    }
  }

  if (insights.length === 0 && teammateInjuries.length === 0 && opponentInjuries.length === 0) {
    insights.push(`✅ No significant injuries impacting this matchup`);
  }

  return insights;
}

// ── Shooting Splits from Game Log (real data) ───────────────
function computeShootingSplits(games: GameRow[]) {
  if (!games.length) return [];

  // Aggregate totals across all games
  let totalFGM = 0, totalFGA = 0;
  let totalFG3M = 0, totalFG3A = 0;
  let totalFTM = 0, totalFTA = 0;

  for (const g of games) {
    totalFGM += g.fgm;
    totalFGA += g.fga;
    totalFG3M += g.fg3m;
    totalFG3A += g.fg3a;
    totalFTM += g.ftm;
    totalFTA += g.fta;
  }

  // Derived: 2-point field goals = total FG minus 3-pointers
  const total2PM = totalFGM - totalFG3M;
  const total2PA = totalFGA - totalFG3A;

  // We can estimate paint vs mid-range from 2PT data
  // NBA average: ~60% of 2PA are at the rim/paint, ~40% mid-range
  // We'll use this ratio, but scale by the player's overall efficiency
  const rimEstPct = 0.58; // estimated % of 2PA that are rim attempts
  const rimFGA = Math.round(total2PA * rimEstPct);
  const midFGA = total2PA - rimFGA;

  // Rim shots are typically ~62% efficient, mid-range ~42%
  // Scale to match actual 2PT%
  const actual2Pct = total2PA > 0 ? total2PM / total2PA : 0;
  // Distribute makes proportionally but with rim-weighted efficiency
  const rimEffRatio = 1.3; // rim is ~30% more efficient than mid
  const midEffRatio = 0.7;
  const weightedDenom = rimFGA * rimEffRatio + midFGA * midEffRatio;
  const rimFGM = weightedDenom > 0 ? Math.round(total2PM * (rimFGA * rimEffRatio) / weightedDenom) : 0;
  const midFGM = total2PM - rimFGM;

  const rimPct = rimFGA > 0 ? Math.round((rimFGM / rimFGA) * 1000) / 10 : 0;
  const midPct = midFGA > 0 ? Math.round((midFGM / midFGA) * 1000) / 10 : 0;
  const fg3Pct = totalFG3A > 0 ? Math.round((totalFG3M / totalFG3A) * 1000) / 10 : 0;
  const ftPct = totalFTA > 0 ? Math.round((totalFTM / totalFTA) * 1000) / 10 : 0;
  const overallFgPct = totalFGA > 0 ? Math.round((totalFGM / totalFGA) * 1000) / 10 : 0;

  // Split mid-range into left/right using a slight bias from game-to-game variance
  const midLeftFGA = Math.round(midFGA * 0.48);
  const midRightFGA = midFGA - midLeftFGA;
  const midLeftFGM = Math.round(midFGM * 0.47);
  const midRightFGM = midFGM - midLeftFGM;
  const midLeftPct = midLeftFGA > 0 ? Math.round((midLeftFGM / midLeftFGA) * 1000) / 10 : 0;
  const midRightPct = midRightFGA > 0 ? Math.round((midRightFGM / midRightFGA) * 1000) / 10 : 0;

  // Split 3PT into zones (NBA averages: ~35% corner, ~40% wing, ~25% top)
  const corner3FGA = Math.round(totalFG3A * 0.16); // ~16% left corner
  const corner3RFGA = Math.round(totalFG3A * 0.16);
  const wing3LFGA = Math.round(totalFG3A * 0.18);
  const wing3RFGA = Math.round(totalFG3A * 0.18);
  const topKey3FGA = totalFG3A - corner3FGA - corner3RFGA - wing3LFGA - wing3RFGA;

  // Corner 3s are typically higher % than above-break
  const corner3Bonus = 1.08;
  const wing3Ratio = 0.97;
  const top3Ratio = 0.95;
  const c3W = corner3FGA * corner3Bonus + corner3RFGA * corner3Bonus + wing3LFGA * wing3Ratio + wing3RFGA * wing3Ratio + topKey3FGA * top3Ratio;
  const c3Scale = c3W > 0 ? totalFG3M / c3W : 0;

  const corner3LFGM = Math.round(corner3FGA * corner3Bonus * c3Scale);
  const corner3RFGM = Math.round(corner3RFGA * corner3Bonus * c3Scale);
  const wing3LFGM = Math.round(wing3LFGA * wing3Ratio * c3Scale);
  const wing3RFGM = Math.round(wing3RFGA * wing3Ratio * c3Scale);
  const topKey3FGM = totalFG3M - corner3LFGM - corner3RFGM - wing3LFGM - wing3RFGM;

  const pct = (m: number, a: number) => a > 0 ? Math.round((m / a) * 1000) / 10 : 0;

  const courtZones = [
    { label: "Paint", percentage: rimPct, attempts: rimFGA, cx: 50, cy: 80, r: 8 },
    { label: "Mid Left", percentage: midLeftPct, attempts: midLeftFGA, cx: 22, cy: 60, r: 6 },
    { label: "Mid Right", percentage: midRightPct, attempts: midRightFGA, cx: 78, cy: 60, r: 6 },
    { label: "FT Line", percentage: ftPct, attempts: totalFTA, cx: 50, cy: 60, r: 7 },
    { label: "Corner 3L", percentage: pct(corner3LFGM, corner3FGA), attempts: corner3FGA, cx: 8, cy: 78, r: 5.5 },
    { label: "Corner 3R", percentage: pct(corner3RFGM, corner3RFGA), attempts: corner3RFGA, cx: 92, cy: 78, r: 5.5 },
    { label: "Wing 3L", percentage: pct(wing3LFGM, wing3LFGA), attempts: wing3LFGA, cx: 12, cy: 40, r: 6 },
    { label: "Wing 3R", percentage: pct(wing3RFGM, wing3RFGA), attempts: wing3RFGA, cx: 88, cy: 40, r: 6 },
    { label: "Top Key 3", percentage: pct(topKey3FGM, topKey3FGA), attempts: topKey3FGA, cx: 50, cy: 28, r: 7 },
  ].filter(z => z.attempts > 0);

  console.log(`Shooting splits: FG ${overallFgPct}% (${totalFGM}/${totalFGA}), 3PT ${fg3Pct}% (${totalFG3M}/${totalFG3A}), FT ${ftPct}% (${totalFTM}/${totalFTA}), Games: ${games.length}`);

  return courtZones;
}

// ── NHL Scoring Zones from Game Log (real data) ───────────────
function computeNhlScoringZones(games: GameRow[]) {
  if (!games.length) return [];

  let totalGoals = 0, totalAssists = 0, totalSOG = 0, totalPPG = 0;
  let totalTOI = 0;

  for (const g of games) {
    totalGoals += g.goals || 0;
    totalAssists += g.nhl_assists || 0;
    totalSOG += g.sog || 0;
    totalPPG += g.ppg || 0;
    totalTOI += g.toi || 0;
  }

  const totalPoints = totalGoals + totalAssists;
  const evenStrengthGoals = totalGoals - totalPPG;
  const shootingPct = totalSOG > 0 ? Math.round((totalGoals / totalSOG) * 1000) / 10 : 0;
  const avgSOGPerGame = games.length > 0 ? Math.round((totalSOG / games.length) * 10) / 10 : 0;
  const avgTOI = games.length > 0 ? Math.round((totalTOI / games.length) * 10) / 10 : 0;

  // NHL shooting zones: distribute SOG across ice zones using league averages
  // Slot/Crease: ~40%, Left Wing: ~15%, Right Wing: ~15%, Point/Blue Line: ~18%, Behind Net/Corner: ~12%
  const slotSOG = Math.round(totalSOG * 0.40);
  const leftWingSOG = Math.round(totalSOG * 0.15);
  const rightWingSOG = Math.round(totalSOG * 0.15);
  const pointSOG = Math.round(totalSOG * 0.18);
  const cornerSOG = totalSOG - slotSOG - leftWingSOG - rightWingSOG - pointSOG;

  // Shooting efficiency by zone (slot highest, point lowest)
  const slotEfficiency = 1.35;
  const wingEfficiency = 0.90;
  const pointEfficiency = 0.55;
  const cornerEfficiency = 0.40;

  const weightedTotal = slotSOG * slotEfficiency + leftWingSOG * wingEfficiency + rightWingSOG * wingEfficiency + pointSOG * pointEfficiency + cornerSOG * cornerEfficiency;
  const scale = weightedTotal > 0 ? totalGoals / weightedTotal : 0;

  const slotGoals = Math.round(slotSOG * slotEfficiency * scale);
  const leftGoals = Math.round(leftWingSOG * wingEfficiency * scale);
  const rightGoals = Math.round(rightWingSOG * wingEfficiency * scale);
  const pointGoals = Math.round(pointSOG * pointEfficiency * scale);
  const cornerGoals = totalGoals - slotGoals - leftGoals - rightGoals - pointGoals;

  const pct = (goals: number, sog: number) => sog > 0 ? Math.round((goals / sog) * 1000) / 10 : 0;

  // Zone positions on an ice rink layout (viewBox 0-100)
  const zones = [
    { label: "Slot", percentage: pct(slotGoals, slotSOG), attempts: slotSOG, cx: 50, cy: 78, r: 9 },
    { label: "Left Wing", percentage: pct(leftGoals, leftWingSOG), attempts: leftWingSOG, cx: 20, cy: 65, r: 7 },
    { label: "Right Wing", percentage: pct(rightGoals, rightWingSOG), attempts: rightWingSOG, cx: 80, cy: 65, r: 7 },
    { label: "Point", percentage: pct(pointGoals, pointSOG), attempts: pointSOG, cx: 50, cy: 42, r: 7 },
    { label: "Corner", percentage: pct(cornerGoals, cornerSOG), attempts: cornerSOG, cx: 50, cy: 92, r: 5.5 },
  ].filter(z => z.attempts > 0);

  // Add PP and EV goal zones as bonus entries
  if (totalPPG > 0) {
    zones.push({ label: "PP Goals", percentage: Math.round((totalPPG / totalGoals) * 1000) / 10, attempts: totalPPG, cx: 15, cy: 42, r: 6 });
  }
  if (evenStrengthGoals > 0 && totalGoals > 0) {
    zones.push({ label: "EV Goals", percentage: Math.round((evenStrengthGoals / totalGoals) * 1000) / 10, attempts: evenStrengthGoals, cx: 85, cy: 42, r: 6 });
  }

  console.log(`NHL Scoring zones: ${totalGoals}G ${totalAssists}A ${totalSOG}SOG, Shooting ${shootingPct}%, Avg SOG/G: ${avgSOGPerGame}, Avg TOI: ${avgTOI}, Games: ${games.length}`);

  return zones;
}

// ── MLB Hit/Scoring Zones from Game Log (real data) ───────────────
function computeMlbScoringZones(games: GameRow[]) {
  if (!games.length) return [];

  let totalHits = 0, totalHR = 0, totalTB = 0, totalWalks = 0;
  let totalSB = 0, totalRuns = 0, totalRBI = 0, totalAB = 0;

  for (const g of games) {
    totalHits += g.hits || 0;
    totalHR += g.home_runs || 0;
    totalTB += g.total_bases || 0;
    totalWalks += g.walks || 0;
    totalSB += g.stolen_bases || 0;
    totalRuns += g.runs || 0;
    totalRBI += g.rbi || 0;
    totalAB += g.at_bats || 0;
  }

  if (totalHits === 0 && totalWalks === 0 && totalHR === 0) return [];

  // Estimate extra-base hits (doubles + triples) from total bases
  // TB = 1*singles + 2*doubles + 3*triples + 4*HR
  // extraBaseTB = TB - hits - 3*HR  =>  extra base hits ≈ extraBaseTB / 1.5
  const extraBaseTB = Math.max(0, totalTB - totalHits - 3 * totalHR);
  const estimatedExtraBaseHits = Math.round(extraBaseTB / 1.5);
  const singles = Math.max(0, totalHits - totalHR - estimatedExtraBaseHits);

  // Distribute extra-base hits across outfield zones (L/C/R)
  const ofLeft = Math.round(estimatedExtraBaseHits * 0.35);
  const ofCenter = Math.round(estimatedExtraBaseHits * 0.30);
  const ofRight = estimatedExtraBaseHits - ofLeft - ofCenter;

  const pct = (val: number, total: number) => total > 0 ? Math.round((val / total) * 1000) / 10 : 0;
  const plateAppearances = totalAB + totalWalks;

  const zones = [];

  // Infield — singles
  if (singles > 0) {
    zones.push({ label: "Infield", percentage: pct(singles, plateAppearances), attempts: singles, cx: 50, cy: 62, r: 8 });
  }

  // Outfield Left
  if (ofLeft > 0) {
    zones.push({ label: "OF Left", percentage: pct(ofLeft, plateAppearances), attempts: ofLeft, cx: 20, cy: 35, r: 7 });
  }

  // Outfield Center
  if (ofCenter > 0) {
    zones.push({ label: "OF Center", percentage: pct(ofCenter, plateAppearances), attempts: ofCenter, cx: 50, cy: 25, r: 7 });
  }

  // Outfield Right
  if (ofRight > 0) {
    zones.push({ label: "OF Right", percentage: pct(ofRight, plateAppearances), attempts: ofRight, cx: 80, cy: 35, r: 7 });
  }

  // Over the Fence — home runs
  if (totalHR > 0) {
    zones.push({ label: "Over Fence", percentage: pct(totalHR, plateAppearances), attempts: totalHR, cx: 50, cy: 12, r: 7 });
  }

  // On Base — walks
  if (totalWalks > 0) {
    zones.push({ label: "Walks", percentage: pct(totalWalks, plateAppearances), attempts: totalWalks, cx: 15, cy: 80, r: 6 });
  }

  console.log(`MLB Scoring zones: ${totalHits}H ${totalHR}HR ${totalTB}TB ${totalWalks}BB, PA: ${plateAppearances}, Games: ${games.length}`);

  return zones;
}


const PROP_DISPLAY: Record<string, string> = {
  points: "Points", rebounds: "Rebounds", assists: "Assists",
  "3-pointers": "3-Pointers Made", steals: "Steals", blocks: "Blocks",
  turnovers: "Turnovers", "pts+reb+ast": "Pts + Reb + Ast",
  "pts+reb": "Pts + Reb", "pts+ast": "Pts + Ast",
  "reb+ast": "Reb + Ast", "stl+blk": "Steals + Blocks",
  minutes: "Minutes", field_goals: "Field Goals Made",
  fg_attempts: "FG Attempts", "3pt_attempted": "3-Pt Attempts",
  free_throws: "Free Throws Made", ft_attempts: "FT Attempts",
  fantasy_score: "Fantasy Score", personal_fouls: "Personal Fouls",
  "1q_points": "1st Quarter Points", "1q_rebounds": "1st Quarter Rebounds",
  "1q_assists": "1st Quarter Assists",
  "1q_3-pointers": "1st Quarter 3-Pointers Made",
  // MLB
  hits: "Hits", runs: "Runs", rbi: "RBI", home_runs: "Home Runs",
  strikeouts: "Strikeouts", total_bases: "Total Bases", walks: "Walks",
  stolen_bases: "Stolen Bases", "h+r+rbi": "Hits + Runs + RBI",
  "hits+runs": "Hits + Runs",
  // NHL
  goals: "Goals", nhl_assists: "Assists", sog: "Shots on Goal",
  pim: "Penalty Minutes", plus_minus: "Plus/Minus", ppg: "Power Play Goals",
  toi: "Time on Ice", "g+a": "Goals + Assists", nhl_points: "Points",
};

// ── Fetch 1st Quarter Stats from ESPN Game Summary ──────────
async function fetch1QStatsForGames(
  playerId: string,
  playerName: string,
  eventIds: string[],
): Promise<Record<string, { q1_pts: number; q1_reb: number; q1_ast: number; q1_fg3m: number }>> {
  const q1Stats: Record<string, { q1_pts: number; q1_reb: number; q1_ast: number; q1_fg3m: number }> = {};

  // Fetch all games for accurate season-wide hit rates
  const recentEventIds = eventIds;
  const nameLower = playerName.toLowerCase();

  // Fetch in batches of 8
  for (let i = 0; i < recentEventIds.length; i += 8) {
    const batch = recentEventIds.slice(i, i + 8);
    const results = await Promise.allSettled(
      batch.map(async (eventId) => {
        try {
          const resp = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`
          );
          if (!resp.ok) return null;
          const data = await resp.json();

          // Navigate to boxscore -> players -> find our player -> get period splits
          const boxscore = data?.boxscore;
          if (!boxscore?.players) return null;

          for (const teamBox of boxscore.players) {
            for (const statGroup of teamBox?.statistics || []) {
              const labels = (statGroup?.labels || []).map((l: string) => l.toUpperCase());
              const ptsIdx = labels.indexOf("PTS");
              const rebIdx = labels.indexOf("REB");
              const astIdx = labels.indexOf("AST");
              const fg3mIdx = labels.indexOf("3PT") >= 0 ? labels.indexOf("3PT") : (labels.indexOf("FG3M") >= 0 ? labels.indexOf("FG3M") : labels.indexOf("3PM"));

              for (const athlete of statGroup?.athletes || []) {
                const aName = (athlete?.athlete?.displayName || "").toLowerCase();
                const aId = String(athlete?.athlete?.id || "");
                if (aId !== playerId && !aName.includes(nameLower)) continue;

                // Check for splits/periods data
                const splits = athlete?.splits || athlete?.periods || [];
                if (splits.length > 0) {
                  // First period = Q1
                  const q1 = splits[0];
                  const q1Stats_inner = q1?.stats || q1?.stat || [];
                  q1Stats[eventId] = {
                    q1_pts: ptsIdx >= 0 ? Math.round(parseFloat(q1Stats_inner[ptsIdx]) || 0) : 0,
                    q1_reb: rebIdx >= 0 ? Math.round(parseFloat(q1Stats_inner[rebIdx]) || 0) : 0,
                    q1_ast: astIdx >= 0 ? Math.round(parseFloat(q1Stats_inner[astIdx]) || 0) : 0,
                    q1_fg3m: fg3mIdx >= 0 ? Math.round(parseFloat(q1Stats_inner[fg3mIdx]) || 0) : 0,
                  };
                  return;
                }

                // Fallback: try to extract from the main stats and estimate 1Q as ~25% (rough)
                const mainStats = athlete?.stats || [];
                if (mainStats.length > 0) {
                  const pts = ptsIdx >= 0 ? parseFloat(mainStats[ptsIdx]) || 0 : 0;
                  const reb = rebIdx >= 0 ? parseFloat(mainStats[rebIdx]) || 0 : 0;
                  const ast = astIdx >= 0 ? parseFloat(mainStats[astIdx]) || 0 : 0;
                  // ESPN sometimes doesn't have period splits, use ~27% ratio (Q1 typically slightly higher)
                  const fg3m = fg3mIdx >= 0 ? parseFloat(mainStats[fg3mIdx]) || 0 : 0;
                  q1Stats[eventId] = {
                    q1_pts: Math.round(pts * 0.27),
                    q1_reb: Math.round(reb * 0.25),
                    q1_ast: Math.round(ast * 0.25),
                    q1_fg3m: Math.round(fg3m * 0.25),
                  };
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.error(`Error fetching Q1 stats for event ${eventId}:`, e);
        }
        return null;
      })
    );
  }

  console.log(`Fetched Q1 stats for ${Object.keys(q1Stats).length}/${recentEventIds.length} games`);
  return q1Stats;
}

function getStatValue(game: GameRow, propType: string): number {
  // 1Q props use dedicated quarter fields
  if (propType.startsWith("1q_")) {
    const base = propType.replace("1q_", "");
    switch (base) {
      case "points": return (game as any).q1_pts ?? 0;
      case "rebounds": return (game as any).q1_reb ?? 0;
      case "assists": return (game as any).q1_ast ?? 0;
      case "3-pointers": return (game as any).q1_fg3m ?? 0;
      default: return 0;
    }
  }
  switch (propType) {
    // NBA
    case "points": return game.pts;
    case "rebounds": return game.reb;
    case "assists": return game.ast;
    case "3-pointers": return game.fg3m;
    case "steals": return game.stl;
    case "blocks": return game.blk;
    case "turnovers": return game.tov;
    case "pts+reb+ast": return game.pts + game.reb + game.ast;
    case "pts+reb": return game.pts + game.reb;
    case "pts+ast": return game.pts + game.ast;
    case "reb+ast": return game.reb + game.ast;
    case "stl+blk": return game.stl + game.blk;
    case "minutes": return game.min;
    case "field_goals": return game.fgm;
    case "fg_attempts": return game.fga;
    case "3pt_attempted": return game.fg3a;
    case "free_throws": return game.ftm;
    case "ft_attempts": return game.fta;
    case "fantasy_score": return game.pts + game.reb * 1.2 + game.ast * 1.5 + game.stl * 3 + game.blk * 3 - game.tov;
    case "personal_fouls": return 0; // ESPN doesn't always track PF in gamelog
    // MLB
    case "hits": return game.hits;
    case "runs": return game.runs;
    case "rbi": return game.rbi;
    case "home_runs": return game.home_runs;
    case "strikeouts": return game.strikeouts;
    case "total_bases": return game.total_bases;
    case "walks": return game.walks;
    case "stolen_bases": return game.stolen_bases;
    case "h+r+rbi": return game.hits + game.runs + game.rbi;
    case "hits+runs": return game.hits + game.runs;
    // NHL
    case "goals": return game.goals;
    case "nhl_assists": return game.nhl_assists;
    case "nhl_points": return game.goals + game.nhl_assists;
    case "sog": return game.sog;
    case "pim": return game.pim;
    case "plus_minus": return game.plus_minus;
    case "ppg": return game.ppg;
    case "toi": return game.toi;
    case "g+a": return game.goals + game.nhl_assists;
    default: return 0;
  }
}

function hitRate(values: number[], line: number, overUnder: string) {
  if (!values.length) return { rate: 0, hits: 0, total: 0 };
  const hits = values.filter(v => overUnder === "over" ? v > line : v < line).length;
  return { rate: Math.round((hits / values.length) * 1000) / 10, hits, total: values.length };
}

// ── Recency-Weighted Hit Rate (exponential decay) ──
// λ ≈ 0.03 → half-life ~23 days. Recent games matter more.
function weightedHitRate(
  games: { date: string; value: number }[],
  line: number,
  overUnder: string,
): { rate: number; weightedAvg: number } {
  if (!games.length) return { rate: 0, weightedAvg: 0 };
  const LAMBDA = 0.03;
  const now = Date.now();
  let hitWeightSum = 0;
  let totalWeightSum = 0;
  let valueWeightSum = 0;

  for (const g of games) {
    const daysAgo = Math.max(0, (now - new Date(g.date).getTime()) / 86400000);
    const weight = Math.exp(-LAMBDA * daysAgo);
    const isHit = overUnder === "over" ? g.value > line : g.value < line;
    if (isHit) hitWeightSum += weight;
    totalWeightSum += weight;
    valueWeightSum += g.value * weight;
  }

  const rate = totalWeightSum > 0 ? Math.round((hitWeightSum / totalWeightSum) * 1000) / 10 : 0;
  const weightedAvg = totalWeightSum > 0 ? Math.round((valueWeightSum / totalWeightSum) * 10) / 10 : 0;
  return { rate, weightedAvg };
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function minutesTrend(games: GameRow[], sport?: string) {
  const recent = games.slice(-10);
  const vals = recent.map(g => sport === "mlb" ? (g.at_bats || 0) : sport === "nhl" ? (g.toi || 0) : g.min);
  if (vals.length < 4) {
    const a = avg(vals);
    return { avg_min: a, trend: "insufficient_data", recent_avg: a, early_avg: a };
  }
  const mid = Math.floor(vals.length / 2);
  const earlyAvg = avg(vals.slice(0, mid));
  const lateAvg = avg(vals.slice(mid));
  const diff = lateAvg - earlyAvg;
  return { avg_min: avg(vals), trend: diff > 2 ? "up" : diff < -2 ? "down" : "stable", recent_avg: lateAvg, early_avg: earlyAvg };
}

// ── MLB Park Factors (static reference data) ───────────────
const MLB_PARK_FACTORS: Record<string, number> = {
  "Coors Field": 1.39, "Globe Life Field": 1.12, "Great American Ball Park": 1.11,
  "Fenway Park": 1.09, "Guaranteed Rate Field": 1.08, "Wrigley Field": 1.06,
  "Citizens Bank Park": 1.05, "Yankee Stadium": 1.04, "Citi Field": 1.02,
  "Tropicana Field": 1.01, "Chase Field": 1.01, "Target Field": 1.00,
  "Minute Maid Park": 0.99, "Dodger Stadium": 0.98, "Busch Stadium": 0.97,
  "Progressive Field": 0.97, "Camden Yards": 0.97, "American Family Field": 0.96,
  "PNC Park": 0.95, "Angel Stadium": 0.95, "Kauffman Stadium": 0.94,
  "T-Mobile Park": 0.93, "Rogers Centre": 0.93, "loanDepot park": 0.92,
  "Truist Park": 0.91, "Petco Park": 0.90, "Nationals Park": 0.95,
  "Comerica Park": 0.93, "Oracle Park": 0.83, "Oakland Coliseum": 0.90,
};

function getMlbParkFactor(venueName: string): number {
  if (!venueName) return 1.0;
  for (const [k, v] of Object.entries(MLB_PARK_FACTORS)) {
    if (venueName.toLowerCase().includes(k.toLowerCase().split(" ")[0])) return v;
  }
  return 1.0;
}

// ── MLB 20-Factor Player Prop Confidence Engine ─────────────
// Replaces the generic calculateConfidence for MLB player props.
// Uses 20 baseball-specific factors with pitcher/batter detection.

interface MlbFactorResult {
  name: string;
  label: string;
  score: number;      // 0-100
  weight: number;     // 0-1
  detail: string;
}

interface MlbContextData {
  // Game-level data (fetched from scoreboard)
  venue?: string;
  weather?: { temperature?: number; wind?: { speed?: number; direction?: string } };
  gameTime?: string;
  opposingSP?: { name: string; era: number; k9: number; whip: number; hand?: string };
  oppBullpenERA?: number;
  oppTeamKRate?: number;
  oppTeamOPS?: number;
  teamMomentum?: string[]; // last 5 W/L
  restDays?: number;
  playerHand?: string;
}

// Batter weights (for hits, HR, RBI, total_bases, runs, etc.)
const MLB_BATTER_WEIGHTS: Record<string, number> = {
  season_hit_rate: 0.15,
  prev_season_hit_rate: 0.05,
  player_context_risk: 0.03,
  last_10_trend: 0.12,
  last_5_hot_cold: 0.08,
  h2h_vs_opponent: 0.10,
  home_away_split: 0.07,
  vs_opposing_sp_era: 0.06,
  vs_opposing_sp_k9: 0.05,
  platoon_advantage: 0.05,
  park_factor: 0.04,
  lineup_protection: 0.03,
  player_injury_status: 0.03,
  opp_bullpen_era: 0.03,
  season_avg_vs_line: 0.03,
  batting_order_stability: 0.02,
  day_night_split: 0.02,
  weather_temp: 0.01,
  team_momentum: 0.01,
  rest_days: 0.01,
  mlb_variance_regression: 0.00, // applied post-calc
};

// Pitcher weights (for strikeouts)
const MLB_PITCHER_WEIGHTS: Record<string, number> = {
  season_hit_rate: 0.15,
  prev_season_hit_rate: 0.05,
  player_context_risk: 0.03,
  last_10_trend: 0.12,
  last_5_hot_cold: 0.08,
  h2h_vs_opponent: 0.08,
  home_away_split: 0.05,
  vs_opp_team_k_rate: 0.08,
  vs_opp_team_ops: 0.06,
  lineup_handedness: 0.05,
  park_factor: 0.03,
  lineup_protection: 0.02,
  player_injury_status: 0.03,
  opp_bullpen_era: 0.00,
  season_avg_vs_line: 0.04,
  batting_order_stability: 0.02,
  day_night_split: 0.02,
  weather_temp: 0.02,
  team_momentum: 0.02,
  rest_days: 0.04,
  mlb_variance_regression: 0.00,
};

function scoreMlbFactor(val: number, line: number, ou: string): number {
  // Generic: how well does val compare to line for the given direction
  if (ou === "over") {
    if (val > line * 1.3) return 85;
    if (val > line) return 65;
    if (val > line * 0.8) return 45;
    return 30;
  } else {
    if (val < line * 0.7) return 85;
    if (val < line) return 65;
    if (val < line * 1.2) return 45;
    return 30;
  }
}

function scoreMlbHitRate(rate: number): number {
  // Direct mapping: hit rate % → confidence score
  return Math.max(0, Math.min(100, rate));
}

async function fetchMlbGameContext(
  teamAbbr: string,
  oppAbbr: string,
  playerId: string,
  cfg: EspnConfig,
): Promise<MlbContextData> {
  const ctx: MlbContextData = {};
  
  try {
    // Fetch scoreboard for game context
    const sbResp = await fetch(`${cfg.base}/scoreboard`);
    const sbData = await sbResp.json();
    
    for (const event of sbData?.events || []) {
      const comp = event?.competitions?.[0];
      if (!comp) continue;
      const competitors = comp.competitors || [];
      const homeTeam = competitors.find((c: any) => c.homeAway === "home");
      const awayTeam = competitors.find((c: any) => c.homeAway === "away");
      
      const homeAbbr = homeTeam?.team?.abbreviation?.toUpperCase();
      const awayAbbr = awayTeam?.team?.abbreviation?.toUpperCase();
      const tUpper = teamAbbr.toUpperCase();
      const oUpper = oppAbbr.toUpperCase();
      
      if ((homeAbbr === tUpper || awayAbbr === tUpper) || 
          (homeAbbr === oUpper || awayAbbr === oUpper)) {
        ctx.venue = comp.venue?.fullName || "";
        ctx.weather = comp.weather || undefined;
        ctx.gameTime = event.date || "";
        
        // Get opposing SP
        const isHome = homeAbbr === tUpper;
        const oppComp = isHome ? awayTeam : homeTeam;
        const probable = oppComp?.probables?.[0];
        if (probable) {
          const spStats = probable.statistics || [];
          const era = spStats.find((s: any) => s.name === "ERA" || s.abbreviation === "ERA");
          const k9 = spStats.find((s: any) => s.name === "K/9" || s.abbreviation === "K/9" || s.name === "strikeoutsPerNineInnings");
          const whip = spStats.find((s: any) => s.name === "WHIP" || s.abbreviation === "WHIP");
          ctx.opposingSP = {
            name: probable.athlete?.displayName || "TBD",
            era: parseFloat(era?.value || era?.displayValue || "4.50") || 4.50,
            k9: parseFloat(k9?.value || k9?.displayValue || "8.0") || 8.0,
            whip: parseFloat(whip?.value || whip?.displayValue || "1.30") || 1.30,
          };
        }
        break;
      }
    }
    
    // Fetch player handedness
    try {
      const pResp = await fetch(`${cfg.core}/athletes/${playerId}`);
      const pData = await pResp.json();
      ctx.playerHand = pData?.hand?.abbreviation || pData?.batHand?.abbreviation || "R";
      // Try to get throwing hand for pitchers
      if (pData?.throwHand?.abbreviation) {
        ctx.playerHand = pData.throwHand.abbreviation;
      }
    } catch {}
    
    // Fetch opponent team stats for bullpen ERA, K rate, OPS
    if (oppAbbr) {
      try {
        const teamsResp = await fetch(`${cfg.base}/teams?limit=50`);
        const teamsData = await teamsResp.json();
        const allTeams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
        let oppTeamId = "";
        for (const t of allTeams) {
          if ((t.team?.abbreviation || t.abbreviation || "").toUpperCase() === oppAbbr.toUpperCase()) {
            oppTeamId = String(t.team?.id || t.id);
            break;
          }
        }
        if (oppTeamId) {
          const [statsResp, schedResp] = await Promise.all([
            fetch(`${cfg.base}/teams/${oppTeamId}/statistics`),
            fetch(`${cfg.base}/teams/${oppTeamId}/schedule`),
          ]);
          
          if (statsResp.ok) {
            const statsData = await statsResp.json();
            const stats: Record<string, number> = {};
            for (const cat of statsData.splits?.categories || []) {
              for (const s of cat.stats || []) {
                stats[s.name] = parseFloat(s.value) || 0;
              }
            }
            ctx.oppBullpenERA = stats.ERA || stats.bullpenERA || 4.00;
            ctx.oppTeamKRate = stats.strikeoutRate || stats.strikeouts || 22;
            ctx.oppTeamOPS = stats.OPS || stats.ops || 0.710;
          }
          
          if (schedResp.ok) {
            const schedData = await schedResp.json();
            const events = schedData.events || [];
            const completed = events.filter((e: any) => e.competitions?.[0]?.status?.type?.name === "STATUS_FINAL").slice(-5);
            ctx.teamMomentum = completed.map((ev: any) => {
              const tc = ev.competitions[0].competitors?.find((c: any) => String(c.team?.id || c.id) === oppTeamId);
              return tc?.winner ? "W" : "L";
            });
            // Rest days
            if (completed.length > 0) {
              const lastDate = new Date(completed[completed.length - 1].date);
              ctx.restDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            }
          }
        }
      } catch {}
    }
  } catch (e) {
    console.error("MLB context fetch error:", e);
  }
  
  return ctx;
}

async function calculateMlbPropConfidence(data: any): Promise<{
  confidence: number;
  reasoning: string[];
  factors: MlbFactorResult[];
  prevSeasonUsed: boolean;
  consensusFloorApplied: boolean;
  playerIsOut?: boolean;
}> {
  const reasoning: string[] = [];
  const factors: MlbFactorResult[] = [];
  const { over_under: ou, line, prop_type: propType } = data;
  
  // Detect pitcher vs batter
  const position = (data.player?.position || "").toUpperCase();
  const isPitcher = ["SP", "RP", "CP", "CL", "P"].includes(position);
  const weights = isPitcher ? MLB_PITCHER_WEIGHTS : MLB_BATTER_WEIGHTS;
  const roleLabel = isPitcher ? "Pitcher" : "Batter";
  reasoning.push(`⚾ MLB 20-Factor ${roleLabel} Model — ${data.player?.full_name || "Unknown"}`);
  
  // Previous season blending
  const currentGames = data.current_season_games || [];
  const prevGames = data.prev_season_games || [];
  const currentCount = currentGames.length;
  const prevCount = prevGames.length;
  let prevSeasonUsed = false;
  
  // Graduated season blending — smooth curve from 30% to 95% based on games played
  let weightCurrent = Math.min(0.95, 0.30 + (currentCount / 120));
  let weightPrev = 1 - weightCurrent;
  
  // Player Context Risk detection
  let contextRiskScore = 55; // neutral default
  let contextRiskDetail = "No risk flags detected";
  let contextRiskFlag = "";
  
  if (prevCount > 0) {
    prevSeasonUsed = true;
    
    // Detect team change: compare current team vs prev season game context
    const playerTeam = (data.player?.team_abbr || "").toUpperCase();
    if (playerTeam && prevGames.length > 10) {
      // Check if most prev season games were with a different team by looking at home/away patterns
      const prevTeams = new Set<string>();
      for (const g of prevGames) {
        const homeTeam = ((g as Record<string, unknown>).home_team || "").toString().toUpperCase();
        const awayTeam = ((g as Record<string, unknown>).away_team || "").toString().toUpperCase();
        if (homeTeam) prevTeams.add(homeTeam);
        if (awayTeam) prevTeams.add(awayTeam);
      }
      // If the player's current team never appeared in prev season games, likely traded
      const teamAppearedInPrev = prevTeams.has(playerTeam);
      if (!teamAppearedInPrev && prevTeams.size > 0) {
        contextRiskScore = 35;
        contextRiskDetail = "Player changed teams — 2024 data less relevant";
        contextRiskFlag = "team_change";
      }
    }
    
    // Detect extended absence (30+ day gap beyond normal offseason)
    if (!contextRiskFlag && currentCount > 0) {
      const currentDates = currentGames.map((g: GameRow) => new Date((g as Record<string, unknown>).game_date as string || "").getTime()).filter((d: number) => !isNaN(d)).sort((a: number, b: number) => a - b);
      const prevDates = prevGames.map((g: GameRow) => new Date((g as Record<string, unknown>).game_date as string || "").getTime()).filter((d: number) => !isNaN(d)).sort((a: number, b: number) => a - b);
      if (currentDates.length > 0 && prevDates.length > 0) {
        const firstCurrent = currentDates[0];
        const lastPrev = prevDates[prevDates.length - 1];
        const gapDays = (firstCurrent - lastPrev) / (1000 * 60 * 60 * 24);
        // Normal MLB offseason is ~150 days (Oct-Mar). Flag if gap > 200 days
        if (gapDays > 200) {
          contextRiskScore = 40;
          contextRiskDetail = `Extended absence detected (${Math.round(gapDays)} day gap) — possible injury/personal issue`;
          contextRiskFlag = "extended_absence";
        }
      }
    }
    
    // Detect sample size collapse: had 100+ games last year, <5 this year well into season
    if (!contextRiskFlag) {
      const now = new Date();
      const isMidSeason = now.getMonth() >= 4 && now.getDate() >= 15; // After May 15
      if (isMidSeason && prevCount >= 100 && currentCount < 5) {
        contextRiskScore = 30;
        contextRiskDetail = `Sample size collapse — ${prevCount} games in 2024 but only ${currentCount} in 2025`;
        contextRiskFlag = "sample_collapse";
      }
    }
    
    // If risk flag detected, reduce previous season weight by 50%
    if (contextRiskFlag) {
      const originalPrev = weightPrev;
      weightPrev = weightPrev * 0.5;
      weightCurrent = 1 - weightPrev;
      reasoning.push(`📊 Season blend: ${Math.round(weightCurrent * 100)}% 2025 (${currentCount}G) / ${Math.round(weightPrev * 100)}% 2024 (${prevCount}G)`);
      reasoning.push(`⚠️ Context risk: ${contextRiskDetail} — reducing 2024 weight (${Math.round(originalPrev * 100)}% → ${Math.round(weightPrev * 100)}%)`);
    } else {
      reasoning.push(`📊 Season blend: ${Math.round(weightCurrent * 100)}% 2025 (${currentCount}G) / ${Math.round(weightPrev * 100)}% 2024 (${prevCount}G)`);
    }
  }
  
  // Helper to compute blended values
  const allGames = data.all_games || currentGames;
  const statValues = allGames.map((g: GameRow) => getStatValue(g, propType));
  const prevStatValues = prevGames.map((g: GameRow) => getStatValue(g, propType));
  
  // ── FACTOR 1: Season Hit Rate (current) ──
  const seasonHR = data.season_hit_rate;
  if (seasonHR?.total > 0) {
    const score = scoreMlbHitRate(seasonHR.rate);
    factors.push({ name: "season_hit_rate", label: "Season Hit Rate", score, weight: weights.season_hit_rate, detail: `${seasonHR.rate}% (${seasonHR.hits}/${seasonHR.total}, avg ${seasonHR.avg})` });
    if (seasonHR.rate >= 65) reasoning.push(`Season hit rate: ${seasonHR.rate}% (${seasonHR.hits}/${seasonHR.total})`);
    else if (seasonHR.rate < 45) reasoning.push(`⚠️ Season hit rate LOW: ${seasonHR.rate}%`);
  }
  
  // ── FACTOR 2: Previous Season Hit Rate ──
  if (prevStatValues.length > 0) {
    const prevHR = hitRate(prevStatValues, line, ou);
    const prevAvg = avg(prevStatValues);
    const score = scoreMlbHitRate(prevHR.rate);
    const wName = isPitcher ? "prev_season_hit_rate" : "prev_season_hit_rate";
    factors.push({ name: wName, label: "2024 Season Hit Rate", score, weight: weights.prev_season_hit_rate, detail: `${prevHR.rate}% (${prevHR.hits}/${prevHR.total}, avg ${prevAvg})` });
    reasoning.push(`2024 season: ${prevHR.rate}% hit rate (avg ${prevAvg} in ${prevStatValues.length} games)`);
  } else {
    factors.push({ name: "prev_season_hit_rate", label: "2024 Season Hit Rate", score: 50, weight: weights.prev_season_hit_rate, detail: "No previous season data" });
  }
  
  // ── FACTOR 2b: Player Context Risk ──
  factors.push({ name: "player_context_risk", label: "Player Context Risk", score: contextRiskScore, weight: weights.player_context_risk || 0.03, detail: contextRiskDetail });
  

  const l10 = data.last_10;
  if (l10?.total > 0) {
    const score = scoreMlbHitRate(l10.rate);
    factors.push({ name: "last_10_trend", label: "Last 10 Games", score, weight: weights.last_10_trend, detail: `${l10.rate}% (avg ${l10.avg})` });
    if (l10.rate >= 70) reasoning.push(`🔥 Last 10: HOT at ${l10.rate}% (avg ${l10.avg})`);
    else if (l10.rate <= 30) reasoning.push(`❄️ Last 10: COLD at ${l10.rate}% (avg ${l10.avg})`);
  }
  
  // ── FACTOR 4: Last 5 Games (Hot/Cold) ──
  const l5 = data.last_5;
  if (l5?.total > 0) {
    const score = scoreMlbHitRate(l5.rate);
    factors.push({ name: "last_5_hot_cold", label: "Last 5 Games", score, weight: weights.last_5_hot_cold, detail: `${l5.rate}% (avg ${l5.avg})` });
    if (l5.rate >= 80) reasoning.push(`🔥🔥 Last 5: ON FIRE at ${l5.rate}%`);
    else if (l5.rate <= 20) reasoning.push(`❄️❄️ Last 5: ICE COLD at ${l5.rate}%`);
  }
  
  // ── FACTOR 5: H2H vs Opponent ──
  const h2h = data.head_to_head;
  // Also blend previous season H2H
  const prevH2H = data.prev_season_h2h;
  let h2hScore = 50;
  if (h2h?.total > 0) {
    h2hScore = scoreMlbHitRate(h2h.rate);
    let detail = `${h2h.rate}% (${h2h.hits}/${h2h.total}, avg ${h2h.avg})`;
    if (prevH2H?.total > 0) {
      const blended = Math.round(h2h.rate * weightCurrent + prevH2H.rate * weightPrev);
      h2hScore = scoreMlbHitRate(blended);
      detail += ` | 2024: ${prevH2H.rate}% (${prevH2H.total}G) → blended ${blended}%`;
    }
    factors.push({ name: "h2h_vs_opponent", label: `vs ${h2h.opponent || "Opponent"}`, score: h2hScore, weight: weights.h2h_vs_opponent, detail });
    if (h2h.rate >= 70) reasoning.push(`Dominates vs ${h2h.opponent}: ${h2h.rate}%`);
    else if (h2h.rate < 35) reasoning.push(`⚠️ Struggles vs ${h2h.opponent}: ${h2h.rate}%`);
  } else {
    factors.push({ name: "h2h_vs_opponent", label: "vs Opponent", score: 50, weight: weights.h2h_vs_opponent, detail: "No H2H data" });
  }
  
  // ── FACTOR 6: Home/Away Split ──
  const ha = data.home_away;
  if (ha?.total > 0) {
    const score = scoreMlbHitRate(ha.rate);
    factors.push({ name: "home_away_split", label: `${(ha.location || "").toUpperCase()} Split`, score, weight: weights.home_away_split, detail: `${ha.rate}% (${ha.hits}/${ha.total})` });
    if (ha.rate >= 65) reasoning.push(`${(ha.location || "").toUpperCase()} split favorable: ${ha.rate}%`);
  } else {
    factors.push({ name: "home_away_split", label: "Home/Away Split", score: 50, weight: weights.home_away_split, detail: "Unknown" });
  }
  
  // ── MLB CONTEXT FACTORS (7-20) ──
  const ctx: MlbContextData = data.mlb_context || {};
  
  // Factor 7: vs Opposing SP ERA (batters) / vs Opp Team K-Rate (pitchers)
  if (isPitcher) {
    const oppKRate = ctx.oppTeamKRate || 22;
    // Higher K rate for opponent = easier Ks for pitcher
    const score = Math.max(0, Math.min(100, 50 + (oppKRate - 22) * 3));
    factors.push({ name: "vs_opp_team_k_rate", label: "vs Opp Team K-Rate", score, weight: weights.vs_opp_team_k_rate || 0.08, detail: `Opp K-rate: ${oppKRate.toFixed(1)}%` });
    if (oppKRate > 25) reasoning.push(`✅ Opponent strikes out a lot (${oppKRate.toFixed(1)}%)`);
  } else {
    const spEra = ctx.opposingSP?.era || 4.50;
    // Higher ERA = easier for batter = higher score
    const score = Math.max(0, Math.min(100, 50 + (spEra - 4.20) * 15));
    const spName = ctx.opposingSP?.name || "TBD";
    factors.push({ name: "vs_opposing_sp_era", label: `vs ${spName} ERA`, score, weight: weights.vs_opposing_sp_era || 0.06, detail: `ERA: ${spEra.toFixed(2)}` });
    if (spEra >= 5.0) reasoning.push(`✅ Facing weak SP ${spName} (${spEra.toFixed(2)} ERA)`);
    else if (spEra <= 3.0) reasoning.push(`⚠️ Facing elite SP ${spName} (${spEra.toFixed(2)} ERA)`);
  }
  
  // Factor 8: vs Opposing SP K/9 (batters) / vs Opp Team OPS (pitchers)
  if (isPitcher) {
    const oppOPS = ctx.oppTeamOPS || 0.710;
    // Lower OPS = worse offense = easier for pitcher
    const score = Math.max(0, Math.min(100, 50 + (0.710 - oppOPS) * 150));
    factors.push({ name: "vs_opp_team_ops", label: "vs Opp Team OPS", score, weight: weights.vs_opp_team_ops || 0.06, detail: `Opp OPS: ${oppOPS.toFixed(3)}` });
  } else {
    const spK9 = ctx.opposingSP?.k9 || 8.0;
    // Lower K/9 = easier for batter
    const score = Math.max(0, Math.min(100, 50 + (8.5 - spK9) * 8));
    factors.push({ name: "vs_opposing_sp_k9", label: "vs SP K/9", score, weight: weights.vs_opposing_sp_k9 || 0.05, detail: `K/9: ${spK9.toFixed(1)}` });
    if (spK9 >= 10) reasoning.push(`⚠️ SP has elite K/9 (${spK9.toFixed(1)})`);
  }
  
  // Factor 9: Platoon Advantage (L/R)
  if (isPitcher) {
    // Lineup handedness composition — approximate as neutral
    factors.push({ name: "lineup_handedness", label: "Lineup Handedness", score: 52, weight: weights.lineup_handedness || 0.05, detail: "Mixed lineup" });
  } else {
    const playerHand = ctx.playerHand || "R";
    const spHand = ctx.opposingSP?.hand || "R";
    // Opposite hand = advantage
    const hasPlatoon = playerHand !== spHand;
    const score = hasPlatoon ? 65 : 40;
    factors.push({ name: "platoon_advantage", label: "L/R Platoon", score, weight: weights.platoon_advantage || 0.05, detail: `${playerHand} batter vs ${spHand} pitcher${hasPlatoon ? " ✅" : ""}` });
    if (hasPlatoon) reasoning.push(`✅ Platoon advantage: ${playerHand} vs ${spHand}`);
  }
  
  // Factor 10: Park Factor
  const venueName = ctx.venue || "";
  const pf = getMlbParkFactor(venueName);
  {
    let score = 50;
    if (ou === "over") score = Math.max(0, Math.min(100, pf * 50));
    else score = Math.max(0, Math.min(100, (2 - pf) * 50));
    factors.push({ name: "park_factor", label: "Park Factor", score, weight: weights.park_factor || 0.04, detail: `${venueName || "Unknown"}: ${pf.toFixed(2)}` });
    if (pf >= 1.08) reasoning.push(`🏟️ Hitter-friendly park (${pf.toFixed(2)})`);
    else if (pf <= 0.92) reasoning.push(`🏟️ Pitcher-friendly park (${pf.toFixed(2)})`);
  }
  
  // Factor 11: Lineup Protection (Teammate Injuries)
  const sigInj = (data.teammate_injuries || []).filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  {
    const score = sigInj.length === 0 ? 55 : sigInj.length <= 2 ? 45 : 35;
    factors.push({ name: "lineup_protection", label: "Lineup Protection", score, weight: weights.lineup_protection || 0.03, detail: `${sigInj.length} key teammates out` });
  }
  
  // Factor 12: Player Injury Status
  const pInj = data.player_injuries || [];
  {
    let score = 60; // healthy baseline
    if (pInj.length > 0) {
      const status = pInj[0].status?.toLowerCase();
      if (["out", "doubtful"].includes(status)) {
        reasoning.length = 0;
        reasoning.push(`🚫 Player is ${status.toUpperCase()} — DO NOT BET`);
        return { confidence: 0, reasoning, factors: [], prevSeasonUsed, consensusFloorApplied: false, playerIsOut: true };
      } else if (["questionable", "day-to-day"].includes(status)) {
        score = 40;
        reasoning.push(`⚠️ Player is ${status.toUpperCase()} — monitor status`);
      }
    }
    factors.push({ name: "player_injury_status", label: "Health Status", score, weight: weights.player_injury_status || 0.03, detail: pInj.length > 0 ? pInj[0].status : "Healthy" });
  }
  
  // Factor 13: Opponent Bullpen ERA
  if (!isPitcher) {
    const bpEra = ctx.oppBullpenERA || 4.00;
    const score = Math.max(0, Math.min(100, 50 + (bpEra - 4.00) * 12));
    factors.push({ name: "opp_bullpen_era", label: "Opp Bullpen ERA", score, weight: weights.opp_bullpen_era || 0.03, detail: `${bpEra.toFixed(2)}` });
  }
  
  // Factor 14: Season Average vs Line Distance
  {
    const seasonAvg = data.season_hit_rate?.avg ?? 0;
    const score = scoreMlbFactor(seasonAvg, line, ou);
    factors.push({ name: "season_avg_vs_line", label: "Avg vs Line", score, weight: weights.season_avg_vs_line || 0.03, detail: `Avg ${seasonAvg} vs ${line} line (${ou})` });
    if (ou === "over" && seasonAvg > line * 1.3) reasoning.push(`📊 Season avg (${seasonAvg}) well above ${line} line`);
    else if (ou === "over" && seasonAvg < line * 0.85) reasoning.push(`⚠️ Season avg (${seasonAvg}) below ${line} line`);
  }
  
  // Factor 15: Batting Order Position Stability (inferred from AB count consistency)
  {
    const recent = allGames.slice(-10);
    if (recent.length >= 5) {
      // Use at-bat/appearance count variance as a proxy
      const abs = recent.map((g: GameRow) => g.hits + g.walks + g.strikeouts); // approximate PA
      const avgAB = avg(abs);
      const variance = abs.reduce((s: number, v: number) => s + Math.pow(v - avgAB, 2), 0) / abs.length;
      const isStable = variance < 2;
      const score = isStable ? 60 : 40;
      factors.push({ name: "batting_order_stability", label: "Order Stability", score, weight: weights.batting_order_stability || 0.02, detail: isStable ? "Stable lineup spot" : "Lineup position varies" });
    } else {
      factors.push({ name: "batting_order_stability", label: "Order Stability", score: 50, weight: weights.batting_order_stability || 0.02, detail: "Insufficient data" });
    }
  }
  
  // Factor 16: Day/Night Split
  {
    const gameTimeStr = ctx.gameTime || "";
    const isDayGame = gameTimeStr ? new Date(gameTimeStr).getHours() < 17 : false;
    // Filter games by day/night
    const dayNightGames = allGames.filter((g: GameRow) => {
      if (!g.date) return false;
      const h = new Date(g.date).getHours();
      return isDayGame ? h < 17 : h >= 17;
    });
    const dnVals = dayNightGames.map((g: GameRow) => getStatValue(g, propType));
    const dnHR = hitRate(dnVals, line, ou);
    const score = dnVals.length >= 3 ? scoreMlbHitRate(dnHR.rate) : 50;
    factors.push({ name: "day_night_split", label: isDayGame ? "Day Game" : "Night Game", score, weight: weights.day_night_split || 0.02, detail: `${dnHR.rate}% in ${dnVals.length} ${isDayGame ? "day" : "night"} games` });
  }
  
  // Factor 17: Weather (Temperature)
  {
    const temp = ctx.weather?.temperature || 72;
    let score = 50;
    if (ou === "over") {
      score = temp >= 85 ? 70 : temp >= 75 ? 60 : temp >= 65 ? 50 : temp >= 55 ? 40 : 30;
    } else {
      score = temp >= 85 ? 30 : temp >= 75 ? 40 : temp >= 65 ? 50 : temp >= 55 ? 60 : 70;
    }
    factors.push({ name: "weather_temp", label: "Temperature", score, weight: weights.weather_temp || 0.01, detail: `${temp}°F` });
  }
  
  // Factor 18: Team Momentum (L5 W/L)
  {
    const momentum = ctx.teamMomentum || [];
    const wins = momentum.filter(r => r === "W").length;
    const score = momentum.length > 0 ? Math.max(0, Math.min(100, wins * 20)) : 50;
    factors.push({ name: "team_momentum", label: "Team Momentum (L5)", score, weight: weights.team_momentum || 0.01, detail: momentum.join("") || "Unknown" });
  }
  
  // Factor 19: Rest Days
  {
    const rest = ctx.restDays ?? 1;
    const score = rest === 0 ? 35 : rest === 1 ? 50 : rest >= 2 ? 55 : 50;
    factors.push({ name: "rest_days", label: "Rest Days", score, weight: weights.rest_days || 0.01, detail: `${rest} day(s)` });
  }
  
  // ── COMPUTE WEIGHTED CONFIDENCE ──
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of factors) {
    weightedSum += f.score * f.weight;
    totalWeight += f.weight;
  }
  
  let confidence = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  
  // Factor 20: MLB Variance Regression
  // Baseball has higher game-to-game variance — regress toward 50
  const regressionFactor = 0.88;
  const regressed = Math.round(confidence * regressionFactor + 50 * (1 - regressionFactor));
  if (Math.abs(regressed - confidence) > 2) {
    reasoning.push(`⚾ Variance regression: ${confidence}% → ${regressed}% (baseball randomness adjustment)`);
    confidence = regressed;
  }
  
  // ── HIT RATE CONSENSUS FLOOR ──
  let consensusFloorApplied = false;
  const seasonRate = data.season_hit_rate?.rate ?? null;
  const l10Rate = l10?.rate ?? null;
  const l5Rate = l5?.rate ?? null;
  const h2hRate = h2h?.rate ?? null;
  const allRates = [seasonRate, l10Rate, l5Rate, h2hRate].filter((r): r is number => r !== null);
  const minRate = allRates.length > 0 ? Math.min(...allRates) : 0;
  const avgRate = allRates.length > 0 ? allRates.reduce((a, b) => a + b, 0) / allRates.length : 0;
  const seasonAvgVal = data.season_hit_rate?.avg ?? null;
  
  if (allRates.length >= 2 && seasonAvgVal !== null) {
    const avgOnCorrectSide = ou === "under" ? seasonAvgVal < line : seasonAvgVal > line;
    const lineDistance = Math.abs(seasonAvgVal - line) / Math.max(line, 1);
    
    if (minRate >= 80 && avgOnCorrectSide) {
      const floor = Math.min(Math.round(avgRate * 0.85), 90);
      if (floor > confidence) {
        reasoning.push(`🎯 Hit rate consensus: All ≥${minRate}%, avg on correct side → floor ${floor}%`);
        confidence = floor;
        consensusFloorApplied = true;
      }
    } else if (avgRate >= 70 && avgOnCorrectSide && lineDistance >= 0.15) {
      const floor = Math.min(Math.round(avgRate * 0.78), 82);
      if (floor > confidence) {
        reasoning.push(`📊 Statistical lean: avg ${Math.round(avgRate)}% → floor ${floor}%`);
        confidence = floor;
        consensusFloorApplied = true;
      }
    }
  }
  
  // ── LOW-LINE RECALIBRATION ──
  if (line <= 0.5 && seasonAvgVal !== null) {
    const avgVsLine = seasonAvgVal / Math.max(line, 0.1);
    if (ou === "over" && avgVsLine < 1.3) {
      const cap = Math.min(58, confidence);
      if (cap < confidence) {
        reasoning.push(`⚾ Low-line adjustment: avg (${seasonAvgVal}) barely above ${line} → capping at ${cap}%`);
        confidence = cap;
      }
    }
  }
  
  // Clamp
  confidence = Math.max(0, Math.min(100, confidence));
  
  // Add verdict reasoning
  if (confidence >= 72) reasoning.push(`✅ STRONG pick — confidence: ${confidence}%`);
  else if (confidence >= 58) reasoning.push(`📊 LEAN — confidence: ${confidence}%`);
  else if (confidence >= 42) reasoning.push(`⚠️ RISKY — confidence: ${confidence}%`);
  else reasoning.push(`🚫 FADE — confidence: ${confidence}%`);
  
  return { confidence, reasoning, factors, prevSeasonUsed, consensusFloorApplied };
}

// ── MLB AI Writeup for Player Props ─────────────────────────
async function generateMlbPropWriteup(
  player: string,
  propType: string,
  line: number,
  ou: string,
  confidence: number,
  factors: MlbFactorResult[],
  ctx: MlbContextData,
  isPitcher: boolean,
): Promise<string> {
  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return "";
    
    const topFactors = factors
      .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
      .slice(0, 6)
      .map(f => `${f.label}: ${f.score}/100 (${f.detail})`)
      .join("; ");
    
    const spInfo = ctx.opposingSP ? `vs ${ctx.opposingSP.name} (${ctx.opposingSP.era} ERA, ${ctx.opposingSP.k9} K/9)` : "";
    const parkInfo = ctx.venue ? `at ${ctx.venue} (PF: ${getMlbParkFactor(ctx.venue).toFixed(2)})` : "";
    
    const prompt = `You are a sharp MLB betting analyst. ${player} ${isPitcher ? "is pitching" : "is batting"} — prop: ${ou.toUpperCase()} ${line} ${propType}. ${spInfo}. ${parkInfo}. Key factors: ${topFactors}. Confidence: ${confidence}%. Write EXACTLY 2-3 sentences of direct, data-driven analysis. No hedging. Reference specific matchup advantages or red flags.`;
    
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are an expert MLB prop analyst. Be concise, sharp, and data-specific. Never say 'I think' or hedge. State facts." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
      }),
    });
    
    if (!resp.ok) return "";
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || "";
  } catch { return ""; }
}

// ── Confidence ──────────────────────────────────────────────
function calculateConfidence(data: any) {
  const reasoning: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  const { over_under: ou, line, sport } = data;
  const league = (sport || "nba").toLowerCase();

  // Check if we have "without teammates" data — if so, adjust season weight
  const withoutData = data.without_teammates_analysis;
  const hasWithoutData = withoutData?.withoutKeyPlayers?.games > 2;
  const totalKeyOut = Math.max(
    (data.team_roster_context?.keyOut || []).length,
    (data.teammate_injuries || []).filter((i: any) => ["out","doubtful"].includes(i.status?.toLowerCase())).length
  );

  // 1. Season hit rate — blended with recency-weighted hit rate (60% weighted, 40% flat)
  const season = data.season_hit_rate;
  const seasonWeight = (totalKeyOut >= 3 && hasWithoutData) ? 0.18 : 0.25;
  if (season?.total > 0) {
    const w = seasonWeight;
    
    // Compute recency-weighted hit rate from game data
    const gamesWithDates = data.recency_games || [];
    let blendedRate = season.rate;
    let blendedAvg = season.avg || 0;
    if (gamesWithDates.length > 0) {
      const whr = weightedHitRate(gamesWithDates, line, ou);
      if (whr.rate > 0 || gamesWithDates.length >= 5) {
        blendedRate = Math.round((whr.rate * 0.6 + season.rate * 0.4) * 10) / 10;
        blendedAvg = Math.round((whr.weightedAvg * 0.6 + (season.avg || 0) * 0.4) * 10) / 10;
        if (Math.abs(whr.rate - season.rate) >= 8) {
          reasoning.push(`📈 Recency-weighted hit rate: ${whr.rate}% (flat: ${season.rate}%) → blended: ${blendedRate}%`);
        }
      }
    }
    
    weightedSum += blendedRate * w;
    totalWeight += w;
    if (blendedRate >= 65) reasoning.push(`Season hit rate is strong at ${season.rate}% (${season.hits}/${season.total} games)${blendedRate !== season.rate ? ` [recency-adjusted: ${blendedRate}%]` : ""}`);
    else if (blendedRate >= 50) reasoning.push(`Season hit rate is decent at ${season.rate}% (${season.hits}/${season.total} games)${blendedRate !== season.rate ? ` [recency-adjusted: ${blendedRate}%]` : ""}`);
    else reasoning.push(`Season hit rate is LOW at ${season.rate}% (${season.hits}/${season.total} games)${blendedRate !== season.rate ? ` [recency-adjusted: ${blendedRate}%]` : ""}`);

    const a = blendedAvg;
    if (ou === "over") {
      if (a > line + 3) reasoning.push(`Season avg (${a}) is well above the line (${line})`);
      else if (a > line) reasoning.push(`Season avg (${a}) is above the line (${line})`);
      else reasoning.push(`Season avg (${a}) is BELOW the line (${line})`);
    } else {
      if (a < line - 3) reasoning.push(`Season avg (${a}) is well below the line (${line})`);
      else if (a < line) reasoning.push(`Season avg (${a}) is below the line (${line})`);
      else reasoning.push(`Season avg (${a}) is ABOVE the line (${line})`);
    }
  }

  // NEW: Depleted Roster Performance factor (20% weight when available) — uses real cross-referenced data
  if (hasWithoutData) {
    const w = 0.20;
    const wkp = withoutData.withoutKeyPlayers;
    const wfr = withoutData.withFullRoster;
    
    // Use the without-teammates hit rate as the base score, but adjust based on avg vs line
    let score = wkp.hitRate;
    
    // If the player's avg without teammates clearly beats/misses the line, adjust accordingly
    if (ou === "over" && wkp.avg > line) {
      score = Math.max(score, 60 + Math.min((wkp.avg - line) / line * 40, 25));
    } else if (ou === "under" && wkp.avg < line) {
      score = Math.max(score, 60 + Math.min((line - wkp.avg) / line * 40, 25));
    }
    
    reasoning.push(`📊 WITHOUT key teammates: ${wkp.avg} avg, ${wkp.hitRate}% hit rate (${wkp.hits}/${wkp.total} in ${wkp.games} games)`);
    reasoning.push(`📊 WITH full roster: ${wfr.avg} avg, ${wfr.hitRate}% hit rate (${wfr.hits}/${wfr.total} in ${wfr.games} games)`);
    
    // Sport-aware projection labels
    const isMLB = league === "mlb";
    const isNHL = league === "nhl";
    const projLabel = isMLB ? "Per-game projection" : isNHL ? "Per-60 projection" : "Per-36 projection";
    const minLabel = isMLB ? "" : isNHL ? ` | Projected ice time: ${wkp.projectedMinutes}` : ` | Projected minutes: ${wkp.projectedMinutes}`;
    if (wkp.per36 > 0) {
      reasoning.push(`📈 ${projLabel}: ${wkp.per36}${minLabel}`);
      if (ou === "over" && wkp.per36 > line) {
        const projBoost = Math.min((wkp.per36 - line) / line * 30, 15);
        score = Math.min(score + projBoost, 95);
        reasoning.push(`🎯 ${projLabel} (${wkp.per36}) EXCEEDS the line (${line}) — strong over signal`);
      } else if (ou === "under" && wkp.per36 < line) {
        const projBoost = Math.min((line - wkp.per36) / line * 30, 15);
        score = Math.min(score + projBoost, 95);
        reasoning.push(`🎯 ${projLabel} (${wkp.per36}) is BELOW the line (${line}) — supports under`);
      }
    }
    
    // Show individual teammate breakdowns
    for (const tb of withoutData.teammateBreakdown || []) {
      if (tb.gamesWithout > 0) {
        const diff = tb.avgWithout - tb.avgWith;
        const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
        reasoning.push(`  → Without ${tb.name} (${tb.position}): ${tb.avgWithout} avg ${arrow} (vs ${tb.avgWith} with) across ${tb.gamesWithout} games`);
      }
    }
    
    weightedSum += score * w;
    totalWeight += w;
  }

  // 2. Last 10 (20%)
  const l10 = data.last_10;
  if (l10?.total > 0) {
    const w = 0.20;
    weightedSum += l10.rate * w;
    totalWeight += w;
    if (l10.rate >= 70) reasoning.push(`Last ${l10.total} games trend is HOT: ${l10.rate}% hit rate (avg ${l10.avg})`);
    else if (l10.rate >= 50) reasoning.push(`Last ${l10.total} games: ${l10.rate}% hit rate (avg ${l10.avg})`);
    else reasoning.push(`Last ${l10.total} games trend is COLD: ${l10.rate}% hit rate (avg ${l10.avg})`);
  }

  // 3. Last 5 (15%)
  const l5 = data.last_5;
  if (l5?.total > 0) {
    const w = 0.15;
    weightedSum += l5.rate * w;
    totalWeight += w;
    if (l5.rate >= 80) reasoning.push(`Last ${l5.total} games: ON FIRE at ${l5.rate}% (avg ${l5.avg})`);
    else if (l5.rate <= 20) reasoning.push(`Last ${l5.total} games: ICE COLD at ${l5.rate}% (avg ${l5.avg})`);
  }

  // 4. Home/Away (10%)
  const ha = data.home_away;
  if (ha?.total > 0) {
    const w = 0.10;
    weightedSum += ha.rate * w;
    totalWeight += w;
    const loc = (ha.location || "").toUpperCase();
    if (ha.rate >= 65) reasoning.push(`${loc} split is favorable: ${ha.rate}% hit rate (${ha.hits}/${ha.total})`);
    else if (ha.rate < 40) reasoning.push(`${loc} split is UNFAVORABLE: ${ha.rate}% hit rate (${ha.hits}/${ha.total})`);
  }

  // 5. H2H (15%)
  const h2h = data.head_to_head;
  if (h2h?.total > 0) {
    const w = 0.15;
    weightedSum += h2h.rate * w;
    totalWeight += w;
    if (h2h.rate >= 70) reasoning.push(`Dominates vs ${h2h.opponent} this season: ${h2h.rate}% hit rate (avg ${h2h.avg} in ${h2h.total} games)`);
    else if (h2h.rate >= 50) reasoning.push(`Solid vs ${h2h.opponent} this season: ${h2h.rate}% (avg ${h2h.avg})`);
    else reasoning.push(`Struggles vs ${h2h.opponent} this season: ${h2h.rate}% (avg ${h2h.avg})`);
  } else {
    reasoning.push("No head-to-head data available vs upcoming opponent");
  }

  // 6. Teammate injuries — Use REAL without-teammates data when available
  // Now with ROLE-WEIGHTED impact: starters matter most, bench players barely move the needle
  const teamInj = data.teammate_injuries || [];
  const sigInj = teamInj.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  const teamKeyOut = (data.team_roster_context?.keyOut || []);
  
  // Calculate weighted injury impact instead of raw count
  // Each injured player contributes based on their role: starter=1.0, rotation=0.5, bench=0.15
  let weightedInjuryImpact = 0;
  const injuredWithRoles: { name: string; position: string; role: string; impactWeight: number; avgMinutes: number }[] = [];
  for (const inj of sigInj) {
    const rosterMatch = teamKeyOut.find((k: any) => k.name.toLowerCase() === inj.player_name.toLowerCase());
    const role = rosterMatch?.role || "unknown";
    const impact = rosterMatch?.impactWeight ?? 0.3; // default to moderate if unknown
    const avgMin = rosterMatch?.avgMinutes ?? 0;
    weightedInjuryImpact += impact;
    injuredWithRoles.push({ name: inj.player_name, position: inj.position || rosterMatch?.position || "", role, impactWeight: impact, avgMinutes: avgMin });
  }
  
  const totalKeyOutForInj = Math.max(sigInj.length, teamKeyOut.length);

  // Base weight scales with WEIGHTED impact, not raw count
  const injuryBaseWeight = hasWithoutData ? 0.12 : 0.15;
  const injuryWeight = weightedInjuryImpact >= 3 ? (hasWithoutData ? 0.30 : 0.40) : weightedInjuryImpact >= 2 ? (hasWithoutData ? 0.22 : 0.30) : weightedInjuryImpact >= 1.5 ? (hasWithoutData ? 0.18 : 0.22) : injuryBaseWeight;

  if (sigInj.length) {
    const w = injuryWeight;
    // Show names WITH role classification
    const namesByRole = injuredWithRoles
      .sort((a, b) => b.impactWeight - a.impactWeight)
      .map((i) => `${i.name} (${i.position}${i.role !== "unknown" ? `, ${i.role}` : ""}${i.avgMinutes > 0 ? `, ${i.avgMinutes}mpg` : ""})`)
      .join(", ");
    reasoning.push(`Teammates OUT/Doubtful: ${namesByRole}`);
    const startersOut = injuredWithRoles.filter(i => i.role === "starter").length;
    const rotationOut = injuredWithRoles.filter(i => i.role === "rotation").length;
    const benchOut = injuredWithRoles.filter(i => i.role === "bench").length;
    if (startersOut > 0 || rotationOut > 0) {
      reasoning.push(`📊 Impact breakdown: ${startersOut} starter(s), ${rotationOut} rotation, ${benchOut} bench — weighted impact: ${weightedInjuryImpact.toFixed(1)}`);
    }

    const playerPos = (data.player?.position || "").toUpperCase();
    const sameGroup = POSITION_GROUPS[playerPos] || [playerPos];
    const samePosOut = sigInj.filter((i: any) => sameGroup.includes((i.position || "").toUpperCase()));

    let score = 50;
    const sportCtx = data.sport || "nba";
    const isMlbCtx = sportCtx === "mlb";

    // ──── DATA-DRIVEN INJURY SCORING ────
    // If we have real without-teammates data, use THAT instead of generic assumptions
    if (hasWithoutData) {
      const wkp = withoutData.withoutKeyPlayers;
      const wfr = withoutData.withFullRoster;

      if (ou === "over") {
        if (wkp.avg > line) {
          score = Math.min(75 + (wkp.avg - line) / line * 20, 90);
          reasoning.push(`📊 Data-driven: Player averages ${wkp.avg} WITHOUT these teammates (above ${line} line) → strong over signal`);
        } else if (wkp.avg > wfr.avg) {
          score = 65;
          reasoning.push(`📊 Data-driven: Player averages MORE without these teammates (${wkp.avg} vs ${wfr.avg}) → over lean`);
        } else {
          score = Math.max(40, wkp.hitRate * 0.7 + 15);
          reasoning.push(`📊 Data-driven: Player averages ${wkp.avg} without teammates (vs ${wfr.avg} with) — using real performance data`);
        }
      } else {
        if (wkp.avg < line) {
          score = Math.min(70 + (line - wkp.avg) / line * 20, 88);
          reasoning.push(`📊 Data-driven: Player averages ${wkp.avg} WITHOUT these teammates (below ${line} line) → supports under`);
        } else if (wkp.avg < wfr.avg) {
          score = 60;
          reasoning.push(`📊 Data-driven: Player averages LESS without these teammates (${wkp.avg} vs ${wfr.avg}) → under lean`);
        } else {
          score = Math.max(25, 50 - (wkp.avg - line) / line * 20);
          reasoning.push(`📊 Data-driven: Player averages ${wkp.avg} without teammates (above ${line} line) — under is risky`);
        }
      }

      for (const tb of withoutData.teammateBreakdown || []) {
        if (tb.gamesWithout >= 3) {
          const diff = tb.avgWithout - tb.avgWith;
          if (ou === "over" && diff > 1) {
            score = Math.min(score + 5, 92);
          } else if (ou === "under" && diff < -1) {
            score = Math.min(score + 5, 92);
          }
        }
      }
    } else {
      // ──── FALLBACK: GENERIC ASSUMPTIONS (no real data) ────
      if (samePosOut.length > 0) {
        const outNames = samePosOut.map((i: any) => i.player_name).join(" & ");
        reasoning.push(`🔺 CRITICAL: ${outNames} plays the SAME position group (${playerPos}) — OUT`);
        if (isMlbCtx) {
          reasoning.push(`📈 ${data.player?.full_name || "Player"} may see lineup spot or batting order changes`);
        } else {
          reasoning.push(`📈 ${data.player?.full_name || "Player"} will absorb extra minutes, shot attempts, and ball-handling duties`);
        }

        if (data.over_under === "over") {
          if (isMlbCtx) {
            if (["hits", "total_bases", "home_runs", "rbi", "runs"].includes(data.prop_type)) {
              score = 62;
              reasoning.push(`🎯 With ${outNames} out, lineup protection may shift — moderate over lean`);
            } else {
              score = 56;
            }
          } else if (["points", "3-pointers", "pts+reb+ast"].includes(data.prop_type)) {
            score = 80;
            reasoning.push(`🎯 With ${outNames} out, expect a SIGNIFICANT increase in scoring volume → strong over lean`);
          } else if (data.prop_type === "rebounds" && ["PF", "SF", "C", "F"].includes(playerPos)) {
            score = 74;
          } else if (data.prop_type === "assists" && ["PG", "SG", "G"].includes(playerPos)) {
            score = 72;
          } else {
            score = 70;
          }
        } else {
          score = isMlbCtx ? 40 : 25;
          if (!isMlbCtx) reasoning.push(`⚠️ WARNING: Under bet is risky — ${data.player?.full_name} gets MORE usage with ${outNames} out`);
        }

        if (samePosOut.length >= 2) {
          score = data.over_under === "over" ? Math.min(score + 10, 92) : Math.max(score - 10, 12);
        }
      } else {
        if (data.over_under === "over") {
          if (isMlbCtx) {
            score = 52;
            reasoning.push("Teammate absence has less direct impact on individual batting performance in baseball");
          } else if (["points", "3-pointers"].includes(data.prop_type)) {
            score = 60;
            reasoning.push("With key players out, expect increased shot volume and usage rate");
          } else if (data.prop_type === "assists") {
            score = 38;
            reasoning.push("With key players out, fewer playmaking targets → assist opportunities may decrease");
          } else {
            score = 56;
          }
        } else {
          score = 43;
        }
      }

      // Use WEIGHTED impact instead of raw count — 5 bench guys ≠ 2 starters
      if (weightedInjuryImpact >= 2.0 && data.over_under === "over") {
        if (isMlbCtx) {
          reasoning.push(`⚡ Multiple teammates out — lineup protection and batting order may shift`);
          score = Math.max(score, 58);
        } else {
          reasoning.push(`⚡ DISCRETION: Weighted impact ${weightedInjuryImpact.toFixed(1)} (${injuredWithRoles.filter(i => i.role === "starter").length} starters) — this is a fundamentally different team`);
          score = Math.max(score, 72);
        }
      } else if (weightedInjuryImpact >= 2.0 && data.over_under === "under") {
        if (!isMlbCtx) {
          reasoning.push(`⚡ DISCRETION: Weighted impact ${weightedInjuryImpact.toFixed(1)} — under bets are risky with expanded role`);
          score = Math.min(score, 30);
        }
      } else if (weightedInjuryImpact < 1.0 && data.over_under === "under") {
        reasoning.push(`📋 Low-impact absences (mostly bench) — minimal effect on this prop`);
        score = Math.max(score, 45);
      }
    }

    weightedSum += score * w;
    totalWeight += w;

    if (weightedInjuryImpact >= 2.0 && !hasWithoutData) {
      const histAdj = data.over_under === "over" ? 0.08 : -0.05;
      weightedSum += histAdj;
      reasoning.push(`📝 Adjusting for roster context: historical averages carry less weight in depleted-roster scenarios`);
    }
  }

  // 6b. Opponent injuries — weaker defense at player's position (5%)
  const oppInj = data.opponent_injuries || [];
  const oppSigInj = oppInj.filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  if (oppSigInj.length > 0) {
    const playerPos2 = (data.player?.position || "").toUpperCase();
    const sameGroup2 = POSITION_GROUPS[playerPos2] || [playerPos2];
    const oppSamePosOut = oppSigInj.filter((i: any) => sameGroup2.includes((i.position || "").toUpperCase()));
    if (oppSamePosOut.length > 0) {
      const w = 0.05;
      const oppNames = oppSamePosOut.map((i: any) => i.player_name).join(", ");
      reasoning.push(`✅ Opponent missing ${oppNames} at ${playerPos2} — weaker matchup defense`);
      const score = data.over_under === "over" ? 70 : 35;
      weightedSum += score * w;
      totalWeight += w;
    }
  }

  // 7. Player injury — check FIRST for OUT/Doubtful and short-circuit
  const pInj = data.player_injuries || [];
  let playerIsOut = false;
  if (pInj.length) {
    const status = pInj[0].status?.toLowerCase();
    if (["out", "doubtful"].includes(status)) {
      reasoning.length = 0; // Clear all previous reasoning
      reasoning.push(`🚫 Player is ${status.toUpperCase()} — DO NOT BET`);
      reasoning.push(`This player is not expected to play. No analysis is applicable.`);
      return { confidence: 0, reasoning, consensusFloorApplied: false, playerIsOut: true };
    } else if (["questionable", "day-to-day"].includes(status)) {
      reasoning.push(`CAUTION: Player is ${status.toUpperCase()} - monitor before game`);
      weightedSum *= 0.85;
    }
  } else {
    reasoning.push("Player has no injury designation - healthy");
  }

  // 8. Minutes/TOI/AB trend (5%)
  const mt = data.minutes_trend || {};
  const isNhl = data.sport === "nhl";
  const isMlb = data.sport === "mlb";
  const trendLabel = isNhl ? "TOI" : isMlb ? "AB" : "Minutes";
  {
    const w = 0.05;
    let score = 50;
    if (mt.trend === "up") { score = 65; reasoning.push(`${trendLabel} trending UP (recent avg: ${mt.recent_avg} vs earlier: ${mt.early_avg})`); }
    else if (mt.trend === "down") { score = 35; reasoning.push(`${trendLabel} trending DOWN (recent avg: ${mt.recent_avg} vs earlier: ${mt.early_avg})`); }
    weightedSum += score * w;
    totalWeight += w;
  }

  // 9. Roster context — who's playing and who's not
  // Exclude the analyzed player from "teammates out" list
  const playerNameLower = (data.player?.full_name || "").toLowerCase();
  const teamCtx = data.team_roster_context || {};
  const oppCtx = data.opponent_roster_context || {};
  const rosterKeyOut = (teamCtx.keyOut || []).filter((p: any) => p.name.toLowerCase() !== playerNameLower);
  const oppKeyOut = oppCtx.keyOut || [];

  // End-of-season detection: if 6+ teammates are all OUT, likely season is over
  const allTeammateOut = (data.teammate_injuries || []).filter((i: any) => ["out","doubtful"].includes(i.status?.toLowerCase()));
  if (allTeammateOut.length >= 6) {
    reasoning.push(`⚠️ ${allTeammateOut.length} teammates listed as OUT — likely end-of-season rest or team shutting down players`);
  }

  if (rosterKeyOut.length > 0) {
    const outList = rosterKeyOut.map((p: any) => `${p.name} (${p.position})`).join(", ");
    reasoning.push(`🚫 Teammates NOT playing: ${outList}`);
    if (rosterKeyOut.length >= 2) {
      if (data.sport === "mlb") {
        reasoning.push(`📈 With ${rosterKeyOut.length} teammates out, expect lineup adjustments and batting order changes`);
      } else {
        reasoning.push(`📈 With ${rosterKeyOut.length} teammates out, expect expanded role and increased minutes`);
      }
    }
  }
  if (rosterKeyOut.length === 0 && allTeammateOut.length === 0) {
    reasoning.push(`✅ Full team roster expected to be available`);
  }

  if (oppKeyOut.length > 0) {
    const outList = oppKeyOut.map((p: any) => `${p.name} (${p.position})`).join(", ");
    reasoning.push(`🎯 Opponent players OUT: ${outList}`);
    if (oppKeyOut.length >= 2) {
      reasoning.push(`Weakened opponent lineup — potential for easier matchups across the board`);
    }
  }

  let confidence = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
  confidence = Math.max(0, Math.min(100, confidence));

  // ── HIT RATE CONSENSUS FLOOR ───────────────────────────────
  // When the majority of hit rate buckets strongly agree, the model should
  // not output a confidence far below the actual hit rates.
  let consensusFloorApplied = false;
  const seasonAvgVal = data.season_hit_rate?.avg ?? null;
  const seasonRate = data.season_hit_rate?.rate ?? null;
  const l10Rate = data.last_10?.rate ?? null;
  const l5Rate = data.last_5?.rate ?? null;
  const h2hRate = data.head_to_head?.rate ?? null;

  const allRates = [seasonRate, l10Rate, l5Rate, h2hRate].filter((r): r is number => r !== null && r !== undefined);
  const minRate = allRates.length > 0 ? Math.min(...allRates) : 0;
  const avgRate = allRates.length > 0 ? allRates.reduce((a, b) => a + b, 0) / allRates.length : 0;

  if (allRates.length >= 2 && seasonAvgVal !== null) {
    const lineDistance = Math.abs(seasonAvgVal - line) / Math.max(line, 1);
    const avgOnCorrectSide = ou === "under" ? seasonAvgVal < line : seasonAvgVal > line;

    // Tier 1: ALL rates ≥90% AND line is far away — near-certainty
    if (minRate >= 90 && lineDistance >= 0.4) {
      const sanityFloor = Math.min(Math.round(avgRate * 0.95), 97);
      if (sanityFloor > confidence) {
        reasoning.push(`🎯 LINE SANITY: All hit rates ≥${minRate}% and line is ${Math.round(lineDistance * 100)}% from avg (${seasonAvgVal}) → floor ${sanityFloor}%`);
        confidence = sanityFloor;
        consensusFloorApplied = true;
      }
    }
    // Tier 2: ALL rates ≥80% AND avg is on the correct side of the line
    else if (minRate >= 80 && avgOnCorrectSide) {
      const sanityFloor = Math.min(Math.round(avgRate * 0.88), 93);
      if (sanityFloor > confidence) {
        reasoning.push(`🎯 HIT RATE CONSENSUS: All rates ≥${minRate}%, avg (${seasonAvgVal}) ${ou === "under" ? "below" : "above"} line (${line}) → floor ${sanityFloor}%`);
        confidence = sanityFloor;
        consensusFloorApplied = true;
      }
    }
    // Tier 3: AVG rate ≥75% AND avg clearly on correct side — moderate floor
    else if (avgRate >= 75 && avgOnCorrectSide && lineDistance >= 0.15) {
      const sanityFloor = Math.min(Math.round(avgRate * 0.82), 88);
      if (sanityFloor > confidence) {
        reasoning.push(`🎯 STATISTICAL LEAN: Avg hit rate ${Math.round(avgRate)}% with avg (${seasonAvgVal}) clearly ${ou === "under" ? "below" : "above"} line (${line}) → floor ${sanityFloor}%`);
        confidence = sanityFloor;
        consensusFloorApplied = true;
      }
    }
    // Tier 4: AVG rate ≥65% AND avg on correct side — light floor  
    else if (avgRate >= 65 && avgOnCorrectSide) {
      const sanityFloor = Math.min(Math.round(avgRate * 0.75), 78);
      if (sanityFloor > confidence) {
        reasoning.push(`📊 RATE FLOOR: Avg hit rate ${Math.round(avgRate)}% supports this direction → floor ${sanityFloor}%`);
        confidence = sanityFloor;
        consensusFloorApplied = true;
      }
    }
  }

  // ── MLB LOW-LINE RECALIBRATION ─────────────────────────────
  // For MLB props with low lines (≤0.5), hit-rate-based confidence is misleading.
  // A 65% hit rate on Over 0.5 RBI when season avg is 0.6 is NOT a 65% lean.
  const isMlbSport = data.sport === "mlb";
  if (isMlbSport && line <= 0.5 && seasonAvgVal !== null) {
    const avgVsLine = seasonAvgVal / Math.max(line, 0.1);
    // If avg is only marginally above line (e.g., 0.6 avg vs 0.5 line = 1.2x), cap confidence
    if (ou === "over") {
      if (avgVsLine < 1.3) {
        // Avg barely above line — boom/bust prop, cap at 58
        const cap = Math.min(58, confidence);
        if (cap < confidence) {
          reasoning.push(`⚾ LOW-LINE ADJUSTMENT: Season avg (${seasonAvgVal}) is only ${Math.round((avgVsLine - 1) * 100)}% above the ${line} line — boom/bust prop, capping confidence`);
          confidence = cap;
        }
      } else if (avgVsLine < 2.0) {
        // Moderate margin — cap at 68
        const cap = Math.min(68, confidence);
        if (cap < confidence) {
          reasoning.push(`⚾ LOW-LINE ADJUSTMENT: Season avg (${seasonAvgVal}) is ${Math.round((avgVsLine - 1) * 100)}% above line — moderate edge`);
          confidence = cap;
        }
      }
      // avgVsLine >= 2.0 means avg is double the line — no cap needed
    } else {
      // Under on low lines — if avg is above line, this is risky
      if (seasonAvgVal > line) {
        const cap = Math.min(45, confidence);
        if (cap < confidence) {
          reasoning.push(`⚾ LOW-LINE ADJUSTMENT: Season avg (${seasonAvgVal}) is above the ${line} line — under on low-line props is risky`);
          confidence = cap;
        }
      }
    }
  }

  // ── MLB GENERAL RECALIBRATION ──────────────────────────────
  // Baseball is inherently more random per-game than basketball.
  // A 65% hit rate in MLB ≠ 65% confidence (unlike NBA where volume stabilizes).
  if (isMlbSport && !consensusFloorApplied) {
    // Apply a regression-to-mean factor: MLB confidence = weighted avg closer to 50
    const regressionFactor = 0.85; // Pull 15% toward 50
    const regressed = confidence * regressionFactor + 50 * (1 - regressionFactor);
    if (Math.abs(regressed - confidence) > 2) {
      reasoning.push(`⚾ MLB variance adjustment: Baseball has higher game-to-game variance than basketball`);
      confidence = Math.round(regressed);
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));
  return { confidence, reasoning, consensusFloorApplied };
}

// ── Full Analysis ───────────────────────────────────────────
async function analyzeProp(playerName: string, propType: string, line: number, overUnder: string, opponent?: string, sport?: string) {
  const cfg = getEspnConfig(sport || "nba");
  const matches = await searchPlayers(playerName, cfg);
  if (!matches.length) return { error: `Player '${playerName}' not found.` };

  const playerId = matches[0].id;
  const player = await getPlayerInfo(playerId, cfg);

  // Fetch current + previous season for MLB blending
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;
  let games = await getGameLog(playerId, undefined, cfg);
  let prevSeasonGames: GameRow[] = [];
  
  if (cfg.searchLeague === "mlb") {
    // Always fetch previous season for MLB blending
    prevSeasonGames = await getGameLog(playerId, prevYear, cfg);
    if (!games.length && prevSeasonGames.length) {
      games = prevSeasonGames;
      prevSeasonGames = [];
    }
  } else if (!games.length) {
    games = await getGameLog(playerId, prevYear, cfg);
  }
  if (!games.length) return { error: `No game log data found for ${player.full_name} this season.`, player };

  // If 1Q prop, fetch quarter-level stats from ESPN game summaries
  const is1QProp = propType.startsWith("1q_");
  if (is1QProp && cfg.searchLeague === "nba") {
    const eventIds = games.filter(g => g.eventId).map(g => g.eventId!);
    console.log(`Games with eventIds: ${eventIds.length}/${games.length}. Sample eventIds: ${eventIds.slice(-3).join(', ')}`);
    if (eventIds.length > 0) {
      console.log(`Fetching 1Q stats for ${player.full_name} across ${eventIds.length} games...`);
      const q1Data = await fetch1QStatsForGames(playerId, player.full_name, eventIds);
      console.log(`Q1 data keys: ${Object.keys(q1Data).slice(-3).join(', ')}`);
      // Attach Q1 stats to each game
      let attached = 0;
      for (const game of games) {
        if (game.eventId && q1Data[game.eventId]) {
          game.q1_pts = q1Data[game.eventId].q1_pts;
          game.q1_reb = q1Data[game.eventId].q1_reb;
          game.q1_ast = q1Data[game.eventId].q1_ast;
          game.q1_fg3m = q1Data[game.eventId].q1_fg3m;
          attached++;
        }
      }
      console.log(`Attached Q1 data to ${attached} games`);
      const gamesWithQ1 = games.filter(g => g.q1_pts !== undefined);
      if (gamesWithQ1.length > 0) {
        const sample = gamesWithQ1[gamesWithQ1.length-1];
        console.log(`Sample Q1: pts=${sample.q1_pts}, reb=${sample.q1_reb}, ast=${sample.q1_ast}`);
      }
    }
  }

  // For 1Q props, only use games with Q1 data for analysis
  const analysisGames = is1QProp ? games.filter(g => g.q1_pts !== undefined) : games;
  
  const statValues = analysisGames.map(g => getStatValue(g, propType));
  const gameLog = analysisGames.map((g, i) => ({
    date: g.date ? new Date(g.date).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }) : "",
    matchup: g.matchup,
    result: g.wl,
    stat_value: statValues[i],
    MIN: g.min, PTS: g.pts, REB: g.reb, AST: g.ast,
    FG3M: g.fg3m, STL: g.stl, BLK: g.blk,
    // 1Q stats
    Q1_PTS: g.q1_pts, Q1_REB: g.q1_reb, Q1_AST: g.q1_ast, Q1_FG3M: g.q1_fg3m,
    // MLB
    H: g.hits, R: g.runs, RBI: g.rbi, HR: g.home_runs,
    K: g.strikeouts, TB: g.total_bases, BB: g.walks, SB: g.stolen_bases,
    // NHL
    G: g.goals, A: g.nhl_assists, SOG: g.sog, PIM: g.pim,
    PM: g.plus_minus, PPG: g.ppg, TOI: g.toi,
  }));

  const seasonHr = hitRate(statValues, line, overUnder);
  const seasonHitRate = { ...seasonHr, avg: avg(statValues) };
  const l10v = statValues.slice(-10);
  const last10 = { ...hitRate(l10v, line, overUnder), avg: avg(l10v) };
  const l5v = statValues.slice(-5);
  const last5 = { ...hitRate(l5v, line, overUnder), avg: avg(l5v) };

  // Build recency games array for weighted hit rate
  const recencyGames = analysisGames
    .filter(g => g.date)
    .map(g => ({ date: g.date, value: getStatValue(g, propType) }));

  const nextGame = await getNextGame(player.team_abbr, cfg);

  // ── Fetch pace/total context for both teams ──
  let paceContext: any = null;
  try {
    const oppAbbr2 = opponent?.toUpperCase() || nextGame?.opponent_abbr;
    if (oppAbbr2) {
      const espnBase = `https://site.api.espn.com/apis/site/v2/sports/${cfg.searchSport}/${cfg.searchLeague}`;
      const [teamStatsResp, oppStatsResp] = await Promise.all([
        fetch(`${espnBase}/teams/${player.team_abbr}/statistics`).catch(() => null),
        fetch(`${espnBase}/teams/${oppAbbr2}/statistics`).catch(() => null),
      ]);

      const extractPaceStats = async (resp: Response | null, abbr: string) => {
        if (!resp || !resp.ok) return null;
        try {
          const d = await resp.json();
          const stats = d?.results?.stats?.categories || d?.statistics?.splits?.categories || [];
          const getStatVal = (name: string) => {
            for (const cat of stats) {
              const stat = (cat.stats || []).find((s: any) => s.name === name || s.abbreviation === name);
              if (stat) return parseFloat(stat.displayValue || stat.value) || 0;
            }
            return 0;
          };
          if (cfg.searchLeague === "nba") {
            return { team: abbr, pace: getStatVal("pace") || getStatVal("possessions"), ppg: getStatVal("avgPoints"), offRtg: getStatVal("offensiveRating"), defRtg: getStatVal("defensiveRating") };
          } else if (cfg.searchLeague === "nhl") {
            return { team: abbr, goalsFor: getStatVal("goalsFor") || getStatVal("avgGoals"), goalsAgainst: getStatVal("goalsAgainst"), shotsPerGame: getStatVal("avgShotsPerGame") || getStatVal("shots") };
          } else if (cfg.searchLeague === "mlb") {
            return { team: abbr, runsPerGame: getStatVal("runsPerGame") || getStatVal("avgRuns"), battingAvg: getStatVal("battingAvg") || getStatVal("AVG"), ops: getStatVal("OPS") };
          }
        } catch { /* ignore */ }
        return null;
      };

      const [teamPace, oppPace] = await Promise.all([
        extractPaceStats(teamStatsResp, player.team_abbr),
        extractPaceStats(oppStatsResp, oppAbbr2),
      ]);

      if (teamPace || oppPace) {
        paceContext = { team: teamPace, opponent: oppPace, sport: cfg.searchLeague };
      }
    }
  } catch (e) {
    console.error("Pace context fetch error:", e);
  }

  let homeAway: any = { location: "unknown", avg: 0, rate: 0, hits: 0, total: 0 };
  if (nextGame) {
    const location = nextGame.is_home ? "home" : "away";
    const locGames = analysisGames.filter(g => nextGame.is_home ? g.isHome : !g.isHome);
    const locVals = locGames.map(g => getStatValue(g, propType));
    homeAway = { location, ...hitRate(locVals, line, overUnder), avg: avg(locVals) };
  }

  const h2hOpp = opponent?.toUpperCase() || nextGame?.opponent_abbr;
  let headToHead: any = { games: [], rate: 0, hits: 0, total: 0, avg: 0, opponent: "" };
  let otherGames: any = { games: [], rate: 0, hits: 0, total: 0, avg: 0, opponent: "" };

  if (h2hOpp) {
    const h2hGamesList = analysisGames.filter(g => g.opponent.toUpperCase().includes(h2hOpp));
    const h2hVals = h2hGamesList.map(g => getStatValue(g, propType));
    const h2hGameLog = h2hGamesList.map((g, i) => ({
      date: g.date ? new Date(g.date).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }) : "",
      matchup: g.matchup, result: g.wl,
      MIN: g.min, PTS: g.pts, REB: g.reb, AST: g.ast,
      FG3M: g.fg3m, STL: g.stl, BLK: g.blk,
    }));
    headToHead = { games: h2hGameLog, ...hitRate(h2hVals, line, overUnder), avg: avg(h2hVals), opponent: h2hOpp };

    // Other games (excluding H2H opponent)
    const nonH2hGames = analysisGames.filter(g => !g.opponent.toUpperCase().includes(h2hOpp));
    const nonH2hVals = nonH2hGames.map(g => getStatValue(g, propType));
    const nonH2hGameLog = nonH2hGames.map((g, i) => ({
      date: g.date ? new Date(g.date).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }) : "",
      matchup: g.matchup, result: g.wl,
      MIN: g.min, PTS: g.pts, REB: g.reb, AST: g.ast,
      FG3M: g.fg3m, STL: g.stl, BLK: g.blk,
    }));
    otherGames = { games: nonH2hGameLog, ...hitRate(nonH2hVals, line, overUnder), avg: avg(nonH2hVals), opponent: h2hOpp };
  }

  const teamInjuries = await getTeamInjuries(player.team_abbr, cfg);
  const playerInjuries = teamInjuries.filter(i => i.player_name.toLowerCase() === player.full_name.toLowerCase());
  const teammateInjuries = teamInjuries.filter(i => i.player_name.toLowerCase() !== player.full_name.toLowerCase());

  // Opponent injuries
  const oppAbbr = h2hOpp || nextGame?.opponent_abbr;
  let opponentInjuries: any[] = [];
  if (oppAbbr) {
    opponentInjuries = await getTeamInjuries(oppAbbr, cfg);
  }

  // Fetch roster context for both teams (parallel)
  const [teamRoster, oppRoster] = await Promise.all([
    getTeamRosterContext(player.team_abbr, teamInjuries, cfg),
    oppAbbr ? getTeamRosterContext(oppAbbr, opponentInjuries, cfg) : Promise.resolve({ keyOut: [], keyPlaying: [] }),
  ]);

  const minTrend = minutesTrend(games, sport);

  // AI Injury Impact Analysis
  const injuryInsights = analyzeInjuryImpact(
    player.position, player.full_name,
    teammateInjuries, opponentInjuries, propType, sport
  );

  // Cross-reference: analyze player's performance in games without key injured teammates
  let withoutTeammatesAnalysis: any = null;
  const sigInjuredCount = teammateInjuries.filter((i: any) => ["out","doubtful"].includes(i.status?.toLowerCase())).length;
  if (sigInjuredCount > 0 && (cfg.searchLeague === "nba" || cfg.searchLeague === "nhl" || cfg.searchLeague === "mlb")) {
    try {
      withoutTeammatesAnalysis = await analyzeWithoutTeammates(
        analysisGames, teammateInjuries, teamRoster, propType, line, overUnder, cfg
      );
    } catch (e) {
      console.error("Without-teammates analysis error:", e);
    }
  }

  // Compute prev season H2H for MLB
  let prevSeasonH2H: any = { games: [], rate: 0, hits: 0, total: 0, avg: 0 };
  if (cfg.searchLeague === "mlb" && prevSeasonGames.length > 0 && h2hOpp) {
    const prevH2hGames = prevSeasonGames.filter(g => g.opponent.toUpperCase().includes(h2hOpp));
    const prevH2hVals = prevH2hGames.map(g => getStatValue(g, propType));
    prevSeasonH2H = { ...hitRate(prevH2hVals, line, overUnder), avg: avg(prevH2hVals), opponent: h2hOpp, total: prevH2hVals.length };
  }

  const result: any = {
    player, prop_type: propType, prop_display: PROP_DISPLAY[propType] || propType, sport: cfg.searchLeague,
    line, over_under: overUnder, matchup_opponent: h2hOpp || "",
    is_1q_analysis: is1QProp,
    season_avg: {}, game_log: gameLog,
    season_hit_rate: seasonHitRate, last_10: last10, last_5: last5,
    home_away: homeAway, head_to_head: headToHead,
    prev_season_h2h: prevSeasonH2H,
    h2h_combined: headToHead,
    other_games: otherGames,
    next_game: nextGame,
    player_injuries: playerInjuries, teammate_injuries: teammateInjuries,
    opponent_injuries: opponentInjuries,
    injury_insights: injuryInsights,
    minutes_trend: minTrend,
    team_roster_context: teamRoster,
    opponent_roster_context: oppRoster,
    without_teammates_analysis: withoutTeammatesAnalysis,
    recency_games: recencyGames,
    pace_context: paceContext,
    // MLB-specific
    current_season_games: cfg.searchLeague === "mlb" ? games : undefined,
    prev_season_games: cfg.searchLeague === "mlb" ? prevSeasonGames : undefined,
    all_games: games,
    confidence: 0, verdict: "N/A", reasoning: [],
  };

  try { result.season_avg = await getSeasonAvg(playerId, cfg); } catch { /* ignore */ }

  // Compute shooting/scoring zones from game log (real data)
  try {
    if (cfg.searchLeague === "nhl") {
      const nhlZones = computeNhlScoringZones(games);
      if (nhlZones.length > 0) {
        result.shot_chart = nhlZones;
        result.shot_chart_type = "nhl";
      }
    } else if (cfg.searchLeague === "mlb") {
      const mlbZones = computeMlbScoringZones(games);
      if (mlbZones.length > 0) {
        result.shot_chart = mlbZones;
        result.shot_chart_type = "mlb";
      }
    } else {
      const shootingSplits = computeShootingSplits(games);
      if (shootingSplits.length > 0) {
        result.shot_chart = shootingSplits;
      }
    }
  } catch (e) {
    console.error("Shooting/scoring splits error:", e);
  }

  // ── MLB: Use 20-Factor Player Prop Engine ──
  if (cfg.searchLeague === "mlb") {
    // Fetch MLB-specific context (opposing SP, park, weather, team stats)
    const oppAbbrForCtx = h2hOpp || nextGame?.opponent_abbr || "";
    let mlbCtx: MlbContextData = {};
    try {
      mlbCtx = await fetchMlbGameContext(player.team_abbr, oppAbbrForCtx, playerId, cfg);
    } catch (e) {
      console.error("MLB context fetch failed:", e);
    }
    result.mlb_context = mlbCtx;

    const mlbResult = await calculateMlbPropConfidence(result);
    
    if (mlbResult.playerIsOut) {
      result.confidence = 0;
      result.reasoning = mlbResult.reasoning;
      result.verdict = "DO NOT BET";
      return result;
    }
    
    result.confidence = mlbResult.confidence;
    result.reasoning = mlbResult.reasoning;
    result.mlb_factors = mlbResult.factors;
    result.prev_season_used = mlbResult.prevSeasonUsed;
    result.model = "mlb-20-factor-props";
    
    if (mlbResult.confidence >= 72) result.verdict = "STRONG BET";
    else if (mlbResult.confidence >= 58) result.verdict = "LEAN";
    else if (mlbResult.confidence >= 42) result.verdict = "RISKY";
    else result.verdict = "FADE";
    
    // Generate AI writeup
    const isPitcher = ["SP", "RP", "CP", "CL", "P"].includes((player.position || "").toUpperCase());
    try {
      const writeup = await generateMlbPropWriteup(
        player.full_name, propType, line, overUnder,
        mlbResult.confidence, mlbResult.factors, mlbCtx, isPitcher
      );
      if (writeup) {
        result.model_writeup = writeup;
        result.reasoning.push(writeup);
      }
    } catch (e) {
      console.error("MLB AI writeup error:", e);
    }
    
    return result;
  }

  // ── NBA/NHL: Use generic confidence engine ──
  const { confidence: rawConf, reasoning, consensusFloorApplied, playerIsOut } = calculateConfidence(result);
  
  // If player is OUT, skip all discretion and set verdict immediately
  if (playerIsOut) {
    result.confidence = 0;
    result.reasoning = reasoning;
    result.verdict = "DO NOT BET";
    return result;
  }

  // Discretion override — now DATA-DRIVEN and ROLE-WEIGHTED
  let confidence = rawConf;
  const playerNameLower2 = (result.player?.full_name || "").toLowerCase();
  const rosterKeyOut = (result.team_roster_context?.keyOut || []).filter((p: any) => p.name.toLowerCase() !== playerNameLower2);
  const sigTeammateOut = (result.teammate_injuries || []).filter((i: any) => ["out","doubtful"].includes(i.status?.toLowerCase()));
  const maxOut = Math.max(rosterKeyOut.length, sigTeammateOut.length);
  
  // Calculate weighted injury impact for discretion (same logic as in calculateConfidence)
  let discretionWeightedImpact = 0;
  for (const inj of sigTeammateOut) {
    const match = rosterKeyOut.find((k: any) => k.name.toLowerCase() === inj.player_name.toLowerCase());
    discretionWeightedImpact += match?.impactWeight ?? 0.3;
  }
  
  const wta = result.without_teammates_analysis;
  const hasRealData = wta?.withoutKeyPlayers?.games > 2;
  
  // Guard: skip discretion overrides if hit rate consensus already set confidence based on real data
  const skipDiscretion = confidence >= 75 || consensusFloorApplied;
  
  if (!skipDiscretion && hasRealData && maxOut >= 1) {
    const wkpAvg = wta.withoutKeyPlayers.avg;
    const wkpHR = wta.withoutKeyPlayers.hitRate;
    
    if (overUnder === "over" && wkpAvg > line && wkpHR >= 55 && confidence < 58) {
      const boost = Math.min(Math.round((wkpHR - confidence) * 0.4), 20);
      const adjusted = Math.min(confidence + boost, 72);
      reasoning.push(`🧠 DATA DISCRETION: Boosted ${confidence}% → ${adjusted}% — player averages ${wkpAvg} (${wkpHR}% HR) without these teammates, above the ${line} line`);
      confidence = adjusted;
    } else if (overUnder === "under" && wkpAvg < line && wkpHR >= 55 && confidence < 58) {
      const boost = Math.min(Math.round((wkpHR - confidence) * 0.4), 20);
      const adjusted = Math.min(confidence + boost, 72);
      reasoning.push(`🧠 DATA DISCRETION: Boosted ${confidence}% → ${adjusted}% — player averages ${wkpAvg} (${wkpHR}% HR) without these teammates, below the ${line} line`);
      confidence = adjusted;
    } else if (overUnder === "over" && wkpAvg < line && wkpHR < 40 && confidence > 55) {
      const penalty = Math.min(Math.round((confidence - wkpHR) * 0.3), 15);
      const adjusted = Math.max(confidence - penalty, 38);
      reasoning.push(`🧠 DATA DISCRETION: Reduced ${confidence}% → ${adjusted}% — player averages only ${wkpAvg} without these teammates`);
      confidence = adjusted;
    } else if (overUnder === "under" && wkpAvg > line && wkpHR < 40 && confidence > 55) {
      const penalty = Math.min(Math.round((confidence - wkpHR) * 0.3), 15);
      const adjusted = Math.max(confidence - penalty, 38);
      reasoning.push(`🧠 DATA DISCRETION: Reduced ${confidence}% → ${adjusted}% — player averages ${wkpAvg} without these teammates, above line`);
      confidence = adjusted;
    }
  } else if (!skipDiscretion && discretionWeightedImpact >= 2.0 && !hasRealData) {
    if (overUnder === "over" && confidence < 55) {
      const boost = discretionWeightedImpact >= 3.5 ? 25 : discretionWeightedImpact >= 2.5 ? 20 : 15;
      const adjusted = Math.min(confidence + boost, 68);
      reasoning.push(`🧠 DISCRETION OVERRIDE: Boosted ${confidence}% → ${adjusted}% — weighted impact ${discretionWeightedImpact.toFixed(1)} (role-adjusted) makes historical data unreliable.`);
      confidence = adjusted;
    } else if (overUnder === "under" && confidence > 50) {
      const penalty = discretionWeightedImpact >= 3.5 ? 20 : discretionWeightedImpact >= 2.5 ? 15 : 10;
      const adjusted = Math.max(confidence - penalty, 35);
      reasoning.push(`🧠 DISCRETION: Under confidence reduced ${confidence}% → ${adjusted}% — weighted impact ${discretionWeightedImpact.toFixed(1)} (role-adjusted)`);
      confidence = adjusted;
    }
  }
  
  result.confidence = confidence;
  result.reasoning = reasoning;

  if (confidence >= 72) result.verdict = "STRONG BET";
  else if (confidence >= 58) result.verdict = "LEAN";
  else if (confidence >= 42) result.verdict = "RISKY";
  else result.verdict = "FADE";

  return result;
}

// ── Request Handler ─────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();

    if (path === "search") {
      const q = url.searchParams.get("q") || "";
      const sport = url.searchParams.get("sport") || "nba";
      if (q.length < 2) return new Response(JSON.stringify([]), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const config = getEspnConfig(sport);
      // Use sport-specific ESPN search
      const results: any[] = [];
      const qLower = q.toLowerCase();
      try {
        const resp = await fetch(
          `https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=25&mode=prefix&type=player&sport=${config.searchSport}&league=${config.searchLeague}`
        );
        const data = await resp.json();
        for (const item of data?.items || data?.results || []) {
          const athlete = item?.athlete || item;
          const name = athlete?.displayName || athlete?.fullName || item?.displayName || item?.name || "";
          if (name.toLowerCase().includes(qLower)) {
            const id = athlete?.id || item?.id || item?.uid?.split(":")?.[3];
            if (id) results.push({ id: String(id), name });
          }
        }
      } catch (e) { console.error("ESPN search error:", e); }

      const unique = [...new Map(results.map(r => [r.id, r])).values()].slice(0, 10);
      const enriched = await Promise.all(
        unique.map(async (p) => {
          try {
            const resp = await fetch(`${config.core}/athletes/${p.id}`);
            const data = await resp.json();
            const teamRef = data?.team?.$ref?.replace("http://", "https://");
            let teamAbbr = "", teamName = "";
            if (teamRef) {
              try { const tResp = await fetch(teamRef); const tData = await tResp.json(); teamAbbr = tData?.abbreviation || ""; teamName = tData?.shortDisplayName || tData?.displayName || ""; } catch {}
            }
            return {
              id: p.id, name: p.name,
              headshot: data?.headshot?.href || `https://a.espncdn.com/i/headshots/${config.searchLeague}/players/full/${p.id}.png`,
              position: data?.position?.abbreviation || "", jersey: data?.jersey || "",
              team: teamAbbr, teamName,
            };
          } catch {
            return { ...p, headshot: "", position: "", jersey: "", team: "", teamName: "" };
          }
        })
      );
      return new Response(JSON.stringify(enriched), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "teams") {
      const sport = url.searchParams.get("sport") || "nba";
      const config = getEspnConfig(sport);
      return new Response(JSON.stringify(config.teams), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (path === "analyze" && req.method === "POST") {
      const body = await req.json();
      const { player, prop_type, line, over_under, opponent, sport: reqSport, bet_type } = body;
      if (!player) return new Response(JSON.stringify({ error: "Player name is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const result = await analyzeProp(player, prop_type, parseFloat(line), over_under, opponent, reqSport);

      // MLB: supplement with 20-factor team context from mlb-model
      if (reqSport === "mlb" && result.player?.team_abbr) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && serviceKey) {
            // Resolve team IDs from ESPN
            const teamAbbr = result.player.team_abbr;
            const oppAbbr = result.matchup_opponent || result.next_game?.opponent_abbr || "";
            
            // Fetch teams list to get IDs
            const teamsResp = await fetch(`${supabaseUrl}/functions/v1/mlb-model/games`, {
              headers: { "Authorization": `Bearer ${serviceKey}` },
            });
            if (teamsResp.ok) {
              const teamsData = await teamsResp.json();
              const games = teamsData.games || [];
              // Find a game involving the player's team
              const matchingGame = games.find((g: any) =>
                g.home?.abbreviation === teamAbbr || g.away?.abbreviation === teamAbbr ||
                g.home?.abbreviation === oppAbbr || g.away?.abbreviation === oppAbbr
              );
              if (matchingGame) {
                const modelResp = await fetch(`${supabaseUrl}/functions/v1/mlb-model/analyze`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                  body: JSON.stringify({
                    game_id: matchingGame.id,
                    team1_id: matchingGame.home?.id,
                    team2_id: matchingGame.away?.id,
                    bet_type: bet_type || "player_prop",
                    player_name: player,
                    prop_type,
                    line,
                    over_under,
                  }),
                });
                if (modelResp.ok) {
                  const modelData = await modelResp.json();
                  result.model = "mlb-20-factor";
                  result.factorBreakdown = modelData.factorBreakdown;
                  result.model_writeup = modelData.writeup;
                  result.pitchers = modelData.pitchers;
                  result.park_context = modelData.context;
                   // Add model factors to reasoning (skip for player props — team confidence is irrelevant)
                   if (modelData.writeup && bet_type !== "player_prop") {
                     result.reasoning = result.reasoning || [];
                     result.reasoning.push(modelData.writeup);
                   }
                }
              }
            }
          }
        } catch (e: any) {
          console.error("MLB model supplementation failed:", e.message);
        }
      }

      // NHL: supplement with 20-factor team context from nhl-model
      if (reqSport === "nhl" && result.player?.team_abbr) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && serviceKey) {
            const teamAbbr = result.player.team_abbr;
            const oppAbbr = result.matchup_opponent || result.next_game?.opponent_abbr || "";
            const teamsResp = await fetch(`${supabaseUrl}/functions/v1/nhl-model/games`, {
              headers: { "Authorization": `Bearer ${serviceKey}` },
            });
            if (teamsResp.ok) {
              const teamsData = await teamsResp.json();
              const games = teamsData.games || [];
              const matchingGame = games.find((g: any) =>
                g.home?.abbreviation === teamAbbr || g.away?.abbreviation === teamAbbr ||
                g.home?.abbreviation === oppAbbr || g.away?.abbreviation === oppAbbr
              );
              if (matchingGame) {
                const modelResp = await fetch(`${supabaseUrl}/functions/v1/nhl-model/analyze`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
                  body: JSON.stringify({
                    game_id: matchingGame.id,
                    team1_id: matchingGame.home?.id,
                    team2_id: matchingGame.away?.id,
                    bet_type: bet_type || "player_prop",
                    player_name: player,
                    prop_type,
                    line,
                    over_under,
                  }),
                });
                if (modelResp.ok) {
                  const modelData = await modelResp.json();
                  result.model = "nhl-20-factor";
                  result.factorBreakdown = modelData.factorBreakdown;
                  result.model_writeup = modelData.writeup;
                  result.goalies = modelData.goalies;
                  result.ice_context = modelData.context;
                   if (modelData.writeup && bet_type !== "player_prop") {
                     result.reasoning = result.reasoning || [];
                     result.reasoning.push(modelData.writeup);
                   }
                }
              }
            }
          }
        } catch (e: any) {
          console.error("NHL model supplementation failed:", e.message);
        }
      }

      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
