// WNBA-only deterministic analysis helpers.
//
// These functions intentionally return heuristic scores, never probabilities.
// Every factor is derived from supplied, timestamped game/stat/availability
// records. Missing inputs are omitted and shrink the score toward 50 instead
// of being replaced with league-looking constants.

export type WnbaDirection = "over" | "under";
export type WnbaMarket = "moneyline" | "spread" | "total";

export interface WnbaFactor {
  name: string;
  label: string;
  score: number;
  weight: number;
  detail: string;
  source: string;
  sampleSize?: number | null;
}

export interface WnbaTeamMetrics {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  netPoints: number | null;
  recentGames: number;
  recentPointsFor: number | null;
  recentPointsAgainst: number | null;
  recentNetPoints: number | null;
  home: WnbaSplitMetrics;
  away: WnbaSplitMetrics;
  restDays: number | null;
  backToBack: boolean | null;
  lastGameDate: string | null;
  lastVenueCity: string | null;
}

export interface WnbaSplitMetrics {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  netPoints: number | null;
}

export interface WnbaEfficiency {
  games: number;
  pace: number | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  source: "espn-team-statistics-derived" | "unavailable";
}

export interface WnbaAvailabilityProfile {
  name: string;
  status: string;
  minutesPerGame: number | null;
  detail?: string | null;
}

export interface WnbaAvailability {
  sourceAvailable: boolean;
  teamMatched: boolean;
  profiles: WnbaAvailabilityProfile[];
  unavailableMinutes: number | null;
  questionableMinutes: number | null;
  missingMinutesProfiles: number;
}

export interface WnbaPlayerGame {
  date: string;
  value: number;
  minutes: number | null;
  isHome: boolean;
  opponent: string;
}

export interface WnbaLineupContext {
  status: "confirmed" | "unconfirmed" | "unavailable";
  sourceAvailable: boolean;
  starters: string[];
  playerListed: boolean | null;
  playerStarting: boolean | null;
  playerActive: boolean | null;
}

export interface WnbaPlayerScoreResult {
  score: number;
  verdict: "STRONG" | "LEAN" | "RISKY" | "PASS";
  factors: WnbaFactor[];
  reasoning: string[];
  diagnostics: Record<string, unknown>;
  playerIsOut: boolean;
}

export interface WnbaTeamScoreResult {
  score: number;
  verdict: "STRONG" | "LEAN" | "RISKY" | "PASS";
  factors: WnbaFactor[];
  reasoning: string[];
  projectedMargin: number | null;
  projectedTotal: number | null;
  diagnostics: Record<string, unknown>;
}

export interface WnbaMarketDiscoverySelection {
  betType: "moneyline" | "spread" | "total";
  team: string | null;
  direction: "home" | "away" | "over" | "under";
  line: number;
  odds: number;
  opposingOdds: number | null;
  bookCount: number;
  marketDataQuality: "medium" | "high";
  rankingScore: number;
}

