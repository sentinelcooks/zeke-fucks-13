// supabase/functions/_shared/prob_math.ts
//
// Canonical probability utilities for Sentinel.
//
// Every edge/EV/confidence/projection calculation in the codebase MUST
// route through this file. Keeping one implementation prevents three
// classes of bugs:
//   1. Vig-contaminated "edge" — comparing model prob to raw implied prob.
//   2. Uncalibrated confidence — treating a weighted factor-score as if
//      it were a true hit-rate.
//   3. Small-sample hot-hand — taking a 3-game mean as gospel.
//
// All probabilities are 0–1. All odds are American.

// ─── Odds ↔ probability ─────────────────────────────────────────────

export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 1;
  return odds > 0 ? odds / 100 + 1 : 100 / -odds + 1;
}

export function calcEvPct(projectedProb: number, americanOdds: number): number {
  const dec = americanToDecimal(americanOdds);
  const p = clamp01(projectedProb);
  return (p * (dec - 1) - (1 - p)) * 100;
}

// ─── Vig removal ────────────────────────────────────────────────────
// Two-way markets (over/under, home/away, ml pair): normalize so the
// two fair probabilities sum to 1. This removes book juice before we
// compute edge.

export function devigPair(pA: number, pB: number): [number, number] {
  const s = pA + pB;
  if (!(s > 0)) return [0.5, 0.5];
  return [pA / s, pB / s];
}

// Given the two American prices for a two-way market, return the
// vig-free implied prob for side A.
export function fairImpliedFromPair(oddsA: number, oddsB: number): number {
  const pA = americanToImplied(oddsA);
  const pB = americanToImplied(oddsB);
  return devigPair(pA, pB)[0];
}

// Multi-way de-vig (method of proportions).
export function devigMulti(probs: number[]): number[] {
  const s = probs.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return probs.map(() => 1 / Math.max(probs.length, 1));
  return probs.map((p) => p / s);
}

// ─── Bayesian shrinkage (beta-binomial) ─────────────────────────────
// Shrinks a sample mean toward a prior. Used for recent-form / hit-rate
// features when the sample size is small.
//
//   posterior = (n * sample + k * prior) / (n + k)
//
// Default k=10 means "a 10-game prior carries equal weight to 10 observations".

export function shrink(
  sampleMean: number,
  n: number,
  priorMean: number,
  priorStrength = 10,
): number {
  if (!(n > 0)) return priorMean;
  return (n * sampleMean + priorStrength * priorMean) / (n + priorStrength);
}

// Variance-aware shrinkage for rates — assumes Beta(α,β) prior built from
// priorMean + priorStrength pseudo-observations. Returns posterior mean.
export function shrinkRate(
  hits: number,
  trials: number,
  priorMean: number,
  priorStrength = 10,
): number {
  const alpha = priorMean * priorStrength;
  const beta = (1 - priorMean) * priorStrength;
  return (hits + alpha) / (trials + alpha + beta);
}

// ─── Calibration ────────────────────────────────────────────────────
// Confidence score (0-1) → calibrated probability (0-1).
// Platt uses a fitted sigmoid; isotonic uses monotone bin lookup.

export interface PlattParams {
  a: number;
  b: number;
}

export interface IsotonicBin {
  lo: number; // inclusive
  hi: number; // exclusive
  rate: number;
}

export function plattCalibrate(score01: number, params: PlattParams): number {
  const x = clamp01(score01);
  const z = params.a * x + params.b;
  // Clamp to avoid inf from exp on extreme z.
  const zc = Math.max(-40, Math.min(40, z));
  return 1 / (1 + Math.exp(-zc));
}

export function isotonicCalibrate(score01: number, bins: IsotonicBin[]): number {
  const x = clamp01(score01);
  for (const b of bins) {
    if (x >= b.lo && x < b.hi) return clamp01(b.rate);
  }
  // If x falls exactly on the top edge.
  if (bins.length > 0 && x >= bins[bins.length - 1].hi) {
    return clamp01(bins[bins.length - 1].rate);
  }
  return x;
}

// Union type for a loaded calibration row.
export type Calibration =
  | { method: "platt"; params: PlattParams }
  | { method: "isotonic"; params: { bins: IsotonicBin[] } }
  | { method: "identity" };

