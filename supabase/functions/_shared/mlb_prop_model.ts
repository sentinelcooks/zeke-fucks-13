/**
 * MLB player-prop scoring engine.
 *
 * Lifted out of `nba-api/index.ts` so MLB props have a deployable unit of their
 * own: `mlb-prop-model` can be redeployed, logged and rolled back without
 * touching the NBA and NHL paths that still live in that handler.
 *
 * This is a verbatim move — weights, thresholds and factor definitions are
 * unchanged. The split and the model rewrite are deliberately separate steps,
 * so that if a number moves after this lands it is the rewrite that moved it,
 * not the move.
 */

import { callAI, AIProviderError, ANTI_GENERIC_INSTRUCTION } from "./ai-provider.ts";
import { isMlbPitcherPosition, isMlbPitchingProp } from "./prop_normalization.ts";
import { fetchMlbGameIntelligence, type MlbGameIntelligence } from "./mlb_data.ts";
import { avg, getStatValue, hitRate, weightedHitRate, type GameRow } from "./espn_player_data.ts";

export const MLB_PROP_WEIGHTS: Record<string, Record<string, number>> = {
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
  pitcher_strikeouts: {},
};

export function detectMlbPropCategory(propType: string | null | undefined, isPitcher = false): keyof typeof MLB_PROP_WEIGHTS {
  const p = (propType || "").toLowerCase();
  if (isPitcher || (p.includes("strikeout") && (p.includes("pitcher") || p.includes("sp")))) return "pitcher_strikeouts";
  if (p.includes("strikeout") || p.match(/\bk\b|\bks\b/)) return "strikeouts";
  if (p.includes("total_base") || p.includes("total bases") || p.includes("tb")) return "total_bases";
  return "hits";
}

export interface MlbFactorResult {
  name: string;
  label: string;
  score: number;      // 0-100
  weight: number;     // 0-1
  detail: string;
}

export interface MlbContextData {
  intelligence?: MlbGameIntelligence;
  playerSide?: "home" | "away";
  opponentSide?: "home" | "away";
  playerPitcher?: MlbGameIntelligence["pitchers"]["home"];
  opposingPitcher?: MlbGameIntelligence["pitchers"]["home"];
  opponentLineup?: MlbGameIntelligence["lineups"]["home"];
  ownLineup?: MlbGameIntelligence["lineups"]["home"];
  listedBatter?: MlbGameIntelligence["lineups"]["home"]["batters"][number] | null;
  opponentTeam?: MlbGameIntelligence["teamStats"]["home"];
  ownBullpen?: MlbGameIntelligence["bullpen"]["home"];
  venue?: string;
  weather?: { temperature?: number; wind?: { speed?: number; direction?: string } };
  gameTime?: string;
  opposingSP?: { name: string; era: number; k9: number; whip: number; hand?: string };
  oppBullpenERA?: number;
  oppTeamKRate?: number;
  oppTeamOPS?: number;
  teamMomentum?: string[];
  restDays?: number;
  playerHand?: string;
}

// Batter weights (for hits, HR, RBI, total_bases, runs, etc.)
export const MLB_BATTER_WEIGHTS: Record<string, number> = {
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
  batting_order_stability: 0.00,
  day_night_split: 0.00,
  weather_temp: 0.01,
  team_momentum: 0.00,
  rest_days: 0.00,
  mlb_variance_regression: 0.00, // applied post-calc
};

export const MLB_PITCHER_PROP_WEIGHTS: Record<string, Record<string, number>> = {
  pitcher_strikeouts: {
    season_hit_rate: 0.18, prev_season_hit_rate: 0.04, last_10_trend: 0.12, last_5_hot_cold: 0.08,
    h2h_vs_opponent: 0.04, home_away_split: 0.04, vs_opp_team_k_rate: 0.14, vs_opp_team_ops: 0.07,
    vs_opp_team_walk_rate: 0, lineup_handedness: 0.06, pitch_type_matchup: 0.08,
    pitcher_workload: 0.08, bullpen_availability: 0.02, park_factor: 0, weather_temp: 0,
    player_injury_status: 0.02,
  },
  hits_allowed: {
    season_hit_rate: 0.20, prev_season_hit_rate: 0.04, last_10_trend: 0.12, last_5_hot_cold: 0.08,
    h2h_vs_opponent: 0.04, home_away_split: 0.04, vs_opp_team_k_rate: 0.06, vs_opp_team_ops: 0.14,
    vs_opp_team_walk_rate: 0, lineup_handedness: 0.08, pitch_type_matchup: 0.06,
    pitcher_workload: 0.08, bullpen_availability: 0.03, park_factor: 0.05, weather_temp: 0.03,
    player_injury_status: 0.02,
  },
  earned_runs: {
    season_hit_rate: 0.18, prev_season_hit_rate: 0.04, last_10_trend: 0.10, last_5_hot_cold: 0.08,
    h2h_vs_opponent: 0.04, home_away_split: 0.04, vs_opp_team_k_rate: 0.04, vs_opp_team_ops: 0.17,
    vs_opp_team_walk_rate: 0.05, lineup_handedness: 0.08, pitch_type_matchup: 0.05,
    pitcher_workload: 0.06, bullpen_availability: 0.04, park_factor: 0.07, weather_temp: 0.04,
    player_injury_status: 0.02,
  },
  walks_allowed: {
    season_hit_rate: 0.22, prev_season_hit_rate: 0.05, last_10_trend: 0.14, last_5_hot_cold: 0.10,
    h2h_vs_opponent: 0.04, home_away_split: 0.05, vs_opp_team_k_rate: 0, vs_opp_team_ops: 0.05,
    vs_opp_team_walk_rate: 0.18, lineup_handedness: 0.06, pitch_type_matchup: 0,
    pitcher_workload: 0.07, bullpen_availability: 0.02, park_factor: 0, weather_temp: 0,
    player_injury_status: 0.02,
  },
  outs_recorded: {
    season_hit_rate: 0.18, prev_season_hit_rate: 0.04, last_10_trend: 0.10, last_5_hot_cold: 0.06,
    h2h_vs_opponent: 0.03, home_away_split: 0.03, vs_opp_team_k_rate: 0.08, vs_opp_team_ops: 0.11,
    vs_opp_team_walk_rate: 0.05, lineup_handedness: 0.06, pitch_type_matchup: 0.06,
    pitcher_workload: 0.18, bullpen_availability: 0.07, park_factor: 0.03, weather_temp: 0,
    player_injury_status: 0.02,
  },
};
MLB_PITCHER_PROP_WEIGHTS.innings_pitched = MLB_PITCHER_PROP_WEIGHTS.outs_recorded;

