/**
 * NFL GAME EDGE ENGINE — feature pipeline (25 team/game factors).
 *
 * Produces two feature sets from the same point-in-time inputs:
 *   - `side`  : home-minus-away differentials (moneyline + spread models)
 *   - `total` : combined/environment features (game-total model)
 *
 * LEAKAGE GUARD: every team-week / player-week row at or after the target
 * (season, week) is discarded here and counted in `diagnostics`. Backtests and
 * live predictions run through this exact function.
 *
 * This module belongs to the game engine. It must never import from `../prop/`.
 */

import type { NflGameRow, NflInjuryRow, NflPlayerWeekRow, NflTeamWeekRow } from "../data/types.ts";
import { NFL_TEAMS, milesBetween } from "../data/teams.ts";
import { buildTeamProfiles, isBefore, type LeagueBaseline, type TeamProfile } from "./ratings.ts";

export const SIDE_FEATURES = [
  "off_epa", "def_epa", "off_sr", "def_sr", "pass_eff", "qb_eff", "qb_pressure", "pass_rush",
  "coverage", "run_off", "run_def", "explosive", "ppd", "red_zone", "strength", "recent_form",
  "turnover_regression", "ol_quality", "injuries", "home_field", "rest", "travel", "weather",
  "coaching",
] as const;
export type SideFeature = typeof SIDE_FEATURES[number];

export const TOTAL_FEATURES = [
  "off_epa", "def_epa", "off_sr", "def_sr", "pass_eff", "qb_eff", "qb_pressure", "pass_rush",
  "coverage", "run_off", "run_def", "explosive", "ppd", "red_zone", "scoring_env", "recent_form",
  "turnover_regression", "ol_quality", "injuries", "home_field", "short_week", "travel",
  "wind", "cold", "dome", "pace", "proe",
] as const;
export type TotalFeature = typeof TOTAL_FEATURES[number];

/** The 25 user-facing factors, each mapped to the model features that carry it. */
export const GAME_FACTORS: ReadonlyArray<{ id: number; name: string; side: SideFeature[]; total: TotalFeature[] }> = [
  { id: 1, name: "Offensive EPA/play", side: ["off_epa"], total: ["off_epa"] },
  { id: 2, name: "Defensive EPA/play", side: ["def_epa"], total: ["def_epa"] },
  { id: 3, name: "Offensive success rate", side: ["off_sr"], total: ["off_sr"] },
  { id: 4, name: "Defensive success rate", side: ["def_sr"], total: ["def_sr"] },
  { id: 5, name: "Passing efficiency", side: ["pass_eff"], total: ["pass_eff"] },
  { id: 6, name: "QB efficiency", side: ["qb_eff"], total: ["qb_eff"] },
  { id: 7, name: "QB pressure performance", side: ["qb_pressure"], total: ["qb_pressure"] },
  { id: 8, name: "Pass rush", side: ["pass_rush"], total: ["pass_rush"] },
  { id: 9, name: "Pass coverage", side: ["coverage"], total: ["coverage"] },
  { id: 10, name: "Run offense", side: ["run_off"], total: ["run_off"] },
  { id: 11, name: "Run defense", side: ["run_def"], total: ["run_def"] },
  { id: 12, name: "Explosive play rate", side: ["explosive"], total: ["explosive"] },
  { id: 13, name: "Points per drive", side: ["ppd"], total: ["ppd"] },
  { id: 14, name: "Red-zone efficiency", side: ["red_zone"], total: ["red_zone"] },
  { id: 15, name: "Opponent-adjusted team strength", side: ["strength"], total: ["scoring_env"] },
  { id: 16, name: "Recent form", side: ["recent_form"], total: ["recent_form"] },
  { id: 17, name: "Turnover regression", side: ["turnover_regression"], total: ["turnover_regression"] },
  { id: 18, name: "Offensive line quality", side: ["ol_quality"], total: ["ol_quality"] },
  { id: 19, name: "Injuries", side: ["injuries"], total: ["injuries"] },
  { id: 20, name: "Home-field advantage", side: ["home_field"], total: ["home_field"] },
  { id: 21, name: "Rest / bye / short week", side: ["rest"], total: ["short_week"] },
  { id: 22, name: "Travel", side: ["travel"], total: ["travel"] },
  { id: 23, name: "Weather", side: ["weather"], total: ["wind", "cold", "dome"] },
  { id: 24, name: "Coaching / game-plan tendencies", side: ["coaching"], total: ["pace", "proe"] },
  { id: 25, name: "Market movement", side: [], total: [] }, // fixed, capped prior — see weights.ts
];

