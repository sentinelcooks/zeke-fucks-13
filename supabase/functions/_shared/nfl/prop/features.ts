/**
 * NFL PLAYER PROP EDGE ENGINE — feature pipeline (33 player factors).
 *
 * Builds the player's opportunity profile (usage shares blended over L3/L5/
 * season/prior windows with shrinkage), the team environment, the opponent
 * matchup (team-level and position-specific), QB context and availability.
 *
 * Independent of the game engine: its own team/opponent aggregation, its own
 * QB logic. Game script and expected team scoring come from the SPORTSBOOK
 * spread/total (market context), never from the game engine's projections.
 *
 * LEAKAGE GUARD: rows at or after the target (season, week) are dropped.
 */

import type { NflInjuryRow, NflPlayerWeekRow, NflTeamWeekRow } from "../data/types.ts";
import type { NflPositionAllowedRow } from "../data/position_allowed.ts";
import { BLEND, SHRINK } from "./weights.ts";

export interface PropGameContext {
  game_id: string;
  season: number;
  week: number;
  team: string;
  opponent: string;
  is_home: boolean | null;
  roof: string | null;
  temp: number | null;
  wind: number | null;
  precip_prob: number | null;
  weather_source: "schedule" | "forecast" | "none";
  team_rest: number | null;
  opp_rest: number | null;
}

/** Sportsbook game lines — the ONLY game-level expectations the prop engine uses. */
export interface PropMarketContext {
  /** Player's team spread (negative = favoured). */
  team_spread: number | null;
  game_total: number | null;
}

export interface PropFeatureInput {
  player: { player_id: string; player_name: string; position: string; team: string };
  game: PropGameContext;
  market_context: PropMarketContext;
  /** Every player row for the player's team (incl. this player and QBs), current + prior season. */
  teamPlayerRows: NflPlayerWeekRow[];
  /** The player's own rows (any team), current + prior season. */
  playerRows: NflPlayerWeekRow[];
  /** League team-week rows, current + prior season. */
  teamWeeks: NflTeamWeekRow[];
  /** Production allowed by every defense to the player's position, current + prior season. */
  positionAllowed: NflPositionAllowedRow[];
  /** Injury report rows for the player's team for this week. */
  injuries: NflInjuryRow[];
}

export interface PropFactor {
  id: number;
  name: string;
  value: number | string | null;
  /** Multiplicative effect on the projection it feeds (1 = neutral), where applicable. */
  effect: number | null;
  source: string;
  proxy: boolean;
  missing: boolean;
}

export interface UsageProfile {
  games_current: number;
  games_prior: number;
  sample_games: number;
  snap_pct: number;
  snap_pct_season: number;
  snap_cv: number; // role stability (CV of recent snap share)
  route_participation: number; // proxy unless participation data exists
  route_proxy: boolean;
  target_share: number;
  air_yards_share: number;
  rz_targets_pg: number;
  rush_share: number;
  carries_pg: number;
  touch_share: number;
  rz_carries_pg: number;
  gl_carries_pg: number;
  pass_att_pg: number;
  // Per-opportunity production (raw sums for shrinkage)
  targets: number; receptions: number; rec_yards: number; rec_tds: number;
  carries: number; rush_yards: number; rush_tds: number;
  pass_att: number; completions: number; pass_yards: number; pass_tds: number; ints: number;
  fg_att: number; fg_made: number; pat_att: number; pat_made: number;
  // Stat rolling averages (factors 1-5) for the requested stat
  stat_l3: number | null;
  stat_l5: number | null;
  stat_season: number | null;
  stat_prior: number | null;
  stat_rolling: number | null;
}

export interface TeamEnv {
  plays_pg: number;
  dropback_rate: number; // all situations
  neutral_pass_rate: number;
  sack_rate: number;
  pressure_allowed: number; // relative to league
  rush_success: number; // relative to league
  points_pg: number;
  drives_pg: number;
  fg_att_per_drive: number;
}

export interface OpponentEnv {
  def_epa: number; // allowed, relative (+ = worse defense)
  def_sr: number;
  def_db_epa: number;
  def_rush_epa: number;
  def_pressure: number; // relative (+ = more pressure)
  plays_allowed_pg: number;
  int_rate: number; // interceptions per dropback faced, relative ratio
}

export interface PositionMatchup {
  targets_ratio: number;
  ypt_ratio: number;
  catch_ratio: number;
  ypc_ratio: number;
  rec_td_ratio: number;
  rush_td_ratio: number;
  ypa_ratio: number;
  cmp_ratio: number;
  int_ratio: number;
  games: number;
}

