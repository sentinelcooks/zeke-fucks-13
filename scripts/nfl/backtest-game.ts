/**
 * NFL GAME EDGE ENGINE — walk-forward fit + backtest.
 *
 *   node scripts/nfl/backtest-game.ts                    # report only
 *   node scripts/nfl/backtest-game.ts --write-weights    # also regenerate weights_fitted.ts
 *   node scripts/nfl/backtest-game.ts --upload           # also insert into nfl_game_backtest_runs
 *
 * Requires the local cache from `node scripts/nfl/ingest.ts --seasons 2017-<last>`.
 *
 * Protocol (no leakage):
 *   - Features for a game use only rows strictly before its (season, week).
 *   - Test season S is predicted by models fit on seasons < S.
 *   - Calibration for S is fit on out-of-sample predictions from seasons < S.
 *   - The market is nflverse CLOSING lines, so a bet here is a bet at the close
 *     (CLV is 0 by construction and is not reported from this source).
 *
 * Metrics are GAME-ONLY. Player props are backtested separately
 * (scripts/nfl/backtest-prop.ts) and never mixed into these numbers.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolveServiceCredentials } from "./credentials.ts";
import { join } from "node:path";
import type {
  NflGameRow,
  NflInjuryRow,
  NflMarketQuote,
  NflPlayerWeekRow,
  NflTeamWeekRow,
} from "../../supabase/functions/_shared/nfl/data/types.ts";
import { buildGameFeatures, SIDE_FEATURES, TOTAL_FEATURES, type GameFeatureVector } from "../../supabase/functions/_shared/nfl/game/features.ts";
import { buildTeamProfiles } from "../../supabase/functions/_shared/nfl/game/ratings.ts";
import {
  fitLogisticRidge,
  fitPlattOnProbs,
  fitRidge,
  predictLinear,
  predictLogistic,
  type LinearModel,
} from "../../supabase/functions/_shared/nfl/game/fit.ts";
import { MARGIN_RANGE, NFL_GAME_MODEL_VERSION, TOTAL_RANGE, type GameModelWeights } from "../../supabase/functions/_shared/nfl/game/weights.ts";
import { calculate_nfl_game_edge, type NflGameEdgeResult } from "../../supabase/functions/_shared/nfl/game/index.ts";
import type { CalibrationEvidence } from "../../supabase/functions/_shared/nfl/game/confidence.ts";
import { americanToImplied, brier, devigPair, logLoss } from "../../supabase/functions/_shared/prob_math.ts";
import { keyedDiscreteNormal, normalCdf, probVsLine } from "../../supabase/functions/_shared/nfl/distributions.ts";

const CACHE = ".cache/nfl";
const FIRST_TRAIN_SEASON = 2018;
const FIRST_OOS_SEASON = 2020; // OOS predictions start here (calibration source)
const FIRST_EVAL_SEASON = 2021; // reported walk-forward seasons start here
const LAMBDAS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10];

export interface Row {
  game: NflGameRow;
  fv: GameFeatureVector;
  side: number[];
  total: number[];
  lgPpg: number;
  margin: number;
  totalPts: number;
  homeWin: number; // 1, 0, or 0.5 (tie)
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function loadSeason(season: number) {
  const dir = join(CACHE, String(season));
  return {
    team: await loadJson<NflTeamWeekRow[]>(join(dir, "team_week.json")),
    players: await loadJson<NflPlayerWeekRow[]>(join(dir, "player_week.json")),
    injuries: await loadJson<NflInjuryRow[]>(join(dir, "injuries.json")),
  };
}

export async function buildRows(lastSeason: number): Promise<Row[]> {
  const games = await loadJson<NflGameRow[]>(join(CACHE, "games.json"));
  const rows: Row[] = [];
  let prev = await loadSeason(FIRST_TRAIN_SEASON - 1);
  for (let season = FIRST_TRAIN_SEASON; season <= lastSeason; season++) {
    const cur = await loadSeason(season);
    const teamWeeks = [...prev.team, ...cur.team];
    const players = [...prev.players, ...cur.players];
    const seasonGames = games.filter((g) =>
      g.season === season && g.home_score !== null && g.away_score !== null);
    const weeks = [...new Set(seasonGames.map((g) => g.week))].sort((a, b) => a - b);
    for (const week of weeks) {
      const profiles = buildTeamProfiles(teamWeeks, season, week);
      for (const game of seasonGames.filter((g) => g.week === week)) {
        const fv = buildGameFeatures({
          game,
          teamWeeks,
          playerWeeks: players,
          injuries: cur.injuries,
          weather: {
            temp: game.temp,
            wind: game.wind,
            precip_prob: null,
            roof: game.roof,
            source: game.temp !== null || game.wind !== null ? "schedule" : "none",
          },
          movement: null,
          profiles,
        });
        const margin = game.home_score! - game.away_score!;
        rows.push({
          game,
          fv,
          side: SIDE_FEATURES.map((f) => fv.side[f]),
          total: TOTAL_FEATURES.map((f) => fv.total[f]),
          lgPpg: fv.league.points_per_game,
          margin,
          totalPts: game.home_score! + game.away_score!,
          homeWin: margin > 0 ? 1 : margin < 0 ? 0 : 0.5,
        });
      }
    }
    console.log(`[backtest-game] features ${season}: ${rows.filter((r) => r.game.season === season).length} games`);
    prev = cur;
  }
  return rows;
}

// ─── Fitting ──────────────────────────────────────────────────────────────

export interface FoldModels {
  margin: LinearModel;
  moneyline: LinearModel;
  total: LinearModel;
  lambdas: { margin: number; moneyline: number; total: number };
}

export function fitModels(train: Row[], lambdas: FoldModels["lambdas"]): FoldModels {
  const decided = train.filter((r) => r.homeWin !== 0.5);
  return {
    margin: fitRidge(train.map((r) => r.side), train.map((r) => r.margin), [...SIDE_FEATURES], lambdas.margin, false),
    moneyline: fitLogisticRidge(decided.map((r) => r.side), decided.map((r) => r.homeWin), [...SIDE_FEATURES], lambdas.moneyline, false),
    total: fitRidge(train.map((r) => r.total), train.map((r) => r.totalPts - 2 * r.lgPpg), [...TOTAL_FEATURES], lambdas.total, true),
    lambdas,
  };
}

/** Pick each model's lambda on the last training season (inner validation). */
export function chooseLambdas(train: Row[]): FoldModels["lambdas"] {
  const lastSeason = Math.max(...train.map((r) => r.game.season));
  const inner = train.filter((r) => r.game.season < lastSeason);
  const val = train.filter((r) => r.game.season === lastSeason);
  const best = { margin: LAMBDAS[0], moneyline: LAMBDAS[0], total: LAMBDAS[0] };
  const scores = { margin: Infinity, moneyline: Infinity, total: Infinity };
  for (const l of LAMBDAS) {
    const m = fitModels(inner, { margin: l, moneyline: l, total: l });
    const mse = (xs: number[]) => xs.reduce((a, b) => a + b * b, 0) / xs.length;
    const sMargin = mse(val.map((r) => predictLinear(m.margin, r.side) - r.margin));
    const sTotal = mse(val.map((r) => predictLinear(m.total, r.total) + 2 * r.lgPpg - r.totalPts));
    const dec = val.filter((r) => r.homeWin !== 0.5);
    const sMl = logLoss(dec.map((r) => predictLogistic(m.moneyline, r.side)), dec.map((r) => r.homeWin));
    if (sMargin < scores.margin) { scores.margin = sMargin; best.margin = l; }
    if (sMl < scores.moneyline) { scores.moneyline = sMl; best.moneyline = l; }
    if (sTotal < scores.total) { scores.total = sTotal; best.total = l; }
  }
  return best;
}

