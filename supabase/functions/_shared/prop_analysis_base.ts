/**
 * Shared player-prop analysis assembly for the per-sport prop endpoints.
 *
 * `mlb-prop-model` and `wnba-prop-model` both need the same preamble — resolve
 * the player, pull the current and previous season game logs, turn those into
 * stat values for the requested prop, and derive the hit rates, splits and
 * head-to-head the UI renders. Only the scoring differs, so only the scoring
 * lives in the per-sport modules.
 *
 * The object returned by `buildPropAnalysisBase` is deliberately the same shape
 * `nba-api/analyze` returns today: the props screen reads ~40 fields off it,
 * and the point of the split is to move the model, not to break the client.
 *
 * Failures are returned as `{ error }`, never thrown. A thrown error becomes a
 * 500, and the client turns any non-2xx into "Failed to analyze. Please try
 * again." — which tells the user nothing about a missing game log.
 */

import {
  avg,
  getGameLog,
  getNextGame,
  getPlayerInfo,
  getSeasonAvg,
  getStatValue,
  hitRate,
  minutesTrend,
  searchPlayers,
  type EspnConfig,
  type GameRow,
} from "./espn_player_data.ts";
import { fetchMatchupInjuries, type InjuryReport, type NormalizedInjury } from "./injuries.ts";

export interface PropAnalysisRequest {
  playerName: string;
  propType: string;
  line: number;
  overUnder: "over" | "under";
  /** Opponent abbreviation, when the caller pinned one. */
  opponent?: string | null;
}

export interface PropAnalysisBase {
  /** Assembled response payload, in the contract the props screen consumes. */
  result: Record<string, any>;
  /** Pieces the per-sport scorers need that are not on the payload. */
  playerId: string;
  player: Record<string, any>;
  games: GameRow[];
  prevSeasonGames: GameRow[];
  analysisGames: GameRow[];
  statValues: number[];
  prevSeasonStatValues: number[];
  nextGame: Awaited<ReturnType<typeof getNextGame>>;
  opponentAbbr: string;
  teamInjuryReport: InjuryReport;
  playerInjuries: NormalizedInjury[];
  teammateInjuries: NormalizedInjury[];
  opponentInjuries: NormalizedInjury[];
}

export interface PropAnalysisFailure {
  error: string;
  [key: string]: unknown;
}

export function isPropAnalysisFailure(
  value: PropAnalysisBase | PropAnalysisFailure,
): value is PropAnalysisFailure {
  return typeof (value as PropAnalysisFailure).error === "string";
}

/** Game-log row shape the props screen renders. Superset across sports. */
function toGameLogRow(game: GameRow, statValue: number) {
  return {
    date: game.date ? new Date(game.date).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" }) : "",
    matchup: game.matchup,
    result: game.wl,
    stat_value: statValue,
    MIN: game.min, PTS: game.pts, REB: game.reb, AST: game.ast,
    FG3M: game.fg3m, STL: game.stl, BLK: game.blk,
    H: game.mlb_line?.hits ?? null,
    R: game.mlb_line?.runs ?? null,
    RBI: game.mlb_line?.rbi ?? null,
    HR: game.mlb_line?.homeRuns ?? null,
    K: game.mlb_line?.strikeouts ?? null,
    TB: game.mlb_line?.totalBases ?? null,
    BB: game.mlb_line?.walks ?? null,
    SB: game.mlb_line?.stolenBases ?? null,
    AB: game.at_bats,
    IP: game.mlb_line?.inningsPitched,
    OUTS: game.mlb_line?.outsRecorded,
    ER: game.mlb_line?.earnedRuns,
    PC: game.mlb_line?.pitches,
  };
}

/** Resolves the player through ESPN search. Returns null when nothing matches. */
export async function resolvePropPlayer(playerName: string, cfg: EspnConfig) {
  const matches = await searchPlayers(playerName, cfg);
  if (!matches.length) return null;
  const playerId = matches[0].id;
  return { playerId, player: await getPlayerInfo(playerId, cfg) };
}

/**
 * Loads every input the per-sport scorers read and assembles the response body.
 *
 * `minCurrentSample` is the number of usable current-season values below which
 * the sport refuses to score. It is a parameter rather than a constant because
 * the two sports genuinely differ: MLB plays 162 games so three is already a
 * red flag, while a WNBA season is 44 and is allowed to lean on a labelled
 * prior-season sample.
 */