export interface QbEnv {
  starter_name: string | null;
  starter_status: string | null;
  starter_value: number; // shrunk EPA/db relative to league
  baseline_value: number;
  delta: number; // starter − baseline
  player_is_starter: boolean;
}

export interface AvailabilityEnv {
  status: string | null; // Out | Doubtful | Questionable | null
  practice: string | null;
  vacated_target_share: number; // share of teammates ruled Out/Doubtful
  vacated_rush_share: number;
}

export interface PropFeatureVector {
  player_id: string;
  player_name: string;
  position: string;
  usage: UsageProfile;
  team: TeamEnv;
  league: TeamEnv & { def_int_rate: number; ppg: number };
  opponent: OpponentEnv;
  matchup: PositionMatchup;
  qb: QbEnv;
  availability: AvailabilityEnv;
  game: PropGameContext;
  market_context: PropMarketContext;
  implied_team_total: number | null;
  data_quality: number;
  factors: PropFactor[];
  diagnostics: { leakage_rows_dropped: number };
}

const isBefore = (r: { season: number; week: number }, s: number, w: number) =>
  r.season < s || (r.season === s && r.week < w);

const played = (r: NflPlayerWeekRow) =>
  (r.offense_snaps ?? 0) > 0 || r.targets + r.carries + r.pass_attempts + r.fg_att + r.pat_att > 0;

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Blend window means with BLEND weights, renormalising over non-empty windows. */
export function blendWindows(w: { last3: number | null; last5: number | null; season: number | null; prior: number | null }): number | null {
  let num = 0, den = 0;
  for (const k of ["last3", "last5", "season", "prior"] as const) {
    const v = w[k];
    if (v === null || !Number.isFinite(v)) continue;
    num += BLEND[k] * v;
    den += BLEND[k];
  }
  return den > 0 ? num / den : null;
}

export function statValue(r: NflPlayerWeekRow, stat: string): number {
  switch (stat) {
    case "pass_yds": return r.passing_yards;
    case "pass_att": return r.pass_attempts;
    case "pass_cmp": return r.completions;
    case "pass_tds": return r.passing_tds;
    case "pass_ints": return r.interceptions;
    case "rush_yds": return r.rushing_yards;
    case "rush_att": return r.carries;
    case "rec_yds": return r.receiving_yards;
    case "receptions": return r.receptions;
    case "targets": return r.targets;
    case "anytime_td": return r.rushing_tds + r.receiving_tds > 0 ? 1 : 0;
    case "fg_made": return r.fg_made;
    case "xp_made": return r.pat_made;
    case "kicking_points": return 3 * r.fg_made + r.pat_made;
    default: return 0;
  }
}

// ─── Usage ────────────────────────────────────────────────────────────────