const DAY_MS = 86_400_000;

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function marketName(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function bestConsensusRow(rows: Array<{ price: number; book: string }>) {
  if (!rows.length) return null;
  return {
    odds: Math.max(...rows.map((row) => row.price)),
    books: new Set(rows.map((row) => row.book)).size,
  };
}

// WNBA scanner discovery is market-data routing only. It deliberately emits
// both sides of each consensus market and does not manufacture an edge. The
// WNBA analyzer later rejects the unsupported side, preventing the scanner's
// favorite/juice bias from deciding the pick before the model runs.
export function selectWnbaConsensusMarkets(
  bookmakers: any[],
  homeTeam: string,
  awayTeam: string,
  minBooks = 3,
): WnbaMarketDiscoverySelection[] {
  const selections: WnbaMarketDiscoverySelection[] = [];
  const homeKey = marketName(homeTeam);
  const awayKey = marketName(awayTeam);
  const marketRows = (marketKey: string) => (Array.isArray(bookmakers) ? bookmakers : []).flatMap((bookmaker: any) => {
    const book = String(bookmaker?.key ?? bookmaker?.title ?? "unknown");
    const market = (bookmaker?.markets ?? []).find((entry: any) => entry?.key === marketKey);
    return (market?.outcomes ?? []).map((outcome: any) => ({
      book,
      name: String(outcome?.name ?? ""),
      key: marketName(outcome?.name),
      price: finite(outcome?.price),
      point: finite(outcome?.point),
    })).filter((row: any) => row.price !== null);
  });
  const quality = (books: number): "medium" | "high" => books >= 6 ? "high" : "medium";
  const rank = (books: number, odds: number) => round(books * 10 - Math.abs(odds + 110) / 100, 3);

  const h2h = marketRows("h2h");
  const homeH2h = bestConsensusRow(h2h.filter((row: any) => row.key === homeKey) as any);
  const awayH2h = bestConsensusRow(h2h.filter((row: any) => row.key === awayKey) as any);
  if (homeH2h && awayH2h && homeH2h.books >= minBooks && awayH2h.books >= minBooks) {
    selections.push({
      betType: "moneyline", team: homeTeam, direction: "home", line: 0,
      odds: homeH2h.odds, opposingOdds: awayH2h.odds, bookCount: homeH2h.books,
      marketDataQuality: quality(homeH2h.books), rankingScore: rank(homeH2h.books, homeH2h.odds),
    });
    selections.push({
      betType: "moneyline", team: awayTeam, direction: "away", line: 0,
      odds: awayH2h.odds, opposingOdds: homeH2h.odds, bookCount: awayH2h.books,
      marketDataQuality: quality(awayH2h.books), rankingScore: rank(awayH2h.books, awayH2h.odds),
    });
  }

  const spreads = marketRows("spreads");
  const spreadChoice = (teamKey: string) => {
    const grouped = new Map<number, Array<{ price: number; book: string }>>();
    for (const row of spreads.filter((entry: any) => entry.key === teamKey && entry.point !== null) as any[]) {
      const list = grouped.get(row.point) ?? [];
      list.push({ price: row.price, book: row.book });
      grouped.set(row.point, list);
    }
    return [...grouped.entries()]
      .map(([point, rows]) => ({ point, ...bestConsensusRow(rows)! }))
      .sort((a, b) => b.books - a.books || b.odds - a.odds)[0] ?? null;
  };
  const homeSpread = spreadChoice(homeKey);
  const awaySpread = spreadChoice(awayKey);
  if (homeSpread && awaySpread && homeSpread.books >= minBooks && awaySpread.books >= minBooks) {
    selections.push({
      betType: "spread", team: homeTeam, direction: "home", line: homeSpread.point,
      odds: homeSpread.odds, opposingOdds: awaySpread.odds, bookCount: homeSpread.books,
      marketDataQuality: quality(homeSpread.books), rankingScore: rank(homeSpread.books, homeSpread.odds),
    });
    selections.push({
      betType: "spread", team: awayTeam, direction: "away", line: awaySpread.point,
      odds: awaySpread.odds, opposingOdds: homeSpread.odds, bookCount: awaySpread.books,
      marketDataQuality: quality(awaySpread.books), rankingScore: rank(awaySpread.books, awaySpread.odds),
    });
  }

  const totals = marketRows("totals");
  const totalGrouped = new Map<number, { over: Array<{ price: number; book: string }>; under: Array<{ price: number; book: string }> }>();
  for (const row of totals as any[]) {
    const direction = row.key.includes("over") ? "over" : row.key.includes("under") ? "under" : null;
    if (!direction || row.point === null) continue;
    const group = totalGrouped.get(row.point) ?? { over: [], under: [] };
    group[direction].push({ price: row.price, book: row.book });
    totalGrouped.set(row.point, group);
  }
  const totalChoice = [...totalGrouped.entries()]
    .map(([point, rows]) => ({ point, over: bestConsensusRow(rows.over), under: bestConsensusRow(rows.under) }))
    .filter((row) => row.over && row.under)
    .sort((a, b) => Math.min(b.over!.books, b.under!.books) - Math.min(a.over!.books, a.under!.books))[0] ?? null;
  if (totalChoice?.over && totalChoice.under && totalChoice.over.books >= minBooks && totalChoice.under.books >= minBooks) {
    selections.push({
      betType: "total", team: null, direction: "over", line: totalChoice.point,
      odds: totalChoice.over.odds, opposingOdds: totalChoice.under.odds, bookCount: totalChoice.over.books,
      marketDataQuality: quality(totalChoice.over.books), rankingScore: rank(totalChoice.over.books, totalChoice.over.odds),
    });
    selections.push({
      betType: "total", team: null, direction: "under", line: totalChoice.point,
      odds: totalChoice.under.odds, opposingOdds: totalChoice.over.odds, bookCount: totalChoice.under.books,
      marketDataQuality: quality(totalChoice.under.books), rankingScore: rank(totalChoice.under.books, totalChoice.under.odds),
    });
  }

  return selections;
}

function eventTeamId(competitor: any): string {
  return String(competitor?.team?.id ?? competitor?.id ?? "");
}

function eventTeamMatches(competitor: any, teamIdOrAbbr: string): boolean {
  const requested = teamIdOrAbbr.trim().toUpperCase();
  return eventTeamId(competitor).toUpperCase() === requested ||
    String(competitor?.team?.abbreviation ?? "").toUpperCase() === requested;
}

function eventScore(competitor: any): number | null {
  return finite(competitor?.score?.value ?? competitor?.score);
}

function isFinalEvent(event: any): boolean {
  const status = event?.competitions?.[0]?.status?.type ?? event?.status?.type;
  return status?.completed === true || status?.name === "STATUS_FINAL";
}

function splitMetrics(rows: Array<{ won: boolean; pointsFor: number; pointsAgainst: number }>): WnbaSplitMetrics {
  const wins = rows.filter((row) => row.won).length;
  const losses = rows.length - wins;
  const pointsFor = mean(rows.map((row) => row.pointsFor));
  const pointsAgainst = mean(rows.map((row) => row.pointsAgainst));
  return {
    games: rows.length,
    wins,
    losses,
    winRate: rows.length ? wins / rows.length : null,
    pointsFor: pointsFor === null ? null : round(pointsFor),
    pointsAgainst: pointsAgainst === null ? null : round(pointsAgainst),
    netPoints: pointsFor === null || pointsAgainst === null ? null : round(pointsFor - pointsAgainst),
  };
}

export function buildWnbaTeamMetrics(
  events: any[],
  teamId: string,
  targetDate: string | Date,
): WnbaTeamMetrics {
  const targetMs = new Date(targetDate).getTime();
  const teamIdString = String(teamId);
  const rows: Array<{
    date: string;
    dateMs: number;
    won: boolean;
    pointsFor: number;
    pointsAgainst: number;
    isHome: boolean;
    venueCity: string | null;
  }> = [];

  for (const event of Array.isArray(events) ? events : []) {
    if (!isFinalEvent(event)) continue;
    const dateMs = Date.parse(String(event?.date ?? ""));
    if (!Number.isFinite(dateMs) || !Number.isFinite(targetMs) || dateMs >= targetMs) continue;
    const competition = event?.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const team = competitors.find((candidate: any) => eventTeamMatches(candidate, teamIdString));
    const opponent = competitors.find((candidate: any) => eventTeamId(candidate) && !eventTeamMatches(candidate, teamIdString));
    const pointsFor = eventScore(team);
    const pointsAgainst = eventScore(opponent);
    if (!team || !opponent || pointsFor === null || pointsAgainst === null) continue;
    rows.push({
      date: new Date(dateMs).toISOString(),
      dateMs,
      won: team?.winner === true || pointsFor > pointsAgainst,
      pointsFor,
      pointsAgainst,
      isHome: team?.homeAway === "home",
      venueCity: competition?.venue?.address?.city ?? null,
    });
  }

  rows.sort((a, b) => a.dateMs - b.dateMs);
  const recent = rows.slice(-10);
  const wins = rows.filter((row) => row.won).length;
  const pointsFor = mean(rows.map((row) => row.pointsFor));
  const pointsAgainst = mean(rows.map((row) => row.pointsAgainst));
  const recentPointsFor = mean(recent.map((row) => row.pointsFor));
  const recentPointsAgainst = mean(recent.map((row) => row.pointsAgainst));
  const last = rows.at(-1) ?? null;
  const calendarDays = last && Number.isFinite(targetMs)
    ? Math.floor((targetMs - last.dateMs) / DAY_MS)
    : null;
  const restDays = calendarDays === null ? null : Math.max(0, calendarDays - 1);

  return {
    games: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: rows.length ? wins / rows.length : null,
    pointsFor: pointsFor === null ? null : round(pointsFor),
    pointsAgainst: pointsAgainst === null ? null : round(pointsAgainst),
    netPoints: pointsFor === null || pointsAgainst === null ? null : round(pointsFor - pointsAgainst),
    recentGames: recent.length,
    recentPointsFor: recentPointsFor === null ? null : round(recentPointsFor),
    recentPointsAgainst: recentPointsAgainst === null ? null : round(recentPointsAgainst),
    recentNetPoints: recentPointsFor === null || recentPointsAgainst === null
      ? null
      : round(recentPointsFor - recentPointsAgainst),
    home: splitMetrics(rows.filter((row) => row.isHome)),
    away: splitMetrics(rows.filter((row) => !row.isHome)),
    restDays,
    backToBack: restDays === null ? null : restDays === 0,
    lastGameDate: last?.date ?? null,
    lastVenueCity: last?.venueCity ?? null,
  };
}

function statValue(stats: Record<string, number>, ...names: string[]): number | null {
  for (const name of names) {
    const value = finite(stats?.[name]);
    if (value !== null) return value;
  }
  return null;
}

export function deriveWnbaEfficiency(
  stats: Record<string, number>,
  metrics: WnbaTeamMetrics,
): WnbaEfficiency {
  const games = statValue(stats, "gamesPlayed") ?? metrics.games;
  if (!games || games <= 0) {
    return { games: 0, pace: null, offensiveRating: null, defensiveRating: null, source: "unavailable" };
  }
  const perGame = (averageNames: string[], totalNames: string[]): number | null => {
    const average = statValue(stats, ...averageNames);
    if (average !== null) return average;
    const total = statValue(stats, ...totalNames);
    return total === null ? null : total / games;
  };
  const fga = perGame(["avgFieldGoalsAttempted"], ["fieldGoalsAttempted"]);
  const oreb = perGame(["avgOffensiveRebounds"], ["offensiveRebounds"]);
  const turnovers = perGame(["avgTurnovers"], ["turnovers"]);
  const fta = perGame(["avgFreeThrowsAttempted"], ["freeThrowsAttempted"]);
  const points = perGame(["avgPoints"], ["points"]);
  if ([fga, oreb, turnovers, fta, points].some((value) => value === null)) {
    return { games, pace: null, offensiveRating: null, defensiveRating: null, source: "unavailable" };
  }
  // Standard possession estimate from verified ESPN box-score aggregates.
  const pace = 0.96 * ((fga as number) - (oreb as number) + (turnovers as number) + 0.44 * (fta as number));
  if (!Number.isFinite(pace) || pace <= 0) {
    return { games, pace: null, offensiveRating: null, defensiveRating: null, source: "unavailable" };
  }
  return {
    games,
    pace: round(pace, 2),
    offensiveRating: round(((points as number) / pace) * 100, 2),
    defensiveRating: metrics.pointsAgainst === null ? null : round((metrics.pointsAgainst / pace) * 100, 2),
    source: "espn-team-statistics-derived",
  };
}

export function detectMinutesRestriction(detail: string | null | undefined): boolean {
  const value = String(detail ?? "").toLowerCase();
  return /minutes?\s+(limit|restriction|cap)|limited\s+minutes|restricted\s+minutes|workload\s+(limit|restriction)/.test(value);
}

export function buildWnbaAvailability(
  injuries: Array<{ name?: string; player_name?: string; status?: string; detail?: string }>,
  minutesByPlayer: Record<string, number | null>,
  sourceAvailable: boolean,
  teamMatched = true,
): WnbaAvailability {
  const profiles = (Array.isArray(injuries) ? injuries : []).map((injury) => {
    const name = String(injury.player_name ?? injury.name ?? "");
    const minutes = finite(minutesByPlayer[name.toLowerCase()]);
    return {
      name,
      status: String(injury.status ?? "").toLowerCase(),
      minutesPerGame: minutes,
      detail: injury.detail ?? null,
    };
  });
  const unavailable = profiles.filter((profile) => ["out", "doubtful"].includes(profile.status));
  const questionable = profiles.filter((profile) => ["questionable", "day-to-day"].includes(profile.status));
  const sumMinutes = (rows: WnbaAvailabilityProfile[]): number | null => {
    if (rows.length === 0) return 0;
    if (rows.some((row) => row.minutesPerGame === null)) return null;
    return round(rows.reduce((sum, row) => sum + (row.minutesPerGame ?? 0), 0));
  };
  return {
    sourceAvailable,
    teamMatched,
    profiles,
    unavailableMinutes: sumMinutes(unavailable),
    questionableMinutes: sumMinutes(questionable),
    missingMinutesProfiles: profiles.filter((profile) => profile.minutesPerGame === null).length,
  };
}

export function parseWnbaLineupContext(
  summary: any,
  teamAbbr: string,
  playerName: string,
): WnbaLineupContext {
  const teamBox = (summary?.boxscore?.players ?? []).find(
    (entry: any) => String(entry?.team?.abbreviation ?? "").toUpperCase() === teamAbbr.toUpperCase(),
  );
  const athletes = teamBox?.statistics?.[0]?.athletes ?? [];
  if (!Array.isArray(athletes) || athletes.length === 0) {
    return {
      status: summary && typeof summary === "object" ? "unconfirmed" : "unavailable",
      sourceAvailable: !!summary,
      starters: [],
      playerListed: null,
      playerStarting: null,
      playerActive: null,
    };
  }
  const starters = athletes
    .filter((row: any) => row?.starter === true)
    .map((row: any) => String(row?.athlete?.displayName ?? ""))
    .filter(Boolean);
  const normalizedPlayer = playerName.trim().toLowerCase();
  const player = athletes.find(
    (row: any) => String(row?.athlete?.displayName ?? "").trim().toLowerCase() === normalizedPlayer,
  );
  return {
    status: starters.length >= 5 ? "confirmed" : "unconfirmed",
    sourceAvailable: true,
    starters,
    playerListed: !!player,
    playerStarting: player ? player?.starter === true : false,
    playerActive: player ? player?.active !== false : false,
  };
}

export async function fetchWnbaLineupContext(
  eventId: string | null | undefined,
  teamAbbr: string,
  playerName: string,
): Promise<WnbaLineupContext> {
  if (!eventId) return parseWnbaLineupContext(null, teamAbbr, playerName);
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(eventId)}`,
      { headers: { "User-Agent": "SentinelAnalytics/1.0" } },
    );
    if (!response.ok) return parseWnbaLineupContext(null, teamAbbr, playerName);
    return parseWnbaLineupContext(await response.json(), teamAbbr, playerName);
  } catch {
    return parseWnbaLineupContext(null, teamAbbr, playerName);
  }
}

function hitRateScore(games: WnbaPlayerGame[], line: number, direction: WnbaDirection): number {
  if (games.length === 0) return 50;
  const hits = games.filter((game) => direction === "over" ? game.value > line : game.value < line).length;
  // Shrink small observed rates toward 50. This is a heuristic feature, not
  // a calibrated win probability.
  return ((hits + 3) / (games.length + 6)) * 100;
}

function scoreFromProjection(projection: number, line: number, direction: WnbaDirection): number {
  const scale = Math.max(1, Math.abs(line) * 0.12);
  const directionalMargin = direction === "over" ? projection - line : line - projection;
  return clamp(50 + (directionalMargin / scale) * 12, 20, 80);
}

function verdictForScore(score: number): WnbaPlayerScoreResult["verdict"] {
  if (score >= 72) return "STRONG";
  if (score >= 58) return "LEAN";
  if (score >= 50) return "RISKY";
  return "PASS";
}

export function scoreWnbaPlayerProp(args: {
  games: WnbaPlayerGame[];
  previousSeasonGames?: WnbaPlayerGame[];
  line: number;
  direction: WnbaDirection;
  propType: string;
  opponent: string | null;
  nextGameDate: string | null;
  isHome: boolean | null;
  lineup: WnbaLineupContext;
  playerAvailability: WnbaAvailabilityProfile | null;
  injurySourceAvailable: boolean;
  teamEfficiency: WnbaEfficiency | null;
  opponentEfficiency: WnbaEfficiency | null;
  targetVenueCity?: string | null;
  lastVenueCity?: string | null;
  marketMovementAvailable?: boolean;
  recentRosterChangesAvailable?: boolean;
}): WnbaPlayerScoreResult {
  const factors: WnbaFactor[] = [];
  const missing: string[] = [];
  const reasoning: string[] = [];
  const targetMs = args.nextGameDate ? Date.parse(args.nextGameDate) : Number.POSITIVE_INFINITY;
  const current = [...(args.games ?? [])]
    .filter((game) => Number.isFinite(game.value) && Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) < targetMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const previous = [...(args.previousSeasonGames ?? [])]
    .filter((game) => Number.isFinite(game.value) && Number.isFinite(Date.parse(game.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const availabilityStatus = String(args.playerAvailability?.status ?? "").toLowerCase();
  const minutesRestricted = detectMinutesRestriction(args.playerAvailability?.detail);
  if (["out", "doubtful"].includes(availabilityStatus) || args.lineup.playerActive === false && args.lineup.status === "confirmed") {
    return {
      score: 0,
      verdict: "PASS",
      factors: [],
      reasoning: ["Official availability data does not support an active player wager."],
      playerIsOut: true,
      diagnostics: {
        model_version: "wnba-verified-props-v1",
        wnba_data_quality: "blocked",
        player_availability: availabilityStatus || "inactive",
        minutes_restriction: minutesRestricted,
        probability_supported: false,
      },
    };
  }

  if (current.length >= 5) {
    const recentCount = current.length >= 10 ? 5 : 0;
    const baseline = recentCount ? current.slice(0, -recentCount) : current;
    factors.push({
      name: "current_season_baseline",
      label: "Current-season baseline",
      score: round(hitRateScore(baseline, args.line, args.direction)),
      weight: 0.30,
      detail: `${baseline.length} pregame results; small samples shrunk toward neutral`,
      source: "ESPN WNBA player game log",
      sampleSize: baseline.length,
    });
    if (recentCount) {
      const recent = current.slice(-recentCount);
      factors.push({
        name: "recent_form",
        label: "Recent form",
        score: round(hitRateScore(recent, args.line, args.direction)),
        weight: 0.18,
        detail: `Last ${recent.length} games, kept separate from the baseline sample`,
        source: "ESPN WNBA player game log",
        sampleSize: recent.length,
      });
    }
  } else {
    missing.push("CURRENT_SEASON_SAMPLE_INSUFFICIENT");
  }

  const minuteGames = current.slice(-10).filter((game) => (game.minutes ?? 0) > 0);
  if (minuteGames.length >= 5) {
    const totalMinutes = minuteGames.reduce((sum, game) => sum + (game.minutes ?? 0), 0);
    const perMinute = totalMinutes > 0
      ? minuteGames.reduce((sum, game) => sum + game.value, 0) / totalMinutes
      : null;
    const recentMinutes = minuteGames.slice(-5).map((game) => game.minutes as number);
    const projectedMinutes = mean(recentMinutes);
    if (perMinute !== null && projectedMinutes !== null) {
      const projection = perMinute * projectedMinutes;
      factors.push({
        name: "minutes_role_projection",
        label: "Minutes and role projection",
        score: round(scoreFromProjection(projection, args.line, args.direction)),
        weight: 0.24,
        detail: `${round(projectedMinutes)} recent MPG × ${round(perMinute, 3)} ${args.propType}/minute = ${round(projection)} projected`,
        source: "ESPN WNBA player game log",
        sampleSize: minuteGames.length,
      });
    }
  } else {
    missing.push("MINUTES_SAMPLE_INSUFFICIENT");
  }

  if (args.isHome !== null) {
    const locationGames = current.filter((game) => game.isHome === args.isHome);
    if (locationGames.length >= 4) {
      factors.push({
        name: "venue_split",
        label: args.isHome ? "Home split" : "Road split",
        score: round(hitRateScore(locationGames, args.line, args.direction)),
        weight: 0.10,
        detail: `${locationGames.length} current-season ${args.isHome ? "home" : "road"} games`,
        source: "ESPN WNBA player game log",
        sampleSize: locationGames.length,
      });
    } else missing.push("VENUE_SPLIT_SAMPLE_INSUFFICIENT");
  } else missing.push("GAME_VENUE_UNRESOLVED");

  if (args.opponent) {
    const opponent = args.opponent.toUpperCase();
    const matchupGames = current.filter((game) => game.opponent.toUpperCase() === opponent);
    if (matchupGames.length >= 3) {
      factors.push({
        name: "matchup_history",
        label: "Current-season matchup history",
        score: round(hitRateScore(matchupGames, args.line, args.direction)),
        weight: 0.08,
        detail: `${matchupGames.length} games against ${opponent}; capped as a small matchup input`,
        source: "ESPN WNBA player game log",
        sampleSize: matchupGames.length,
      });
    } else missing.push("MATCHUP_SAMPLE_INSUFFICIENT");
  } else missing.push("OPPONENT_UNRESOLVED");

  const volumeProps = new Set([
    "points", "assists", "3-pointers", "three_pointers_made", "pts+reb", "pts+ast", "reb+ast", "pts+reb+ast",
  ]);
  if (
    volumeProps.has(args.propType) &&
    args.teamEfficiency?.pace !== null && args.teamEfficiency?.pace !== undefined &&
    args.teamEfficiency?.offensiveRating !== null && args.teamEfficiency?.offensiveRating !== undefined &&
    args.opponentEfficiency?.pace !== null && args.opponentEfficiency?.pace !== undefined &&
    args.opponentEfficiency?.defensiveRating !== null && args.opponentEfficiency?.defensiveRating !== undefined
  ) {
    const paceDelta = args.opponentEfficiency.pace - args.teamEfficiency.pace;
    const matchupDelta = args.opponentEfficiency.defensiveRating - args.teamEfficiency.offensiveRating;
    const directional = clamp(50 + paceDelta * 1.5 + matchupDelta * 0.8, 30, 70);
    factors.push({
      name: "pace_efficiency_matchup",
      label: "Pace and efficiency matchup",
      score: round(args.direction === "over" ? directional : 100 - directional),
      weight: 0.10,
      detail: `Opponent pace delta ${round(paceDelta, 2)}, opponent DRtg vs team ORtg ${round(matchupDelta, 2)}`,
      source: "ESPN WNBA team statistics (possession-derived)",
      sampleSize: Math.min(args.teamEfficiency.games, args.opponentEfficiency.games),
    });
  } else {
    missing.push("PACE_EFFICIENCY_MATCHUP_UNAVAILABLE");
  }

  let previousSeasonUsed = false;
  if (current.length < 10 && previous.length >= 10) {
    previousSeasonUsed = true;
    factors.push({
      name: "previous_season_prior",
      label: "Previous-season prior",
      score: round(hitRateScore(previous, args.line, args.direction)),
      weight: 0.10,
      detail: `${previous.length} prior-season games used only as a low-weight prior`,
      source: "ESPN WNBA prior-season player game log",
      sampleSize: previous.length,
    });
  }

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weighted = totalWeight > 0
    ? factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight
    : 50;
  let qualityShrink = clamp(totalWeight / 0.90, 0.45, 1);
  if (!args.injurySourceAvailable) {
    qualityShrink *= 0.82;
    missing.push("INJURY_SOURCE_UNAVAILABLE");
  }
  if (args.lineup.status !== "confirmed") {
    qualityShrink *= 0.90;
    missing.push(args.lineup.sourceAvailable ? "STARTING_LINEUP_UNCONFIRMED" : "LINEUP_SOURCE_UNAVAILABLE");
  }
  if (args.lineup.status === "confirmed" && args.lineup.playerStarting === false) {
    qualityShrink *= 0.75;
    missing.push("PLAYER_NOT_STARTING");
  }
  const lastGameMs = current.length ? Date.parse(current.at(-1)!.date) : Number.NaN;
  const restDays = Number.isFinite(lastGameMs) && Number.isFinite(targetMs)
    ? Math.max(0, Math.floor((targetMs - lastGameMs) / DAY_MS) - 1)
    : null;
  const travelCityChanged = !!args.targetVenueCity && !!args.lastVenueCity &&
    args.targetVenueCity.toLowerCase() !== args.lastVenueCity.toLowerCase();
  if (restDays === 0) qualityShrink *= 0.92;
  if (restDays !== null && restDays <= 1 && travelCityChanged) qualityShrink *= 0.94;
  if (restDays === null) missing.push("REST_CONTEXT_UNAVAILABLE");
  if (!args.targetVenueCity || !args.lastVenueCity) missing.push("TRAVEL_CONTEXT_UNAVAILABLE");
  if (args.marketMovementAvailable !== true) missing.push("MARKET_MOVEMENT_UNAVAILABLE");
  if (args.recentRosterChangesAvailable !== true) missing.push("RECENT_ROSTER_CHANGES_UNAVAILABLE");

  let score = round(50 + (weighted - 50) * qualityShrink);
  if (previousSeasonUsed) score = Math.min(score, 64);
  if (["questionable", "day-to-day"].includes(availabilityStatus)) score = Math.min(score, 55);
  if (minutesRestricted) score = Math.min(score, 52);
  if (current.length < 5) score = Math.min(score, previous.length >= 10 ? 55 : 0);
  if (!args.injurySourceAvailable || args.lineup.status === "unavailable") score = Math.min(score, 68);
  score = clamp(score, 0, 82);

  const verdict = verdictForScore(score);
  reasoning.push(`${score}/100 WNBA heuristic score from ${factors.length} verified factors; it is not a calibrated probability.`);
  if (restDays !== null) reasoning.push(`${restDays} full rest day(s) before the listed game${travelCityChanged ? "; venue city changes from the prior game" : ""}.`);
  if (missing.length) reasoning.push(`Unavailable or limited inputs: ${[...new Set(missing)].join(", ")}.`);

  const severeMissing = missing.filter((flag) => [
    "CURRENT_SEASON_SAMPLE_INSUFFICIENT", "INJURY_SOURCE_UNAVAILABLE", "LINEUP_SOURCE_UNAVAILABLE", "OPPONENT_UNRESOLVED",
  ].includes(flag)).length;
  const dataQuality = severeMissing >= 2 || totalWeight < 0.45 ? "low" : missing.length >= 3 ? "medium" : "high";

  return {
    score,
    verdict,
    factors,
    reasoning,
    playerIsOut: false,
    diagnostics: {
      model_version: "wnba-verified-props-v1",
      wnba_data_quality: dataQuality,
      current_season_sample: current.length,
      previous_season_sample: previous.length,
      previous_season_used: previousSeasonUsed,
      evidence_weight: round(totalWeight, 2),
      quality_shrink: round(qualityShrink, 3),
      injury_source_available: args.injurySourceAvailable,
      lineup_status: args.lineup.status,
      player_listed: args.lineup.playerListed,
      player_starting: args.lineup.playerStarting,
      player_availability: availabilityStatus || "not_listed",
      minutes_restriction: minutesRestricted,
      rest_days: restDays,
      travel_city_changed: args.targetVenueCity && args.lastVenueCity ? travelCityChanged : null,
      market_movement_available: args.marketMovementAvailable === true,
      recent_roster_changes_available: args.recentRosterChangesAvailable === true,
      missing_inputs: [...new Set(missing)],
      score_kind: "heuristic_score",
      probability_supported: false,
    },
  };
}

function factorScoreFromDelta(delta: number, multiplier: number): number {
  return clamp(50 + delta * multiplier, 25, 75);
}

function selectedVenueSplit(metrics: WnbaTeamMetrics, isHome: boolean | null): WnbaSplitMetrics | null {
  if (isHome === null) return null;
  return isHome ? metrics.home : metrics.away;
}

function availabilityFactor(
  selected: WnbaAvailability,
  opponent: WnbaAvailability,
): { score: number; detail: string } | null {
  if (!selected.sourceAvailable || !opponent.sourceAvailable || !selected.teamMatched || !opponent.teamMatched) return null;
  if (selected.unavailableMinutes === null || opponent.unavailableMinutes === null) return null;
  const delta = opponent.unavailableMinutes - selected.unavailableMinutes;
  return {
    score: clamp(50 + delta * 0.6, 25, 75),
    detail: `Unavailable rotation minutes: selected ${selected.unavailableMinutes}, opponent ${opponent.unavailableMinutes}`,
  };
}

export function scoreWnbaTeamMarket(args: {
  market: WnbaMarket;
  selectedTeamName: string;
  opponentTeamName: string;
  selectedMetrics: WnbaTeamMetrics;
  opponentMetrics: WnbaTeamMetrics;
  selectedPreviousMetrics?: WnbaTeamMetrics | null;
  opponentPreviousMetrics?: WnbaTeamMetrics | null;
  selectedEfficiency: WnbaEfficiency;
  opponentEfficiency: WnbaEfficiency;
  selectedAvailability: WnbaAvailability;
  opponentAvailability: WnbaAvailability;
  selectedIsHome: boolean | null;
  spreadLine?: number | null;
  totalLine?: number | null;
  direction?: string | null;
  targetVenueCity?: string | null;
  selectedLineup?: WnbaLineupContext | null;
  opponentLineup?: WnbaLineupContext | null;
  marketMovementAvailable?: boolean;
  recentRosterChangesAvailable?: boolean;
}): WnbaTeamScoreResult {
  const factors: WnbaFactor[] = [];
  const missing: string[] = [];
  const s = args.selectedMetrics;
  const o = args.opponentMetrics;

  if (s.winRate !== null && o.winRate !== null && s.games >= 5 && o.games >= 5) {
    factors.push({
      name: "current_season_win_rate",
      label: "Current-season win rate",
      score: round(factorScoreFromDelta(s.winRate - o.winRate, 45)),
      weight: 0.18,
      detail: `${args.selectedTeamName} ${s.wins}-${s.losses}; ${args.opponentTeamName} ${o.wins}-${o.losses}`,
      source: "ESPN WNBA schedules",
      sampleSize: Math.min(s.games, o.games),
    });
  } else missing.push("CURRENT_RECORD_SAMPLE_INSUFFICIENT");

  if (s.netPoints !== null && o.netPoints !== null) {
    factors.push({
      name: "season_scoring_margin",
      label: "Season scoring margin",
      score: round(factorScoreFromDelta(s.netPoints - o.netPoints, 1.6)),
      weight: 0.20,
      detail: `${args.selectedTeamName} ${s.netPoints >= 0 ? "+" : ""}${s.netPoints}; ${args.opponentTeamName} ${o.netPoints >= 0 ? "+" : ""}${o.netPoints}`,
      source: "ESPN WNBA final scores",
      sampleSize: Math.min(s.games, o.games),
    });
  } else missing.push("SCORING_MARGIN_UNAVAILABLE");

  if (s.recentNetPoints !== null && o.recentNetPoints !== null && s.recentGames >= 5 && o.recentGames >= 5) {
    factors.push({
      name: "recent_form",
      label: "Recent form",
      score: round(factorScoreFromDelta(s.recentNetPoints - o.recentNetPoints, 1.4)),
      weight: 0.16,
      detail: `Last ${Math.min(s.recentGames, o.recentGames)} net: ${args.selectedTeamName} ${s.recentNetPoints}, ${args.opponentTeamName} ${o.recentNetPoints}`,
      source: "ESPN WNBA final scores",
      sampleSize: Math.min(s.recentGames, o.recentGames),
    });
  } else missing.push("RECENT_FORM_SAMPLE_INSUFFICIENT");

  const selectedSplit = selectedVenueSplit(s, args.selectedIsHome);
  const opponentSplit = selectedVenueSplit(o, args.selectedIsHome === null ? null : !args.selectedIsHome);
  if (selectedSplit?.netPoints !== null && selectedSplit?.netPoints !== undefined && opponentSplit?.netPoints !== null && opponentSplit?.netPoints !== undefined && selectedSplit.games >= 4 && opponentSplit.games >= 4) {
    factors.push({
      name: "venue_split",
      label: "Home/road split",
      score: round(factorScoreFromDelta(selectedSplit.netPoints - opponentSplit.netPoints, 1.2)),
      weight: 0.10,
      detail: `Selected split ${selectedSplit.netPoints}; opponent split ${opponentSplit.netPoints}`,
      source: "ESPN WNBA schedules",
      sampleSize: Math.min(selectedSplit.games, opponentSplit.games),
    });
  } else missing.push("VENUE_SPLIT_SAMPLE_INSUFFICIENT");

  if (
    args.selectedEfficiency.offensiveRating !== null && args.selectedEfficiency.defensiveRating !== null &&
    args.opponentEfficiency.offensiveRating !== null && args.opponentEfficiency.defensiveRating !== null
  ) {
    const selectedNet = args.selectedEfficiency.offensiveRating - args.selectedEfficiency.defensiveRating;
    const opponentNet = args.opponentEfficiency.offensiveRating - args.opponentEfficiency.defensiveRating;
    factors.push({
      name: "possession_efficiency",
      label: "Possession efficiency",
      score: round(factorScoreFromDelta(selectedNet - opponentNet, 1.2)),
      weight: 0.16,
      detail: `Derived net rating: selected ${round(selectedNet, 2)}, opponent ${round(opponentNet, 2)}`,
      source: "ESPN WNBA team statistics (possession-derived)",
      sampleSize: Math.min(args.selectedEfficiency.games, args.opponentEfficiency.games),
    });
  } else missing.push("POSSESSION_EFFICIENCY_UNAVAILABLE");

  if (s.restDays !== null && o.restDays !== null) {
    const restDelta = s.restDays - o.restDays;
    let restScore = factorScoreFromDelta(restDelta, 5);
    const travelCityChanged = !!args.targetVenueCity && !!s.lastVenueCity &&
      args.targetVenueCity.toLowerCase() !== s.lastVenueCity.toLowerCase();
    if (s.restDays <= 1 && travelCityChanged) restScore -= 4;
    factors.push({
      name: "rest_travel",
      label: "Rest and travel",
      score: round(clamp(restScore, 30, 70)),
      weight: 0.10,
      detail: `Full rest days: selected ${s.restDays}, opponent ${o.restDays}${travelCityChanged ? "; selected team changes venue city" : ""}`,
      source: "ESPN WNBA schedule dates and venue cities",
      sampleSize: 1,
    });
  } else missing.push("REST_TRAVEL_CONTEXT_UNAVAILABLE");

  const availability = availabilityFactor(args.selectedAvailability, args.opponentAvailability);
  if (availability) {
    factors.push({
      name: "player_availability",
      label: "Player availability",
      score: round(availability.score),
      weight: 0.10,
      detail: availability.detail,
      source: "ESPN WNBA injuries plus ESPN season minutes",
      sampleSize: args.selectedAvailability.profiles.length + args.opponentAvailability.profiles.length,
    });
  } else missing.push("AVAILABILITY_IMPACT_UNVERIFIED");

  const lineupStatus = args.selectedLineup?.status === "confirmed" && args.opponentLineup?.status === "confirmed"
    ? "confirmed"
    : args.selectedLineup?.status === "unavailable" || args.opponentLineup?.status === "unavailable"
      ? "unavailable"
      : "unconfirmed";
  if (lineupStatus !== "confirmed") missing.push("STARTING_LINEUPS_UNCONFIRMED");
  if (args.marketMovementAvailable !== true) missing.push("MARKET_MOVEMENT_UNAVAILABLE");
  if (args.recentRosterChangesAvailable !== true) missing.push("RECENT_ROSTER_CHANGES_UNAVAILABLE");

  let previousSeasonUsed = false;
  if (
    (s.games < 8 || o.games < 8) &&
    args.selectedPreviousMetrics?.netPoints !== null && args.selectedPreviousMetrics?.netPoints !== undefined &&
    args.opponentPreviousMetrics?.netPoints !== null && args.opponentPreviousMetrics?.netPoints !== undefined
  ) {
    previousSeasonUsed = true;
    factors.push({
      name: "previous_season_prior",
      label: "Previous-season prior",
      score: round(factorScoreFromDelta(args.selectedPreviousMetrics.netPoints - args.opponentPreviousMetrics.netPoints, 0.8)),
      weight: 0.08,
      detail: "Prior season used only because a current-season team sample has fewer than eight games",
      source: "ESPN WNBA prior-season final scores",
      sampleSize: Math.min(args.selectedPreviousMetrics.games, args.opponentPreviousMetrics.games),
    });
  }

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const composite = totalWeight > 0
    ? factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0) / totalWeight
    : 50;

  const selectedExpected = s.pointsFor !== null && o.pointsAgainst !== null
    ? (s.pointsFor + o.pointsAgainst) / 2
    : null;
  const opponentExpected = o.pointsFor !== null && s.pointsAgainst !== null
    ? (o.pointsFor + s.pointsAgainst) / 2
    : null;
  let projectedMargin = selectedExpected !== null && opponentExpected !== null
    ? selectedExpected - opponentExpected
    : null;
  let projectedTotal = selectedExpected !== null && opponentExpected !== null
    ? selectedExpected + opponentExpected
    : null;

  if (projectedMargin !== null && selectedSplit?.netPoints !== null && selectedSplit?.netPoints !== undefined && opponentSplit?.netPoints !== null && opponentSplit?.netPoints !== undefined) {
    const venueAdjustment = clamp((selectedSplit.netPoints - opponentSplit.netPoints) * 0.15, -3, 3);
    projectedMargin += venueAdjustment;
  }
  if (projectedTotal !== null && s.recentPointsFor !== null && s.recentPointsAgainst !== null && o.recentPointsFor !== null && o.recentPointsAgainst !== null) {
    const recentExpected = (s.recentPointsFor + o.recentPointsAgainst + o.recentPointsFor + s.recentPointsAgainst) / 2;
    projectedTotal = projectedTotal * 0.75 + recentExpected * 0.25;
  }
  projectedMargin = projectedMargin === null ? null : round(projectedMargin);
  projectedTotal = projectedTotal === null ? null : round(projectedTotal);

  let score = composite;
  if (args.market === "spread") {
    const line = finite(args.spreadLine);
    if (line === null || projectedMargin === null) {
      missing.push("SPREAD_PROJECTION_UNAVAILABLE");
      score = 0;
    } else {
      const coverScore = clamp(50 + (projectedMargin + line) * 3.5, 20, 80);
      score = composite * 0.45 + coverScore * 0.55;
    }
  } else if (args.market === "total") {
    const line = finite(args.totalLine);
    const direction = String(args.direction ?? "").toLowerCase();
    if (line === null || projectedTotal === null || !["over", "under"].includes(direction)) {
      missing.push("TOTAL_PROJECTION_UNAVAILABLE");
      score = 0;
    } else {
      const margin = direction === "over" ? projectedTotal - line : line - projectedTotal;
      score = clamp(50 + margin * 2.5, 20, 80);
    }
  }

  let qualityShrink = clamp(totalWeight / 0.92, 0.45, 1);
  if (!args.selectedAvailability.sourceAvailable || !args.opponentAvailability.sourceAvailable) qualityShrink *= 0.82;
  score = score === 0 ? 0 : round(50 + (score - 50) * qualityShrink);
  if (previousSeasonUsed) score = Math.min(score, 64);
  if (s.games < 5 || o.games < 5) score = Math.min(score, 55);
  if (!args.selectedAvailability.sourceAvailable || !args.opponentAvailability.sourceAvailable) score = Math.min(score, 66);
  score = clamp(score, 0, 82);
  const verdict = verdictForScore(score);

  const severeMissing = missing.filter((flag) => [
    "CURRENT_RECORD_SAMPLE_INSUFFICIENT", "SCORING_MARGIN_UNAVAILABLE", "POSSESSION_EFFICIENCY_UNAVAILABLE", "AVAILABILITY_IMPACT_UNVERIFIED",
  ].includes(flag)).length;
  const dataQuality = severeMissing >= 2 || totalWeight < 0.50 ? "low" : missing.length >= 3 ? "medium" : "high";
  const reasoning = [
    `${score}/100 WNBA ${args.market} heuristic score for ${args.selectedTeamName}; it is not a calibrated probability.`,
  ];
  if (projectedMargin !== null) reasoning.push(`Verified score inputs imply a ${projectedMargin >= 0 ? "+" : ""}${projectedMargin} selected-team margin.`);
  if (projectedTotal !== null) reasoning.push(`Verified score inputs imply a ${projectedTotal} game total.`);
  if (missing.length) reasoning.push(`Unavailable or limited inputs: ${[...new Set(missing)].join(", ")}.`);

  return {
    score,
    verdict,
    factors,
    reasoning,
    projectedMargin,
    projectedTotal,
    diagnostics: {
      model_version: "wnba-verified-team-markets-v1",
      wnba_data_quality: dataQuality,
      selected_side_confirmed: true,
      selected_team: args.selectedTeamName,
      market: args.market,
      current_season_samples: { selected: s.games, opponent: o.games },
      previous_season_used: previousSeasonUsed,
      evidence_weight: round(totalWeight, 2),
      quality_shrink: round(qualityShrink, 3),
      injury_source_available: args.selectedAvailability.sourceAvailable && args.opponentAvailability.sourceAvailable,
      lineup_status: lineupStatus,
      market_movement_available: args.marketMovementAvailable === true,
      recent_roster_changes_available: args.recentRosterChangesAvailable === true,
      projected_margin: projectedMargin,
      projected_total: projectedTotal,
      missing_inputs: [...new Set(missing)],
      score_kind: "heuristic_score",
      probability_supported: false,
    },
  };
}
