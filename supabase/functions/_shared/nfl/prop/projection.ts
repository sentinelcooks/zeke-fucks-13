/**
 * NFL PLAYER PROP EDGE ENGINE — opportunity × efficiency projection.
 *
 *   expected team plays   (team pace × opponent pace × market-implied scoring)
 *   → team dropbacks / rushes (team pass rate × market game script × weather)
 *   → player opportunity  (snap share → routes → target / rush share, with
 *                          vacated-share redistribution from injured teammates)
 *   → per-opportunity efficiency (shrunk player rates × opponent position
 *                          matchup × opponent unit EPA × QB × OL × weather)
 *
 * The output is a set of MEANS for the distribution layer (stat_models.ts).
 * It is never "season average": every mean is rebuilt for this matchup.
 */

import { shrink, shrinkRate } from "../../prob_math.ts";
import type { PropFactor, PropFeatureVector } from "./features.ts";
import { POSITION_PRIORS as P, SHRINK } from "./weights.ts";

export interface PropProjection {
  team_plays: number;
  pass_rate: number;
  team_dropbacks: number;
  team_pass_att: number;
  team_designed_rushes: number;
  exp_snap_pct: number;
  exp_snaps: number;
  availability_mult: number;

  targets: number;
  catch_rate: number;
  yards_per_target: number;
  yards_per_reception: number;
  carries: number;
  yards_per_carry: number;
  pass_att: number;
  completion_pct: number;
  yards_per_attempt: number;
  yards_per_completion: number;
  pass_td_rate: number;
  int_rate: number;
  rec_td_lambda: number;
  rush_td_lambda: number;
  fg_att: number;
  fg_pct: number;
  xp_mean: number;

  factors: PropFactor[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : (lo + hi) / 2));
const pow = (x: number, e: number) => Math.pow(Math.max(x, 1e-6), e);
const r3 = (x: number | null) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