export function scoreMlbFactor(val: number, line: number, ou: string): number {
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

export function scoreMlbHitRate(rate: number): number {
  // Direct mapping: hit rate % → confidence score
  return Math.max(0, Math.min(100, rate));
}

export function normalizeMlbPlayerName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[.'’\-]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchVerifiedMlbGameContext(args: {
  teamAbbr: string;
  opponentAbbr: string;
  playerName: string;
  isPitcher: boolean;
  gameDate?: string | null;
}): Promise<MlbContextData> {
  const intelligence = await fetchMlbGameIntelligence({
    teamAbbr: args.teamAbbr,
    opponentAbbr: args.opponentAbbr,
    gameDate: args.gameDate,
    focusPitcherName: args.isPitcher ? args.playerName : null,
    includePitchTypes: args.isPitcher,
  });
  const teamAbbr = args.teamAbbr.toUpperCase();
  if (intelligence.home.abbreviation !== teamAbbr && intelligence.away.abbreviation !== teamAbbr) {
    throw new Error(`Verified MLB game does not contain player team ${teamAbbr}`);
  }
  const playerSide: "home" | "away" = intelligence.home.abbreviation === teamAbbr ? "home" : "away";
  const opponentSide: "home" | "away" = playerSide === "home" ? "away" : "home";
  const playerPitcher = intelligence.pitchers[playerSide];
  const opposingPitcher = intelligence.pitchers[opponentSide];
  const opponentLineup = intelligence.lineups[opponentSide];
  const opponentTeam = intelligence.teamStats[opponentSide];
  const ownBullpen = intelligence.bullpen[playerSide];
  const ownLineup = intelligence.lineups[playerSide];
  const listedPlayer = ownLineup.batters.find((batter) =>
    normalizeMlbPlayerName(batter.name) === normalizeMlbPlayerName(args.playerName)
  );
  const weather = intelligence.weather;
  return {
    intelligence,
    playerSide,
    opponentSide,
    playerPitcher,
    opposingPitcher,
    opponentLineup,
    opponentTeam,
    ownBullpen,
    ownLineup,
    listedBatter: listedPlayer || null,
    venue: intelligence.venue.name || undefined,
    weather: weather ? {
      temperature: weather.temperatureF ?? undefined,
      wind: { speed: weather.windMph ?? undefined, direction: weather.windDirection ?? undefined },
    } : undefined,
    gameTime: intelligence.gameDate,
    opposingSP: opposingPitcher?.season ? {
      name: opposingPitcher.name,
      era: opposingPitcher.season.era,
      k9: opposingPitcher.season.k9,
      whip: opposingPitcher.season.whip,
      hand: opposingPitcher.hand || undefined,
    } : undefined,
    oppBullpenERA: opponentTeam.bullpenEra ?? undefined,
    oppTeamKRate: (opponentLineup.confirmed ? opponentLineup.strikeoutRate : null)
      ?? opponentTeam.splitVsPitcherHand?.strikeoutRate
      ?? opponentTeam.strikeoutRate
      ?? undefined,
    oppTeamOPS: (opponentLineup.confirmed ? opponentLineup.ops : null)
      ?? opponentTeam.splitVsPitcherHand?.ops
      ?? opponentTeam.ops
      ?? undefined,
    restDays: playerPitcher?.workload.daysRest ?? undefined,
    playerHand: args.isPitcher ? playerPitcher?.hand || undefined : listedPlayer?.batSide || undefined,
  };
}

export function directionalMlbScore(overScore: number, direction: string): number {
  const clamped = Math.max(0, Math.min(100, overScore));
  return direction === "under" ? 100 - clamped : clamped;
}