function buildUsage(rows: NflPlayerWeekRow[], season: number, stat: string, position: string): UsageProfile {
  const games = rows.filter(played).sort((a, b) => (b.season - a.season) || (b.week - a.week));
  const current = games.filter((r) => r.season === season);
  const prior = games.filter((r) => r.season === season - 1);
  const l3 = games.slice(0, 3);
  const l5 = games.slice(0, 5);

  const windowMean = (list: NflPlayerWeekRow[], f: (r: NflPlayerWeekRow) => number | null) => {
    const vals = list.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
    return mean(vals);
  };
  const blend = (f: (r: NflPlayerWeekRow) => number | null) => blendWindows({
    last3: windowMean(l3, f), last5: windowMean(l5, f), season: windowMean(current, f), prior: windowMean(prior, f),
  });

  const teamTargets = (r: NflPlayerWeekRow) =>
    r.target_share && r.target_share > 0 ? r.targets / r.target_share : null;
  const snap = (r: NflPlayerWeekRow) => r.offense_pct;
  const snaps5 = l5.map((r) => r.offense_pct).filter((v): v is number => v !== null);
  const snapMean = mean(snaps5) ?? 0;
  const snapSd = snaps5.length > 1 ? Math.sqrt(snaps5.reduce((a, v) => a + (v - snapMean) ** 2, 0) / (snaps5.length - 1)) : 0;

  const sum = (f: (r: NflPlayerWeekRow) => number) => {
    // Opportunity sums for shrinkage: current season fully, prior season at half weight.
    return current.reduce((a, r) => a + f(r), 0) + 0.5 * prior.reduce((a, r) => a + f(r), 0);
  };

  const snapPct = blend(snap) ?? 0;
  const targetShare = blend((r) => r.target_share ?? (teamTargets(r) ? r.targets / teamTargets(r)! : null)) ?? 0;
  const rushShare = blend((r) => (r.team_carries && r.team_carries > 0 ? r.carries / r.team_carries : null)) ?? 0;
  const statFn = (r: NflPlayerWeekRow) => statValue(r, stat);

  return {
    games_current: current.length,
    games_prior: prior.length,
    sample_games: current.length + prior.length,
    snap_pct: snapPct,
    snap_pct_season: windowMean(current.length ? current : prior, snap) ?? snapPct,
    snap_cv: snapMean > 0 ? snapSd / snapMean : 1,
    route_participation: routeParticipation(games.slice(0, 5), position),
    route_proxy: games.slice(0, 5).every((r) => r.routes === null),
    target_share: targetShare,
    air_yards_share: blend((r) => r.air_yards_share) ?? 0,
    rz_targets_pg: blend((r) => r.rz_targets) ?? 0,
    rush_share: rushShare,
    carries_pg: blend((r) => r.carries) ?? 0,
    touch_share: blend((r) =>
      r.team_carries !== null && r.team_dropbacks !== null && r.team_carries + r.team_dropbacks > 0
        ? (r.carries + r.targets) / (r.team_carries + r.team_dropbacks) : null) ?? 0,
    rz_carries_pg: blend((r) => r.rz_carries) ?? 0,
    gl_carries_pg: blend((r) => r.gl_carries) ?? 0,
    pass_att_pg: blend((r) => r.pass_attempts) ?? 0,
    targets: sum((r) => r.targets), receptions: sum((r) => r.receptions),
    rec_yards: sum((r) => r.receiving_yards), rec_tds: sum((r) => r.receiving_tds),
    carries: sum((r) => r.carries), rush_yards: sum((r) => r.rushing_yards), rush_tds: sum((r) => r.rushing_tds),
    pass_att: sum((r) => r.pass_attempts), completions: sum((r) => r.completions),
    pass_yards: sum((r) => r.passing_yards), pass_tds: sum((r) => r.passing_tds), ints: sum((r) => r.interceptions),
    fg_att: sum((r) => r.fg_att), fg_made: sum((r) => r.fg_made), pat_att: sum((r) => r.pat_att), pat_made: sum((r) => r.pat_made),
    stat_l3: windowMean(l3, statFn),
    stat_l5: windowMean(l5, statFn),
    stat_season: windowMean(current, statFn),
    stat_prior: windowMean(prior, statFn),
    stat_rolling: blend(statFn),
  };
}

/**
 * Route participation. nflverse participation data lags the current season,
 * so when routes are missing this is a FLAGGED proxy: snap share scaled by
 * how pass-involved the position is (RBs run far fewer routes per snap).
 */
function routeParticipation(recent: NflPlayerWeekRow[], position: string): number {
  const withRoutes = recent.filter((r) => r.routes !== null && r.team_dropbacks);
  if (withRoutes.length) {
    return mean(withRoutes.map((r) => r.routes! / r.team_dropbacks!)) ?? 0;
  }
  const perSnap: Record<string, number> = { WR: 0.93, TE: 0.72, RB: 0.55, FB: 0.25, QB: 0, K: 0 };
  return (mean(recent.map((r) => r.offense_pct ?? 0)) ?? 0) * (perSnap[position] ?? 0.5);
}

// ─── Team / opponent / league environment (prop engine's own) ────────────

interface WeightedRow { r: NflTeamWeekRow; w: number }

function weightedRows(rows: NflTeamWeekRow[], team: string, season: number): WeightedRow[] {
  const list = rows.filter((r) => r.team === team).sort((a, b) => (b.season - a.season) || (b.week - a.week));
  const current = list.filter((r) => r.season === season);
  const priorW = 0.3 * Math.pow(0.5, current.length / 4);
  return list.map((r, i) => ({ r, w: r.season === season ? Math.pow(0.9, i) : priorW }));
}

function wRate(rows: WeightedRow[], num: (r: NflTeamWeekRow) => number, den: (r: NflTeamWeekRow) => number, fallback: number): number {
  let n = 0, d = 0;
  for (const { r, w } of rows) { n += w * num(r); d += w * den(r); }
  return d > 0 ? n / d : fallback;
}