export function projectPlayer(fv: PropFeatureVector): PropProjection {
  const u = fv.usage;
  const pos = fv.position;
  const g = fv.game;
  const lgTeamPpg = fv.league.ppg;
  const indoor = g.roof === "dome" || g.roof === "closed";

  // ── Environment ──
  const implied = fv.implied_team_total;
  const scoringRatio = implied !== null ? clamp(implied / lgTeamPpg, 0.55, 1.6) : clamp(fv.team.points_pg / lgTeamPpg, 0.7, 1.35);
  const scriptPlays = implied !== null ? clamp(1 + 0.008 * (implied - lgTeamPpg), 0.9, 1.1) : 1;
  const paceMult = Math.sqrt(clamp(fv.opponent.plays_allowed_pg / fv.league.plays_pg, 0.85, 1.15));
  const teamPlays = fv.team.plays_pg * paceMult * scriptPlays;

  const spread = fv.market_context.team_spread;
  const scriptPass = spread !== null ? clamp(0.006 * spread, -0.07, 0.07) : 0;
  const wind = indoor ? 0 : g.wind ?? 0;
  const weatherPassRate = indoor ? 0 : (wind > 15 ? -0.02 : 0) + ((g.precip_prob ?? 0) >= 0.5 ? -0.015 : 0);
  const passRate = clamp(fv.team.dropback_rate + scriptPass + weatherPassRate, 0.4, 0.78);
  const teamDropbacks = teamPlays * passRate;
  const teamPassAtt = teamDropbacks * (1 - fv.team.sack_rate - 0.035);
  const teamDesignedRushes = teamPlays - teamDropbacks;

  const weatherPassEff = indoor ? 1 :
    (wind > 15 ? 0.93 : wind > 10 ? 0.97 : 1) * ((g.precip_prob ?? 0) >= 0.5 ? 0.96 : 1) * ((g.temp ?? 60) < 20 ? 0.97 : 1);
  const homeMult = g.is_home === null ? 1 : g.is_home ? 1.015 : 0.985;
  const restMult = g.team_rest === null ? 1 : g.team_rest <= 5 ? 0.98 : g.team_rest >= 13 ? 1.01 : 1;

  // ── Availability & role ──
  const status = fv.availability.status;
  const availabilityMult = status === "Out" ? 0 : status === "Doubtful" ? 0.35 : status === "Questionable" ? 0.93 : 1;
  const expSnapPct = clamp(u.snap_pct * availabilityMult, 0, 1);
  const roleMult = u.snap_pct > 0.05 ? expSnapPct / u.snap_pct : availabilityMult;
  const vacT = fv.availability.vacated_target_share;
  const vacR = fv.availability.vacated_rush_share;

  // ── Receiving ──
  const targetShare = clamp(u.target_share / Math.max(1 - vacT, 0.5), 0, 0.45);
  const targets = teamPassAtt * targetShare * pow(fv.matchup.targets_ratio, 0.3) * roleMult;
  const catchPrior = P.catch_rate[pos] ?? 0.65;
  const catchRate = clamp(
    shrinkRate(u.receptions, u.targets, catchPrior, SHRINK.catch_rate) * pow(fv.matchup.catch_ratio, 0.5) * (1 + 0.3 * fv.qb.delta),
    0.3, 0.92,
  );
  const yptPrior = P.yards_per_target[pos] ?? 7;
  const ypt = clamp(
    shrink(u.targets > 0 ? u.rec_yards / u.targets : yptPrior, u.targets, yptPrior, SHRINK.yards_per_target) *
      pow(fv.matchup.ypt_ratio, 0.5) * (1 + 0.5 * fv.opponent.def_db_epa) * (1 + 1.0 * fv.qb.delta) * weatherPassEff * homeMult,
    2, 16,
  );

  // ── Rushing ──
  const isQb = pos === "QB";
  const scriptRush = spread !== null ? clamp(1 - 0.01 * spread, 0.9, 1.1) : 1;
  const rushShare = clamp(u.rush_share / Math.max(1 - vacR, 0.4), 0, 0.85);
  const carries = isQb
    ? u.carries_pg * roleMult * (spread !== null ? clamp(1 + 0.006 * spread, 0.92, 1.08) : 1)
    : teamDesignedRushes * rushShare * scriptRush * roleMult;
  const ypcPrior = P.yards_per_carry[pos] ?? 4.3;
  const ypc = clamp(
    shrink(u.carries > 0 ? u.rush_yards / u.carries : ypcPrior, u.carries, ypcPrior, SHRINK.yards_per_carry) *
      pow(fv.matchup.ypc_ratio, 0.5) * (1 + 0.8 * fv.opponent.def_rush_epa) * (1 + 0.5 * fv.team.rush_success) * homeMult,
    1, 12,
  );

  // ── Passing ──
  const passAtt = isQb
    ? (fv.qb.player_is_starter ? teamPassAtt * 0.98 : u.pass_att_pg) * availabilityMult * restMult
    : 0;
  const pressureGap = fv.opponent.def_pressure + fv.team.pressure_allowed; // + = more pressure than average
  const cmpPct = clamp(
    shrinkRate(u.completions, u.pass_att, P.completion_pct, SHRINK.completion_pct) * pow(fv.matchup.cmp_ratio, 0.5) * (1 - 0.3 * pressureGap),
    0.45, 0.8,
  );
  const ypa = clamp(
    shrink(u.pass_att > 0 ? u.pass_yards / u.pass_att : P.yards_per_attempt, u.pass_att, P.yards_per_attempt, SHRINK.yards_per_attempt) *
      pow(fv.matchup.ypa_ratio, 0.5) * (1 + 0.6 * fv.opponent.def_db_epa) * (1 - 0.5 * pressureGap) * weatherPassEff * homeMult,
    4, 11,
  );
  const passTdRate = clamp(
    shrink(u.pass_att > 0 ? u.pass_tds / u.pass_att : P.pass_td_per_att, u.pass_att, P.pass_td_per_att, SHRINK.pass_td) * scoringRatio,
    0.01, 0.1,
  );
  const intRate = clamp(
    shrink(u.pass_att > 0 ? u.ints / u.pass_att : P.int_per_att, u.pass_att, P.int_per_att, SHRINK.int) *
      pow(fv.opponent.int_rate, 0.5) * (spread !== null ? clamp(1 + 0.01 * spread, 0.9, 1.12) : 1),
    0.005, 0.06,
  );

  // ── Touchdowns ──
  const tgPg = Math.max(targets, 0.1);
  const rzTargetRatio = clamp(pow((u.rz_targets_pg / Math.max(u.targets / Math.max(u.games_current + 0.5 * u.games_prior, 1), 0.1)) / 0.12, 0.4), 0.6, 1.6);
  const recTdRate = shrink(u.targets > 0 ? u.rec_tds / u.targets : P.rec_td_per_target[pos] ?? 0.04, u.targets, P.rec_td_per_target[pos] ?? 0.04, SHRINK.rec_td);
  const recTdLambda = tgPg * recTdRate * rzTargetRatio * pow(fv.matchup.rec_td_ratio, 0.5) * scoringRatio;
  const glRatio = clamp(pow((u.gl_carries_pg / Math.max(u.carries_pg, 0.1)) / 0.05, 0.4), 0.6, 1.8);
  const rushTdRate = shrink(u.carries > 0 ? u.rush_tds / u.carries : P.rush_td_per_carry[pos] ?? 0.03, u.carries, P.rush_td_per_carry[pos] ?? 0.03, SHRINK.rush_td);
  const rushTdLambda = Math.max(carries, 0) * rushTdRate * (u.carries_pg > 0.5 ? glRatio : 1) * pow(fv.matchup.rush_td_ratio, 0.5) * scoringRatio;

  // ── Kicking ──
  const fgAtt = fv.team.drives_pg * fv.team.fg_att_per_drive * pow(scoringRatio, 0.4);
  const fgWeather = indoor ? 1 : (wind > 15 ? 0.94 : 1) * ((g.temp ?? 60) < 25 ? 0.97 : 1);
  const fgPct = clamp(shrinkRate(u.fg_made, u.fg_att, P.fg_pct, SHRINK.fg_pct) * fgWeather, 0.6, 0.97);
  const xpPct = shrinkRate(u.pat_made, u.pat_att, P.xp_pct, 20);
  const xpMean = (implied ?? fv.team.points_pg) * 0.105 * xpPct;

  const proj: PropProjection = {
    team_plays: teamPlays,
    pass_rate: passRate,
    team_dropbacks: teamDropbacks,
    team_pass_att: teamPassAtt,
    team_designed_rushes: teamDesignedRushes,
    exp_snap_pct: expSnapPct,
    exp_snaps: expSnapPct * teamPlays,
    availability_mult: availabilityMult,
    targets: Math.max(targets, 0),
    catch_rate: catchRate,
    yards_per_target: ypt,
    yards_per_reception: ypt / catchRate,
    carries: Math.max(carries, 0),
    yards_per_carry: ypc,
    pass_att: Math.max(passAtt, 0),
    completion_pct: cmpPct,
    yards_per_attempt: ypa,
    yards_per_completion: ypa / cmpPct,
    pass_td_rate: passTdRate,
    int_rate: intRate,
    rec_td_lambda: pos === "K" || pos === "QB" ? 0 : recTdLambda * availabilityMult,
    rush_td_lambda: pos === "K" ? 0 : rushTdLambda,
    fg_att: pos === "K" ? fgAtt * (availabilityMult > 0 ? 1 : 0) : 0,
    fg_pct: fgPct,
    xp_mean: pos === "K" ? xpMean * (availabilityMult > 0 ? 1 : 0) : 0,
    factors: [],
  };

  proj.factors = buildFactors(fv, proj, {
    scoringRatio, scriptPlays, paceMult, scriptPass, weatherPassEff, homeMult, restMult,
    rzTargetRatio, glRatio, pressureGap,
  });
  return proj;
}

