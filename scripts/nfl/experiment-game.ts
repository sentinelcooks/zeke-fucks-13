/**
 * NFL GAME EDGE — pre-registered model-variant experiment with a locked holdout.
 *
 *   node scripts/nfl/experiment-game.ts
 *
 * PROTOCOL (fixed before any results were seen — do not edit after running):
 *   - Base models: the v1 ridge/logistic models, re-fit walk-forward so every
 *     projection for season S comes from models trained on seasons < S.
 *   - Variants (per market):
 *       V0  raw v1 probability, bet when edge ≥ 3%
 *       V1  market-residual layer: logistic on [market, model − market,
 *           situational terms], fit on out-of-sample rows from earlier
 *           seasons; bet when edge ≥ 3%
 *       V2  V1 with edge ≥ 5%
 *       V3  V1, edge ≥ 2%, only when |model − market| ≥ 3 pts (spread) / 4 pts
 *           (total) / 0.08 win-prob (moneyline)
 *   - DEV seasons 2021–2023 choose ONE variant per market (best dev ROI with
 *     ≥ 60 bets). HOLDOUT seasons 2024–2025 are evaluated once, for the
 *     chosen variant only, and decide shipping:
 *       ship ⇔ dev ROI > 0 AND holdout ROI > 0 AND holdout bets ≥ 100.
 *   - Market = nflverse closing lines and prices (bet at the close).
 */

import { writeFile } from "node:fs/promises";
import { buildRows, chooseLambdas, fitModels, type Row } from "./backtest-game.ts";
import { fitLogisticRidge, predictLinear, predictLogistic, type LinearModel } from "../../supabase/functions/_shared/nfl/game/fit.ts";
import { americanToImplied, devigPair } from "../../supabase/functions/_shared/prob_math.ts";
import { normalCdf } from "../../supabase/functions/_shared/nfl/distributions.ts";

const DEV = [2021, 2022, 2023];
const HOLDOUT = [2024, 2025];
const FIRST_OOS = 2020;
const MIN_DEV_BETS = 60;
const MIN_HOLDOUT_BETS = 100;

type Market = "moneyline" | "spread" | "total";
type Variant = "V0" | "V1" | "V2" | "V3";

interface Oos {
  row: Row;
  pMl: number; // raw model P(home win)
  margin: number; // model home − away
  total: number; // model total
  sdMargin: number;
  sdTotal: number;
}

interface Bet { season: number; market: Market; variant: Variant; profit: number; win: boolean; push: boolean; edge: number }

const logit = (p: number) => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return Math.log(q / (1 - q)); };
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const decimalProfit = (price: number) => (price > 0 ? price / 100 : 100 / -price);

// ─── 1. Walk-forward out-of-sample base projections ──────────────────────

async function oosProjections(): Promise<Oos[]> {
  const rows = await buildRows(2025);
  const out: Oos[] = [];
  for (let S = FIRST_OOS; S <= 2025; S++) {
    const train = rows.filter((r) => r.game.season < S);
    const m = fitModels(train, chooseLambdas(train));
    const resid = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length);
    const sdMargin = resid(train.map((r) => predictLinear(m.margin, r.side) - r.margin)) * 1.05;
    const sdTotal = resid(train.map((r) => predictLinear(m.total, r.total) + 2 * r.lgPpg - r.totalPts)) * 1.05;
    for (const row of rows.filter((r) => r.game.season === S)) {
      out.push({
        row,
        pMl: predictLogistic(m.moneyline, row.side),
        margin: predictLinear(m.margin, row.side),
        total: predictLinear(m.total, row.total) + 2 * row.lgPpg,
        sdMargin,
        sdTotal,
      });
    }
  }
  return out;
}

// ─── 2. Market-residual layer (fit on earlier OOS seasons only) ──────────

interface Layer { model: LinearModel; market: Market }

