// Verified MLB data utilities shared by player-prop and team-market models.
// Source data is MLB's public Stats API/game feed. Missing values stay null;
// callers must omit or penalize unavailable factors rather than inventing a
// league-average-looking replacement.

const MLB_API = "https://statsapi.mlb.com/api";

export type MlbRole = "pitching" | "batting" | "unknown";

export interface MlbStatLine {
  profile: MlbRole;
  strikeouts: number | null;
  hits: number | null;
  runs: number | null;
  rbi: number | null;
  homeRuns: number | null;
  doubles: number | null;
  totalBases: number | null;
  walks: number | null;
  stolenBases: number | null;
  atBats: number | null;
  inningsPitched: number | null;
  outsRecorded: number | null;
  earnedRuns: number | null;
  pitches: number | null;
  battersFaced: number | null;
}

export interface MlbPitchingGame {
  date: string;
  gamePk: number | null;
  opponent: string | null;
  inningsPitched: number | null;
  outsRecorded: number | null;
  strikeouts: number | null;
  earnedRuns: number | null;
  hitsAllowed: number | null;
  walksAllowed: number | null;
  pitches: number | null;
  battersFaced: number | null;
}

export interface MlbPitcherProfile {
  id: number;
  name: string;
  hand: "L" | "R" | null;
  season: {
    starts: number;
    inningsPitched: number;
    era: number;
    whip: number;
    k9: number;
    strikeouts: number;
    walks: number;
    hits: number;
    earnedRuns: number;
    pitches: number | null;
  } | null;
  recent: {
    starts: number;
    inningsPitched: number;
    era: number;
    whip: number;
    k9: number;
    avgPitches: number | null;
    avgOuts: number;
  } | null;
  workload: {
    lastStartDate: string | null;
    daysRest: number | null;
    avgPitchesLast3: number | null;
    avgOutsLast3: number | null;
    pitchesLastStart: number | null;
  };
  games: MlbPitchingGame[];
  source: "mlb_stats_api";
}

export interface MlbLineupBatter {
  id: number;
  name: string;
  order: number;
  batSide: "L" | "R" | "S" | null;
  plateAppearances: number | null;
  strikeouts: number | null;
  walks: number | null;
  ops: number | null;
}

export interface MlbLineupContext {
  confirmed: boolean;
  batters: MlbLineupBatter[];
  strikeoutRate: number | null;
  walkRate: number | null;
  ops: number | null;
  handedness: { left: number; right: number; switch: number; unknown: number };
  source: "mlb_game_feed";
}

export interface MlbTeamBattingContext {
  teamId: number;
  abbreviation: string;
  games: number | null;
  battingAverage: number | null;
  ops: number | null;
  runsPerGame: number | null;
  strikeoutRate: number | null;
  walkRate: number | null;
  splitVsPitcherHand: {
    hand: "L" | "R";
    plateAppearances: number;
    strikeoutRate: number;
    walkRate: number | null;
    ops: number | null;
  } | null;
  bullpenEra: number | null;
  source: "mlb_stats_api";
}

export interface MlbBullpenUsage {
  gamesTracked: number;
  relieversTracked: number;
  pitchesYesterday: number;
  pitchesLastTwoDays: number;
  taxedRelievers: Array<{ id: number; name: string; pitchesYesterday: number; pitchesLastTwoDays: number }>;
  freshnessScore: number | null;
  source: "mlb_game_feed";
}

export interface MlbPitchTypeMatchup {
  pitcherPitches: number;
  opponentSwings: number;
  pitcherMix: Array<{ code: string; share: number; pitches: number }>;
  opponentWhiffRateOnMix: number;
  opponentOverallWhiffRate: number;
  score: number;
  source: "mlb_game_feed_pitch_events";
}

export interface MlbParkFactorRecord {
  venueId: number;
  venueName: string;
  season: number;
  runFactor: number;
  homeGames: number;
  roadGames: number;
  asOf: string;
  source: string;
}

export interface MlbWeatherContext {
  temperatureF: number | null;
  windMph: number | null;
  windDirection: string | null;
  condition: string | null;
  roofType: string | null;
  source: "mlb_game_feed";
}

export interface MlbGameIntelligence {
  gamePk: number;
  officialDate: string;
  gameDate: string;
  status: string;
  venue: { id: number | null; name: string | null };
  weather: MlbWeatherContext | null;
  parkFactor: MlbParkFactorRecord | null;
  home: { id: number; abbreviation: string; name: string };
  away: { id: number; abbreviation: string; name: string };
  lineups: { home: MlbLineupContext; away: MlbLineupContext };
  teamStats: { home: MlbTeamBattingContext; away: MlbTeamBattingContext };
  bullpen: { home: MlbBullpenUsage; away: MlbBullpenUsage };
  pitchers: { home: MlbPitcherProfile | null; away: MlbPitcherProfile | null };
  pitchTypeMatchup: MlbPitchTypeMatchup | null;
  missing: string[];
  source: "mlb_stats_api";
  fetchedAt: string;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function pickIndex(labels: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = labels.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function valueAt(labels: string[], stats: unknown[], aliases: string[]): unknown {
  const idx = pickIndex(labels, aliases);
  return idx >= 0 ? stats[idx] : null;
}

export function inningsToOuts(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "--") return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d+)(?:\.(\d))?$/);
  if (!match) return null;
  const innings = Number(match[1]);
  const partial = Number(match[2] ?? 0);
  if (partial < 0 || partial > 2) return null;
  return innings * 3 + partial;
}

