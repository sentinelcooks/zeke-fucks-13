/**
 * NFL PLAYER PROP EDGE ENGINE — distribution fit + historical backtest.
 *
 *   node scripts/nfl/backtest-prop.ts                   # report only
 *   node scripts/nfl/backtest-prop.ts --write-weights   # regenerate prop/weights_fitted.ts
 *   node scripts/nfl/backtest-prop.ts --upload          # insert into nfl_player_prop_backtest_runs
 *
 * There are no free historical player-prop prices, so this backtest measures
 * what CAN be measured honestly from history:
 *   - projection accuracy: MAE / RMSE vs actual stat lines
 *   - distribution calibration: randomized PIT histogram ECE
 *   - over-probability calibration at PROXY lines (player's L5 average rounded
 *     to .5) — labelled proxy_line = true; hit rate/ROI at an assumed −110
 *     are shown per prop type / position / edge bucket / confidence bucket
 *     and are NOT evidence of market edge.
 * Real ROI / CLV / hit rate come from graded live predictions
 * (nfl_player_prop_predictions), reported separately in the admin panel.
 *
 * Protocol: dispersion parameters are fit on TRAIN seasons, evaluated on later
 * seasons. Features are point-in-time (buildPropFeatures drops rows ≥ week).
 * Metrics here are PROP-ONLY — never mixed with game-engine metrics.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolveServiceCredentials } from "./credentials.ts";
import { join } from "node:path";
import type { NflGameRow, NflInjuryRow, NflPlayerWeekRow, NflTeamWeekRow } from "../../supabase/functions/_shared/nfl/data/types.ts";
import { aggregatePositionAllowed, type NflPositionAllowedRow } from "../../supabase/functions/_shared/nfl/data/position_allowed.ts";
import { buildPropFeatures, statValue, type PropFeatureInput } from "../../supabase/functions/_shared/nfl/prop/features.ts";
import { projectPlayer, type PropProjection } from "../../supabase/functions/_shared/nfl/prop/projection.ts";
import { propDistribution } from "../../supabase/functions/_shared/nfl/prop/stat_models.ts";
import {
  DEFAULT_PROP_PARAMS,
  NFL_PROP_MODEL_VERSION,
  PROP_TYPES_BY_POSITION,
  type NflPropType,
  type PropDistributionParams,
  type PropModelWeights,
} from "../../supabase/functions/_shared/nfl/prop/weights.ts";
import { pmfCdf, pmfMean, probVsLine, type IntPmf } from "../../supabase/functions/_shared/nfl/distributions.ts";

const CACHE = ".cache/nfl";
const TRAIN = [2021, 2022];
const TEST = [2023, 2024, 2025];
const MIN_WEEK = 3; // need some current-season sample

interface Sample {
  season: number;
  week: number;
  position: string;
  stat: NflPropType;
  proj: PropProjection;
  actual: number;
  proxyLine: number | null;
  dataQuality: number;
}

const loadJson = async <T>(p: string): Promise<T> => JSON.parse(await readFile(p, "utf8")) as T;

async function loadSeason(s: number) {
  const d = join(CACHE, String(s));
  return {
    team: await loadJson<NflTeamWeekRow[]>(join(d, "team_week.json")),
    players: await loadJson<NflPlayerWeekRow[]>(join(d, "player_week.json")),
    injuries: await loadJson<NflInjuryRow[]>(join(d, "injuries.json")),
  };
}

/**
 * Pregame eligibility — decided from the player's PREVIOUS appearance only,
 * never from the target game (that would drop early injury exits and leak
 * the outcome into the sample). A player with no row in the target game did
 * not play; sportsbooks void those props, so they are excluded.
 */
function eligibleBefore(prev: NflPlayerWeekRow | undefined): boolean {
  if (!prev) return false;
  if (prev.position === "K") return prev.fg_att + prev.pat_att > 0;
  if (prev.position === "QB") return prev.pass_attempts >= 15;
  return (prev.offense_pct ?? 0) >= 0.3;
}