function wPerGame(rows: WeightedRow[], f: (r: NflTeamWeekRow) => number, fallback: number): number {
  const w = rows.reduce((a, x) => a + x.w, 0);
  return w > 0 ? rows.reduce((a, x) => a + x.w * f(x.r), 0) / w : fallback;
}

function leagueEnv(rows: NflTeamWeekRow[]) {
  const all = rows.map((r) => ({ r, w: 1 }));
  return {
    plays_pg: wPerGame(all, (r) => r.off_plays, 63),
    dropback_rate: wRate(all, (r) => r.off_dropbacks, (r) => r.off_plays, 0.6),
    neutral_pass_rate: wRate(all, (r) => r.off_neutral_dropbacks, (r) => r.off_neutral_plays, 0.56),
    sack_rate: wRate(all, (r) => r.off_sacks, (r) => r.off_dropbacks, 0.065),
    pressure_allowed: 0,
    rush_success: 0,
    points_pg: wPerGame(all, (r) => r.points_for ?? 0, 22.5),
    drives_pg: wPerGame(all, (r) => r.off_drives, 10.8),
    fg_att_per_drive: wRate(all, (r) => r.off_fg_att, (r) => r.off_drives, 0.17),
    epa: wRate(all, (r) => r.off_epa_sum, (r) => r.off_plays, 0),
    sr: wRate(all, (r) => r.off_success, (r) => r.off_plays, 0.44),
    db_epa: wRate(all, (r) => r.off_dropback_epa_sum, (r) => r.off_dropbacks, 0.05),
    rush_epa: wRate(all, (r) => r.off_rush_epa_sum, (r) => r.off_rushes, -0.08),
    pressure: wRate(all, (r) => r.off_qb_hits, (r) => r.off_dropbacks, 0.2),
    rush_sr: wRate(all, (r) => r.off_rush_success, (r) => r.off_rushes, 0.4),
    int_rate: wRate(all, (r) => r.off_interceptions, (r) => r.off_dropbacks, 0.022),
    ppg: wPerGame(all, (r) => r.points_for ?? 0, 22.5),
  };
}

// ─── Position matchup ─────────────────────────────────────────────────────

function positionMatchup(rows: NflPositionAllowedRow[], defense: string, position: string, season: number): PositionMatchup {
  const pos = rows.filter((r) => r.position === position);
  const agg = (list: NflPositionAllowedRow[]) => {
    const s = (f: (r: NflPositionAllowedRow) => number) => list.reduce((a, r) => a + f(r), 0);
    const g = Math.max(list.length, 1);
    return {
      g: list.length,
      targets_pg: s((r) => r.targets) / g,
      ypt: s((r) => r.receiving_yards) / Math.max(s((r) => r.targets), 1),
      catch: s((r) => r.receptions) / Math.max(s((r) => r.targets), 1),
      ypc: s((r) => r.rushing_yards) / Math.max(s((r) => r.carries), 1),
      rec_td: s((r) => r.receiving_tds) / Math.max(s((r) => r.targets), 1),
      rush_td: s((r) => r.rushing_tds) / Math.max(s((r) => r.carries), 1),
      ypa: s((r) => r.passing_yards) / Math.max(s((r) => r.pass_attempts), 1),
      cmp: s((r) => r.completions) / Math.max(s((r) => r.pass_attempts), 1),
      int: s((r) => r.interceptions) / Math.max(s((r) => r.pass_attempts), 1),
    };
  };
  // Opponent sample: current season fully + prior season (weighted by duplication).
  const opp = pos.filter((r) => r.defense === defense);
  const oppCur = opp.filter((r) => r.season === season);
  const oppSample = oppCur.length >= 4 ? oppCur : opp;
  const league = agg(pos);
  const o = agg(oppSample);
  // Shrink each ratio toward 1 by sample size (6 games = half weight).
  const k = oppSample.length / (oppSample.length + 6);
  const ratio = (a: number, b: number) => (b > 0 ? 1 + k * (a / b - 1) : 1);
  return {
    targets_ratio: ratio(o.targets_pg, league.targets_pg),
    ypt_ratio: ratio(o.ypt, league.ypt),
    catch_ratio: ratio(o.catch, league.catch),
    ypc_ratio: ratio(o.ypc, league.ypc),
    rec_td_ratio: ratio(o.rec_td, league.rec_td),
    rush_td_ratio: ratio(o.rush_td, league.rush_td),
    ypa_ratio: ratio(o.ypa, league.ypa),
    cmp_ratio: ratio(o.cmp, league.cmp),
    int_ratio: ratio(o.int, league.int),
    games: oppSample.length,
  };
}