export function outsToInnings(outs: number): number {
  const safe = Math.max(0, Math.trunc(outs));
  return Math.floor(safe / 3) + (safe % 3) / 10;
}

function parsePitchCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const first = String(value).trim().split("-")[0];
  return finite(first);
}

export function inferMlbStatProfile(labelsInput: string[], expected?: MlbRole): MlbRole {
  const labels = labelsInput.map((v) => String(v).trim().toUpperCase());
  const pitchingMarkers = ["IP", "ER", "ERA", "P-S", "PC", "BF", "WHIP"];
  const battingMarkers = ["AB", "RBI", "TB", "SB", "AVG", "OBP", "SLG"];
  const pitching = pitchingMarkers.some((label) => labels.includes(label));
  const batting = battingMarkers.some((label) => labels.includes(label));
  if (pitching && !batting) return "pitching";
  if (batting && !pitching) return "batting";
  return expected ?? "unknown";
}

export function parseMlbLabeledStatLine(
  labelsInput: string[],
  stats: unknown[],
  expected?: MlbRole,
): MlbStatLine {
  const labels = labelsInput.map((v) => String(v).trim().toUpperCase());
  const profile = inferMlbStatProfile(labels, expected);
  const ipRaw = valueAt(labels, stats, ["IP"]);
  const outs = inningsToOuts(ipRaw);
  const h = finite(valueAt(labels, stats, ["H"]));
  const bb = finite(valueAt(labels, stats, ["BB"]));
  const k = finite(valueAt(labels, stats, ["K", "SO"]));

  return {
    profile,
    strikeouts: k,
    hits: h,
    runs: finite(valueAt(labels, stats, ["R"])),
    rbi: finite(valueAt(labels, stats, ["RBI"])),
    homeRuns: finite(valueAt(labels, stats, ["HR"])),
    doubles: finite(valueAt(labels, stats, ["2B", "DOUBLES"])),
    totalBases: finite(valueAt(labels, stats, ["TB"])),
    walks: bb,
    stolenBases: finite(valueAt(labels, stats, ["SB"])),
    atBats: finite(valueAt(labels, stats, ["AB"])),
    inningsPitched: outs === null ? null : outsToInnings(outs),
    outsRecorded: outs,
    earnedRuns: finite(valueAt(labels, stats, ["ER"])),
    pitches: parsePitchCount(valueAt(labels, stats, ["PC", "P-S", "PITCHES"])),
    battersFaced: finite(valueAt(labels, stats, ["BF"])),
  };
}

export function mlbStatValue(line: MlbStatLine | null | undefined, propType: string): number | null {
  if (!line) return null;
  switch (propType) {
    case "pitcher_strikeouts": return line.profile === "pitching" ? line.strikeouts : null;
    case "hits_allowed": return line.profile === "pitching" ? line.hits : null;
    case "earned_runs": return line.profile === "pitching" ? line.earnedRuns : null;
    case "walks_allowed": return line.profile === "pitching" ? line.walks : null;
    case "outs_recorded": return line.profile === "pitching" ? line.outsRecorded : null;
    case "innings_pitched": return line.profile === "pitching" && line.outsRecorded !== null
      ? line.outsRecorded / 3
      : null;
    case "batter_strikeouts": return line.profile === "batting" ? line.strikeouts : null;
    case "hits": return line.profile === "batting" ? line.hits : null;
    case "runs": return line.profile === "batting" ? line.runs : null;
    case "rbi": return line.profile === "batting" ? line.rbi : null;
    case "home_runs": return line.profile === "batting" ? line.homeRuns : null;
    case "doubles": return line.profile === "batting" ? line.doubles : null;
    case "total_bases": return line.profile === "batting" ? line.totalBases : null;
    case "walks": return line.profile === "batting" ? line.walks : null;
    case "stolen_bases": return line.profile === "batting" ? line.stolenBases : null;
    case "h+r+rbi":
      return line.profile === "batting" && line.hits !== null && line.runs !== null && line.rbi !== null
        ? line.hits + line.runs + line.rbi
        : null;
    case "hits+runs":
      return line.profile === "batting" && line.hits !== null && line.runs !== null
        ? line.hits + line.runs
        : null;
    default: return null;
  }
}