async function buildSamples(seasons: number[]): Promise<Sample[]> {
  const games = await loadJson<NflGameRow[]>(join(CACHE, "games.json"));
  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const samples: Sample[] = [];
  for (const season of seasons) {
    const prev = await loadSeason(season - 1);
    const cur = await loadSeason(season);
    const teamWeeks = [...prev.team, ...cur.team];
    const players = [...prev.players, ...cur.players];
    const allowedAll: NflPositionAllowedRow[] = aggregatePositionAllowed(players);
    const allowedByPos = new Map<string, NflPositionAllowedRow[]>();
    for (const a of allowedAll) allowedByPos.set(a.position, [...(allowedByPos.get(a.position) ?? []), a]);
    const byTeam = new Map<string, NflPlayerWeekRow[]>();
    const byPlayer = new Map<string, NflPlayerWeekRow[]>();
    for (const p of players) {
      byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
      byPlayer.set(p.player_id, [...(byPlayer.get(p.player_id) ?? []), p]);
    }
    const injByTeamWeek = new Map<string, NflInjuryRow[]>();
    for (const i of cur.injuries) {
      const k = `${i.team}|${i.week}`;
      injByTeamWeek.set(k, [...(injByTeamWeek.get(k) ?? []), i]);
    }

    const lastBefore = (r: NflPlayerWeekRow) => (byPlayer.get(r.player_id) ?? [])
      .filter((p) => p.season < r.season || (p.season === r.season && p.week < r.week))
      .reduce<NflPlayerWeekRow | undefined>((a, b) => (!a || b.season > a.season || (b.season === a.season && b.week > a.week) ? b : a), undefined);
    const targets = cur.players.filter((r) => r.week >= MIN_WEEK && eligibleBefore(lastBefore(r)));
    for (const r of targets) {
      const g = gameById.get(r.game_id);
      if (!g) continue;
      const isHome = g.home_team === r.team;
      // Historical sportsbook game lines (closing) as the market context.
      const teamSpread = g.spread_line === null ? null : (isHome ? -g.spread_line : g.spread_line);
      const input: PropFeatureInput = {
        player: { player_id: r.player_id, player_name: r.player_name, position: r.position, team: r.team },
        game: {
          game_id: r.game_id, season, week: r.week, team: r.team, opponent: r.opponent, is_home: isHome,
          roof: g.roof, temp: g.temp, wind: g.wind, precip_prob: null,
          weather_source: g.temp !== null || g.wind !== null ? "schedule" : "none",
          team_rest: isHome ? g.home_rest : g.away_rest, opp_rest: isHome ? g.away_rest : g.home_rest,
        },
        market_context: { team_spread: teamSpread, game_total: g.total_line },
        teamPlayerRows: byTeam.get(r.team) ?? [],
        playerRows: byPlayer.get(r.player_id) ?? [],
        teamWeeks,
        positionAllowed: allowedByPos.get(r.position) ?? [],
        injuries: injByTeamWeek.get(`${r.team}|${r.week}`) ?? [],
      };
      for (const stat of PROP_TYPES_BY_POSITION[r.position] ?? []) {
        const fv = buildPropFeatures(input, stat);
        if (fv.usage.sample_games < 3) continue;
        const proj = projectPlayer(fv);
        const l5 = fv.usage.stat_l5;
        const proxyLine = stat === "anytime_td" ? 0.5 : l5 === null ? null : Math.floor(l5) + 0.5;
        samples.push({ season, week: r.week, position: r.position, stat, proj, actual: statValue(r, stat), proxyLine, dataQuality: fv.data_quality });
      }
    }
    console.log(`[backtest-prop] ${season}: ${samples.filter((s) => s.season === season).length} player-prop samples`);
  }
  return samples;
}

// ─── Scoring ─────────────────────────────────────────────────────────────