export interface GameWeatherInput {
  temp: number | null; // °F
  wind: number | null; // mph
  precip_prob: number | null; // 0..1, forecasts only
  roof: string | null; // dome | closed | open | outdoors
  source: "schedule" | "forecast" | "none";
}

export interface MarketMovementInput {
  /** Current home spread minus opening home spread (negative = moved toward home). */
  spread_move_home: number | null;
  /** Current total minus opening total. */
  total_move: number | null;
  /** Current no-vig home ML prob minus opening no-vig home ML prob. */
  ml_move_home: number | null;
}

export interface GameFeatureInput {
  game: NflGameRow;
  teamWeeks: NflTeamWeekRow[];
  playerWeeks: NflPlayerWeekRow[];
  injuries: NflInjuryRow[];
  weather: GameWeatherInput;
  movement: MarketMovementInput | null;
  /**
   * Optional precomputed league profiles for this (season, week). Backtests
   * pass one shared build per week; it must have been built from rows before
   * (season, week) — `buildTeamProfiles` enforces that itself.
   */
  profiles?: ReturnType<typeof buildTeamProfiles>;
}

export interface QbContext {
  team: string;
  starter_id: string | null;
  starter_name: string | null;
  starter_status: string | null; // injury report status
  starter_value: number; // shrunk EPA/dropback, league-relative
  team_baseline_value: number; // dropback-weighted value of QBs in the rating window
  starter_dropbacks: number;
  source: "player_data" | "team_proxy";
}

export interface InjuryContext {
  team: string;
  points_lost: number; // rule-based estimate, non-QB
  out_players: string[];
  questionable_starters: string[];
  qb_questionable: boolean;
  report_found: boolean;
}

export interface FactorDetail {
  id: number;
  name: string;
  home: number | null;
  away: number | null;
  side_value: number | null;
  total_value: number | null;
  source: string;
  proxy: boolean;
  missing: boolean;
}

export interface GameFeatureVector {
  game_id: string;
  season: number;
  week: number;
  home: string;
  away: string;
  side: Record<SideFeature, number>;
  total: Record<TotalFeature, number>;
  factors: FactorDetail[];
  league: LeagueBaseline;
  home_profile: TeamProfile;
  away_profile: TeamProfile;
  qb: { home: QbContext; away: QbContext };
  injuries: { home: InjuryContext; away: InjuryContext };
  movement: MarketMovementInput | null;
  data_quality: number; // 0..1
  diagnostics: {
    leakage_rows_dropped: number;
    home_games_current: number;
    away_games_current: number;
    weather_source: string;
    neutral_site: boolean;
  };
}

const REPLACEMENT_QB_EPA = -0.12; // EPA/db of a replacement-level QB, relative to league
const QB_SHRINK_DROPBACKS = 150;

// ─── QB context (game-engine owned) ──────────────────────────────────────