async function fetchJson(url: string, timeoutMs = 7000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Sentinel/1.0" },
    });
    if (!response.ok) throw new Error(`MLB Stats API ${response.status}: ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function dateDiffDays(later: string, earlier: string): number {
  return Math.max(0, Math.floor((new Date(`${later}T12:00:00Z`).getTime() - new Date(`${earlier}T12:00:00Z`).getTime()) / 86400000));
}

function aggregatePitchingGames(games: MlbPitchingGame[]) {
  const pitched = games.filter((g) => g.outsRecorded !== null && g.outsRecorded > 0);
  const usable = pitched.filter((g) =>
    g.strikeouts !== null && g.walksAllowed !== null && g.hitsAllowed !== null && g.earnedRuns !== null
  );
  if (!usable.length || usable.length !== pitched.length) return null;
  const starts = usable.length;
  const outs = usable.reduce((sum, g) => sum + (g.outsRecorded ?? 0), 0);
  const strikeouts = usable.reduce((sum, g) => sum + (g.strikeouts ?? 0), 0);
  const walks = usable.reduce((sum, g) => sum + (g.walksAllowed ?? 0), 0);
  const hits = usable.reduce((sum, g) => sum + (g.hitsAllowed ?? 0), 0);
  const earnedRuns = usable.reduce((sum, g) => sum + (g.earnedRuns ?? 0), 0);
  const pitches = usable.every((g) => g.pitches !== null)
    ? usable.reduce((sum, g) => sum + Number(g.pitches), 0)
    : null;
  const innings = outs / 3;
  return {
    starts,
    inningsPitched: Math.round(innings * 10) / 10,
    era: Math.round((earnedRuns * 9 / innings) * 100) / 100,
    whip: Math.round(((walks + hits) / innings) * 100) / 100,
    k9: Math.round((strikeouts * 9 / innings) * 10) / 10,
    strikeouts,
    walks,
    hits,
    earnedRuns,
    pitches,
  };
}

export function buildPitcherProfileFromStats(
  pitcher: { id: number; name: string; hand: "L" | "R" | null },
  rawSplits: any[],
  targetDate: string,
): MlbPitcherProfile {
  const games: MlbPitchingGame[] = rawSplits
    .filter((split: any) => finite(split?.stat?.gamesStarted) === 1)
    .map((split: any) => {
      const stat = split?.stat || {};
      const outs = finite(stat.outs) ?? inningsToOuts(stat.inningsPitched);
      return {
        date: String(split?.date || ""),
        gamePk: finite(split?.game?.gamePk),
        opponent: split?.opponent?.name || null,
        inningsPitched: outs === null ? null : outsToInnings(outs),
        outsRecorded: outs,
        strikeouts: finite(stat.strikeOuts),
        earnedRuns: finite(stat.earnedRuns),
        hitsAllowed: finite(stat.hits),
        walksAllowed: finite(stat.baseOnBalls),
        pitches: finite(stat.numberOfPitches ?? stat.pitchesThrown),
        battersFaced: finite(stat.battersFaced),
      } satisfies MlbPitchingGame;
    })
    .filter((game: MlbPitchingGame) => game.date && game.date < targetDate)
    .sort((a: MlbPitchingGame, b: MlbPitchingGame) => a.date.localeCompare(b.date));

  const seasonAgg = aggregatePitchingGames(games);
  const last3 = games.slice(-3);
  const recentAgg = aggregatePitchingGames(last3);
  const last = games.at(-1) ?? null;
  return {
    id: pitcher.id,
    name: pitcher.name,
    hand: pitcher.hand,
    season: seasonAgg,
    recent: recentAgg ? {
      starts: recentAgg.starts,
      inningsPitched: recentAgg.inningsPitched,
      era: recentAgg.era,
      whip: recentAgg.whip,
      k9: recentAgg.k9,
      avgPitches: recentAgg.pitches === null ? null : Math.round(recentAgg.pitches / recentAgg.starts),
      avgOuts: Math.round((last3.reduce((sum, game) => sum + (game.outsRecorded ?? 0), 0) / recentAgg.starts) * 10) / 10,
    } : null,
    workload: {
      lastStartDate: last?.date ?? null,
      daysRest: last ? Math.max(0, dateDiffDays(targetDate, last.date) - 1) : null,
      avgPitchesLast3: recentAgg?.pitches === null || !recentAgg ? null : Math.round(recentAgg.pitches / recentAgg.starts),
      avgOutsLast3: recentAgg ? Math.round((last3.reduce((sum, game) => sum + (game.outsRecorded ?? 0), 0) / recentAgg.starts) * 10) / 10 : null,
      pitchesLastStart: last?.pitches ?? null,
    },
    games,
    source: "mlb_stats_api",
  };
}

async function fetchPitcherProfile(pitcherId: number, name: string, season: number, targetDate: string): Promise<MlbPitcherProfile | null> {
  try {
    const [personData, statsData] = await Promise.all([
      fetchJson(`${MLB_API}/v1/people/${pitcherId}`),
      fetchJson(`${MLB_API}/v1/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}`),
    ]);
    const person = personData?.people?.[0] || {};
    const hand = ["L", "R"].includes(person?.pitchHand?.code) ? person.pitchHand.code : null;
    const splits = statsData?.stats?.[0]?.splits || [];
    return buildPitcherProfileFromStats({ id: pitcherId, name: person.fullName || name, hand }, splits, targetDate);
  } catch (error) {
    console.warn(`[mlb-data] pitcher profile unavailable id=${pitcherId}:`, error);
    return null;
  }
}

export function buildLineupContext(feed: any, side: "home" | "away"): MlbLineupContext {
  const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
  const gamePlayers = feed?.gameData?.players || {};
  const boxPlayers = teamBox.players || {};
  const candidates = Object.values(boxPlayers)
    .filter((entry: any) => {
      const order = Number(entry?.battingOrder);
      return Number.isFinite(order) && order >= 100 && order <= 900 && order % 100 === 0;
    })
    .sort((a: any, b: any) => Number(a.battingOrder) - Number(b.battingOrder))
    .slice(0, 9) as any[];

  const batters: MlbLineupBatter[] = candidates.map((entry: any) => {
    const id = Number(entry?.person?.id);
    const person = gamePlayers[`ID${id}`] || {};
    const stats = entry?.seasonStats?.batting || {};
    const pa = finite(stats.plateAppearances);
    const k = finite(stats.strikeOuts);
    const walks = finite(stats.baseOnBalls);
    const ops = finite(stats.ops);
    const batSide = ["L", "R", "S"].includes(person?.batSide?.code) ? person.batSide.code : null;
    return {
      id,
      name: entry?.person?.fullName || person?.fullName || `Player ${id}`,
      order: Math.trunc(Number(entry.battingOrder) / 100),
      batSide,
      plateAppearances: pa,
      strikeouts: k,
      walks,
      ops,
    };
  });

  const kRows = batters.filter((batter) => batter.plateAppearances !== null && batter.strikeouts !== null);
  const kPa = kRows.reduce((sum, batter) => sum + Number(batter.plateAppearances), 0);
  const totalK = kRows.reduce((sum, batter) => sum + Number(batter.strikeouts), 0);
  const walkRows = batters.filter((batter) => batter.plateAppearances !== null && batter.walks !== null);
  const walkPa = walkRows.reduce((sum, batter) => sum + Number(batter.plateAppearances), 0);
  const totalWalks = walkRows.reduce((sum, batter) => sum + Number(batter.walks), 0);
  const opsRows = batters.filter((batter) => batter.plateAppearances !== null && batter.ops !== null);
  const opsPaTotal = opsRows.reduce((sum, batter) => sum + Number(batter.plateAppearances), 0);
  const weightedOps = opsRows.reduce(
    (sum, batter) => sum + Number(batter.ops) * Number(batter.plateAppearances),
    0,
  );
  const handedness = { left: 0, right: 0, switch: 0, unknown: 0 };
  for (const batter of batters) {
    if (batter.batSide === "L") handedness.left++;
    else if (batter.batSide === "R") handedness.right++;
    else if (batter.batSide === "S") handedness.switch++;
    else handedness.unknown++;
  }
  return {
    confirmed: batters.length === 9,
    batters,
    strikeoutRate: kPa >= 100 ? Math.round((totalK / kPa * 100) * 10) / 10 : null,
    walkRate: walkPa >= 100 ? Math.round((totalWalks / walkPa * 100) * 10) / 10 : null,
    ops: opsPaTotal >= 100 ? Math.round((weightedOps / opsPaTotal) * 1000) / 1000 : null,
    handedness,
    source: "mlb_game_feed",
  };
}

function parseSeasonStatBlock(data: any): any {
  return data?.stats?.[0]?.splits?.[0]?.stat || null;
}

async function fetchTeamContext(team: { id: number; abbreviation: string }, season: number, opposingPitcherHand: "L" | "R" | null): Promise<MlbTeamBattingContext> {
  const handCode = opposingPitcherHand === "L" ? "vl" : "vr";
  const [hittingResult, reliefResult, splitResult] = await Promise.allSettled([
    fetchJson(`${MLB_API}/v1/teams/${team.id}/stats?stats=season&group=hitting&season=${season}`),
    fetchJson(`${MLB_API}/v1/teams/${team.id}/stats?stats=statSplits&group=pitching&season=${season}&sitCodes=rp`),
    opposingPitcherHand
      ? fetchJson(`${MLB_API}/v1/teams/${team.id}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=${handCode}`)
      : Promise.resolve(null),
  ]);
  const hitting = hittingResult.status === "fulfilled" ? parseSeasonStatBlock(hittingResult.value) : null;
  const relief = reliefResult.status === "fulfilled" ? parseSeasonStatBlock(reliefResult.value) : null;
  const split = splitResult.status === "fulfilled" ? parseSeasonStatBlock(splitResult.value) : null;
  const games = finite(hitting?.gamesPlayed);
  const pa = finite(hitting?.plateAppearances);
  const runs = finite(hitting?.runs);
  const splitPa = finite(split?.plateAppearances);
  const splitK = finite(split?.strikeOuts);
  const splitWalks = finite(split?.baseOnBalls);
  const strikeouts = finite(hitting?.strikeOuts);
  const walks = finite(hitting?.baseOnBalls);
  return {
    teamId: team.id,
    abbreviation: team.abbreviation,
    games,
    battingAverage: finite(hitting?.avg),
    ops: finite(hitting?.ops),
    runsPerGame: games && runs !== null ? Math.round((runs / games) * 100) / 100 : null,
    strikeoutRate: pa && pa >= 100 && strikeouts !== null ? Math.round((strikeouts / pa * 100) * 10) / 10 : null,
    walkRate: pa && pa >= 100 && walks !== null ? Math.round((walks / pa * 100) * 10) / 10 : null,
    splitVsPitcherHand: opposingPitcherHand && splitPa && splitPa >= 100 && splitK !== null
      ? {
          hand: opposingPitcherHand,
          plateAppearances: splitPa,
          strikeoutRate: Math.round((splitK / splitPa * 100) * 10) / 10,
          walkRate: splitWalks === null ? null : Math.round((splitWalks / splitPa * 100) * 10) / 10,
          ops: finite(split?.ops),
        }
      : null,
    bullpenEra: finite(relief?.era),
    source: "mlb_stats_api",
  };
}

function teamSide(feed: any, teamId: number): "home" | "away" | null {
  if (Number(feed?.gameData?.teams?.home?.id) === teamId) return "home";
  if (Number(feed?.gameData?.teams?.away?.id) === teamId) return "away";
  return null;
}

export function calculateBullpenUsage(
  appearances: Array<{ id: number; name: string; date: string; pitches: number }>,
  targetDate: string,
  gamesTracked: number,
): MlbBullpenUsage {
  const byPitcher = new Map<number, { id: number; name: string; yesterday: number; twoDays: number }>();
  for (const appearance of appearances) {
    const days = dateDiffDays(targetDate, appearance.date);
    if (days < 1 || days > 2) continue;
    const row = byPitcher.get(appearance.id) || { id: appearance.id, name: appearance.name, yesterday: 0, twoDays: 0 };
    if (days === 1) row.yesterday += appearance.pitches;
    row.twoDays += appearance.pitches;
    byPitcher.set(appearance.id, row);
  }
  const taxed = [...byPitcher.values()]
    .filter((row) => row.yesterday >= 20 || row.twoDays >= 35)
    .map((row) => ({ id: row.id, name: row.name, pitchesYesterday: row.yesterday, pitchesLastTwoDays: row.twoDays }));
  const yesterday = [...byPitcher.values()].reduce((sum, row) => sum + row.yesterday, 0);
  const twoDays = [...byPitcher.values()].reduce((sum, row) => sum + row.twoDays, 0);
  return {
    gamesTracked,
    relieversTracked: byPitcher.size,
    pitchesYesterday: yesterday,
    pitchesLastTwoDays: twoDays,
    taxedRelievers: taxed,
    freshnessScore: gamesTracked > 0 ? Math.max(25, Math.min(65, 60 - taxed.length * 8 - (yesterday >= 100 ? 5 : 0))) : null,
    source: "mlb_game_feed",
  };
}

const feedCache = new Map<number, Promise<any>>();

async function fetchGameFeed(gamePk: number): Promise<any> {
  if (!feedCache.has(gamePk)) {
    feedCache.set(gamePk, fetchJson(`${MLB_API}/v1.1/game/${gamePk}/feed/live`, 9000));
  }
  return await feedCache.get(gamePk)!;
}

async function fetchBullpenUsage(teamId: number, targetDate: string): Promise<MlbBullpenUsage> {
  try {
    const schedule = await fetchJson(
      `${MLB_API}/v1/schedule?sportId=1&teamId=${teamId}&startDate=${addDays(targetDate, -3)}&endDate=${addDays(targetDate, -1)}`,
    );
    const games = (schedule?.dates || []).flatMap((date: any) => date.games || [])
      .filter((game: any) => String(game?.status?.abstractGameState).toLowerCase() === "final")
      .slice(-3);
    const feeds = await Promise.allSettled(games.map((game: any) => fetchGameFeed(Number(game.gamePk))));
    const appearances: Array<{ id: number; name: string; date: string; pitches: number }> = [];
    let tracked = 0;
    for (const result of feeds) {
      if (result.status !== "fulfilled") continue;
      const feed = result.value;
      const side = teamSide(feed, teamId);
      if (!side) continue;
      tracked++;
      const teamBox = feed?.liveData?.boxscore?.teams?.[side] || {};
      const pitchers: number[] = teamBox.pitchers || [];
      for (const id of pitchers.slice(1)) {
        const player = teamBox.players?.[`ID${id}`] || {};
        const pitches = finite(player?.stats?.pitching?.numberOfPitches) ?? 0;
        if (pitches <= 0) continue;
        appearances.push({
          id: Number(id),
          name: player?.person?.fullName || `Pitcher ${id}`,
          date: String(feed?.gameData?.datetime?.officialDate || isoDate(feed?.gameData?.datetime?.dateTime)),
          pitches,
        });
      }
    }
    return calculateBullpenUsage(appearances, targetDate, tracked);
  } catch (error) {
    console.warn(`[mlb-data] bullpen usage unavailable team=${teamId}:`, error);
    return calculateBullpenUsage([], targetDate, 0);
  }
}

const SWING_CODES = new Set(["S", "W", "T", "X", "F", "L", "D", "E"]);
const WHIFF_CODES = new Set(["S", "W", "T"]);

export interface PitchSample {
  pitches: Map<string, number>;
  swings: Map<string, number>;
  whiffs: Map<string, number>;
}

export function emptyPitchSample(): PitchSample {
  return { pitches: new Map(), swings: new Map(), whiffs: new Map() };
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function collectPitchEvents(feed: any, predicate: (play: any) => boolean): PitchSample {
  const sample = emptyPitchSample();
  for (const play of feed?.liveData?.plays?.allPlays || []) {
    if (!predicate(play)) continue;
    for (const event of play?.playEvents || []) {
      if (!event?.isPitch) continue;
      const pitchType = String(event?.details?.type?.code || "").trim();
      if (!pitchType) continue;
      increment(sample.pitches, pitchType);
      const code = String(event?.details?.code || "").trim();
      if (SWING_CODES.has(code)) increment(sample.swings, pitchType);
      if (WHIFF_CODES.has(code)) increment(sample.whiffs, pitchType);
    }
  }
  return sample;
}

function mergePitchSamples(target: PitchSample, source: PitchSample) {
  for (const [key, value] of source.pitches) target.pitches.set(key, (target.pitches.get(key) || 0) + value);
  for (const [key, value] of source.swings) target.swings.set(key, (target.swings.get(key) || 0) + value);
  for (const [key, value] of source.whiffs) target.whiffs.set(key, (target.whiffs.get(key) || 0) + value);
}

export function calculatePitchTypeMatchup(pitcher: PitchSample, opponent: PitchSample): MlbPitchTypeMatchup | null {
  const totalPitcherPitches = [...pitcher.pitches.values()].reduce((sum, value) => sum + value, 0);
  const totalOpponentSwings = [...opponent.swings.values()].reduce((sum, value) => sum + value, 0);
  const totalOpponentWhiffs = [...opponent.whiffs.values()].reduce((sum, value) => sum + value, 0);
  if (totalPitcherPitches < 100 || totalOpponentSwings < 50) return null;
  const mix = [...pitcher.pitches.entries()]
    .map(([code, pitches]) => ({ code, pitches, share: pitches / totalPitcherPitches }))
    .filter((row) => row.share >= 0.10)
    .sort((a, b) => b.share - a.share);
  if (!mix.length) return null;
  let weightedWhiff = 0;
  let usedShare = 0;
  let matchedSwings = 0;
  for (const pitch of mix) {
    const swings = opponent.swings.get(pitch.code) || 0;
    const whiffs = opponent.whiffs.get(pitch.code) || 0;
    if (swings < 10) continue;
    weightedWhiff += (whiffs / swings) * pitch.share;
    usedShare += pitch.share;
    matchedSwings += swings;
  }
  if (usedShare < 0.50 || matchedSwings < 40) return null;
  const matchupWhiff = weightedWhiff / usedShare;
  const overallWhiff = totalOpponentWhiffs / totalOpponentSwings;
  const score = Math.max(30, Math.min(70, Math.round(50 + (matchupWhiff - overallWhiff) * 200)));
  return {
    pitcherPitches: totalPitcherPitches,
    opponentSwings: matchedSwings,
    pitcherMix: mix.map((row) => ({ ...row, share: Math.round(row.share * 1000) / 1000 })),
    opponentWhiffRateOnMix: Math.round(matchupWhiff * 1000) / 10,
    opponentOverallWhiffRate: Math.round(overallWhiff * 1000) / 10,
    score,
    source: "mlb_game_feed_pitch_events",
  };
}

async function fetchPitchTypeMatchup(
  pitcher: MlbPitcherProfile,
  opponentTeamId: number,
  targetDate: string,
): Promise<MlbPitchTypeMatchup | null> {
  try {
    const pitcherGamePks = pitcher.games.slice(-3).map((game) => game.gamePk).filter((id): id is number => id !== null);
    const schedule = await fetchJson(
      `${MLB_API}/v1/schedule?sportId=1&teamId=${opponentTeamId}&startDate=${addDays(targetDate, -12)}&endDate=${addDays(targetDate, -1)}`,
    );
    const opponentGamePks = (schedule?.dates || []).flatMap((date: any) => date.games || [])
      .filter((game: any) => String(game?.status?.abstractGameState).toLowerCase() === "final")
      .slice(-5)
      .map((game: any) => Number(game.gamePk));
    const unique = [...new Set([...pitcherGamePks, ...opponentGamePks])];
    const settled = await Promise.allSettled(unique.map((id) => fetchGameFeed(id)));
    const feeds = new Map<number, any>();
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") feeds.set(unique[index], result.value);
    });
    const pitcherSample = emptyPitchSample();
    for (const gamePk of pitcherGamePks) {
      const feed = feeds.get(gamePk);
      if (!feed) continue;
      mergePitchSamples(pitcherSample, collectPitchEvents(feed, (play) => Number(play?.matchup?.pitcher?.id) === pitcher.id));
    }
    const opponentSample = emptyPitchSample();
    for (const gamePk of opponentGamePks) {
      const feed = feeds.get(gamePk);
      if (!feed) continue;
      const side = teamSide(feed, opponentTeamId);
      if (!side) continue;
      const half = side === "away" ? "top" : "bottom";
      mergePitchSamples(opponentSample, collectPitchEvents(feed, (play) => String(play?.about?.halfInning).toLowerCase() === half));
    }
    return calculatePitchTypeMatchup(pitcherSample, opponentSample);
  } catch (error) {
    console.warn(`[mlb-data] pitch-type matchup unavailable pitcher=${pitcher.id}:`, error);
    return null;
  }
}

function runtimeEnv(name: string): string | null {
  const runtime = globalThis as any;
  try {
    return runtime?.Deno?.env?.get?.(name) || null;
  } catch {
    return null;
  }
}

async function fetchParkFactor(venueId: number | null, season: number): Promise<MlbParkFactorRecord | null> {
  if (!venueId) return null;
  const supabaseUrl = runtimeEnv("SUPABASE_URL");
  const serviceKey = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/mlb_park_factors?venue_id=eq.${venueId}&season=eq.${season}&order=as_of.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!response.ok) return null;
    const [row] = await response.json();
    if (!row) return null;
    return {
      venueId: Number(row.venue_id),
      venueName: String(row.venue_name),
      season: Number(row.season),
      runFactor: Number(row.run_factor),
      homeGames: Number(row.home_games),
      roadGames: Number(row.road_games),
      asOf: String(row.as_of),
      source: String(row.source),
    };
  } catch {
    return null;
  }
}

function parseWeather(feed: any): MlbWeatherContext | null {
  const weather = feed?.gameData?.weather;
  const roofType = feed?.gameData?.venue?.fieldInfo?.roofType || null;
  if (!weather && !roofType) return null;
  const wind = String(weather?.wind || "");
  const speedMatch = wind.match(/(\d+(?:\.\d+)?)\s*mph/i);
  const comma = wind.indexOf(",");
  return {
    temperatureF: finite(weather?.temp),
    windMph: speedMatch ? finite(speedMatch[1]) : null,
    windDirection: comma >= 0 ? wind.slice(comma + 1).trim() || null : null,
    condition: weather?.condition || null,
    roofType,
    source: "mlb_game_feed",
  };
}

interface FetchMlbGameOptions {
  gamePk?: number | null;
  gameDate?: string | null;
  homeAbbr?: string | null;
  awayAbbr?: string | null;
  teamAbbr?: string | null;
  opponentAbbr?: string | null;
  focusPitcherId?: number | null;
  focusPitcherName?: string | null;
  includePitchTypes?: boolean;
}

function normalizeAbbr(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.'’\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveGame(options: FetchMlbGameOptions): Promise<{ gamePk: number; scheduleGame: any }> {
  const date = options.gameDate ? isoDate(options.gameDate) : isoDate(new Date());
  if (options.gamePk) {
    return { gamePk: Number(options.gamePk), scheduleGame: null };
  }
  const schedule = await fetchJson(`${MLB_API}/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`);
  const games = (schedule?.dates || []).flatMap((entry: any) => entry.games || []);
  const home = normalizeAbbr(options.homeAbbr);
  const away = normalizeAbbr(options.awayAbbr);
  const team = normalizeAbbr(options.teamAbbr);
  const opponent = normalizeAbbr(options.opponentAbbr);
  const match = games.find((game: any) => {
    const h = normalizeAbbr(game?.teams?.home?.team?.abbreviation);
    const a = normalizeAbbr(game?.teams?.away?.team?.abbreviation);
    if (home && away) return h === home && a === away;
    if (team && opponent) return (h === team && a === opponent) || (h === opponent && a === team);
    return team ? h === team || a === team : false;
  });
  if (!match) throw new Error(`No MLB game matched ${away || team} at ${home || opponent} on ${date}`);
  return { gamePk: Number(match.gamePk), scheduleGame: match };
}

export async function fetchMlbGameIntelligence(options: FetchMlbGameOptions): Promise<MlbGameIntelligence> {
  const resolved = await resolveGame(options);
  const feed = await fetchGameFeed(resolved.gamePk);
  const officialDate = String(feed?.gameData?.datetime?.officialDate || options.gameDate || isoDate(new Date()));
  const season = Number(feed?.gameData?.game?.season || officialDate.slice(0, 4));
  const homeTeam = feed?.gameData?.teams?.home || {};
  const awayTeam = feed?.gameData?.teams?.away || {};
  const home = { id: Number(homeTeam.id), abbreviation: normalizeAbbr(homeTeam.abbreviation), name: String(homeTeam.name || "Home") };
  const away = { id: Number(awayTeam.id), abbreviation: normalizeAbbr(awayTeam.abbreviation), name: String(awayTeam.name || "Away") };
  const homeProbable = feed?.gameData?.probablePitchers?.home || resolved.scheduleGame?.teams?.home?.probablePitcher || null;
  const awayProbable = feed?.gameData?.probablePitchers?.away || resolved.scheduleGame?.teams?.away?.probablePitcher || null;
  const [homePitcher, awayPitcher] = await Promise.all([
    homeProbable?.id ? fetchPitcherProfile(Number(homeProbable.id), homeProbable.fullName || "Home starter", season, officialDate) : Promise.resolve(null),
    awayProbable?.id ? fetchPitcherProfile(Number(awayProbable.id), awayProbable.fullName || "Away starter", season, officialDate) : Promise.resolve(null),
  ]);
  const [homeStats, awayStats, homeBullpen, awayBullpen] = await Promise.all([
    fetchTeamContext(home, season, awayPitcher?.hand ?? null),
    fetchTeamContext(away, season, homePitcher?.hand ?? null),
    fetchBullpenUsage(home.id, officialDate),
    fetchBullpenUsage(away.id, officialDate),
  ]);
  const homeLineup = buildLineupContext(feed, "home");
  const awayLineup = buildLineupContext(feed, "away");
  const focusName = normalizePersonName(options.focusPitcherName);
  const nameMatchedPitcher = focusName && normalizePersonName(homePitcher?.name) === focusName
    ? homePitcher.id
    : focusName && normalizePersonName(awayPitcher?.name) === focusName
      ? awayPitcher.id
      : 0;
  const focusPitcher = Number(options.focusPitcherId || nameMatchedPitcher || 0);
  const pitcherSide = homePitcher?.id === focusPitcher ? "home" : awayPitcher?.id === focusPitcher ? "away" : null;
  const pitchTypeMatchup = options.includePitchTypes && pitcherSide
    ? await fetchPitchTypeMatchup(pitcherSide === "home" ? homePitcher! : awayPitcher!, pitcherSide === "home" ? away.id : home.id, officialDate)
    : null;
  const venueId = finite(feed?.gameData?.venue?.id);
  const parkFactor = await fetchParkFactor(venueId, season);
  const weather = parseWeather(feed);
  const missing: string[] = [];
  if (!homePitcher?.season || !awayPitcher?.season) missing.push("PROBABLE_STARTER_PROFILE_MISSING");
  if (!homeLineup.confirmed || !awayLineup.confirmed) missing.push("LINEUP_UNCONFIRMED");
  if (
    homeLineup.strikeoutRate === null || awayLineup.strikeoutRate === null ||
    homeLineup.ops === null || awayLineup.ops === null
  ) missing.push("LINEUP_SEASON_STATS_INCOMPLETE");
  if (
    homeStats.battingAverage === null || awayStats.battingAverage === null ||
    homeStats.ops === null || awayStats.ops === null ||
    homeStats.runsPerGame === null || awayStats.runsPerGame === null
  ) missing.push("TEAM_SEASON_STATS_INCOMPLETE");
  if (!weather) missing.push("WEATHER_MISSING");
  if (!parkFactor) missing.push("CURRENT_PARK_FACTOR_MISSING");
  if (!homeBullpen.gamesTracked || !awayBullpen.gamesTracked) missing.push("BULLPEN_USAGE_INCOMPLETE");
  if (options.includePitchTypes && focusPitcher && !pitchTypeMatchup) missing.push("PITCH_TYPE_MATCHUP_INSUFFICIENT");

  return {
    gamePk: resolved.gamePk,
    officialDate,
    gameDate: String(feed?.gameData?.datetime?.dateTime || officialDate),
    status: String(feed?.gameData?.status?.detailedState || "Unknown"),
    venue: { id: venueId, name: feed?.gameData?.venue?.name || null },
    weather,
    parkFactor,
    home,
    away,
    lineups: { home: homeLineup, away: awayLineup },
    teamStats: { home: homeStats, away: awayStats },
    bullpen: { home: homeBullpen, away: awayBullpen },
    pitchers: { home: homePitcher, away: awayPitcher },
    pitchTypeMatchup,
    missing,
    source: "mlb_stats_api",
    fetchedAt: new Date().toISOString(),
  };
}

export interface ParkFactorAggregateInput {
  venueId: number;
  venueName: string;
  homeTeamId: number;
  awayTeamId: number;
  homeRuns: number;
  awayRuns: number;
}

export function calculateCurrentParkFactors(
  games: ParkFactorAggregateInput[],
  season: number,
  asOf: string,
): MlbParkFactorRecord[] {
  const homeByVenue = new Map<number, { name: string; teamId: number; totals: number[] }>();
  const roadByTeam = new Map<number, number[]>();
  for (const game of games) {
    if (![game.homeRuns, game.awayRuns].every(Number.isFinite)) continue;
    const total = game.homeRuns + game.awayRuns;
    const home = homeByVenue.get(game.venueId) || { name: game.venueName, teamId: game.homeTeamId, totals: [] };
    home.totals.push(total);
    homeByVenue.set(game.venueId, home);
    const road = roadByTeam.get(game.awayTeamId) || [];
    road.push(total);
    roadByTeam.set(game.awayTeamId, road);
  }
  const results: MlbParkFactorRecord[] = [];
  for (const [venueId, home] of homeByVenue) {
    const road = roadByTeam.get(home.teamId) || [];
    if (home.totals.length < 20 || road.length < 20) continue;
    const homeAvg = home.totals.reduce((sum, value) => sum + value, 0) / home.totals.length;
    const roadAvg = road.reduce((sum, value) => sum + value, 0) / road.length;
    if (roadAvg <= 0) continue;
    const raw = homeAvg / roadAvg;
    const reliability = Math.min(1, Math.min(home.totals.length, road.length) / 60);
    const shrunk = 1 + (raw - 1) * reliability;
    results.push({
      venueId,
      venueName: home.name,
      season,
      runFactor: Math.round(shrunk * 1000) / 1000,
      homeGames: home.totals.length,
      roadGames: road.length,
      asOf,
      source: "mlb_stats_api_home_road_run_environment_v1",
    });
  }
  return results.sort((a, b) => a.venueId - b.venueId);
}