export function applyCalibration(score01: number, cal: Calibration): number {
  if (cal.method === "platt") return plattCalibrate(score01, cal.params);
  if (cal.method === "isotonic") return isotonicCalibrate(score01, cal.params.bins);
  return clamp01(score01);
}

// ─── Scoring & metrics ──────────────────────────────────────────────

export function brier(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < predictions.length; i++) {
    const d = predictions[i] - outcomes[i];
    s += d * d;
  }
  return s / predictions.length;
}

export function logLoss(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0) return 0;
  const eps = 1e-6;
  let s = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, predictions[i]));
    const y = outcomes[i];
    s += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return s / predictions.length;
}

// ─── Platt fit (Newton-Raphson on log-loss) ─────────────────────────
// Fits sigmoid(a*x+b) to labels y∈{0,1}. Returns stable params even on
// small samples by constraining |a|,|b| ≤ 10.

export function fitPlatt(
  scores: number[],
  labels: number[],
  iters = 50,
): PlattParams {
  if (scores.length !== labels.length || scores.length === 0) {
    return { a: 1, b: 0 };
  }
  let a = 1;
  let b = 0;
  for (let it = 0; it < iters; it++) {
    let g1 = 0, g2 = 0;       // gradient
    let h11 = 0, h12 = 0, h22 = 0; // hessian
    for (let i = 0; i < scores.length; i++) {
      const x = scores[i];
      const y = labels[i];
      const z = Math.max(-40, Math.min(40, a * x + b));
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y;
      g1 += err * x;
      g2 += err;
      const w = p * (1 - p);
      h11 += w * x * x;
      h12 += w * x;
      h22 += w;
    }
    // Regularize hessian to keep it invertible.
    h11 += 1e-6;
    h22 += 1e-6;
    const det = h11 * h22 - h12 * h12;
    if (Math.abs(det) < 1e-12) break;
    const da = (h22 * g1 - h12 * g2) / det;
    const db = (-h12 * g1 + h11 * g2) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-6) break;
  }
  return {
    a: clampRange(a, -10, 10),
    b: clampRange(b, -10, 10),
  };
}

// ─── Isotonic fit via pool-adjacent-violators on equal-width bins ───
// Simple 10-bin fit (splits [0,1] into deciles). Guarantees monotonicity.

export function fitIsotonic(
  scores: number[],
  labels: number[],
  nBins = 10,
): IsotonicBin[] {
  if (scores.length === 0) return [];
  const bins: IsotonicBin[] = [];
  for (let i = 0; i < nBins; i++) {
    const lo = i / nBins;
    const hi = (i + 1) / nBins;
    bins.push({ lo, hi: i === nBins - 1 ? 1.0001 : hi, rate: (lo + hi) / 2 });
  }
  const sums = new Array(nBins).fill(0);
  const counts = new Array(nBins).fill(0);
  for (let i = 0; i < scores.length; i++) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(clamp01(scores[i]) * nBins)));
    sums[idx] += labels[i];
    counts[idx] += 1;
  }
  // Initial means; fall back to bin midpoint if empty (avoids NaN).
  for (let i = 0; i < nBins; i++) {
    bins[i].rate = counts[i] > 0 ? sums[i] / counts[i] : (bins[i].lo + bins[i].hi) / 2;
  }
  // Pool-adjacent-violators enforcement.
  for (let pass = 0; pass < nBins; pass++) {
    let changed = false;
    for (let i = 0; i < nBins - 1; i++) {
      if (bins[i].rate > bins[i + 1].rate) {
        const nA = counts[i] || 1;
        const nB = counts[i + 1] || 1;
        const merged = (bins[i].rate * nA + bins[i + 1].rate * nB) / (nA + nB);
        bins[i].rate = merged;
        bins[i + 1].rate = merged;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return bins;
}

// ─── Joint / correlation utilities ──────────────────────────────────
// For SGP: naive product assumes independence. `adjustJoint` multiplies
// the product by a correlation factor. ρ=1 is independent; ρ>1 means
// legs are positively correlated (joint is more likely than independent).

export function adjustJoint(legProbs: number[], rho: number): number {
  const base = legProbs.reduce((acc, p) => acc * clamp01(p), 1);
  return clamp01(base * clamp01Range(rho, 0.1, 2));
}

// ─── Small helpers ──────────────────────────────────────────────────

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampRange(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, x));
}

function clamp01Range(x: number, lo: number, hi: number): number {
  return clampRange(x, lo, hi);
}