function qbValue(rows: NflPlayerWeekRow[], leagueDbEpa: number): { value: number; dropbacks: number } {
  let epa = 0, db = 0;
  for (const r of rows) {
    const d = r.pass_attempts + r.sacks_taken;
    if (d <= 0 || r.passing_epa === null) continue;
    epa += r.passing_epa;
    db += d;
  }
  // Shrink toward replacement level: unknown/backup QBs are below average.
  const raw = db > 0 ? epa / db - leagueDbEpa : REPLACEMENT_QB_EPA;
  const value = (raw * db + REPLACEMENT_QB_EPA * QB_SHRINK_DROPBACKS) / (db + QB_SHRINK_DROPBACKS);
  return { value, dropbacks: db };
}

export function buildQbContext(
  team: string,
  season: number,
  week: number,
  playerWeeks: NflPlayerWeekRow[],
  injuries: NflInjuryRow[],
  league: LeagueBaseline,
  profile: TeamProfile | undefined,
): QbContext {
  const qbRows = playerWeeks.filter((p) =>
    p.position === "QB" && isBefore(p, season, week) && p.season >= season - 1);
  const teamQbRows = qbRows.filter((p) => p.team === team);
  if (teamQbRows.length === 0) {
    return {
      team, starter_id: null, starter_name: null, starter_status: null,
      starter_value: profile?.qb_epa_per_db ?? 0, team_baseline_value: profile?.qb_epa_per_db ?? 0,
      starter_dropbacks: 0, source: "team_proxy",
    };
  }
  const report = injuries.filter((i) => i.team === team && i.season === season && i.week === week);
  const statusOf = (id: string) => report.find((i) => i.player_id === id)?.report_status ?? null;
  const unavailable = (s: string | null) => s === "Out" || s === "Doubtful";

  // Candidates ordered by recency, then attempts in the team's latest game.
  const latest = teamQbRows.reduce((a, b) => (b.season > a.season || (b.season === a.season && b.week > a.week) ? b : a));
  const latestGame = teamQbRows.filter((r) => r.game_id === latest.game_id).sort((a, b) => b.pass_attempts - a.pass_attempts);
  const byAttempts = new Map<string, number>();
  for (const r of teamQbRows.filter((r) => r.season === season || r.season === latest.season)) {
    byAttempts.set(r.player_id, (byAttempts.get(r.player_id) ?? 0) + r.pass_attempts);
  }
  const ordered = [
    ...latestGame.map((r) => r.player_id),
    ...[...byAttempts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
  ].filter((id, i, arr) => arr.indexOf(id) === i);
  const starterId = ordered.find((id) => !unavailable(statusOf(id))) ?? ordered[0];

  // Starter value uses the QB's own history on ANY team (trades/signings).
  const starterRows = qbRows.filter((r) => r.player_id === starterId);
  const starter = qbValue(starterRows, league.db_epa);

  // Team baseline: what the team profile already "knows" about its QB play.
  let baseN = 0, baseW = 0;
  for (const id of new Set(teamQbRows.map((r) => r.player_id))) {
    const rows = teamQbRows.filter((r) => r.player_id === id);
    const v = qbValue(qbRows.filter((r) => r.player_id === id), league.db_epa);
    const teamDb = rows.reduce((a, r) => a + r.pass_attempts + r.sacks_taken, 0);
    baseN += v.value * teamDb;
    baseW += teamDb;
  }
  return {
    team,
    starter_id: starterId,
    starter_name: starterRows[0]?.player_name ?? null,
    starter_status: statusOf(starterId),
    starter_value: starter.value,
    team_baseline_value: baseW > 0 ? baseN / baseW : starter.value,
    starter_dropbacks: starter.dropbacks,
    source: "player_data",
  };
}

// ─── Injuries (rule-based, non-QB) ───────────────────────────────────────

const SKILL_WEIGHT: Record<string, number> = { WR: 0.55, TE: 0.4, RB: 0.3, FB: 0.05 };
const OL_POSITIONS = new Set(["T", "G", "C", "OT", "OG", "OL"]);
const DEF_POSITIONS = new Set(["DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "CB", "S", "FS", "SS", "DB", "DL", "EDGE"]);
const INJURY_POINTS_CAP = 3.5;

export function buildInjuryContext(
  team: string,
  season: number,
  week: number,
  playerWeeks: NflPlayerWeekRow[],
  injuries: NflInjuryRow[],
): InjuryContext {
  const report = injuries.filter((i) => i.team === team && i.season === season && i.week === week);
  const reported = new Set(report.map((i) => i.player_id));
  const rowsById = new Map<string, NflPlayerWeekRow[]>();
  for (const p of playerWeeks) {
    if (!reported.has(p.player_id) || !isBefore(p, season, week) || p.season < season - 1) continue;
    const list = rowsById.get(p.player_id) ?? [];
    list.push(p);
    rowsById.set(p.player_id, list);
  }
  const recentSnapPct = (id: string): number => {
    const rows = (rowsById.get(id) ?? [])
      .sort((a, b) => (b.season - a.season) || (b.week - a.week))
      .slice(0, 4);
    const vals = rows.map((r) => r.offense_pct).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  let points = 0;
  const out: string[] = [];
  const questionable: string[] = [];
  let qbQuestionable = false;
  for (const inj of report) {
    const status = inj.report_status;
    if (!status) continue;
    const pos = inj.position.toUpperCase();
    if (pos === "QB") {
      if (status === "Questionable") qbQuestionable = true;
      continue; // QB handled by QbContext
    }
    let value = 0;
    let starter = false;
    if (SKILL_WEIGHT[pos] !== undefined) {
      const snap = recentSnapPct(inj.player_id);
      starter = snap >= 0.55;
      value = SKILL_WEIGHT[pos] * snap * 1.6;
    } else if (OL_POSITIONS.has(pos)) {
      value = 0.3;
      starter = true; // no OL snap data; treated as a starter-level concern
    } else if (DEF_POSITIONS.has(pos)) {
      value = 0.2;
    }
    const factor = status === "Out" ? 1 : status === "Doubtful" ? 0.85 : status === "Questionable" ? 0.25 : 0;
    points += value * factor;
    if (status === "Out" || status === "Doubtful") out.push(inj.player_name);
    if (status === "Questionable" && starter) questionable.push(inj.player_name);
  }
  return {
    team,
    points_lost: Math.min(points, INJURY_POINTS_CAP),
    out_players: out,
    questionable_starters: questionable,
    qb_questionable: qbQuestionable,
    report_found: report.length > 0,
  };
}

// ─── Weather / travel / rest ─────────────────────────────────────────────

function isIndoor(roof: string | null): boolean {
  return roof === "dome" || roof === "closed";
}

export function weatherSeverity(w: GameWeatherInput): number {
  if (isIndoor(w.roof)) return 0;
  const wind = Math.max(0, (w.wind ?? 0) - 10) / 10;
  const cold = Math.max(0, 35 - (w.temp ?? 60)) / 25;
  const wet = (w.precip_prob ?? 0) * 0.5;
  return wind + cold + wet;
}

function travelBurden(visitor: string, host: string, neutral: boolean): { miles: number; tz: number } {
  if (neutral) return { miles: 0, tz: 0 };
  const a = NFL_TEAMS[visitor];
  const b = NFL_TEAMS[host];
  if (!a || !b) return { miles: 0, tz: 0 };
  return { miles: milesBetween(a, b), tz: Math.abs(a.utcOffset - b.utcOffset) };
}

// ─── Assembly ─────────────────────────────────────────────────────────────

export function buildGameFeatures(input: GameFeatureInput): GameFeatureVector {
  const { game } = input;
  const season = game.season;
  const week = game.week;

  const allowedTeam = input.teamWeeks.filter((r) => isBefore(r, season, week));
  const allowedPlayers = input.playerWeeks.filter((r) => isBefore(r, season, week));
  const leakageDropped = (input.teamWeeks.length - allowedTeam.length) + (input.playerWeeks.length - allowedPlayers.length);

  const { profiles, league } = input.profiles ?? buildTeamProfiles(allowedTeam, season, week);
  const blank = (team: string): TeamProfile => ({
    team, games_current: 0, games_prior: 0, weight_total: 0,
    off_epa: 0, def_epa: 0, off_sr: 0, def_sr: 0, off_db_epa: 0, def_db_epa: 0, off_rush_epa: 0, def_rush_epa: 0,
    off_explosive: 0, def_explosive: 0, off_ppd: 0, def_ppd: 0, off_rz_td: 0, def_rz_td: 0,
    off_pressure_allowed: 0, def_pressure: 0, off_sack_rate: 0, pressured_epa: 0,
    neutral_pass_rate: league.neutral_pass_rate, proe: 0, sec_per_play: league.sec_per_play,
    plays_per_game: league.plays_per_game, qb_epa_per_db: 0, cpoe: 0, fg_rate: league.fg_rate,
    points_for_pg: league.points_per_game, points_against_pg: league.points_per_game, srs: 0,
    turnover_luck: 0, recent_form: 0,
  });
  const H = profiles.get(game.home_team) ?? blank(game.home_team);
  const A = profiles.get(game.away_team) ?? blank(game.away_team);

  const qbH = buildQbContext(game.home_team, season, week, allowedPlayers, input.injuries, league, H);
  const qbA = buildQbContext(game.away_team, season, week, allowedPlayers, input.injuries, league, A);
  const injH = buildInjuryContext(game.home_team, season, week, allowedPlayers, input.injuries);
  const injA = buildInjuryContext(game.away_team, season, week, allowedPlayers, input.injuries);

  // A QB change shifts expected passing efficiency by the starter-vs-baseline gap.
  const qbShiftH = qbH.starter_value - qbH.team_baseline_value;
  const qbShiftA = qbA.starter_value - qbA.team_baseline_value;
  const passH = H.off_db_epa + qbShiftH;
  const passA = A.off_db_epa + qbShiftA;
  const neutral = game.location === "Neutral";
  const travel = travelBurden(game.away_team, game.home_team, neutral);
  const sev = weatherSeverity(input.weather);
  const restH = game.home_rest ?? 7;
  const restA = game.away_rest ?? 7;
  const indoor = isIndoor(input.weather.roof);

  const side: Record<SideFeature, number> = {
    off_epa: H.off_epa - A.off_epa,
    def_epa: A.def_epa - H.def_epa, // + = home defense better
    off_sr: H.off_sr - A.off_sr,
    def_sr: A.def_sr - H.def_sr,
    pass_eff: passH - passA,
    qb_eff: qbH.starter_value - qbA.starter_value,
    qb_pressure: H.pressured_epa - A.pressured_epa,
    pass_rush: H.def_pressure - A.def_pressure,
    coverage: A.def_db_epa - H.def_db_epa,
    run_off: H.off_rush_epa - A.off_rush_epa,
    run_def: A.def_rush_epa - H.def_rush_epa,
    explosive: (H.off_explosive - H.def_explosive) - (A.off_explosive - A.def_explosive),
    ppd: (H.off_ppd - H.def_ppd) - (A.off_ppd - A.def_ppd),
    red_zone: (H.off_rz_td - H.def_rz_td) - (A.off_rz_td - A.def_rz_td),
    strength: H.srs - A.srs,
    recent_form: H.recent_form - A.recent_form,
    turnover_regression: -(H.turnover_luck - A.turnover_luck),
    ol_quality: -(H.off_pressure_allowed - A.off_pressure_allowed),
    injuries: -(injH.points_lost - injA.points_lost),
    home_field: neutral ? 0 : 1,
    rest: Math.max(-7, Math.min(7, restH - restA)),
    travel: travel.miles / 1000 + 0.3 * travel.tz,
    weather: -sev * (H.neutral_pass_rate - A.neutral_pass_rate) * 10,
    coaching: (H.proe - A.proe) / 10,
  };

  const total: Record<TotalFeature, number> = {
    off_epa: H.off_epa + A.off_epa,
    def_epa: H.def_epa + A.def_epa, // + = worse defenses = more points
    off_sr: H.off_sr + A.off_sr,
    def_sr: H.def_sr + A.def_sr,
    pass_eff: passH + A.def_db_epa + passA + H.def_db_epa,
    qb_eff: qbH.starter_value + qbA.starter_value,
    qb_pressure: H.pressured_epa + A.pressured_epa,
    pass_rush: H.def_pressure + A.def_pressure,
    coverage: H.def_db_epa + A.def_db_epa,
    run_off: H.off_rush_epa + A.off_rush_epa,
    run_def: H.def_rush_epa + A.def_rush_epa,
    explosive: H.off_explosive + A.off_explosive + H.def_explosive + A.def_explosive,
    ppd: H.off_ppd + A.def_ppd + A.off_ppd + H.def_ppd,
    red_zone: H.off_rz_td + A.def_rz_td + A.off_rz_td + H.def_rz_td,
    scoring_env: (H.points_for_pg + H.points_against_pg + A.points_for_pg + A.points_against_pg) / 2 - 2 * league.points_per_game,
    recent_form: H.recent_form + A.recent_form,
    turnover_regression: -(H.turnover_luck + A.turnover_luck),
    ol_quality: -(H.off_pressure_allowed + A.off_pressure_allowed),
    injuries: -(injH.points_lost + injA.points_lost),
    home_field: neutral ? 0 : 1,
    short_week: Math.min(restH, restA) <= 5 ? 1 : 0,
    travel: travel.tz,
    wind: indoor ? 0 : Math.max(0, (input.weather.wind ?? 0) - 8),
    cold: indoor ? 0 : Math.max(0, 40 - (input.weather.temp ?? 60)),
    dome: indoor ? 1 : 0,
    pace: -((H.sec_per_play - league.sec_per_play) + (A.sec_per_play - league.sec_per_play)),
    proe: (H.proe + A.proe) / 10,
  };

  // Data quality: sample depth + coverage of player-level and context inputs.
  const depth = (p: TeamProfile) => Math.min(1, (p.games_current + 0.5 * Math.min(p.games_prior, 8)) / 8);
  const qbCoverage = (q: QbContext) => (q.source === "player_data" ? 1 : 0.4);
  const weatherKnown = indoor || input.weather.source !== "none" ? 1 : 0.6;
  const injuryKnown = (injH.report_found ? 0.5 : 0.3) + (injA.report_found ? 0.5 : 0.3);
  const dataQuality = Math.max(0, Math.min(1,
    0.45 * (depth(H) + depth(A)) / 2 +
    0.2 * (qbCoverage(qbH) + qbCoverage(qbA)) / 2 +
    0.15 * injuryKnown +
    0.1 * weatherKnown +
    0.1 * (input.movement ? 1 : 0.5),
  ));

  const factors: FactorDetail[] = GAME_FACTORS.map((f) => {
    const sideVal = f.side.length ? f.side.reduce((a, k) => a + side[k], 0) : null;
    const totalVal = f.total.length ? f.total.reduce((a, k) => a + total[k], 0) : null;
    const [home, away, source, proxy, missing] = describeFactor(f.id, H, A, qbH, qbA, injH, injA, input);
    return { id: f.id, name: f.name, home, away, side_value: sideVal, total_value: totalVal, source, proxy, missing };
  });

  return {
    game_id: game.game_id, season, week, home: game.home_team, away: game.away_team,
    side, total, factors, league, home_profile: H, away_profile: A,
    qb: { home: qbH, away: qbA },
    injuries: { home: injH, away: injA },
    movement: input.movement,
    data_quality: round(dataQuality, 3),
    diagnostics: {
      leakage_rows_dropped: leakageDropped,
      home_games_current: H.games_current,
      away_games_current: A.games_current,
      weather_source: input.weather.source,
      neutral_site: neutral,
    },
  };
}

function describeFactor(
  id: number, H: TeamProfile, A: TeamProfile, qbH: QbContext, qbA: QbContext,
  injH: InjuryContext, injA: InjuryContext, input: GameFeatureInput,
): [number | null, number | null, string, boolean, boolean] {
  const r = (x: number) => round(x, 4);
  switch (id) {
    case 1: return [r(H.off_epa), r(A.off_epa), "nflverse pbp, opponent-adjusted", false, false];
    case 2: return [r(H.def_epa), r(A.def_epa), "nflverse pbp, opponent-adjusted (allowed)", false, false];
    case 3: return [r(H.off_sr), r(A.off_sr), "nflverse pbp, opponent-adjusted", false, false];
    case 4: return [r(H.def_sr), r(A.def_sr), "nflverse pbp, opponent-adjusted (allowed)", false, false];
    case 5: return [r(H.off_db_epa), r(A.off_db_epa), "dropback EPA, opponent-adjusted", false, false];
    case 6: return [r(qbH.starter_value), r(qbA.starter_value), "starter EPA/dropback (shrunk)", qbH.source !== "player_data" || qbA.source !== "player_data", false];
    case 7: return [r(H.pressured_epa), r(A.pressured_epa), "EPA on sacks/QB hits (pressure proxy)", true, false];
    case 8: return [r(H.def_pressure), r(A.def_pressure), "defensive sacks+hits per dropback", true, false];
    case 9: return [r(H.def_db_epa), r(A.def_db_epa), "dropback EPA allowed (no coverage grades)", true, false];
    case 10: return [r(H.off_rush_epa), r(A.off_rush_epa), "rush EPA, opponent-adjusted", false, false];
    case 11: return [r(H.def_rush_epa), r(A.def_rush_epa), "rush EPA allowed, opponent-adjusted", false, false];
    case 12: return [r(H.off_explosive), r(A.off_explosive), "20+ pass / 10+ rush rate", false, false];
    case 13: return [r(H.off_ppd), r(A.off_ppd), "drive outcomes", false, false];
    case 14: return [r(H.off_rz_td), r(A.off_rz_td), "TD rate on red-zone drives", false, false];
    case 15: return [r(H.srs), r(A.srs), "opponent-adjusted margin (SRS)", false, false];
    case 16: return [r(H.recent_form), r(A.recent_form), "last-3 net EPA vs weighted season", false, false];
    case 17: return [r(H.turnover_luck), r(A.turnover_luck), "fumble-recovery luck per game", false, false];
    case 18: return [r(H.off_pressure_allowed), r(A.off_pressure_allowed), "pressure allowed per dropback", true, false];
    case 19: return [r(injH.points_lost), r(injA.points_lost), "injury report, rule-based points", false, !injH.report_found && !injA.report_found];
    case 20: return [input.game.location === "Neutral" ? 0 : 1, 0, "schedule", false, false];
    case 21: return [input.game.home_rest, input.game.away_rest, "schedule rest days", false, input.game.home_rest === null];
    case 22: return [0, round(travelBurden(input.game.away_team, input.game.home_team, input.game.location === "Neutral").miles, 0), "stadium coordinates", false, false];
    case 23: return [input.weather.temp, input.weather.wind, `weather (${input.weather.source})`, false, input.weather.source === "none" && !isIndoor(input.weather.roof)];
    case 24: return [r(H.proe), r(A.proe), "PROE + neutral pace", false, false];
    case 25: return [input.movement?.spread_move_home ?? null, input.movement?.total_move ?? null, "odds snapshots open→current", false, input.movement === null];
    default: return [null, null, "", false, true];
  }
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