function nll(pmf: IntPmf, x: number): number {
  const i = Math.round(x) - pmf.offset;
  const p = i >= 0 && i < pmf.p.length ? pmf.p[i] : 0;
  return -Math.log(Math.max(p, 1e-9));
}

/**
 * Randomized PIT for a discrete outcome: F(x−1) + V·P(X = x), V ~ U(0,1).
 * Uniform iff the forecast is calibrated. A seeded LCG keeps runs reproducible.
 */
let seed = 12345;
function uniform(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pit(pmf: IntPmf, x: number): number {
  const below = pmfCdf(pmf, Math.round(x) - 1);
  const at = pmfCdf(pmf, Math.round(x)) - below;
  return below + uniform() * at;
}

function histEce(values: number[], bins = 10): number {
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(v * bins))]++;
  return counts.reduce((a, c) => a + Math.abs(c / values.length - 1 / bins), 0) / 2;
}

function pitHist(values: number[], bins = 10): number[] {
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(v * bins))]++;
  return counts.map((c) => round(c / values.length, 3));
}

function calibrationEce(probs: number[], ys: number[], bins = 10): number {
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const idx = probs.map((p, i) => (Math.min(bins - 1, Math.floor(p * bins)) === b ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const pred = idx.reduce((a, i) => a + probs[i], 0) / idx.length;
    const obs = idx.reduce((a, i) => a + ys[i], 0) / idx.length;
    e += (idx.length / probs.length) * Math.abs(pred - obs);
  }
  return e;
}

/** Which dispersion/CV parameter each stat depends on. */
const PARAM_OF: Partial<Record<NflPropType, Array<[keyof PropDistributionParams, string]>>> = {
  targets: [["dispersion", "targets"]],
  receptions: [["dispersion", "targets"]],
  rec_yds: [["dispersion", "targets"], ["per_unit_cv", "rec"]],
  rush_att: [["dispersion", "carries"]],
  rush_yds: [["dispersion", "carries"], ["per_unit_cv", "rush"]],
  pass_att: [["dispersion", "pass_att"]],
  pass_cmp: [["dispersion", "pass_att"]],
  pass_yds: [["dispersion", "pass_att"], ["per_unit_cv", "pass"]],
};

const GRID: Record<string, number[]> = {
  "dispersion.targets": [3, 4, 6, 8, 12, 20],
  "dispersion.carries": [3, 4, 6, 8, 12, 20],
  "dispersion.pass_att": [2, 3, 4, 6, 8, 15, 30],
  "dispersion.qb_carries": [1, 1.5, 2, 3, 5],
  "per_unit_cv.rec": [0.7, 0.85, 1.0, 1.15, 1.3, 1.5],
  "per_unit_cv.rush": [1.0, 1.3, 1.6, 1.9, 2.3],
  "per_unit_cv.pass": [0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1.05],
};

function setParam(p: PropDistributionParams, key: string, v: number): PropDistributionParams {
  const [group, name] = key.split(".") as [keyof PropDistributionParams, string];
  return { ...p, [group]: { ...(p[group] as Record<string, number>), [name]: v } } as PropDistributionParams;
}

/**
 * Level calibration: Σ actual / Σ projected per layer, fit sequentially on
 * TRAIN samples (opportunities first, then efficiency given the corrected
 * opportunities). Clamped to ±25% so a bad season cannot distort the model.
 */
function fitScales(train: Sample[]): PropDistributionParams["scale"] {
  const scale = { ...DEFAULT_PROP_PARAMS.scale };
  const ratio = (rows: Sample[], proj: (s: Sample) => number) => {
    const a = rows.reduce((x, s) => x + s.actual, 0);
    const p = rows.reduce((x, s) => x + proj(s), 0);
    return p > 0 ? Math.max(0.75, Math.min(1.25, a / p)) : 1;
  };
  const of = (stat: NflPropType, qb?: boolean) =>
    train.filter((s) => s.stat === stat && (qb === undefined || (s.position === "QB") === qb));
  scale.targets = ratio(of("targets"), (s) => s.proj.targets);
  scale.catch = ratio(of("receptions"), (s) => s.proj.targets * scale.targets * s.proj.catch_rate);
  scale.ypr = ratio(of("rec_yds"), (s) => s.proj.targets * scale.targets * s.proj.catch_rate * scale.catch * s.proj.yards_per_reception);
  scale.carries = ratio(of("rush_att", false), (s) => s.proj.carries);
  scale.qb_carries = ratio(of("rush_att", true), (s) => s.proj.carries);
  scale.ypc = ratio(of("rush_yds"), (s) => s.proj.carries * (s.position === "QB" ? scale.qb_carries : scale.carries) * s.proj.yards_per_carry);
  scale.pass_att = ratio(of("pass_att"), (s) => s.proj.pass_att);
  scale.cmp = ratio(of("pass_cmp"), (s) => s.proj.pass_att * scale.pass_att * s.proj.completion_pct);
  scale.ypcmp = ratio(of("pass_yds"), (s) => s.proj.pass_att * scale.pass_att * s.proj.completion_pct * scale.cmp * s.proj.yards_per_completion);
  scale.pass_td = ratio(of("pass_tds"), (s) => s.proj.pass_att * scale.pass_att * s.proj.pass_td_rate);
  scale.int = ratio(of("pass_ints"), (s) => s.proj.pass_att * scale.pass_att * s.proj.int_rate);
  // Anytime TD is binary; calibrate λ by matching P(≥1) in aggregate.
  const td = of("anytime_td");
  let lo = 0.5, hi = 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const pred = td.reduce((x, s) => x + 1 - Math.exp(-mid * (s.proj.rec_td_lambda + s.proj.rush_td_lambda)), 0);
    if (pred > td.reduce((x, s) => x + s.actual, 0)) hi = mid; else lo = mid;
  }
  scale.td = Math.max(0.75, Math.min(1.25, (lo + hi) / 2));
  scale.fg = ratio(of("fg_made"), (s) => s.proj.fg_att * s.proj.fg_pct);
  scale.xp = ratio(of("xp_made"), (s) => s.proj.xp_mean);
  for (const k of Object.keys(scale) as Array<keyof typeof scale>) scale[k] = round(scale[k], 4);
  console.log(`[backtest-prop] fitted mean scales ${JSON.stringify(scale)}`);
  return scale;
}

