/**
 * Discrete probability distributions for NFL outcomes.
 *
 * Shared PURE MATH only — both NFL engines import it, neither engine's
 * predictions live here. Every NFL outcome (margins, totals, yards, catches,
 * touchdowns, kicker points) is integer-valued, so every distribution is
 * materialised as an integer PMF. That gives one exact code path for
 * over / under / push at half-point and whole-number lines.
 *
 * Families (chosen per stat by the engines, never "normal by default"):
 *   - Poisson                 rare-event counts (TDs, INTs, FGs)
 *   - Negative binomial       over-dispersed counts (targets, carries, attempts)
 *   - Binomial thinning       receptions from targets, completions from attempts
 *   - Zero-inflated gamma     yardage (point mass at 0 + right skew)
 *   - Discretised normal      game margin / total, reweighted at key numbers
 *   - Convolution / scaling   kicker points = 3·FG + XP
 */

export interface IntPmf {
  /** Value of p[0]. */
  offset: number;
  p: number[];
}

const EPS = 1e-12;

// ─── PMF utilities ────────────────────────────────────────────────────────

export function normalize(pmf: IntPmf): IntPmf {
  const s = pmf.p.reduce((a, b) => a + b, 0);
  if (!(s > 0)) throw new Error("cannot normalise an empty PMF");
  return { offset: pmf.offset, p: pmf.p.map((x) => x / s) };
}

export function pmfMean(pmf: IntPmf): number {
  let m = 0;
  pmf.p.forEach((pr, i) => { m += pr * (i + pmf.offset); });
  return m;
}

export function pmfSd(pmf: IntPmf): number {
  const m = pmfMean(pmf);
  let v = 0;
  pmf.p.forEach((pr, i) => { const d = i + pmf.offset - m; v += pr * d * d; });
  return Math.sqrt(v);
}

/** P(X ≤ x). */
export function pmfCdf(pmf: IntPmf, x: number): number {
  const last = Math.floor(x) - pmf.offset;
  if (last < 0) return 0;
  let c = 0;
  for (let i = 0; i <= Math.min(last, pmf.p.length - 1); i++) c += pmf.p[i];
  return Math.min(1, c);
}

/** Smallest integer k with P(X ≤ k) ≥ q. */
export function pmfQuantile(pmf: IntPmf, q: number): number {
  let c = 0;
  for (let i = 0; i < pmf.p.length; i++) {
    c += pmf.p[i];
    if (c >= q - EPS) return i + pmf.offset;
  }
  return pmf.p.length - 1 + pmf.offset;
}

export interface LineProbabilities {
  over: number;
  under: number;
  push: number;
}

/** Exact over/under/push against a sportsbook line (half-point or whole). */
export function probVsLine(pmf: IntPmf, line: number): LineProbabilities {
  const isWhole = Math.abs(line - Math.round(line)) < 1e-9;
  if (isWhole) {
    const under = pmfCdf(pmf, line - 1);
    const push = pmfCdf(pmf, line) - under;
    return { over: Math.max(0, 1 - under - push), under, push };
  }
  const under = pmfCdf(pmf, Math.floor(line));
  return { over: Math.max(0, 1 - under), under, push: 0 };
}

/** Convolution of two independent integer PMFs. */
export function convolve(a: IntPmf, b: IntPmf): IntPmf {
  const out = new Array(a.p.length + b.p.length - 1).fill(0);
  for (let i = 0; i < a.p.length; i++) {
    if (a.p[i] < EPS) continue;
    for (let j = 0; j < b.p.length; j++) out[i + j] += a.p[i] * b.p[j];
  }
  return { offset: a.offset + b.offset, p: out };
}