function buildFactors(
  fv: PropFeatureVector,
  p: PropProjection,
  e: Record<string, number>,
): PropFactor[] {
  const u = fv.usage;
  const f = (id: number, name: string, value: number | string | null, effect: number | null, source: string, proxy = false, missing = false): PropFactor =>
    ({ id, name, value: typeof value === "number" ? r3(value) : value, effect: effect === null ? null : r3(effect), source, proxy, missing });
  const hasMarket = fv.implied_team_total !== null;
  const indoor = fv.game.roof === "dome" || fv.game.roof === "closed";
  return [
    f(1, "Player rolling average", u.stat_rolling, null, "blended L3/L5/season/prior", false, u.stat_rolling === null),
    f(2, "Last 3 games", u.stat_l3, null, "player log", false, u.stat_l3 === null),
    f(3, "Last 5 games", u.stat_l5, null, "player log", false, u.stat_l5 === null),
    f(4, "Season average", u.stat_season, null, "player log (current season)", false, u.stat_season === null),
    f(5, "Previous-season baseline", u.stat_prior, null, "player log (prior season)", false, u.stat_prior === null),
    f(6, "Snap percentage", u.snap_pct, null, "nflverse snap counts", false, u.snap_pct === 0),
    f(7, "Route participation", u.route_participation, null, u.route_proxy ? "proxy: snap share × position route rate" : "participation data", u.route_proxy),
    f(8, "Target share", u.target_share, null, "nflverse weekly stats"),
    f(9, "Red-zone target share", u.rz_targets_pg, e.rzTargetRatio, "pbp (targets inside 20) per game"),
    f(10, "Air-yards share", u.air_yards_share, null, "nflverse weekly stats"),
    f(11, "Carries per game", u.carries_pg, null, "player log"),
    f(12, "Rush attempt share", u.rush_share, null, "carries / team carries"),
    f(13, "Touch share", u.touch_share, null, "(carries + targets) / (team carries + dropbacks)"),
    f(14, "Red-zone opportunity share", u.rz_carries_pg + u.rz_targets_pg, null, "pbp inside-20 touches per game"),
    f(15, "Goal-line touches", u.gl_carries_pg, e.glRatio, "pbp carries inside 5"),
    f(16, "Team pass rate", p.pass_rate, null, "team dropback rate + market script + weather"),
    f(17, "Team rush rate", 1 - p.pass_rate, null, "complement of pass rate"),
    f(18, "Pace / expected plays", p.team_plays, e.paceMult * e.scriptPlays, "team plays × opponent plays allowed × implied scoring"),
    f(19, "Opponent defensive EPA", fv.opponent.def_epa, null, "EPA/play allowed vs league"),
    f(20, "Opponent defensive success rate", fv.opponent.def_sr, null, "success rate allowed vs league"),
    f(21, "Opponent coverage matchup", fv.opponent.def_db_epa, 1 + 0.5 * fv.opponent.def_db_epa, "dropback EPA allowed (no coverage grades)", true),
    f(22, "Opponent pass-rush pressure", fv.opponent.def_pressure, 1 - 0.5 * e.pressureGap, "sacks+hits per dropback vs league", true),
    f(23, "Opponent run defense", fv.opponent.def_rush_epa, 1 + 0.8 * fv.opponent.def_rush_epa, "rush EPA allowed vs league"),
    f(24, "Opponent position-specific production allowed", fv.matchup.ypt_ratio, null, `${fv.position} production allowed vs league (${fv.matchup.games} games)`, false, fv.matchup.games === 0),
    f(25, "Offensive line quality", fv.team.pressure_allowed, null, "pressure allowed + rush success", true),
    f(26, "QB quality / availability", fv.qb.starter_name ? `${fv.qb.starter_name} (${fv.qb.delta >= 0 ? "+" : ""}${fv.qb.delta.toFixed(3)} EPA/db vs baseline)` : null, 1 + fv.qb.delta, "starter EPA/dropback, injury report", false, fv.qb.starter_name === null),
    f(27, "Injury status", fv.availability.status ?? "Active", p.availability_mult, "nflverse injury report"),
    f(28, "Expected game script", fv.market_context.team_spread, 1 + e.scriptPass, "sportsbook spread (market, not the game model)", false, fv.market_context.team_spread === null),
    f(29, "Expected team scoring", fv.implied_team_total, e.scoringRatio, "sportsbook implied team total", false, !hasMarket),
    f(30, "Weather", indoor ? "indoor" : `${fv.game.temp ?? "?"}°F, ${fv.game.wind ?? "?"} mph`, e.weatherPassEff, `weather (${fv.game.weather_source})`, false, !indoor && fv.game.weather_source === "none"),
    f(31, "Home/away", fv.game.is_home === null ? null : fv.game.is_home ? "home" : "away", e.homeMult, "schedule"),
    f(32, "Rest", fv.game.team_rest, e.restMult, "schedule rest days", false, fv.game.team_rest === null),
    f(33, "Expected player snap count", p.exp_snaps, null, "expected snap % × expected team plays"),
  ];
}