function fitParams(train: Sample[]): PropDistributionParams {
  let params: PropDistributionParams = structuredClone(DEFAULT_PROP_PARAMS);
  params.scale = fitScales(train);
  // Counts first (they feed the yardage compounds), then per-unit CVs.
  // QB passing: joint grid over the early-exit mixture and body dispersion.
  {
    const rows = train.filter((s) => s.stat === "pass_att");
    let best = { prob: 0, r: params.dispersion.pass_att, score: Infinity };
    for (const prob of [0, 0.04, 0.07, 0.1, 0.14, 0.18]) {
      for (const r of [8, 15, 30, 60, 120, 400]) {
        const trial: PropDistributionParams = { ...params, qb_early_exit: { prob, fraction: 0.3 }, dispersion: { ...params.dispersion, pass_att: r } };
        const score = rows.reduce((a, s) => a + nll(propDistribution("pass_att", s.proj, trial, s.position).pmf, s.actual), 0) / rows.length;
        if (score < best.score) best = { prob, r, score };
      }
    }
    params = { ...params, qb_early_exit: { prob: best.prob, fraction: 0.3 }, dispersion: { ...params.dispersion, pass_att: best.r } };
    console.log(`[backtest-prop] fit qb_early_exit.prob = ${best.prob}, dispersion.pass_att = ${best.r} (NLL ${best.score.toFixed(4)})`);
  }
  const order = ["dispersion.targets", "dispersion.carries", "dispersion.qb_carries",
    "per_unit_cv.rec", "per_unit_cv.rush", "per_unit_cv.pass"];
  for (const key of order) {
    const stats: NflPropType[] = key === "dispersion.targets" ? ["targets", "receptions"]
      : key === "dispersion.carries" ? ["rush_att"]
      : key === "dispersion.pass_att" ? ["pass_att", "pass_cmp"]
      : key === "dispersion.qb_carries" ? ["rush_att"]
      : key === "per_unit_cv.rec" ? ["rec_yds"]
      : key === "per_unit_cv.rush" ? ["rush_yds"]
      : ["pass_yds"];
    const qbOnly = key === "dispersion.qb_carries";
    const sub = train.filter((s) => stats.includes(s.stat) &&
      (key.includes("carries") || key.includes("rush") ? (qbOnly ? s.position === "QB" : s.position !== "QB") : true));
    // Subsample for speed; the grid is 1-D so a few thousand rows is plenty.
    const rows = sub.filter((_, i) => i % Math.max(1, Math.floor(sub.length / 4000)) === 0);
    let best = { v: 0, score: Infinity };
    for (const v of GRID[key]) {
      const trial = setParam(params, key, v);
      const score = rows.reduce((a, s) => a + nll(propDistribution(s.stat, s.proj, trial, s.position).pmf, s.actual), 0) / rows.length;
      if (score < best.score) best = { v, score };
    }
    params = setParam(params, key, best.v);
    console.log(`[backtest-prop] fit ${key} = ${best.v} (NLL ${best.score.toFixed(4)}, n=${rows.length})`);
  }
  return params;
}