/** Mixture w·a + (1−w)·b of two integer PMFs. */
export function mixture(a: IntPmf, b: IntPmf, w: number): IntPmf {
  const lo = Math.min(a.offset, b.offset);
  const hi = Math.max(a.offset + a.p.length, b.offset + b.p.length);
  const p = new Array(hi - lo).fill(0);
  a.p.forEach((x, i) => { p[i + a.offset - lo] += w * x; });
  b.p.forEach((x, i) => { p[i + b.offset - lo] += (1 - w) * x; });
  return { offset: lo, p };
}

/** Distribution of c·X for integer c ≥ 1 (e.g. 3 points per field goal). */
export function scale(pmf: IntPmf, c: number): IntPmf {
  const out = new Array((pmf.p.length - 1) * c + 1).fill(0);
  pmf.p.forEach((pr, i) => { out[i * c] = pr; });
  return { offset: pmf.offset * c, p: out };
}

export interface PmfSummary {
  mean: number;
  median: number;
  sd: number;
  p10: number;
  p90: number;
}

export function summarize(pmf: IntPmf): PmfSummary {
  return {
    mean: pmfMean(pmf),
    median: pmfQuantile(pmf, 0.5),
    sd: pmfSd(pmf),
    p10: pmfQuantile(pmf, 0.1),
    p90: pmfQuantile(pmf, 0.9),
  };
}

// ─── Special functions ────────────────────────────────────────────────────

/** ln Γ(x), Lanczos approximation (g=7, n=9). */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // Series expansion.
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  // Continued fraction for Q(a, x) (modified Lentz).
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf, |err| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
    t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// ─── Families ─────────────────────────────────────────────────────────────

/** Upper support bound: far enough out that the tail mass is negligible. */
function supportMax(mean: number, sd: number, floor = 10): number {
  return Math.max(floor, Math.ceil(mean + 10 * sd + 10));
}

export function poisson(lambda: number): IntPmf {
  const lam = Math.max(lambda, 1e-9);
  const max = supportMax(lam, Math.sqrt(lam));
  const p: number[] = [];
  let term = Math.exp(-lam);
  for (let k = 0; k <= max; k++) {
    p.push(term);
    term *= lam / (k + 1);
  }
  return normalize({ offset: 0, p });
}

/**
 * Negative binomial parameterised by mean μ and dispersion r:
 * Var = μ + μ²/r. Large r → Poisson; small r → heavier tails.
 */
export function negativeBinomial(mean: number, dispersion: number): IntPmf {
  const mu = Math.max(mean, 1e-9);
  if (!(dispersion > 0) || dispersion > 1e6) return poisson(mu);
  const r = dispersion;
  const q = r / (r + mu); // success prob
  const max = supportMax(mu, Math.sqrt(mu + (mu * mu) / r));
  const p: number[] = [];
  // P(0) = q^r ; P(k+1) = P(k) · (k + r)/(k + 1) · (1 − q)
  let term = Math.exp(r * Math.log(q));
  for (let k = 0; k <= max; k++) {
    p.push(term);
    term *= ((k + r) / (k + 1)) * (1 - q);
  }
  return normalize({ offset: 0, p });
}

/**
 * Binomial thinning: if N ~ `counts` and each unit succeeds independently
 * with probability `rate`, return the PMF of successes. Exact.
 */
export function binomialThin(counts: IntPmf, rate: number): IntPmf {
  if (counts.offset !== 0) throw new Error("binomialThin expects a count PMF starting at 0");
  const r = Math.min(Math.max(rate, 0), 1);
  const out = new Array(counts.p.length).fill(0);
  for (let n = 0; n < counts.p.length; n++) {
    const pn = counts.p[n];
    if (pn < EPS) continue;
    // Binomial(n, r) via recurrence, in log space for stability at large n.
    let logTerm = n * Math.log(Math.max(1 - r, 1e-300));
    for (let k = 0; k <= n; k++) {
      out[k] += pn * Math.exp(logTerm);
      if (k < n) logTerm += Math.log((n - k) / (k + 1)) + Math.log(Math.max(r, 1e-300)) - Math.log(Math.max(1 - r, 1e-300));
    }
  }
  return normalize({ offset: 0, p: out });
}