function features(o: Oos, market: Market): number[] | null {
  const g = o.row.game;
  if (market === "moneyline") {
    if (g.home_moneyline === null || g.away_moneyline === null) return null;
    const mkt = devigPair(americanToImplied(g.home_moneyline), americanToImplied(g.away_moneyline))[0];
    return [logit(mkt), logit(o.pMl) - logit(mkt), g.div_game ? 1 : 0, ((g.home_rest ?? 7) - (g.away_rest ?? 7)) / 7];
  }
  if (market === "spread") {
    if (g.spread_line === null) return null;
    const homeDog = g.spread_line < 0 ? 1 : 0;
    return [(o.margin - g.spread_line) / 13, homeDog, g.div_game ? homeDog : 0, ((g.home_rest ?? 7) - (g.away_rest ?? 7)) / 7];
  }
  if (g.total_line === null) return null;
  const indoor = g.roof === "dome" || g.roof === "closed";
  return [(o.total - g.total_line) / 13, indoor ? 0 : Math.max(0, (g.wind ?? 0) - 10) / 10, indoor ? 1 : 0, indoor ? 0 : Math.max(0, 40 - (g.temp ?? 60)) / 20];
}

function target(o: Oos, market: Market): number | null {
  const g = o.row.game;
  if (market === "moneyline") return o.row.margin === 0 ? null : o.row.margin > 0 ? 1 : 0;
  if (market === "spread") { const a = o.row.margin - g.spread_line!; return a === 0 ? null : a > 0 ? 1 : 0; }
  const d = o.row.totalPts - g.total_line!; return d === 0 ? null : d > 0 ? 1 : 0;
}

function fitLayer(train: Oos[], market: Market): Layer | null {
  const X: number[][] = [], y: number[] = [];
  for (const o of train) {
    const x = features(o, market), t = target(o, market);
    if (x && t !== null) { X.push(x); y.push(t); }
  }
  if (X.length < 200) return null;
  return { model: fitLogisticRidge(X, y, ["f0", "f1", "f2", "f3"], 0.01, true), market };
}

// ─── 3. Per-variant probability + bet decision ───────────────────────────

/** Returns [P(side A), marketNoVigA, priceA, priceB, disagreement] or null. */
function evaluate(o: Oos, market: Market, variant: Variant, layer: Layer | null) {
  const g = o.row.game;
  let pA: number, nvA: number, pa: number, pb: number, disagree: number;
  if (market === "moneyline") {
    if (g.home_moneyline === null || g.away_moneyline === null) return null;
    pa = g.home_moneyline; pb = g.away_moneyline;
    nvA = devigPair(americanToImplied(pa), americanToImplied(pb))[0];
    disagree = Math.abs(o.pMl - nvA);
    pA = o.pMl;
  } else if (market === "spread") {
    if (g.spread_line === null) return null;
    pa = g.home_spread_odds ?? -110; pb = g.away_spread_odds ?? -110;
    nvA = devigPair(americanToImplied(pa), americanToImplied(pb))[0];
    disagree = Math.abs(o.margin - g.spread_line);
    pA = normalCdf((o.margin - g.spread_line) / o.sdMargin);
  } else {
    if (g.total_line === null) return null;
    pa = g.over_odds ?? -110; pb = g.under_odds ?? -110;
    nvA = devigPair(americanToImplied(pa), americanToImplied(pb))[0];
    disagree = Math.abs(o.total - g.total_line);
    pA = normalCdf((o.total - g.total_line) / o.sdTotal);
  }
  if (variant !== "V0") {
    if (!layer) return null;
    const x = features(o, market);
    if (!x) return null;
    pA = predictLogistic(layer.model, x);
  }
  return { pA, nvA, pa, pb, disagree };
}

const THRESH: Record<Variant, number> = { V0: 0.03, V1: 0.03, V2: 0.05, V3: 0.02 };
const MIN_DISAGREE: Record<Market, number> = { spread: 3, total: 4, moneyline: 0.08 };

