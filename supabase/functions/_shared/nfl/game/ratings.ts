/**
 * NFL GAME EDGE ENGINE — team strength profiles.
 *
 * Builds one `TeamProfile` per team from point-in-time team-week rows:
 *   1. Recency-weighted rates (current-season half-life, decaying prior-season carry-over).
 *   2. Shrinkage toward the league mean (a pseudo-sample of league-average play).
 *   3. Iterative opponent adjustment of EPA/success-rate metrics and of the
 *      scoring-margin rating (SRS), so a team is not credited for a soft schedule.
 *
 * Owned by the game engine only. The prop engine builds its own matchup views.
 */

import type { NflTeamWeekRow } from "../data/types.ts";

// Recency: a current-season game `n` games ago is weighted HALF_LIFE^-n.
export const CURRENT_HALF_LIFE_GAMES = 6;
// A prior-season game starts at this weight and fades as the current sample grows.
export const PRIOR_SEASON_GAME_WEIGHT = 0.35;
export const PRIOR_FADE_GAMES = 4;
// League-mean pseudo-sample, in games, used to shrink every rate.
export const SHRINK_GAMES = 2;
const ADJUST_ITERATIONS = 8;

export interface TeamProfile {
  team: string;
  games_current: number;
  games_prior: number;
  weight_total: number;

  // Opponent-adjusted, league-relative (0 = league average). Offense: higher is
  // better. Defense values are "allowed", relative: higher = WORSE defense.
  off_epa: number;
  def_epa: number;
  off_sr: number;
  def_sr: number;
  off_db_epa: number;
  def_db_epa: number;
  off_rush_epa: number;
  def_rush_epa: number;

  // Shrunk raw rates (league-relative where noted).
  off_explosive: number; // per play
  def_explosive: number;
  off_ppd: number; // points per drive
  def_ppd: number;
  off_rz_td: number; // TD rate on red-zone drives
  def_rz_td: number;
  off_pressure_allowed: number; // (sacks + hits) per dropback
  def_pressure: number;
  off_sack_rate: number;
  pressured_epa: number; // offense EPA per pressured dropback
  neutral_pass_rate: number;
  proe: number; // pass rate over expected, percentage points
  sec_per_play: number;
  plays_per_game: number;
  qb_epa_per_db: number;
  cpoe: number;
  fg_rate: number; // field goals made per drive

  // Scoring
  points_for_pg: number;
  points_against_pg: number;
  srs: number; // opponent-adjusted margin per game

  // Turnover luck (per game). Positive = team has been LUCKY.
  turnover_luck: number;

  // Recent form: last-3 net EPA/play minus the weighted season net EPA/play.
  recent_form: number;
}

export interface LeagueBaseline {
  epa: number;
  sr: number;
  db_epa: number;
  rush_epa: number;
  explosive: number;
  ppd: number;
  rz_td: number;
  pressure: number;
  sack_rate: number;
  pressured_epa: number;
  neutral_pass_rate: number;
  sec_per_play: number;
  plays_per_game: number;
  points_per_game: number;
  fg_rate: number;
  qb_epa_per_db: number;
  cpoe: number;
}

export interface WeightedGame {
  row: NflTeamWeekRow;
  w: number;
}

/** Point-in-time filter: strictly before (season, week). */
export function isBefore(row: { season: number; week: number }, season: number, week: number): boolean {
  return row.season < season || (row.season === season && row.week < week);
}

/**
 * Weights each team's games for a prediction made before (season, week).
 * Uses only the target season and the one before it.
 */
export function weightTeamGames(
  rows: NflTeamWeekRow[],
  season: number,
  week: number,
): Map<string, WeightedGame[]> {
  const byTeam = new Map<string, NflTeamWeekRow[]>();
  for (const r of rows) {
    if (!isBefore(r, season, week) || r.season < season - 1) continue;
    const list = byTeam.get(r.team) ?? [];
    list.push(r);
    byTeam.set(r.team, list);
  }
  const decay = Math.pow(0.5, 1 / CURRENT_HALF_LIFE_GAMES);
  const out = new Map<string, WeightedGame[]>();
  for (const [team, list] of byTeam) {
    list.sort((a, b) => (a.season - b.season) || (a.week - b.week));
    const current = list.filter((r) => r.season === season);
    const prior = list.filter((r) => r.season === season - 1);
    const priorFade = Math.pow(0.5, current.length / PRIOR_FADE_GAMES);
    const games: WeightedGame[] = [];
    current.forEach((row, i) => games.push({ row, w: Math.pow(decay, current.length - 1 - i) }));
    prior.forEach((row, i) => {
      // Late prior-season games carry a little more than early ones.
      const within = Math.pow(decay, (prior.length - 1 - i) / 2);
      games.push({ row, w: PRIOR_SEASON_GAME_WEIGHT * priorFade * within });
    });
    out.set(team, games);
  }
  return out;
}