/**
 * Zero-inflated gamma, discretised to integers (continuity-corrected).
 * `pZero` is the mass at exactly zero (e.g. P(no receptions)); the positive
 * part is gamma with the given conditional mean and variance.
 */
export function zeroInflatedGamma(pZero: number, posMean: number, posVar: number): IntPmf {
  const p0 = Math.min(Math.max(pZero, 0), 0.999);
  const m = Math.max(posMean, 0.5);
  const v = Math.max(posVar, 0.25);
  const k = (m * m) / v;
  const theta = v / m;
  const max = supportMax(m, Math.sqrt(v), 20);
  const G = (x: number) => gammaP(k, Math.max(x, 0) / theta);
  const p: number[] = [p0 + (1 - p0) * G(0.5)];
  for (let y = 1; y <= max; y++) p.push((1 - p0) * (G(y + 0.5) - G(y - 0.5)));
  return normalize({ offset: 0, p });
}

/**
 * Zero-inflated gamma matched to a compound (random-sum) statistic.
 *
 * Yards = Σ_{i=1..N} Y_i with N the opportunity count and Y_i the gain per
 * opportunity:
 *   E[T]   = E[N]·E[Y]
 *   Var[T] = E[N]·Var[Y] + Var[N]·E[Y]²
 * `pZero` = probability the player records no positive-yardage event.
 */
export function compoundYards(
  meanCount: number,
  varCount: number,
  meanPerUnit: number,
  sdPerUnit: number,
  pZero: number,
): IntPmf {
  const mean = meanCount * meanPerUnit;
  const variance = meanCount * sdPerUnit * sdPerUnit + varCount * meanPerUnit * meanPerUnit;
  const p0 = Math.min(Math.max(pZero, 0), 0.95);
  // Condition on T > 0: E[T | T>0] = E[T]/(1−p0); Var from the second moment.
  const posMean = mean / (1 - p0);
  const secondMoment = variance + mean * mean;
  const posVar = Math.max(secondMoment / (1 - p0) - posMean * posMean, posMean * 0.5);
  return zeroInflatedGamma(p0, posMean, posVar);
}

/**
 * Discretised normal on [lo, hi] with optional multiplicative key-number
 * weights (e.g. NFL margins cluster on 3 and 7). After reweighting, the
 * location is re-solved so the PMF mean equals `mean` exactly — key numbers
 * redistribute mass, they must not move the projection.
 */
export function keyedDiscreteNormal(
  mean: number,
  sd: number,
  lo: number,
  hi: number,
  weights: Record<number, number> = {},
): IntPmf {
  const build = (center: number): IntPmf => {
    const p: number[] = [];
    for (let x = lo; x <= hi; x++) {
      const mass = normalCdf((x + 0.5 - center) / sd) - normalCdf((x - 0.5 - center) / sd);
      p.push(mass * (weights[x] ?? 1));
    }
    return normalize({ offset: lo, p });
  };
  let center = mean;
  let pmf = build(center);
  for (let i = 0; i < 6; i++) {
    const err = pmfMean(pmf) - mean;
    if (Math.abs(err) < 1e-4) break;
    center -= err;
    pmf = build(center);
  }
  return pmf;
}

// ─── Price helpers (shared math) ─────────────────────────────────────────

/** American price for a fair probability (no vig). */
export function probToAmerican(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/**
 * Expected value per 1 unit staked, with push refunds:
 *   EV = P(win)·(decimal − 1) − P(loss)
 */
export function expectedValue(pWin: number, pPush: number, americanPrice: number): number {
  const dec = americanPrice > 0 ? americanPrice / 100 + 1 : 100 / -americanPrice + 1;
  const pLoss = Math.max(0, 1 - pWin - pPush);
  return pWin * (dec - 1) - pLoss;
}