function betFor(o: Oos, market: Market, variant: Variant, layer: Layer | null): Bet | null {
  const e = evaluate(o, market, variant, layer);
  if (!e) return null;
  if (variant === "V3" && e.disagree < MIN_DISAGREE[market]) return null;
  const edgeA = e.pA - e.nvA;
  const edgeB = (1 - e.pA) - (1 - e.nvA);
  const sideA = edgeA >= edgeB;
  const edge = sideA ? edgeA : edgeB;
  if (edge < THRESH[variant]) return null;
  const price = sideA ? e.pa : e.pb;
  if (price > 500) return null; // longshot cap, same as the live gates
  const t = target(o, market);
  const push = t === null;
  const win = !push && (sideA ? t === 1 : t === 0);
  return { season: o.row.game.season, market, variant, edge, push, win, profit: push ? 0 : win ? decimalProfit(price) : -1 };
}

// ─── 4. Stats ─────────────────────────────────────────────────────────────

function stats(bets: Bet[]) {
  const n = bets.length;
  const decided = bets.filter((b) => !b.push);
  const wins = decided.filter((b) => b.win).length;
  const profit = bets.reduce((a, b) => a + b.profit, 0);
  const mean = n ? profit / n : 0;
  const sd = n > 1 ? Math.sqrt(bets.reduce((a, b) => a + (b.profit - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) : 0;
  const z = se > 0 ? mean / se : 0;
  return {
    bets: n,
    record: `${wins}-${decided.length - wins}-${n - decided.length}`,
    hit_rate: decided.length ? +(wins / decided.length).toFixed(4) : null,
    profit_units: +profit.toFixed(2),
    roi: n ? +mean.toFixed(4) : null,
    roi_95ci: n > 1 ? [+(mean - 1.96 * se).toFixed(4), +(mean + 1.96 * se).toFixed(4)] : null,
    p_value_roi_gt_0: se > 0 ? +(1 - normalCdf(z)).toFixed(4) : null,
  };
}

// ─── 5. Run ───────────────────────────────────────────────────────────────

async function main() {
  const oos = await oosProjections();
  const markets: Market[] = ["moneyline", "spread", "total"];
  const variants: Variant[] = ["V0", "V1", "V2", "V3"];
  const bets: Bet[] = [];
  for (const S of [...DEV, ...HOLDOUT]) {
    const prior = oos.filter((o) => o.row.game.season < S);
    const test = oos.filter((o) => o.row.game.season === S);
    for (const market of markets) {
      const layer = fitLayer(prior, market);
      for (const variant of variants) {
        for (const o of test) { const b = betFor(o, market, variant, layer); if (b) bets.push(b); }
      }
    }
  }

  const report: Record<string, unknown> = { protocol: { dev: DEV, holdout: HOLDOUT, min_dev_bets: MIN_DEV_BETS, min_holdout_bets: MIN_HOLDOUT_BETS }, markets: {} };
  for (const market of markets) {
    const dev: Record<string, ReturnType<typeof stats>> = {};
    for (const v of variants) dev[v] = stats(bets.filter((b) => b.market === market && b.variant === v && DEV.includes(b.season)));
    const eligible = variants.filter((v) => dev[v].bets >= MIN_DEV_BETS);
    const chosen = eligible.sort((a, b) => (dev[b].roi ?? -9) - (dev[a].roi ?? -9))[0] ?? null;
    const holdout = chosen ? stats(bets.filter((b) => b.market === market && b.variant === chosen && HOLDOUT.includes(b.season))) : null;
    const ship = !!chosen && (dev[chosen].roi ?? -1) > 0 && !!holdout && (holdout.roi ?? -1) > 0 && holdout.bets >= MIN_HOLDOUT_BETS;
    (report.markets as Record<string, unknown>)[market] = { dev_by_variant: dev, chosen_on_dev: chosen, holdout_for_chosen: holdout, ship };
  }
  await writeFile(".cache/nfl/experiment-game.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