function ratio(games: WeightedGame[], num: (r: NflTeamWeekRow) => number, den: (r: NflTeamWeekRow) => number): {
  num: number;
  den: number;
} {
  let n = 0;
  let d = 0;
  for (const g of games) {
    n += g.w * num(g.row);
    d += g.w * den(g.row);
  }
  return { num: n, den: d };
}

/** Rate shrunk toward `prior` by a pseudo-sample of `SHRINK_GAMES` average games. */
function shrunk(
  games: WeightedGame[],
  num: (r: NflTeamWeekRow) => number,
  den: (r: NflTeamWeekRow) => number,
  prior: number,
  denPerGame: number,
): number {
  const { num: n, den: d } = ratio(games, num, den);
  const k = SHRINK_GAMES * denPerGame;
  return (n + k * prior) / (d + k);
}

export function leagueBaseline(weighted: Map<string, WeightedGame[]>): LeagueBaseline {
  const all: WeightedGame[] = [...weighted.values()].flat().map((g) => ({ row: g.row, w: 1 }));
  const r = (num: (x: NflTeamWeekRow) => number, den: (x: NflTeamWeekRow) => number, fallback: number) => {
    const { num: n, den: d } = ratio(all, num, den);
    return d > 0 ? n / d : fallback;
  };
  const games = all.length || 1;
  return {
    epa: r((x) => x.off_epa_sum, (x) => x.off_plays, 0),
    sr: r((x) => x.off_success, (x) => x.off_plays, 0.44),
    db_epa: r((x) => x.off_dropback_epa_sum, (x) => x.off_dropbacks, 0.05),
    rush_epa: r((x) => x.off_rush_epa_sum, (x) => x.off_rushes, -0.08),
    explosive: r((x) => x.off_explosive_pass + x.off_explosive_rush, (x) => x.off_plays, 0.08),
    ppd: r((x) => x.off_drive_points, (x) => x.off_drives, 2.0),
    rz_td: r((x) => x.off_rz_td_drives, (x) => x.off_rz_drives, 0.57),
    pressure: r((x) => x.off_qb_hits, (x) => x.off_dropbacks, 0.2),
    sack_rate: r((x) => x.off_sacks, (x) => x.off_dropbacks, 0.065),
    pressured_epa: r((x) => x.off_pressured_epa_sum, (x) => x.off_pressured_dropbacks, -1.1),
    neutral_pass_rate: r((x) => x.off_neutral_dropbacks, (x) => x.off_neutral_plays, 0.56),
    sec_per_play: r((x) => x.off_seconds_per_play_sum, (x) => x.off_seconds_per_play_n, 30),
    plays_per_game: all.reduce((a, g) => a + g.row.off_plays, 0) / games || 63,
    points_per_game: all.reduce((a, g) => a + (g.row.points_for ?? 0), 0) / games || 22.5,
    fg_rate: r((x) => x.off_fg_made, (x) => x.off_drives, 0.15),
    qb_epa_per_db: r((x) => x.off_qb_epa_sum, (x) => x.off_dropbacks, 0.05),
    cpoe: r((x) => x.off_cpoe_sum, (x) => x.off_cpoe_n, 0),
  };
}

/**
 * Opponent-adjusts a per-play offense/defense pair. Returns league-relative
 * adjusted values: off (higher = better) and def-allowed (higher = worse).
 */