export function calculateVerifiedMlbPitcherScore(data: any, weights: Record<string, number>) {
  const reasoning: string[] = [];
  const factors: MlbFactorResult[] = [];
  const direction = data.over_under;
  const line = Number(data.line);
  const propType = String(data.prop_type || "");
  const isStrikeoutProp = propType === "pitcher_strikeouts";
  const isWalkProp = propType === "walks_allowed";
  const isOutsProp = propType === "outs_recorded" || propType === "innings_pitched";
  const isRunPreventionProp = propType === "hits_allowed" || propType === "earned_runs";
  const currentGames: GameRow[] = data.current_season_games || [];
  const previousGames: GameRow[] = data.prev_season_games || [];
  const currentValues = currentGames.map((game) => getStatValue(game, data.prop_type)).filter(Number.isFinite);
  const previousValues = previousGames.map((game) => getStatValue(game, data.prop_type)).filter(Number.isFinite);
  const addRateFactor = (name: string, label: string, values: number[], weight: number) => {
    if (!weight || values.length < 3) return;
    const rate = hitRate(values, line, direction);
    factors.push({ name, label, score: scoreMlbHitRate(rate.rate), weight, detail: `${rate.rate}% (${rate.hits}/${rate.total}), avg ${avg(values)}` });
  };

  addRateFactor("season_hit_rate", "Current Season Results", currentValues, weights.season_hit_rate);
  addRateFactor("prev_season_hit_rate", `${new Date().getFullYear() - 1} Results`, previousValues, weights.prev_season_hit_rate);
  addRateFactor("last_10_trend", "Last 10 Starts", currentValues.slice(-10), weights.last_10_trend);
  addRateFactor("last_5_hot_cold", "Last 5 Starts", currentValues.slice(-5), weights.last_5_hot_cold);

  const h2hValues = (data.head_to_head?.games || [])
    .map((game: any) => Number(game.stat_value))
    .filter(Number.isFinite);
  addRateFactor("h2h_vs_opponent", `vs ${data.head_to_head?.opponent || "Opponent"}`, h2hValues, weights.h2h_vs_opponent);
  const homeAwayValues = currentGames
    .filter((game) => data.home_away?.location === "home" ? game.isHome : !game.isHome)
    .map((game) => getStatValue(game, data.prop_type))
    .filter(Number.isFinite);
  addRateFactor("home_away_split", `${String(data.home_away?.location || "Venue").toUpperCase()} Split`, homeAwayValues, weights.home_away_split);

  const injuries = data.player_injuries || [];
  if (injuries.length > 0) {
    const status = String(injuries[0]?.status || "").toLowerCase();
    if (["out", "doubtful", "injured list", "il"].some((token) => status.includes(token))) {
      return {
        confidence: 0,
        reasoning: [`Player status is ${String(injuries[0]?.status || "unavailable")}; pitching prop blocked.`],
        factors: [],
        prevSeasonUsed: previousValues.length > 0,
        consensusFloorApplied: false,
        playerIsOut: true,
        dataQuality: { missing: ["PLAYER_UNAVAILABLE"], shrinkFactor: 0 },
      };
    }
    factors.push({ name: "player_injury_status", label: "Pitcher Availability", score: 35, weight: weights.player_injury_status, detail: String(injuries[0]?.status || "Status concern") });
  } else if (weights.player_injury_status > 0) {
    factors.push({ name: "player_injury_status", label: "Pitcher Availability", score: 50, weight: weights.player_injury_status, detail: "No active injury listing" });
  }

  const ctx: MlbContextData = data.mlb_context || {};
  const intelligence = ctx.intelligence;
  const missing = [...(intelligence?.missing || [])].filter((flag) => {
    if (flag === "CURRENT_PARK_FACTOR_MISSING") return weights.park_factor > 0;
    if (flag === "WEATHER_MISSING") return weights.weather_temp > 0;
    if (flag === "PITCH_TYPE_MATCHUP_INSUFFICIENT") return weights.pitch_type_matchup > 0;
    return true;
  });
  const profile = ctx.playerPitcher;
  const playerName = normalizeMlbPlayerName(data.player?.full_name);
  const profileMatches = Boolean(profile && normalizeMlbPlayerName(profile.name) === playerName);
  if (!profileMatches) {
    missing.push("PITCHER_NOT_CONFIRMED_AS_PROBABLE_STARTER");
  }
  const lineup = ctx.opponentLineup;
  const team = ctx.opponentTeam;
  const splitK = team?.splitVsPitcherHand?.strikeoutRate ?? null;
  const lineupK = lineup?.confirmed ? lineup.strikeoutRate : null;
  const kRate = lineupK ?? splitK ?? team?.strikeoutRate ?? null;
  if (weights.vs_opp_team_k_rate > 0 && kRate !== null && Number.isFinite(kRate)) {
    const overScore = isStrikeoutProp || isOutsProp
      ? 50 + (kRate - 22) * 3
      : 50 + (22 - kRate) * 3;
    factors.push({
      name: "vs_opp_team_k_rate",
      label: lineupK !== null ? "Confirmed Lineup K Rate" : splitK !== null ? `Team K Rate vs ${profile?.hand || "Pitcher"}` : "Opponent Team K Rate",
      score: directionalMlbScore(overScore, direction),
      weight: weights.vs_opp_team_k_rate,
      detail: `${kRate.toFixed(1)}% (${lineupK !== null ? "confirmed lineup" : splitK !== null ? `${team?.splitVsPitcherHand?.plateAppearances} PA hand split` : "season team rate"})`,
    });
  } else if (weights.vs_opp_team_k_rate > 0) missing.push("OPPONENT_K_RATE_MISSING");

  const lineupOps = lineup?.confirmed ? lineup.ops : null;
  const splitOps = team?.splitVsPitcherHand?.ops ?? null;
  const opponentOps = lineupOps ?? splitOps ?? team?.ops ?? null;
  if (weights.vs_opp_team_ops > 0 && opponentOps !== null && Number.isFinite(opponentOps)) {
    const overScore = isStrikeoutProp || isOutsProp
      ? 50 + (0.710 - opponentOps) * 150
      : 50 + (opponentOps - 0.710) * 150;
    factors.push({ name: "vs_opp_team_ops", label: "Opponent OPS Matchup", score: directionalMlbScore(overScore, direction), weight: weights.vs_opp_team_ops, detail: `${opponentOps.toFixed(3)} OPS` });
  } else if (weights.vs_opp_team_ops > 0) missing.push("OPPONENT_OPS_MISSING");

  const lineupWalkRate = lineup?.confirmed ? lineup.walkRate : null;
  const splitWalkRate = team?.splitVsPitcherHand?.walkRate ?? null;
  const opponentWalkRate = lineupWalkRate ?? splitWalkRate ?? team?.walkRate ?? null;
  if (weights.vs_opp_team_walk_rate > 0 && opponentWalkRate !== null && Number.isFinite(opponentWalkRate)) {
    const overScore = isOutsProp ? 50 + (8.5 - opponentWalkRate) * 4 : 50 + (opponentWalkRate - 8.5) * 4;
    factors.push({
      name: "vs_opp_team_walk_rate",
      label: lineupWalkRate !== null ? "Confirmed Lineup Walk Rate" : "Opponent Walk Rate",
      score: directionalMlbScore(overScore, direction),
      weight: weights.vs_opp_team_walk_rate,
      detail: `${opponentWalkRate.toFixed(1)}%`,
    });
  } else if (weights.vs_opp_team_walk_rate > 0) missing.push("OPPONENT_WALK_RATE_MISSING");

  if (weights.lineup_handedness > 0 && lineup?.confirmed) {
    const lineupMetric = isStrikeoutProp
      ? lineupK
      : isWalkProp ? lineupWalkRate : lineupOps;
    const splitMetric = isStrikeoutProp
      ? splitK
      : isWalkProp ? splitWalkRate : splitOps;
    if (lineupMetric !== null && splitMetric !== null) {
    const rawDifferenceScore = 50 + (lineupMetric - splitMetric) * (isStrikeoutProp || isWalkProp ? 3 : 150);
    const overScore = isOutsProp ? 100 - rawDifferenceScore : rawDifferenceScore;
    const hand = profile?.hand || "unknown";
    factors.push({
      name: "lineup_handedness",
      label: "Confirmed Lineup / Handedness",
      score: directionalMlbScore(overScore, direction),
      weight: weights.lineup_handedness,
      detail: `${lineup.handedness.left}L/${lineup.handedness.right}R/${lineup.handedness.switch}S vs ${hand}HP; lineup metric ${lineupMetric.toFixed(3)} vs hand split ${splitMetric.toFixed(3)}`,
    });
    } else missing.push("CONFIRMED_LINEUP_HANDEDNESS_MISSING");
  } else if (weights.lineup_handedness > 0) missing.push("CONFIRMED_LINEUP_HANDEDNESS_MISSING");

  const pitchType = intelligence?.pitchTypeMatchup;
  if (pitchType && weights.pitch_type_matchup > 0) {
    const overScore = isRunPreventionProp ? 100 - pitchType.score : pitchType.score;
    factors.push({
      name: "pitch_type_matchup",
      label: "Pitch-Type Matchup",
      score: directionalMlbScore(overScore, direction),
      weight: weights.pitch_type_matchup,
      detail: `${pitchType.opponentWhiffRateOnMix.toFixed(1)}% whiff on mix vs ${pitchType.opponentOverallWhiffRate.toFixed(1)}% overall (${pitchType.pitcherPitches} pitcher pitches, ${pitchType.opponentSwings} opponent swings)`,
    });
  } else if (weights.pitch_type_matchup > 0) missing.push("PITCH_TYPE_MATCHUP_INSUFFICIENT");

  if (profile && profile.workload.avgPitchesLast3 !== null && profile.workload.avgOutsLast3 !== null) {
    const rest = profile.workload.daysRest;
    const pitchScore = profile.workload.avgPitchesLast3 >= 90 ? 60 : profile.workload.avgPitchesLast3 >= 75 ? 50 : 35;
    const outsScore = profile.workload.avgOutsLast3 >= 18 ? 60 : profile.workload.avgOutsLast3 >= 15 ? 50 : 35;
    const restScore = rest === null ? 50 : rest < 4 ? 30 : rest <= 6 ? 58 : 52;
    const overScore = (pitchScore + outsScore + restScore) / 3;
    factors.push({
      name: "pitcher_workload",
      label: "Pitcher Workload / Leash",
      score: directionalMlbScore(overScore, direction),
      weight: weights.pitcher_workload,
      detail: `L3 ${profile.workload.avgPitchesLast3} pitches, ${profile.workload.avgOutsLast3} outs; ${rest ?? "unknown"} full rest day(s)`,
    });
  } else missing.push("PITCHER_WORKLOAD_MISSING");

  if (ctx.ownBullpen?.freshnessScore !== null && ctx.ownBullpen?.freshnessScore !== undefined) {
    const overScore = 100 - ctx.ownBullpen.freshnessScore;
    factors.push({
      name: "bullpen_availability",
      label: "Bullpen Availability",
      score: directionalMlbScore(overScore, direction),
      weight: weights.bullpen_availability,
      detail: `${ctx.ownBullpen.taxedRelievers.length} taxed reliever(s); ${ctx.ownBullpen.pitchesYesterday} bullpen pitches yesterday`,
    });
  }

  const park = intelligence?.parkFactor;
  if (park && weights.park_factor > 0) {
    const runEnvironmentScore = 50 + (park.runFactor - 1) * 100;
    const overScore = isOutsProp ? 100 - runEnvironmentScore : runEnvironmentScore;
    factors.push({ name: "park_factor", label: "Current Park Run Factor", score: directionalMlbScore(overScore, direction), weight: weights.park_factor, detail: `${park.runFactor.toFixed(3)} (${park.homeGames} home / ${park.roadGames} road games, as of ${park.asOf})` });
  } else if (weights.park_factor > 0) missing.push("CURRENT_PARK_FACTOR_MISSING");

  const weather = intelligence?.weather;
  const roofClosed = String(weather?.roofType || "").toLowerCase().includes("closed");
  if (weights.weather_temp > 0 && weather?.temperatureF !== null && weather?.temperatureF !== undefined && !roofClosed) {
    const runEnvironmentScore = weather.temperatureF >= 85 ? 60 : weather.temperatureF <= 55 ? 42 : 50;
    const overScore = isOutsProp ? 100 - runEnvironmentScore : runEnvironmentScore;
    factors.push({ name: "weather_temp", label: "Verified Game Weather", score: directionalMlbScore(overScore, direction), weight: weights.weather_temp, detail: `${weather.temperatureF}F, ${weather.windMph ?? "?"} mph ${weather.windDirection || "direction unknown"}` });
  } else if (weights.weather_temp > 0 && !roofClosed) missing.push("WEATHER_MISSING");

  let weightedSum = 0;
  let totalWeight = 0;
  for (const factor of factors) {
    if (!Number.isFinite(factor.score) || !Number.isFinite(factor.weight) || factor.weight <= 0) continue;
    weightedSum += factor.score * factor.weight;
    totalWeight += factor.weight;
  }
  if (totalWeight < 0.45 || !profileMatches || !profile) {
    return {
      confidence: 0,
      reasoning: ["Verified pitching context is incomplete; no pitcher score was issued.", ...missing.map((flag) => `Missing: ${flag}`)],
      factors,
      prevSeasonUsed: previousValues.length > 0,
      consensusFloorApplied: false,
      dataQuality: { missing: [...new Set(missing)], shrinkFactor: 0 },
    };
  }

  let score = weightedSum / totalWeight;
  let shrinkFactor = 1;
  if (currentValues.length < 5) shrinkFactor *= 0.80;
  if (!lineup?.confirmed) shrinkFactor *= 0.85;
  if (weights.pitch_type_matchup > 0 && !pitchType) shrinkFactor *= 0.95;
  if (!profile.recent || profile.recent.starts < 3) shrinkFactor *= 0.80;
  score = 50 + (score - 50) * shrinkFactor;
  const confidence = Math.max(0, Math.min(100, Math.round(score)));
  reasoning.push(`MLB heuristic score: ${confidence}/100 from ${factors.filter((factor) => factor.weight > 0).length} verified factors.`);
  if (missing.length) reasoning.push(`Data-quality shrink ${shrinkFactor.toFixed(2)}; unavailable inputs: ${[...new Set(missing)].join(", ")}.`);
  return {
    confidence,
    reasoning,
    factors,
    prevSeasonUsed: previousValues.length > 0,
    consensusFloorApplied: false,
    dataQuality: { missing: [...new Set(missing)], shrinkFactor },
  };
}