// ─── QB (prop engine's own) ──────────────────────────────────────────────

function qbEnv(teamRows: NflPlayerWeekRow[], injuries: NflInjuryRow[], season: number, playerId: string, leagueDbEpa: number): QbEnv {
  const qbs = teamRows.filter((r) => r.position === "QB" && played(r));
  if (!qbs.length) {
    return { starter_name: null, starter_status: null, starter_value: 0, baseline_value: 0, delta: 0, player_is_starter: false };
  }
  const status = (id: string) => injuries.find((i) => i.player_id === id)?.report_status ?? null;
  const out = (s: string | null) => s === "Out" || s === "Doubtful";
  const latest = qbs.reduce((a, b) => (b.season > a.season || (b.season === a.season && b.week > a.week) ? b : a));
  const ordered = [...qbs.filter((r) => r.game_id === latest.game_id).sort((a, b) => b.pass_attempts - a.pass_attempts).map((r) => r.player_id),
    ...[...new Set(qbs.map((r) => r.player_id))]];
  const starter = ordered.find((id) => !out(status(id))) ?? ordered[0];
  const value = (id: string) => {
    const rows = qbs.filter((r) => r.player_id === id);
    const db = rows.reduce((a, r) => a + r.pass_attempts + r.sacks_taken, 0);
    const epa = rows.reduce((a, r) => a + (r.passing_epa ?? 0), 0);
    const raw = db > 0 ? epa / db - leagueDbEpa : -0.12;
    return (raw * db - 0.12 * 150) / (db + 150);
  };
  const seasonQbs = qbs.filter((r) => r.season === season);
  const base = seasonQbs.length ? seasonQbs : qbs;
  let n = 0, d = 0;
  for (const id of new Set(base.map((r) => r.player_id))) {
    const db = base.filter((r) => r.player_id === id).reduce((a, r) => a + r.pass_attempts + r.sacks_taken, 0);
    n += value(id) * db;
    d += db;
  }
  const sv = value(starter);
  const bv = d > 0 ? n / d : sv;
  return {
    starter_name: qbs.find((r) => r.player_id === starter)?.player_name ?? null,
    starter_status: status(starter),
    starter_value: sv,
    baseline_value: bv,
    delta: sv - bv,
    player_is_starter: starter === playerId,
  };
}

// ─── Availability ─────────────────────────────────────────────────────────

function availability(teamRows: NflPlayerWeekRow[], injuries: NflInjuryRow[], playerId: string, season: number): AvailabilityEnv {
  const own = injuries.find((i) => i.player_id === playerId);
  let vacTarget = 0, vacRush = 0;
  for (const inj of injuries) {
    if (inj.player_id === playerId || !(inj.report_status === "Out" || inj.report_status === "Doubtful")) continue;
    const rows = teamRows.filter((r) => r.player_id === inj.player_id && played(r))
      .sort((a, b) => (b.season - a.season) || (b.week - a.week)).slice(0, 4);
    if (!rows.length || rows[0].season < season - 1) continue;
    vacTarget += mean(rows.map((r) => r.target_share ?? 0)) ?? 0;
    vacRush += mean(rows.map((r) => (r.team_carries ? r.carries / r.team_carries : 0))) ?? 0;
  }
  return {
    status: own?.report_status ?? null,
    practice: own?.practice_status ?? null,
    vacated_target_share: Math.min(vacTarget, 0.5),
    vacated_rush_share: Math.min(vacRush, 0.7),
  };
}

// ─── Assembly ─────────────────────────────────────────────────────────────