export async function buildPropAnalysisBase(args: {
  cfg: EspnConfig;
  playerId: string;
  player: Record<string, any>;
  request: PropAnalysisRequest;
  /** Fall back to the previous season when the current one is empty. */
  usePrevSeasonWhenEmpty: boolean;
  minCurrentSample: number;
  insufficientSampleError: string;
}): Promise<PropAnalysisBase | PropAnalysisFailure> {
  const { cfg, playerId, player, request } = args;
  const { propType, line, overUnder } = request;

  const currentYear = new Date().getFullYear();
  let games = await getGameLog(playerId, undefined, cfg);
  let prevSeasonGames = await getGameLog(playerId, currentYear - 1, cfg);

  if (args.usePrevSeasonWhenEmpty && !games.length && prevSeasonGames.length) {
    games = prevSeasonGames;
    prevSeasonGames = [];
  }
  if (!games.length && prevSeasonGames.length < args.minCurrentSample) {
    return { error: `No game log data found for ${player.full_name} this season.`, player };
  }

  const analysisGames = games;
  const statValues = analysisGames.map((game) => getStatValue(game, propType));
  const prevSeasonStatValues = prevSeasonGames
    .map((game) => getStatValue(game, propType))
    .filter((value) => Number.isFinite(value));
  const currentFiniteSample = statValues.filter((value) => Number.isFinite(value)).length;

  if (currentFiniteSample + prevSeasonStatValues.length < args.minCurrentSample) {
    return {
      error: args.insufficientSampleError,
      player,
      prop_type: propType,
      line,
      over_under: overUnder,
      game_log: [],
      confidence: 0,
      verdict: "PASS",
      reasoning: [args.insufficientSampleError],
      dataQuality: { quality: "estimated", flags: ["INSUFFICIENT_VERIFIED_SAMPLE"], sampleSize: "insufficient" },
    };
  }

  const gameLog = analysisGames.map((game, index) => toGameLogRow(game, statValues[index]));
  const seasonHitRate = { ...hitRate(statValues, line, overUnder), avg: avg(statValues) };
  const last10Values = statValues.slice(-10);
  const last5Values = statValues.slice(-5);
  const last10 = { ...hitRate(last10Values, line, overUnder), avg: avg(last10Values) };
  const last5 = { ...hitRate(last5Values, line, overUnder), avg: avg(last5Values) };

  const nextGame = await getNextGame(player.team_abbr, cfg);
  const opponentAbbr = (request.opponent || nextGame?.opponent_abbr || "").toUpperCase();

  // Home/away split is computed against the side the player will actually be
  // on, so an "at home" split is never quoted for a road game.
  const isHomeNext = typeof nextGame?.is_home === "boolean" ? nextGame.is_home : null;
  const locationGames = isHomeNext === null
    ? []
    : analysisGames.filter((game) => game.isHome === isHomeNext);
  const locationValues = locationGames.map((game) => getStatValue(game, propType));
  const homeAway = {
    location: isHomeNext === null ? "" : isHomeNext ? "home" : "away",
    ...hitRate(locationValues, line, overUnder),
    avg: avg(locationValues),
  };

  const h2hGames = opponentAbbr
    ? analysisGames.filter((game) => (game.opponent || "").toUpperCase() === opponentAbbr)
    : [];
  const h2hValues = h2hGames.map((game) => getStatValue(game, propType));
  const headToHead = {
    opponent: opponentAbbr,
    games: h2hGames.map((game, index) => toGameLogRow(game, h2hValues[index])),
    ...hitRate(h2hValues, line, overUnder),
    avg: avg(h2hValues),
  };

  const prevH2hGames = opponentAbbr
    ? prevSeasonGames.filter((game) => (game.opponent || "").toUpperCase() === opponentAbbr)
    : [];
  const prevH2hValues = prevH2hGames.map((game) => getStatValue(game, propType));
  const prevSeasonH2H = {
    opponent: opponentAbbr,
    games: prevH2hGames.map((game, index) => toGameLogRow(game, prevH2hValues[index])),
    ...hitRate(prevH2hValues, line, overUnder),
    avg: avg(prevH2hValues),
  };

  const teamInjuryReport = await fetchMatchupInjuries(
    cfg.searchLeague,
    { abbr: player.team_abbr },
    opponentAbbr ? { abbr: opponentAbbr } : {},
  );
  const normalizedPlayerName = String(player.full_name || "").toLowerCase();
  const playerInjuries = teamInjuryReport.team1.filter(
    (injury) => String(injury.name || "").toLowerCase() === normalizedPlayerName,
  );
  const teammateInjuries = teamInjuryReport.team1.filter(
    (injury) => String(injury.name || "").toLowerCase() !== normalizedPlayerName,
  );

  const result: Record<string, any> = {
    player,
    prop_type: propType,
    prop_display: propType,
    sport: cfg.searchLeague,
    line,
    over_under: overUnder,
    matchup_opponent: opponentAbbr,
    season_avg: {},
    game_log: gameLog,
    season_hit_rate: seasonHitRate,
    last_10: last10,
    last_5: last5,
    home_away: homeAway,
    head_to_head: headToHead,
    h2h_combined: headToHead,
    prev_season_h2h: prevSeasonH2H,
    next_game: nextGame,
    player_injuries: playerInjuries,
    teammate_injuries: teammateInjuries,
    opponent_injuries: teamInjuryReport.team2,
    minutes_trend: minutesTrend(analysisGames, cfg.searchLeague),
    recency_games: analysisGames
      .filter((game) => game.date)
      .map((game) => ({ date: game.date, value: getStatValue(game, propType) }))
      .filter((row) => Number.isFinite(row.value)),
    current_season_games: games,
    prev_season_games: prevSeasonGames,
    all_games: games,
    injuries_last_updated: teamInjuryReport.sourceUpdatedAt ?? teamInjuryReport.fetchedAt,
    injury_source_available: teamInjuryReport.sourceAvailable && teamInjuryReport.team1Matched,
    opponent_injury_source_available: teamInjuryReport.sourceAvailable && teamInjuryReport.team2Matched,
    confidence: 0,
    verdict: "N/A",
    reasoning: [],
  };

  // Season averages are a display nicety; a failure here must not sink the
  // analysis, so it is fetched separately and swallowed.
  try {
    result.season_avg = await getSeasonAvg(playerId, cfg);
  } catch { /* display-only */ }

  return {
    result,
    playerId,
    player,
    games,
    prevSeasonGames,
    analysisGames,
    statValues,
    prevSeasonStatValues,
    nextGame,
    opponentAbbr,
    teamInjuryReport,
    playerInjuries,
    teammateInjuries,
    opponentInjuries: teamInjuryReport.team2,
  };
}