export async function calculateMlbPropConfidence(data: any): Promise<{
  confidence: number;
  reasoning: string[];
  factors: MlbFactorResult[];
  prevSeasonUsed: boolean;
  consensusFloorApplied: boolean;
  playerIsOut?: boolean;
  dataQuality?: { missing: string[]; shrinkFactor: number };
}> {
  const reasoning: string[] = [];
  const factors: MlbFactorResult[] = [];
  const { over_under: ou, line, prop_type: propType } = data;
  
  // Detect pitcher vs batter
  const position = (data.player?.position || "").toUpperCase();
  const isPitcher = isMlbPitcherPosition(position);
  if (isPitcher) {
    const pitcherWeights = MLB_PITCHER_PROP_WEIGHTS[propType] || MLB_PITCHER_PROP_WEIGHTS.pitcher_strikeouts;
    return calculateVerifiedMlbPitcherScore(data, pitcherWeights);
  }
  const baseWeights = MLB_BATTER_WEIGHTS;
  // Apply prop-category specific weight overrides on top of base weights
  const propCategory = detectMlbPropCategory(propType, isPitcher);
  const categoryOverrides = MLB_PROP_WEIGHTS[propCategory] || {};
  const weights: Record<string, number> = { ...baseWeights, ...categoryOverrides };
  const roleLabel = "Batter";
  reasoning.push(`⚾ MLB verified-factor ${roleLabel} model [${propCategory}] — ${data.player?.full_name || "Unknown"}`);
  
  // Previous season blending
  const currentGames = data.current_season_games || [];
  const prevGames = data.prev_season_games || [];
  const currentCount = currentGames.length;
  const prevCount = prevGames.length;
  const currentSeasonLabel = new Date().getFullYear();
  const previousSeasonLabel = currentSeasonLabel - 1;
  let prevSeasonUsed = false;
  
  // Graduated season blending — smooth curve from 30% to 95% based on games played
  let weightCurrent = Math.min(0.95, 0.30 + (currentCount / 120));
  let weightPrev = 1 - weightCurrent;
  
  // Player Context Risk detection
  let contextRiskScore = 50;
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
        contextRiskDetail = `Player changed teams — ${previousSeasonLabel} data less relevant`;
        contextRiskFlag = "team_change";
      }
    }
    
    // Detect extended absence (30+ day gap beyond normal offseason)
    if (!contextRiskFlag && currentCount > 0) {
      const currentDates = currentGames.map((g: GameRow) => new Date(g.date || "").getTime()).filter((d: number) => !isNaN(d)).sort((a: number, b: number) => a - b);
      const prevDates = prevGames.map((g: GameRow) => new Date(g.date || "").getTime()).filter((d: number) => !isNaN(d)).sort((a: number, b: number) => a - b);
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
        contextRiskDetail = `Sample size collapse — ${prevCount} games in ${previousSeasonLabel} but only ${currentCount} in ${currentSeasonLabel}`;
        contextRiskFlag = "sample_collapse";
      }
    }
    
    // If risk flag detected, reduce previous season weight by 50%
    if (contextRiskFlag) {
      const originalPrev = weightPrev;
      weightPrev = weightPrev * 0.5;
      weightCurrent = 1 - weightPrev;
      reasoning.push(`📊 Season blend: ${Math.round(weightCurrent * 100)}% ${currentSeasonLabel} (${currentCount}G) / ${Math.round(weightPrev * 100)}% ${previousSeasonLabel} (${prevCount}G)`);
      reasoning.push(`⚠️ Context risk: ${contextRiskDetail} — reducing ${previousSeasonLabel} weight (${Math.round(originalPrev * 100)}% → ${Math.round(weightPrev * 100)}%)`);
    } else {
      reasoning.push(`📊 Season blend: ${Math.round(weightCurrent * 100)}% ${currentSeasonLabel} (${currentCount}G) / ${Math.round(weightPrev * 100)}% ${previousSeasonLabel} (${prevCount}G)`);
    }
  }
  
  // Helper to compute blended values
  const allGames = data.all_games || currentGames;
  const statValues = allGames.map((g: GameRow) => getStatValue(g, propType)).filter(Number.isFinite);
  const prevStatValues = prevGames.map((g: GameRow) => getStatValue(g, propType)).filter(Number.isFinite);
  
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
    factors.push({ name: wName, label: `${previousSeasonLabel} Season Hit Rate`, score, weight: weights.prev_season_hit_rate, detail: `${prevHR.rate}% (${prevHR.hits}/${prevHR.total}, avg ${prevAvg})` });
    reasoning.push(`${previousSeasonLabel} season: ${prevHR.rate}% hit rate (avg ${prevAvg} in ${prevStatValues.length} games)`);
  }
  
  // ── FACTOR 2b: Player Context Risk ──
  if (contextRiskFlag && weights.player_context_risk > 0) {
    factors.push({ name: "player_context_risk", label: "Player Context Risk", score: contextRiskScore, weight: weights.player_context_risk, detail: contextRiskDetail });
  }
  

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
      detail += ` | ${previousSeasonLabel}: ${prevH2H.rate}% (${prevH2H.total}G) → blended ${blended}%`;
    }
    factors.push({ name: "h2h_vs_opponent", label: `vs ${h2h.opponent || "Opponent"}`, score: h2hScore, weight: weights.h2h_vs_opponent, detail });
    if (h2h.rate >= 70) reasoning.push(`Dominates vs ${h2h.opponent}: ${h2h.rate}%`);
    else if (h2h.rate < 35) reasoning.push(`⚠️ Struggles vs ${h2h.opponent}: ${h2h.rate}%`);
  }
  
  // ── FACTOR 6: Home/Away Split ──
  const ha = data.home_away;
  if (ha?.total > 0) {
    const score = scoreMlbHitRate(ha.rate);
    factors.push({ name: "home_away_split", label: `${(ha.location || "").toUpperCase()} Split`, score, weight: weights.home_away_split, detail: `${ha.rate}% (${ha.hits}/${ha.total})` });
    if (ha.rate >= 65) reasoning.push(`${(ha.location || "").toUpperCase()} split favorable: ${ha.rate}%`);
  }
  
  // ── MLB CONTEXT FACTORS (7-20) ──
  const ctx: MlbContextData = data.mlb_context || {};
  
  // Factor 7: verified opposing starter ERA
  const spEra = ctx.opposingSP?.era;
  if (spEra !== undefined) {
    const score = Math.max(0, Math.min(100, 50 + (spEra - 4.20) * 15));
    const spName = ctx.opposingSP?.name || "Verified starter";
    factors.push({ name: "vs_opposing_sp_era", label: `vs ${spName} ERA`, score, weight: weights.vs_opposing_sp_era, detail: `ERA: ${spEra.toFixed(2)}` });
    reasoning.push(`Opposing starter ${spName}: ${spEra.toFixed(2)} ERA.`);
  }
  
  // Factor 8: verified opposing starter K/9
  const spK9 = ctx.opposingSP?.k9;
  if (spK9 !== undefined) {
    const score = Math.max(0, Math.min(100, 50 + (8.5 - spK9) * 8));
    factors.push({ name: "vs_opposing_sp_k9", label: "vs SP K/9", score, weight: weights.vs_opposing_sp_k9, detail: `K/9: ${spK9.toFixed(1)}` });
  }
  
  // Factor 9: Platoon Advantage (L/R)
  const playerHand = ctx.playerHand;
  const spHand = ctx.opposingSP?.hand;
  if (playerHand && spHand) {
    const hasPlatoon = playerHand === "S" || playerHand !== spHand;
    const score = hasPlatoon ? 62 : 42;
    factors.push({ name: "platoon_advantage", label: "Verified L/R Platoon", score, weight: weights.platoon_advantage, detail: `${playerHand} batter vs ${spHand} pitcher` });
  }
  
  // Factor 10: Park Factor
  const parkRecord = ctx.intelligence?.parkFactor;
  if (parkRecord && weights.park_factor > 0) {
    const pf = parkRecord.runFactor;
    let score = 50;
    if (ou === "over") score = Math.max(0, Math.min(100, pf * 50));
    else score = Math.max(0, Math.min(100, (2 - pf) * 50));
    factors.push({ name: "park_factor", label: "Current Park Run Factor", score, weight: weights.park_factor, detail: `${ctx.intelligence?.venue.name || "Venue"}: ${pf.toFixed(3)} (${parkRecord.homeGames}/${parkRecord.roadGames} game samples)` });
  }
  
  // Factor 11: Lineup Protection (Teammate Injuries)
  const sigInj = (data.teammate_injuries || []).filter((i: any) => ["out", "doubtful"].includes(i.status?.toLowerCase()));
  if (weights.lineup_protection > 0) {
    const score = sigInj.length === 0 ? 50 : sigInj.length <= 2 ? 45 : 35;
    factors.push({ name: "lineup_protection", label: "Lineup Protection", score, weight: weights.lineup_protection, detail: `${sigInj.length} key teammates out` });
  }
  
  // Factor 12: Player Injury Status
  const pInj = data.player_injuries || [];
  if (weights.player_injury_status > 0) {
    let score = 50;
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
    factors.push({ name: "player_injury_status", label: "Health Status", score, weight: weights.player_injury_status, detail: pInj.length > 0 ? pInj[0].status : "No active injury listing" });
  }
  
  // Factor 13: Opponent Bullpen ERA
  const bpEra = ctx.oppBullpenERA;
  if (bpEra !== undefined && weights.opp_bullpen_era > 0) {
    const score = Math.max(0, Math.min(100, 50 + (bpEra - 4.00) * 12));
    factors.push({ name: "opp_bullpen_era", label: "Verified Opp Bullpen ERA", score, weight: weights.opp_bullpen_era, detail: `${bpEra.toFixed(2)}` });
  }
  
  // Factor 14: Season Average vs Line Distance
  const seasonAvg = Number(data.season_hit_rate?.avg);
  if (weights.season_avg_vs_line > 0 && Number.isFinite(seasonAvg)) {
    const score = scoreMlbFactor(seasonAvg, line, ou);
    factors.push({ name: "season_avg_vs_line", label: "Avg vs Line", score, weight: weights.season_avg_vs_line, detail: `Avg ${seasonAvg} vs ${line} line (${ou})` });
    if (ou === "over" && seasonAvg > line * 1.3) reasoning.push(`📊 Season avg (${seasonAvg}) well above ${line} line`);
    else if (ou === "over" && seasonAvg < line * 0.85) reasoning.push(`⚠️ Season avg (${seasonAvg}) below ${line} line`);
  }
  
  // Factor 17: Weather (Temperature)
  if (weights.weather_temp > 0) {
    const temp = ctx.weather?.temperature;
    const roofClosed = String(ctx.intelligence?.weather?.roofType || "").toLowerCase().includes("closed");
    if (temp !== undefined && !roofClosed) {
    let score = 50;
    if (ou === "over") {
      score = temp >= 85 ? 70 : temp >= 75 ? 60 : temp >= 65 ? 50 : temp >= 55 ? 40 : 30;
    } else {
      score = temp >= 85 ? 30 : temp >= 75 ? 40 : temp >= 65 ? 50 : temp >= 55 ? 60 : 70;
    }
    factors.push({ name: "weather_temp", label: "Temperature", score, weight: weights.weather_temp, detail: `${temp}°F` });
    }
  }

  const missing = [...(ctx.intelligence?.missing || [])];
  if (ctx.ownLineup?.confirmed) {
    if (!ctx.listedBatter) {
      missing.push("PLAYER_NOT_IN_CONFIRMED_LINEUP");
      return {
        confidence: 0,
        reasoning: ["Player is not in the confirmed starting lineup; no batter score was issued."],
        factors,
        prevSeasonUsed,
        consensusFloorApplied: false,
        dataQuality: { missing: [...new Set(missing)], shrinkFactor: 0 },
      };
    }
    reasoning.push(`Confirmed batting order: ${ctx.listedBatter.order}.`);
  } else {
    missing.push("LINEUP_UNCONFIRMED");
  }
  if (!ctx.opposingSP) missing.push("OPPOSING_STARTER_PROFILE_MISSING");
  
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

  let dataQualityShrink = 1;
  if (statValues.length < 5) dataQualityShrink *= 0.85;
  if (!ctx.ownLineup?.confirmed) dataQualityShrink *= 0.90;
  if (!ctx.opposingSP) dataQualityShrink *= 0.85;
  if (weights.park_factor > 0 && !ctx.intelligence?.parkFactor) dataQualityShrink *= 0.95;
  confidence = Math.round(50 + (confidence - 50) * dataQualityShrink);
  if (missing.length) {
    reasoning.push(`Data-quality shrink ${dataQualityShrink.toFixed(2)}; unavailable inputs: ${[...new Set(missing)].join(", ")}.`);
  }
  
  // ── HIT RATE CONSENSUS FLOOR REMOVED ──
  // Raw model output now stands. Display caps applied at decision layer only.
  let consensusFloorApplied = false;
  const seasonAvgVal = data.season_hit_rate?.avg ?? null;

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
  if (confidence >= 72) reasoning.push(`✅ STRONG heuristic score: ${confidence}/100`);
  else if (confidence >= 58) reasoning.push(`📊 LEAN heuristic score: ${confidence}/100`);
  else if (confidence >= 42) reasoning.push(`⚠️ RISKY heuristic score: ${confidence}/100`);
  else reasoning.push(`🚫 PASS — heuristic score: ${confidence}/100`);
  
  return {
    confidence,
    reasoning,
    factors,
    prevSeasonUsed,
    consensusFloorApplied,
    dataQuality: { missing: [...new Set(missing)], shrinkFactor: dataQualityShrink },
  };
}