export function buildPropFeatures(input: PropFeatureInput, stat: string): PropFeatureVector {
  const { season, week } = input.game;
  const keep = <T extends { season: number; week: number }>(rows: T[]) =>
    rows.filter((r) => isBefore(r, season, week) && r.season >= season - 1);
  const playerRows = keep(input.playerRows);
  const teamPlayerRows = keep(input.teamPlayerRows);
  const teamWeeks = keep(input.teamWeeks);
  const positionAllowed = keep(input.positionAllowed);
  const dropped = (input.playerRows.length - playerRows.length) + (input.teamPlayerRows.length - teamPlayerRows.length) +
    (input.teamWeeks.length - teamWeeks.length) + (input.positionAllowed.length - positionAllowed.length);

  const position = input.player.position.toUpperCase();
  const usage = buildUsage(playerRows, season, stat, position);
  const lg = leagueEnv(teamWeeks);
  const teamRows = weightedRows(teamWeeks, input.game.team, season);
  const oppRows = weightedRows(teamWeeks, input.game.opponent, season);

  const team: TeamEnv = {
    plays_pg: wPerGame(teamRows, (r) => r.off_plays, lg.plays_pg),
    dropback_rate: (wRate(teamRows, (r) => r.off_dropbacks, (r) => r.off_plays, lg.dropback_rate) * teamRows.length +
      lg.dropback_rate * SHRINK.share_games) / (teamRows.length + SHRINK.share_games),
    neutral_pass_rate: (wRate(teamRows, (r) => r.off_neutral_dropbacks, (r) => r.off_neutral_plays, lg.neutral_pass_rate) * teamRows.length +
      lg.neutral_pass_rate * SHRINK.share_games) / (teamRows.length + SHRINK.share_games),
    sack_rate: wRate(teamRows, (r) => r.off_sacks, (r) => r.off_dropbacks, lg.sack_rate),
    pressure_allowed: wRate(teamRows, (r) => r.off_qb_hits, (r) => r.off_dropbacks, lg.pressure) - lg.pressure,
    rush_success: wRate(teamRows, (r) => r.off_rush_success, (r) => r.off_rushes, lg.rush_sr) - lg.rush_sr,
    points_pg: wPerGame(teamRows, (r) => r.points_for ?? 0, lg.points_pg),
    drives_pg: wPerGame(teamRows, (r) => r.off_drives, lg.drives_pg),
    fg_att_per_drive: wRate(teamRows, (r) => r.off_fg_att, (r) => r.off_drives, lg.fg_att_per_drive),
  };
  const opponent: OpponentEnv = {
    def_epa: wRate(oppRows, (r) => r.def_epa_sum, (r) => r.def_plays, lg.epa) - lg.epa,
    def_sr: wRate(oppRows, (r) => r.def_success, (r) => r.def_plays, lg.sr) - lg.sr,
    def_db_epa: wRate(oppRows, (r) => r.def_dropback_epa_sum, (r) => r.def_dropbacks, lg.db_epa) - lg.db_epa,
    def_rush_epa: wRate(oppRows, (r) => r.def_rush_epa_sum, (r) => r.def_rushes, lg.rush_epa) - lg.rush_epa,
    def_pressure: wRate(oppRows, (r) => r.def_qb_hits, (r) => r.def_dropbacks, lg.pressure) - lg.pressure,
    plays_allowed_pg: wPerGame(oppRows, (r) => r.def_plays, lg.plays_pg),
    int_rate: wRate(oppRows, (r) => r.def_interceptions, (r) => r.def_dropbacks, lg.int_rate) / Math.max(lg.int_rate, 1e-6),
  };
  const matchup = positionMatchup(positionAllowed, input.game.opponent, position, season);
  const qb = qbEnv(teamPlayerRows, input.injuries, season, input.player.player_id, lg.db_epa);
  const avail = availability(teamPlayerRows, input.injuries, input.player.player_id, season);

  const mc = input.market_context;
  const impliedTeamTotal = mc.game_total !== null && mc.team_spread !== null
    ? mc.game_total / 2 - mc.team_spread / 2
    : null;

  // Data quality: sample depth, snap data, opponent sample, market context, weather.
  const indoor = input.game.roof === "dome" || input.game.roof === "closed";
  const dataQuality = Math.max(0, Math.min(1,
    0.35 * Math.min(1, (usage.games_current + 0.5 * usage.games_prior) / 8) +
    0.15 * (usage.snap_pct > 0 ? 1 : 0.3) +
    0.15 * Math.min(1, matchup.games / 6) +
    0.15 * (impliedTeamTotal !== null ? 1 : 0.4) +
    0.1 * (indoor || input.game.weather_source !== "none" ? 1 : 0.6) +
    0.1 * (usage.route_proxy ? 0.5 : 1),
  ));

  const fv: PropFeatureVector = {
    player_id: input.player.player_id,
    player_name: input.player.player_name,
    position,
    usage,
    team,
    league: { ...lg, pressure_allowed: 0, rush_success: 0, def_int_rate: lg.int_rate, ppg: lg.ppg },
    opponent,
    matchup,
    qb,
    availability: avail,
    game: input.game,
    market_context: mc,
    implied_team_total: impliedTeamTotal,
    data_quality: Math.round(dataQuality * 1000) / 1000,
    factors: [],
    diagnostics: { leakage_rows_dropped: dropped },
  };
  return fv;
}
