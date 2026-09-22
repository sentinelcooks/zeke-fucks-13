/**
 * NFL GAME EDGE ENGINE — offline model fitting (ridge / logistic ridge).
 *
 * Used only by `scripts/nfl/backtest-game.ts` to fit the spread, moneyline
 * and total models walk-forward. Live inference only reads the resulting
 * coefficients from `weights_fitted.ts`; nothing is fit at request time.
 */

export interface LinearModel {
  features: string[];
  scale: number[]; // feature standard deviations used for standardisation
  coef: number[]; // on standardised features
  intercept: number;
}

/** Solve A x = b (A symmetric positive-definite, small) by Gaussian elimination. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

export function featureScales(X: number[][]): number[] {
  const p = X[0]?.length ?? 0;
  const out: number[] = [];
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(col.length - 1, 1));
    out.push(sd > 1e-9 ? sd : 1);
  }
  return out;
}

/**
 * Ridge regression on standardised features. `fitIntercept=false` forces the
 * fit through the origin (used for home-minus-away margins, where a neutral,
 * evenly-matched game must project to 0).
 */
export function fitRidge(
  X: number[][],
  y: number[],
  features: string[],
  lambda: number,
  fitIntercept: boolean,
): LinearModel {
  const scale = featureScales(X);
  const Z = X.map((r) => r.map((v, j) => v / scale[j]));
  const yMean = fitIntercept ? y.reduce((a, b) => a + b, 0) / y.length : 0;
  const zMeans = fitIntercept
    ? scale.map((_, j) => Z.reduce((a, r) => a + r[j], 0) / Z.length)
    : scale.map(() => 0);
  const p = scale.length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < Z.length; i++) {
    const zi = Z[i].map((v, j) => v - zMeans[j]);
    const yi = y[i] - yMean;
    for (let j = 0; j < p; j++) {
      b[j] += zi[j] * yi;
      for (let k = j; k < p; k++) A[j][k] += zi[j] * zi[k];
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += lambda * Z.length;
  }
  const coef = solve(A, b);
  const intercept = fitIntercept ? yMean - coef.reduce((a, c, j) => a + c * zMeans[j], 0) : 0;
  return { features, scale, coef, intercept };
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

/** L2-regularised logistic regression via Newton-Raphson (IRLS). */
export function fitLogisticRidge(
  X: number[][],
  y: number[],
  features: string[],
  lambda: number,
  fitIntercept: boolean,
): LinearModel {
  const scale = featureScales(X);
  const Z = X.map((r) => {
    const z = r.map((v, j) => v / scale[j]);
    return fitIntercept ? [1, ...z] : z;
  });
  const p = Z[0].length;
  let w = new Array(p).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < Z.length; i++) {
      const mu = sigmoid(Z[i].reduce((a, v, j) => a + v * w[j], 0));
      const s = mu * (1 - mu);
      for (let j = 0; j < p; j++) {
        g[j] += (mu - y[i]) * Z[i][j];
        for (let k = j; k < p; k++) H[j][k] += s * Z[i][j] * Z[i][k];
      }
    }
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < j; k++) H[j][k] = H[k][j];
      const pen = fitIntercept && j === 0 ? 0 : lambda * Z.length;
      H[j][j] += pen + 1e-9;
      g[j] += pen * w[j];
    }
    const step = solve(H, g);
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return fitIntercept
    ? { features, scale, coef: w.slice(1), intercept: w[0] }
    : { features, scale, coef: w, intercept: 0 };
}

export function predictLinear(model: LinearModel, x: number[]): number {
  return model.intercept + model.coef.reduce((a, c, j) => a + (c * x[j]) / model.scale[j], 0);
}

export function predictLogistic(model: LinearModel, x: number[]): number {
  return sigmoid(predictLinear(model, x));
}

/** Per-feature contributions (coef × standardised value), for factor logging. */
export function contributions(model: LinearModel, x: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  model.features.forEach((f, j) => { out[f] = (model.coef[j] * x[j]) / model.scale[j]; });
  return out;
}

/** Platt scaling on logit(p): p' = σ(a·logit(p) + b). Fit on out-of-sample predictions only. */
export function fitPlattOnProbs(probs: number[], outcomes: number[]): { a: number; b: number } {
  const X = probs.map((p) => {
    const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
    return [Math.log(q / (1 - q))];
  });
  const m = fitLogisticRidge(X, outcomes, ["logit"], 1e-4, true);
  return { a: m.coef[0] / m.scale[0], b: m.intercept };
}

export function applyPlatt(p: number, params: { a: number; b: number }): number {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return sigmoid(params.a * Math.log(q / (1 - q)) + params.b);
}