interface Pick { stat: string; position: string; edge: number; conf: number; win: boolean; push: boolean }

function summarize(picks: Pick[]) {
  const decided = picks.filter((p) => !p.push);
  const wins = decided.filter((p) => p.win).length;
  const profit = wins * (100 / 110) - (decided.length - wins);
  return {
    bets: picks.length,
    hit_rate: decided.length ? round(wins / decided.length) : null,
    roi_at_minus110: picks.length ? round(profit / picks.length) : null,
  };
}

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const train = await buildSamples(TRAIN);
  const params = fitParams(train);
  const test = await buildSamples(TEST);

  const perStat: Record<string, unknown> = {};
  const calibration: PropModelWeights["calibration"] = {};
  const picks: Pick[] = [];
  for (const [stat, rows] of Object.entries(groupBy(test, (s) => s.stat))) {
    const errs: number[] = [], pits: number[] = [], overP: number[] = [], overY: number[] = [];
    for (const s of rows) {
      const pmf = propDistribution(s.stat, s.proj, params, s.position).pmf;
      errs.push(pmfMean(pmf) - s.actual);
      pits.push(pit(pmf, s.actual));
      if (s.proxyLine !== null) {
        const pr = probVsLine(pmf, s.proxyLine);
        const pOver = pr.over / Math.max(pr.over + pr.under, 1e-9);
        if (s.actual !== s.proxyLine) { overP.push(pOver); overY.push(s.actual > s.proxyLine ? 1 : 0); }
        // Proxy "bet": model side when it clears a 4% edge vs a fair 50/50 line.
        const edge = Math.abs(pOver - 0.5);
        if (edge >= 0.04 && s.stat !== "anytime_td") {
          const over = pOver > 0.5;
          const push = s.actual === s.proxyLine;
          picks.push({ stat, position: s.position, edge, conf: s.dataQuality, push, win: !push && (over ? s.actual > s.proxyLine : s.actual < s.proxyLine) });
        }
      }
    }
    const mae = errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length;
    const rmse = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
    const pitEce = histEce(pits);
    const overEce = overP.length ? calibrationEce(overP, overY) : null;
    perStat[stat] = { n: rows.length, mae: round(mae, 3), rmse: round(rmse, 3), bias: round(errs.reduce((a, b) => a + b, 0) / errs.length, 3), pit_ece: round(pitEce), pit_hist: pitHist(pits), over_ece_proxy_line: overEce === null ? null : round(overEce) };
    calibration[stat as NflPropType] = { pit_ece: round(pitEce), over_ece: round(overEce ?? pitEce), n: rows.length, mae: round(mae, 3) };
  }

  const report = {
    engine: "nfl_player_prop_edge",
    model_version: NFL_PROP_MODEL_VERSION,
    train_seasons: TRAIN,
    test_seasons: TEST,
    generated_at: new Date().toISOString(),
    fitted_params: params,
    by_prop_type: perStat,
    proxy_line_backtest: {
      proxy_line: true,
      note: "Lines are the player's L5 average rounded to .5 at an assumed -110; not sportsbook prices, not evidence of market edge.",
      overall: summarize(picks),
      by_prop_type: Object.fromEntries(Object.entries(groupBy(picks, (p) => p.stat)).map(([k, v]) => [k, summarize(v)])),
      by_position: Object.fromEntries(Object.entries(groupBy(picks, (p) => p.position)).map(([k, v]) => [k, summarize(v)])),
      by_edge_bucket: Object.fromEntries(Object.entries(groupBy(picks, (p) => (p.edge < 0.07 ? "4-7%" : p.edge < 0.12 ? "7-12%" : "12%+"))).map(([k, v]) => [k, summarize(v)])),
      by_data_quality_bucket: Object.fromEntries(Object.entries(groupBy(picks, (p) => (p.conf < 0.7 ? "<0.7" : p.conf < 0.85 ? "0.7-0.85" : "0.85+"))).map(([k, v]) => [k, summarize(v)])),
    },
    clv: { available: false, note: "No historical prop prices; CLV is tracked on live predictions only." },
  };
  await writeFile(join(CACHE, `backtest-prop-${NFL_PROP_MODEL_VERSION}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ fitted_params: params, by_prop_type: perStat, proxy_line_backtest: report.proxy_line_backtest }, null, 2));

  const weights: PropModelWeights = {
    version: NFL_PROP_MODEL_VERSION,
    params,
    calibration,
    trained_on: `dispersion fit ${TRAIN.join(",")}; evaluated ${TEST.join(",")}`,
    fitted_at: new Date().toISOString(),
  };
  if (args.has("--write-weights")) {
    const path = "supabase/functions/_shared/nfl/prop/weights_fitted.ts";
    await writeFile(path, `/**
 * GENERATED by \`node scripts/nfl/backtest-prop.ts --write-weights\` — do not hand-edit.
 *
 * NFL PLAYER PROP EDGE ENGINE fitted distribution parameters (${weights.version}).
 * ${weights.trained_on}. Calibration entries are out-of-sample (test seasons).
 */

import type { PropModelWeights } from "./weights.ts";

export const NFL_PROP_FITTED_WEIGHTS: PropModelWeights = ${JSON.stringify(weights, null, 2)};
`);
    console.log(`[backtest-prop] wrote ${path}`);
  }
  if (args.has("--upload")) {
    const creds = resolveServiceCredentials(process.argv.slice(2));
    if (!creds) { console.warn("[backtest-prop] --upload needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or --linked"); return; }
    const client = (await import("@supabase/supabase-js")).createClient(creds.url, creds.key, { auth: { persistSession: false } });
    const { error } = await client.from("nfl_player_prop_backtest_runs").insert({
      model_version: weights.version,
      seasons: `${TEST[0]}-${TEST[TEST.length - 1]}`,
      market_source: "proxy lines (L5 average), no historical prices",
      metrics: report,
      params,
    });
    if (error) throw new Error(`nfl_player_prop_backtest_runs insert failed: ${error.message}`);
    console.log("[backtest-prop] uploaded run");
  }
}

main().catch((e) => {
  console.error("[backtest-prop] FAILED", e);
  process.exit(1);
});