/**
 * Key-number weights: observed frequency of each integer outcome divided by
 * the frequency a smooth normal would give, shrunk toward 1.
 */
export function keyWeights(values: number[], lo: number, hi: number, symmetric: boolean): Record<number, number> {
  const n = values.length;
  const mean = symmetric ? 0 : values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const counts = new Map<number, number>();
  for (const v of values) {
    const k = symmetric ? Math.abs(v) : v;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: Record<number, number> = {};
  const PSEUDO = 15; // expected-count pseudo-observations
  for (let k = symmetric ? 0 : lo; k <= hi; k++) {
    const mass = normalCdf((k + 0.5 - mean) / sd) - normalCdf((k - 0.5 - mean) / sd);
    const expected = n * (symmetric && k > 0 ? 2 * mass : mass);
    if (expected <= 0) continue;
    const obs = counts.get(k) ?? 0;
    const w = Math.max(0.1, Math.min(3, (obs + PSEUDO) / (expected + PSEUDO)));
    const rounded = Math.round(w * 1000) / 1000;
    out[k] = rounded;
    if (symmetric && k > 0) out[-k] = rounded;
  }
  return out;
}

export function residualSd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(xs.length - 1, 1));
}

// ─── Evaluation helpers ──────────────────────────────────────────────────

function ece(probs: number[], outcomes: number[], bins = 10): { ece: number; bins: Array<{ lo: number; n: number; pred: number; obs: number }> } {
  const out: Array<{ lo: number; n: number; pred: number; obs: number }> = [];
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = probs.map((p, i) => (p >= lo && (p < hi || (b === bins - 1 && p <= 1)) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const pred = idx.reduce((a, i) => a + probs[i], 0) / idx.length;
    const obs = idx.reduce((a, i) => a + outcomes[i], 0) / idx.length;
    e += (idx.length / probs.length) * Math.abs(pred - obs);
    out.push({ lo, n: idx.length, pred: round(pred, 4), obs: round(obs, 4) });
  }
  return { ece: e, bins: out };
}

function round(x: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function quote(line: number | null, a: number | null, b: number | null): NflMarketQuote | null {
  if (a === null || b === null) return null;
  return {
    current: { line, price_a: a, price_b: b },
    opening: null,
    best_price_a: null,
    best_book_a: null,
    best_price_b: null,
    best_book_b: null,
    books: 6, // closing consensus; liquidity assumed deep at the close
    snapshot_at: null,
  };
}

interface BetRecord {
  season: number;
  market: string;
  edge: number;
  confidence: number;
  price: number;
  profit: number; // units, 1u stake
  outcome: "win" | "loss" | "push";
}

function settle(r: NflGameEdgeResult, row: Row): BetRecord {
  let outcome: BetRecord["outcome"];
  if (r.market_type === "moneyline") {
    if (row.margin === 0) outcome = "push";
    else outcome = (r.side === "home") === (row.margin > 0) ? "win" : "loss";
  } else if (r.market_type === "spread") {
    const homeAdj = row.margin + (r.side === "home" ? r.line! : -r.line!);
    if (homeAdj === 0) outcome = "push";
    else outcome = (r.side === "home") === (homeAdj > 0) ? "win" : "loss";
  } else {
    const diff = row.totalPts - r.line!;
    if (diff === 0) outcome = "push";
    else outcome = (r.side === "over") === (diff > 0) ? "win" : "loss";
  }
  const dec = r.market_price > 0 ? r.market_price / 100 : 100 / -r.market_price;
  const profit = outcome === "win" ? dec : outcome === "loss" ? -1 : 0;
  return { season: row.game.season, market: r.market_type, edge: r.edge_percentage, confidence: r.confidence, price: r.market_price, profit, outcome };
}

function summarizeBets(bets: BetRecord[]) {
  const wins = bets.filter((b) => b.outcome === "win").length;
  const losses = bets.filter((b) => b.outcome === "loss").length;
  const pushes = bets.length - wins - losses;
  const profit = bets.reduce((a, b) => a + b.profit, 0);
  return {
    bets: bets.length,
    record: `${wins}-${losses}-${pushes}`,
    win_rate: wins + losses ? round(wins / (wins + losses)) : null,
    profit_units: round(profit, 2),
    roi: bets.length ? round(profit / bets.length) : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const lastSeason = Number(process.env.NFL_BACKTEST_LAST_SEASON ?? 2025);
  const rows = await buildRows(lastSeason);

  // 1) Walk-forward OOS predictions (raw, uncalibrated) for FIRST_OOS_SEASON..last.
  const oos: Array<{ row: Row; pMlRaw: number; margin: number; total: number; lambdas: FoldModels["lambdas"] }> = [];
  for (let S = FIRST_OOS_SEASON; S <= lastSeason; S++) {
    const train = rows.filter((r) => r.game.season < S);
    const lambdas = chooseLambdas(train);
    const m = fitModels(train, lambdas);
    for (const row of rows.filter((r) => r.game.season === S)) {
      oos.push({
        row,
        pMlRaw: predictLogistic(m.moneyline, row.side),
        margin: predictLinear(m.margin, row.side),
        total: predictLinear(m.total, row.total) + 2 * row.lgPpg,
        lambdas,
      });
    }
    console.log(`[backtest-game] fold ${S}: lambdas ${JSON.stringify(lambdas)}`);
  }

  // 2) Evaluate each season with models fit on earlier seasons and calibration
  //    fit on OOS predictions from earlier seasons.
  const bets: BetRecord[] = [];
  const allSideBets: BetRecord[] = [];
  const mlEval: { p: number[]; y: number[]; market: number[] } = { p: [], y: [], market: [] };
  const spreadEval: { p: number[]; y: number[] } = { p: [], y: [] };
  const totalEval: { p: number[]; y: number[] } = { p: [], y: [] };
  const marginErr: number[] = [];
  const totalErr: number[] = [];
  // The closing line as a predictor — the benchmark the model has to beat.
  const marketMarginErr: number[] = [];
  const marketTotalErr: number[] = [];
  const perSeason: Record<string, unknown> = {};

  for (let S = FIRST_EVAL_SEASON; S <= lastSeason; S++) {
    const train = rows.filter((r) => r.game.season < S);
    const prior = oos.filter((o) => o.row.game.season < S);
    const lambdas = oos.find((o) => o.row.game.season === S)!.lambdas;
    const m = fitModels(train, lambdas);
    const decidedPrior = prior.filter((o) => o.row.homeWin !== 0.5);
    const weights = buildWeights(m, train, prior);
    const calibration = priorCalibrationEvidence(prior, weights);

    const seasonBets: BetRecord[] = [];
    for (const row of rows.filter((r) => r.game.season === S)) {
      const g = row.game;
      const homeSpread = g.spread_line === null ? null : -g.spread_line;
      const out = calculate_nfl_game_edge({
        features: row.fv,
        weights,
        markets: {
          moneyline: quote(null, g.home_moneyline, g.away_moneyline),
          spread: homeSpread === null ? null : quote(homeSpread, g.home_spread_odds ?? -110, g.away_spread_odds ?? -110),
          total: g.total_line === null ? null : quote(g.total_line, g.over_odds ?? -110, g.under_odds ?? -110),
        },
        calibration,
        // Evidence gates are DERIVED from this backtest, so they cannot gate it.
        gates: { respect_backtest_evidence: false },
        now: `${g.gameday}T00:00:00Z`,
      });

      // Probabilistic accuracy (every game, no gating).
      const mlHome = out.results.find((r) => r.market_type === "moneyline" && r.side === "home");
      if (mlHome && row.homeWin !== 0.5) {
        mlEval.p.push(mlHome.model_probability);
        mlEval.y.push(row.homeWin);
        mlEval.market.push(mlHome.no_vig_probability);
      }
      const spHome = out.results.find((r) => r.market_type === "spread" && r.side === "home");
      if (spHome) {
        const adj = row.margin + spHome.line!;
        if (adj !== 0) { spreadEval.p.push(spHome.model_probability); spreadEval.y.push(adj > 0 ? 1 : 0); }
      }
      const over = out.results.find((r) => r.market_type === "total" && r.side === "over");
      if (over && row.totalPts !== over.line) {
        totalEval.p.push(over.model_probability);
        totalEval.y.push(row.totalPts > over.line! ? 1 : 0);
      }
      marginErr.push(out.projections.projected_margin - row.margin);
      totalErr.push(out.projections.projected_total - row.totalPts);
      if (g.spread_line !== null) marketMarginErr.push(g.spread_line - row.margin);
      if (g.total_line !== null) marketTotalErr.push(g.total_line - row.totalPts);

      // Gated picks (the product) and ungated "model side" (every game).
      for (const r of out.results) if (r.status === "PLAY") seasonBets.push(settle(r, row));
      for (const market of ["spread", "total"] as const) {
        const sides = out.results.filter((r) => r.market_type === market);
        if (sides.length === 2) {
          const pick = sides[0].model_probability >= sides[1].model_probability ? sides[0] : sides[1];
          allSideBets.push(settle(pick, row));
        }
      }
    }
    bets.push(...seasonBets);
    perSeason[S] = {
      games: rows.filter((r) => r.game.season === S).length,
      lambdas,
      calibration_source_games: decidedPrior.length,
      moneyline: summarizeBets(seasonBets.filter((b) => b.market === "moneyline")),
      spread: summarizeBets(seasonBets.filter((b) => b.market === "spread")),
      total: summarizeBets(seasonBets.filter((b) => b.market === "total")),
    };
  }

  const mlAcc = mlEval.p.filter((p, i) => (p > 0.5 ? 1 : 0) === mlEval.y[i]).length / mlEval.p.length;
  const report = {
    engine: "nfl_game_edge",
    model_version: NFL_GAME_MODEL_VERSION,
    seasons: `${FIRST_EVAL_SEASON}-${lastSeason}`,
    market_source: "nflverse closing lines",
    generated_at: new Date().toISOString(),
    moneyline: {
      games: mlEval.p.length,
      accuracy: round(mlAcc),
      brier: round(brier(mlEval.p, mlEval.y)),
      log_loss: round(logLoss(mlEval.p, mlEval.y)),
      market_brier: round(brier(mlEval.market, mlEval.y)),
      market_log_loss: round(logLoss(mlEval.market, mlEval.y)),
      calibration: ece(mlEval.p, mlEval.y),
      gated_bets: summarizeBets(bets.filter((b) => b.market === "moneyline")),
    },
    spread: {
      games: spreadEval.p.length,
      brier: round(brier(spreadEval.p, spreadEval.y)),
      calibration: ece(spreadEval.p, spreadEval.y),
      margin_mae: round(marginErr.reduce((a, b) => a + Math.abs(b), 0) / marginErr.length, 2),
      market_margin_mae: round(marketMarginErr.reduce((a, b) => a + Math.abs(b), 0) / marketMarginErr.length, 2),
      ats_all_games: summarizeBets(allSideBets.filter((b) => b.market === "spread")),
      gated_bets: summarizeBets(bets.filter((b) => b.market === "spread")),
    },
    total: {
      games: totalEval.p.length,
      brier: round(brier(totalEval.p, totalEval.y)),
      calibration: ece(totalEval.p, totalEval.y),
      total_mae: round(totalErr.reduce((a, b) => a + Math.abs(b), 0) / totalErr.length, 2),
      market_total_mae: round(marketTotalErr.reduce((a, b) => a + Math.abs(b), 0) / marketTotalErr.length, 2),
      ou_all_games: summarizeBets(allSideBets.filter((b) => b.market === "total")),
      gated_bets: summarizeBets(bets.filter((b) => b.market === "total")),
    },
    clv: { available: false, note: "Historical market is the closing line; CLV is tracked on live predictions only." },
    by_edge_bucket: bucket(bets, (b) => (b.edge < 5 ? "3-5%" : b.edge < 8 ? "5-8%" : "8%+")),
    by_confidence_bucket: bucket(bets, (b) => (b.confidence < 65 ? "60-65" : b.confidence < 70 ? "65-70" : "70+")),
    per_season: perSeason,
  };

  // 3) Production weights: fit on every season, calibrated on all OOS predictions.
  const finalLambdas = {
    margin: median(oos.map((o) => o.lambdas.margin)),
    moneyline: median(oos.map((o) => o.lambdas.moneyline)),
    total: median(oos.map((o) => o.lambdas.total)),
  };
  const finalModels = fitModels(rows, finalLambdas);
  const finalWeights = buildWeights(finalModels, rows, oos);
  finalWeights.evidence_gates = {
    moneyline: evidenceGate(bets.filter((b) => b.market === "moneyline")),
    spread: evidenceGate(bets.filter((b) => b.market === "spread")),
    total: evidenceGate(bets.filter((b) => b.market === "total")),
  };
  (report as Record<string, unknown>).evidence_gates = finalWeights.evidence_gates;
  finalWeights.trained_on = `${FIRST_TRAIN_SEASON}-${lastSeason} (walk-forward OOS calibration ${FIRST_OOS_SEASON}-${lastSeason})`;

  await writeFile(join(CACHE, `backtest-game-${NFL_GAME_MODEL_VERSION}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    moneyline: { ...report.moneyline, calibration: { ece: round(report.moneyline.calibration.ece) } },
    spread: { ...report.spread, calibration: { ece: round(report.spread.calibration.ece) } },
    total: { ...report.total, calibration: { ece: round(report.total.calibration.ece) } },
    by_edge_bucket: report.by_edge_bucket,
    by_confidence_bucket: report.by_confidence_bucket,
    evidence_gates: finalWeights.evidence_gates,
  }, null, 2));

  if (args.has("--write-weights")) {
    const path = "supabase/functions/_shared/nfl/game/weights_fitted.ts";
    await writeFile(path, renderWeights(finalWeights, report));
    console.log(`[backtest-game] wrote ${path}`);
  }
  if (args.has("--upload")) await upload(report, finalWeights);
}

function bucket(bets: BetRecord[], key: (b: BetRecord) => string) {
  const groups = new Map<string, BetRecord[]>();
  for (const b of bets) groups.set(key(b), [...(groups.get(key(b)) ?? []), b]);
  return Object.fromEntries([...groups].map(([k, v]) => [k, summarizeBets(v)]));
}

/**
 * Smallest edge threshold (3%..12%) at which the walk-forward gated bets had
 * positive ROI over at least MIN_EVIDENCE_BETS bets; null if none did.
 */
const MIN_EVIDENCE_BETS = 75;
function evidenceGate(bets: BetRecord[]): { min_edge: number; bets: number; roi: number } | null {
  for (let t = 3; t <= 12; t++) {
    const sub = bets.filter((b) => b.edge >= t);
    if (sub.length < MIN_EVIDENCE_BETS) break;
    const roi = sub.reduce((a, b) => a + b.profit, 0) / sub.length;
    if (roi > 0) return { min_edge: t / 100, bets: sub.length, roi: round(roi) };
  }
  return null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Assemble a full weights object; residual SDs and calibration come from OOS rows. */
function buildWeights(
  m: FoldModels,
  train: Row[],
  oosPrior: Array<{ row: Row; pMlRaw: number; margin: number; total: number }>,
): GameModelWeights {
  const haveOos = oosPrior.length >= 200;
  const marginResid = haveOos
    ? oosPrior.map((o) => o.margin - o.row.margin)
    : train.map((r) => predictLinear(m.margin, r.side) - r.margin);
  const totalResid = haveOos
    ? oosPrior.map((o) => o.total - o.row.totalPts)
    : train.map((r) => predictLinear(m.total, r.total) + 2 * r.lgPpg - r.totalPts);
  const inflate = haveOos ? 1 : 1.05;

  const base: GameModelWeights = {
    version: NFL_GAME_MODEL_VERSION,
    margin: m.margin,
    margin_sd: round(residualSd(marginResid) * inflate, 3),
    margin_key_weights: keyWeights(train.map((r) => r.margin), -28, 28, true),
    moneyline: m.moneyline,
    total: m.total,
    total_sd: round(residualSd(totalResid) * inflate, 3),
    total_key_weights: keyWeights(train.map((r) => r.totalPts), 20, 75, false),
    calibration: { moneyline: null, spread: null, total: null },
    // Filled from the walk-forward results in main(); fold models never read it
    // because the backtest runs with respect_backtest_evidence = false.
    evidence_gates: { moneyline: null, spread: null, total: null },
    trained_on: `${Math.min(...train.map((r) => r.game.season))}-${Math.max(...train.map((r) => r.game.season))}`,
    fitted_at: new Date().toISOString(),
  };
  if (!haveOos) return base;

  // Platt calibration on out-of-sample predictions only.
  const dec = oosPrior.filter((o) => o.row.homeWin !== 0.5);
  base.calibration.moneyline = fitPlattOnProbs(dec.map((o) => o.pMlRaw), dec.map((o) => o.row.homeWin));

  // Spread/total: raw conditional probabilities from each OOS projection at the closing line.
  const uncal: GameModelWeights = { ...base, calibration: { moneyline: null, spread: null, total: null } };
  const sp: number[] = [], sy: number[] = [], tp: number[] = [], ty: number[] = [];
  for (const o of oosPrior) {
    const g = o.row.game;
    if (g.spread_line !== null) {
      const adj = o.row.margin - g.spread_line;
      if (adj !== 0) {
        const p = rawCover(o.margin, uncal.margin_sd, uncal.margin_key_weights, -g.spread_line);
        sp.push(p); sy.push(adj > 0 ? 1 : 0);
      }
    }
    if (g.total_line !== null && o.row.totalPts !== g.total_line) {
      tp.push(rawOver(o.total, uncal.total_sd, uncal.total_key_weights, g.total_line));
      ty.push(o.row.totalPts > g.total_line ? 1 : 0);
    }
  }
  base.calibration.spread = fitPlattOnProbs(sp, sy);
  base.calibration.total = fitPlattOnProbs(tp, ty);
  return base;
}

function rawCover(margin: number, sd: number, kw: Record<number, number>, homeLine: number): number {
  const p = probVsLine(keyedDiscreteNormal(margin, sd, MARGIN_RANGE.lo, MARGIN_RANGE.hi, kw), -homeLine);
  return p.over / Math.max(p.over + p.under, 1e-9);
}

function rawOver(total: number, sd: number, kw: Record<number, number>, line: number): number {
  const p = probVsLine(keyedDiscreteNormal(total, sd, TOTAL_RANGE.lo, TOTAL_RANGE.hi, kw), line);
  return p.over / Math.max(p.over + p.under, 1e-9);
}

/** Calibration evidence for the confidence model, from OOS seasons before the test season. */
function priorCalibrationEvidence(
  prior: Array<{ row: Row; pMlRaw: number }>,
  w: GameModelWeights,
): Record<"moneyline" | "spread" | "total", CalibrationEvidence | null> {
  const dec = prior.filter((o) => o.row.homeWin !== 0.5);
  if (dec.length < 200 || !w.calibration.moneyline) return { moneyline: null, spread: null, total: null };
  const ps = dec.map((o) => {
    const q = Math.min(Math.max(o.pMlRaw, 1e-6), 1 - 1e-6);
    return 1 / (1 + Math.exp(-(w.calibration.moneyline!.a * Math.log(q / (1 - q)) + w.calibration.moneyline!.b)));
  });
  const ys = dec.map((o) => o.row.homeWin);
  // In-sample to the calibration fit, so this is optimistic; the ECE is floored
  // to avoid over-crediting confidence.
  const e = Math.max(ece(ps, ys).ece, 0.03);
  const ev: CalibrationEvidence = { ece: e, brier: brier(ps, ys), n: dec.length };
  return { moneyline: ev, spread: { ...ev }, total: { ...ev } };
}

function renderWeights(w: GameModelWeights, report: { moneyline: { brier: number; log_loss: number; accuracy: number }; spread: { margin_mae: number }; total: { total_mae: number } }): string {
  return `/**
 * GENERATED by \`node scripts/nfl/backtest-game.ts --write-weights\` — do not hand-edit.
 *
 * NFL GAME EDGE ENGINE fitted coefficients (${w.version}).
 * Trained on: ${w.trained_on}
 * Walk-forward OOS (${FIRST_EVAL_SEASON}+): ML accuracy ${report.moneyline.accuracy}, Brier ${report.moneyline.brier},
 * log loss ${report.moneyline.log_loss}; margin MAE ${report.spread.margin_mae}; total MAE ${report.total.total_mae}.
 */

import type { GameModelWeights } from "./weights.ts";

export const NFL_GAME_FITTED_WEIGHTS: GameModelWeights = ${JSON.stringify(w, null, 2)};
`;
}

async function upload(report: unknown, weights: GameModelWeights): Promise<void> {
  const creds = resolveServiceCredentials(process.argv.slice(2));
  if (!creds) {
    console.warn("[backtest-game] --upload needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or --linked");
    return;
  }
  const client = (await import("@supabase/supabase-js")).createClient(creds.url, creds.key, { auth: { persistSession: false } });
  const r = report as Record<string, any>;
  const { error } = await client.from("nfl_game_backtest_runs").insert({
    model_version: weights.version,
    seasons: r.seasons,
    market_source: r.market_source,
    metrics: r,
    params: { trained_on: weights.trained_on, margin_sd: weights.margin_sd, total_sd: weights.total_sd },
  });
  if (error) throw new Error(`nfl_game_backtest_runs insert failed: ${error.message}`);
  console.log("[backtest-game] uploaded run");
}

// Only run when executed directly (experiment-game.ts imports the builders).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/nfl/backtest-game.ts")) {
  main().catch((e) => {
    console.error("[backtest-game] FAILED", e);
    process.exit(1);
  });
}