// ── MLB AI Writeup for Player Props ─────────────────────────
export async function generateMlbPropWriteup(
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
    const topFactors = factors
      .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
      .slice(0, 6)
      .map(f => `${f.label}: ${f.score}/100 (${f.detail})`)
      .join("; ");

    const spInfo = ctx.opposingSP ? `vs ${ctx.opposingSP.name} (${ctx.opposingSP.era} ERA, ${ctx.opposingSP.k9} K/9)` : "";
    const parkInfo = ctx.intelligence?.parkFactor
      ? `at ${ctx.venue || "the listed venue"} (current-season run factor ${ctx.intelligence.parkFactor.runFactor.toFixed(3)})`
      : ctx.venue ? `at ${ctx.venue} (current park factor unavailable)` : "";

    const prompt = `You are a sharp MLB betting analyst. ${player} ${isPitcher ? "is pitching" : "is batting"} — prop: ${ou.toUpperCase()} ${line} ${propType}. ${spInfo}. ${parkInfo}. Key factors: ${topFactors}. Non-probabilistic heuristic score: ${confidence}/100. Write EXACTLY 2-3 sentences of direct, data-driven analysis. Do not call the score a probability, win chance, or calibrated confidence. Reference only the supplied matchup facts.`;

    const result = await callAI({
      fnName: "nba-api",
      messages: [
        { role: "system", content: `You are an expert MLB prop analyst. Be concise, sharp, and data-specific. Never say 'I think' or hedge. State facts. ${ANTI_GENERIC_INSTRUCTION}` },
        { role: "user", content: prompt },
      ],
      maxTokens: 200,
    });

    return result.output as string;
  } catch (e) {
    if (!(e instanceof AIProviderError)) console.error("nba-api MLB writeup error:", e);
    return "Analysis currently unavailable";
  }
}