function opponentAdjust(
  weighted: Map<string, WeightedGame[]>,
  offNum: (r: NflTeamWeekRow) => number,
  offDen: (r: NflTeamWeekRow) => number,
  defNum: (r: NflTeamWeekRow) => number,
  defDen: (r: NflTeamWeekRow) => number,
  league: number,
): { off: Map<string, number>; def: Map<string, number> } {
  const off = new Map<string, number>();
  const def = new Map<string, number>();
  for (const t of weighted.keys()) { off.set(t, 0); def.set(t, 0); }
  for (let it = 0; it < ADJUST_ITERATIONS; it++) {
    const nextOff = new Map<string, number>();
    const nextDef = new Map<string, number>();
    for (const [team, games] of weighted) {
      let on = 0, od = 0, dn = 0, dd = 0;
      for (const { row, w } of games) {
        const oDen = offDen(row);
        const dDen = defDen(row);
        // Offense residual vs what this opponent's defense usually allows.
        if (oDen > 0) {
          on += w * (offNum(row) - oDen * (league + (def.get(row.opponent) ?? 0)));
          od += w * oDen;
        }
        // Defense residual vs what this opponent's offense usually produces.
        if (dDen > 0) {
          dn += w * (defNum(row) - dDen * (league + (off.get(row.opponent) ?? 0)));
          dd += w * dDen;
        }
      }
      // Shrink: SHRINK_GAMES of zero-residual pseudo-sample.
      const perGameO = od / Math.max(games.reduce((a, g) => a + g.w, 0), 1e-9);
      const perGameD = dd / Math.max(games.reduce((a, g) => a + g.w, 0), 1e-9);
      nextOff.set(team, on / (od + SHRINK_GAMES * perGameO || 1));
      nextDef.set(team, dn / (dd + SHRINK_GAMES * perGameD || 1));
    }
    // Re-centre so the league averages to zero.
    const mo = mean([...nextOff.values()]);
    const md = mean([...nextDef.values()]);
    for (const t of nextOff.keys()) {
      off.set(t, nextOff.get(t)! - mo);
      def.set(t, nextDef.get(t)! - md);
    }
  }
  return { off, def };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Opponent-adjusted scoring margin per game (simple rating system). */
function srs(weighted: Map<string, WeightedGame[]>): Map<string, number> {
  const rating = new Map<string, number>();
  for (const t of weighted.keys()) rating.set(t, 0);
  for (let it = 0; it < ADJUST_ITERATIONS * 2; it++) {
    const next = new Map<string, number>();
    for (const [team, games] of weighted) {
      let n = 0, d = 0;
      for (const { row, w } of games) {
        if (row.points_for === null || row.points_against === null) continue;
        // Cap blowouts at 24 so garbage time does not dominate.
        const margin = Math.max(-24, Math.min(24, row.points_for - row.points_against));
        n += w * (margin + (rating.get(row.opponent) ?? 0));
        d += w;
      }
      next.set(team, n / (d + SHRINK_GAMES));
    }
    const m = mean([...next.values()]);
    for (const [t, v] of next) rating.set(t, v - m);
  }
  return rating;
}

export function buildTeamProfiles(
  rows: NflTeamWeekRow[],
  season: number,
  week: number,
): { profiles: Map<string, TeamProfile>; league: LeagueBaseline } {
  const weighted = weightTeamGames(rows, season, week);
  const lg = leagueBaseline(weighted);

  const epa = opponentAdjust(weighted, (r) => r.off_epa_sum, (r) => r.off_plays, (r) => r.def_epa_sum, (r) => r.def_plays, lg.epa);
  const sr = opponentAdjust(weighted, (r) => r.off_success, (r) => r.off_plays, (r) => r.def_success, (r) => r.def_plays, lg.sr);
  const db = opponentAdjust(weighted, (r) => r.off_dropback_epa_sum, (r) => r.off_dropbacks, (r) => r.def_dropback_epa_sum, (r) => r.def_dropbacks, lg.db_epa);
  const rush = opponentAdjust(weighted, (r) => r.off_rush_epa_sum, (r) => r.off_rushes, (r) => r.def_rush_epa_sum, (r) => r.def_rushes, lg.rush_epa);
  const ratingSrs = srs(weighted);

  const profiles = new Map<string, TeamProfile>();
  for (const [team, games] of weighted) {
    const perGame = (f: (r: NflTeamWeekRow) => number) => {
      const w = games.reduce((a, g) => a + g.w, 0);
      return w > 0 ? games.reduce((a, g) => a + g.w * f(g.row), 0) / w : 0;
    };
    const playsPg = perGame((r) => r.off_plays) || lg.plays_per_game;
    const dbPg = perGame((r) => r.off_dropbacks) || 35;
    const drivesPg = perGame((r) => r.off_drives) || 11;
    const rzPg = perGame((r) => r.off_rz_drives) || 3.3;

    const current = games.filter((g) => g.row.season === season);
    const last3 = [...(current.length ? current : games)]
      .sort((a, b) => (b.row.season - a.row.season) || (b.row.week - a.row.week))
      .slice(0, 3);
    const netOf = (list: WeightedGame[]) => {
      const off = list.reduce((a, g) => a + g.row.off_epa_sum, 0) / Math.max(list.reduce((a, g) => a + g.row.off_plays, 0), 1);
      const def = list.reduce((a, g) => a + g.row.def_epa_sum, 0) / Math.max(list.reduce((a, g) => a + g.row.def_plays, 0), 1);
      return off - def;
    };
    const seasonNet = ratio(games, (r) => r.off_epa_sum, (r) => r.off_plays).num /
        Math.max(ratio(games, (r) => r.off_epa_sum, (r) => r.off_plays).den, 1) -
      ratio(games, (r) => r.def_epa_sum, (r) => r.def_plays).num /
        Math.max(ratio(games, (r) => r.def_epa_sum, (r) => r.def_plays).den, 1);
    // Shrink the form signal by sample size (3 games is noisy).
    const recentForm = last3.length ? (netOf(last3) - seasonNet) * (last3.length / (last3.length + 3)) : 0;

    // Turnover luck: fumble recoveries are ~50/50 in the long run.
    const luck = perGame((r) =>
      (r.def_fumbles_recovered - 0.5 * r.def_fumbles_forced) - (r.off_fumbles_lost - 0.5 * r.off_fumbles));

    profiles.set(team, {
      team,
      games_current: current.length,
      games_prior: games.length - current.length,
      weight_total: games.reduce((a, g) => a + g.w, 0),
      off_epa: epa.off.get(team) ?? 0,
      def_epa: epa.def.get(team) ?? 0,
      off_sr: sr.off.get(team) ?? 0,
      def_sr: sr.def.get(team) ?? 0,
      off_db_epa: db.off.get(team) ?? 0,
      def_db_epa: db.def.get(team) ?? 0,
      off_rush_epa: rush.off.get(team) ?? 0,
      def_rush_epa: rush.def.get(team) ?? 0,
      off_explosive: shrunk(games, (r) => r.off_explosive_pass + r.off_explosive_rush, (r) => r.off_plays, lg.explosive, playsPg) - lg.explosive,
      def_explosive: shrunk(games, (r) => r.def_explosive_pass + r.def_explosive_rush, (r) => r.def_plays, lg.explosive, playsPg) - lg.explosive,
      off_ppd: shrunk(games, (r) => r.off_drive_points, (r) => r.off_drives, lg.ppd, drivesPg) - lg.ppd,
      def_ppd: shrunk(games, (r) => r.def_drive_points, (r) => r.def_drives, lg.ppd, drivesPg) - lg.ppd,
      off_rz_td: shrunk(games, (r) => r.off_rz_td_drives, (r) => r.off_rz_drives, lg.rz_td, rzPg) - lg.rz_td,
      def_rz_td: shrunk(games, (r) => r.def_rz_td_drives, (r) => r.def_rz_drives, lg.rz_td, rzPg) - lg.rz_td,
      off_pressure_allowed: shrunk(games, (r) => r.off_qb_hits, (r) => r.off_dropbacks, lg.pressure, dbPg) - lg.pressure,
      def_pressure: shrunk(games, (r) => r.def_qb_hits, (r) => r.def_dropbacks, lg.pressure, dbPg) - lg.pressure,
      off_sack_rate: shrunk(games, (r) => r.off_sacks, (r) => r.off_dropbacks, lg.sack_rate, dbPg) - lg.sack_rate,
      pressured_epa: shrunk(games, (r) => r.off_pressured_epa_sum, (r) => r.off_pressured_dropbacks, lg.pressured_epa, dbPg * 0.2) - lg.pressured_epa,
      neutral_pass_rate: shrunk(games, (r) => r.off_neutral_dropbacks, (r) => r.off_neutral_plays, lg.neutral_pass_rate, 30),
      proe: shrunk(games, (r) => r.off_pass_oe_sum, (r) => r.off_pass_oe_n, 0, playsPg),
      sec_per_play: shrunk(games, (r) => r.off_seconds_per_play_sum, (r) => r.off_seconds_per_play_n, lg.sec_per_play, 25),
      plays_per_game: playsPg,
      qb_epa_per_db: shrunk(games, (r) => r.off_qb_epa_sum, (r) => r.off_dropbacks, lg.qb_epa_per_db, dbPg) - lg.qb_epa_per_db,
      cpoe: shrunk(games, (r) => r.off_cpoe_sum, (r) => r.off_cpoe_n, 0, dbPg * 0.9),
      fg_rate: shrunk(games, (r) => r.off_fg_made, (r) => r.off_drives, lg.fg_rate, drivesPg),
      points_for_pg: perGame((r) => r.points_for ?? 0),
      points_against_pg: perGame((r) => r.points_against ?? 0),
      srs: ratingSrs.get(team) ?? 0,
      turnover_luck: luck,
      recent_form: recentForm,
    });
  }
  return { profiles, league: lg };
}
