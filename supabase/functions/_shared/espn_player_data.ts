/**
 * ESPN player-data layer shared by the per-sport prop models.
 *
 * Extracted verbatim from `nba-api/index.ts`, which grew to 4,800+ lines
 * serving every sport's props from one handler. `mlb-prop-model` and
 * `wnba-prop-model` need exactly this slice — league config, player lookup,
 * game logs and the stat accessor — so it lives here rather than being forked.
 *
 * Behaviour is unchanged from the nba-api original on purpose: the prop split
 * is a staged refactor, and a single moved line that silently alters a game log
 * would look like a model regression rather than a data one.
 *
 * NOTE: `nba-api` still carries its own copy for NBA and NHL. It is migrated
 * onto this module once the new prop endpoints are proven in production —
 * there is no Deno toolchain in the dev environment, so a blind rewrite of the
 * live NBA/NHL path is not something to bundle into this change.
 */

import { isMlbPitchingProp } from "./prop_normalization.ts";
import { mlbStatValue, parseMlbLabeledStatLine, type MlbStatLine } from "./mlb_data.ts";


// ── League team directories ─────────────────────────────────

export const NBA_TEAMS = [
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

export const WNBA_TEAMS = [
  { abbr: "ATL", name: "Atlanta Dream" }, { abbr: "CHI", name: "Chicago Sky" },
  { abbr: "CONN", name: "Connecticut Sun" }, { abbr: "DAL", name: "Dallas Wings" },
  { abbr: "GS", name: "Golden State Valkyries" }, { abbr: "IND", name: "Indiana Fever" },
  { abbr: "LV", name: "Las Vegas Aces" }, { abbr: "LA", name: "Los Angeles Sparks" },
  { abbr: "MIN", name: "Minnesota Lynx" }, { abbr: "NY", name: "New York Liberty" },
  { abbr: "PHX", name: "Phoenix Mercury" }, { abbr: "SEA", name: "Seattle Storm" },
  { abbr: "POR", name: "Portland Fire" }, { abbr: "TOR", name: "Toronto Tempo" },
  { abbr: "WAS", name: "Washington Mystics" },
];

export const MLB_TEAMS = [
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

export const NHL_TEAMS = [
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


// ── League configuration ────────────────────────────────────

export function getEspnConfig(sport: string) {
  if (sport === "wnba") {
    return {
      base: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba",
      core: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba",
      searchSport: "basketball",
      searchLeague: "wnba",
      teams: WNBA_TEAMS,
      sportKey: "wnba" as const,
    };
  }
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

export type EspnConfig = ReturnType<typeof getEspnConfig>;


// ── Player lookup ───────────────────────────────────────────

export async function searchPlayers(query: string, config?: EspnConfig) {
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

export async function getPlayerInfo(playerId: string, config?: EspnConfig) {
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


// ── Game logs ───────────────────────────────────────────────

export interface GameRow {
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
  mlb_line?: MlbStatLine;
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
  // ESPN season-type tag (regular/preseason/postseason). Defaults to 'regular'
  // when ESPN's seasonTypes payload is missing or unparseable. Used by playoff
  // diagnostics; never overrides regular-season behavior unless explicit
  // playoff signal is detected.
  seasonType?: 'regular' | 'preseason' | 'postseason';
  // 1Q stats (populated separately)
  q1_pts?: number;
  q1_reb?: number;
  q1_ast?: number;
}

export async function getGameLog(playerId: string, season?: number, config?: EspnConfig): Promise<GameRow[]> {
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
    // Tag each event with its ESPN season type so downstream logic can
    // distinguish regular-season from postseason games. ESPN encodes type as
    // either a numeric `type` (1=pre, 2=regular, 3=post) or a `displayName`
    // string. We accept both and fall back to 'regular' if absent.
    const eventSeasonType: Record<string, 'regular' | 'preseason' | 'postseason'> = {};
    const classifySeason = (st: any): 'regular' | 'preseason' | 'postseason' => {
      const num = Number(st?.type ?? st?.id);
      if (num === 1) return 'preseason';
      if (num === 3) return 'postseason';
      if (num === 2) return 'regular';
      const name = String(st?.displayName || st?.name || '').toLowerCase();
      if (name.includes('post')) return 'postseason';
      if (name.includes('pre')) return 'preseason';
      return 'regular';
    };

    for (const st of seasonTypes) {
      const tag = classifySeason(st);
      for (const cat of st?.categories || []) {
        for (const ev of cat?.events || []) {
          const eventId = String(ev?.eventId || ev?.id || "");
          if (eventId && ev?.stats) {
            statRows[eventId] = ev.stats;
            eventSeasonType[eventId] = tag;
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
      const mlbLine = cfg.searchLeague === "mlb"
        ? parseMlbLabeledStatLine(topLabels, stats)
        : undefined;

      const tbVal = tbIdx >= 0 ? parseStat(stats[tbIdx]) : 0;

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
        seasonType: eventSeasonType[eventId] || 'regular',
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
        mlb_line: mlbLine,
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


// ── Season averages and schedule ────────────────────────────

export async function getSeasonAvg(playerId: string, config?: EspnConfig) {
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

export async function getNextGame(teamAbbr: string, config?: EspnConfig) {
  const cfg = config || getEspnConfig("nba");
  try {
    const resp = await fetch(`${cfg.base}/scoreboard`);
    const data = await resp.json();

    for (const event of data?.events || []) {
      const gameDate = new Date(event?.date).getTime();
      if (!Number.isFinite(gameDate) || gameDate < Date.now() - 3 * 3600000) continue;
      const status = event?.status?.type?.name;
      if (status === "STATUS_FINAL" || status === "STATUS_POSTPONED") continue;

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
        event_id: String(event.id || ""),
        date: event.date ? new Date(event.date).toISOString().split("T")[0] : "",
        date_time: event.date || null,
        opponent_abbr: opponent.abbreviation || "",
        opponent_name: opponent.displayName || "",
        is_home: isHome,
        venue_city: comp?.venue?.address?.city ?? null,
        lineup_status: "unconfirmed",
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
        event_id: String(event.id || ""),
        date: new Date(event.date).toISOString().split("T")[0],
        date_time: event.date || null,
        opponent_abbr: opponent.abbreviation || "",
        opponent_name: opponent.displayName || "",
        is_home: isHome,
        venue_city: comp?.venue?.address?.city ?? null,
        lineup_status: "unconfirmed",
      };
    }
  } catch { /* ignore */ }
  return null;
}


// ── Stat accessors and hit rates ────────────────────────────

export function getStatValue(game: GameRow, propType: string): number {
  if (game.mlb_line) {
    const value = mlbStatValue(game.mlb_line, propType);
    if (value !== null) return value;
    if (
      isMlbPitchingProp(propType) ||
      ["batter_strikeouts", "hits", "runs", "rbi", "home_runs", "doubles", "total_bases", "walks", "stolen_bases", "h+r+rbi", "hits+runs"].includes(propType)
    ) return Number.NaN;
  }
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
    case "doubles": return Number.NaN;
    case "strikeouts": return game.strikeouts;
    case "pitcher_strikeouts": return Number.NaN;
    case "batter_strikeouts": return Number.NaN;
    case "hits_allowed": return Number.NaN;
    case "earned_runs": return Number.NaN;
    case "walks_allowed": return Number.NaN;
    case "outs_recorded": return Number.NaN;
    case "innings_pitched": return Number.NaN;
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

export function hitRate(values: number[], line: number, overUnder: string) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return { rate: 0, hits: 0, total: 0 };
  const hits = usable.filter(v => overUnder === "over" ? v > line : v < line).length;
  return { rate: Math.round((hits / usable.length) * 1000) / 10, hits, total: usable.length };
}

export function weightedHitRate(
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


// ── Small numeric helpers ───────────────────────────────────

export function avg(values: number[]): number {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return 0;
  return Math.round((usable.reduce((a, b) => a + b, 0) / usable.length) * 10) / 10;
}

export function minutesTrend(games: GameRow[], sport?: string) {
  const recent = games.slice(-10);
  const vals = recent.map(g => sport === "mlb"
    ? (g.mlb_line?.profile === "pitching" ? (g.mlb_line.outsRecorded ?? 0) : (g.at_bats || 0))
    : sport === "nhl" ? (g.toi || 0) : g.min);
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
