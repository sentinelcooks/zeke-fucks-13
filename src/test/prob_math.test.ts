// Tests for the canonical probability utilities. We re-export the pure
// functions from supabase/functions/_shared/prob_math.ts via a relative
// import so we don't duplicate the math.
import { describe, it, expect } from "vitest";
import {
  americanToImplied,
  americanToDecimal,
  calcEvPct,
  devigPair,
  fairImpliedFromPair,
  shrink,
  shrinkRate,
  plattCalibrate,
  isotonicCalibrate,
  fitPlatt,
  fitIsotonic,
  brier,
  logLoss,
  adjustJoint,
  clamp01,
  applyCalibration,
} from "../../supabase/functions/_shared/prob_math";

describe("americanToImplied", () => {
  it("-110 → ~0.524", () => {
    expect(americanToImplied(-110)).toBeCloseTo(110 / 210, 4);
  });
  it("+150 → 0.4", () => {
    expect(americanToImplied(+150)).toBeCloseTo(0.4, 4);
  });
  it("0 / non-finite → 0", () => {
    expect(americanToImplied(0)).toBe(0);
    expect(americanToImplied(NaN)).toBe(0);
  });
});

describe("americanToDecimal & calcEvPct", () => {
  it("+100 is 2.0 decimal", () => {
    expect(americanToDecimal(+100)).toBeCloseTo(2.0, 6);
  });
  it("EV at fair 50% on +100 is zero", () => {
    expect(calcEvPct(0.5, +100)).toBeCloseTo(0, 6);
  });
  it("EV is positive when p > implied", () => {
    expect(calcEvPct(0.6, -110)).toBeGreaterThan(0);
  });
});

describe("devigPair / fairImpliedFromPair", () => {
  it("normalizes to 1", () => {
    const [a, b] = devigPair(0.55, 0.50);
    expect(a + b).toBeCloseTo(1, 8);
  });
  it("-110/-110 de-vigs to 0.5/0.5", () => {
    const fa = fairImpliedFromPair(-110, -110);
    expect(fa).toBeCloseTo(0.5, 6);
  });
  it("+150/-180 de-vigs sensibly", () => {
    const fa = fairImpliedFromPair(+150, -180);
    // implied 0.4 vs 0.6429 → normalized 0.384
    expect(fa).toBeGreaterThan(0.38);
    expect(fa).toBeLessThan(0.40);
  });
  it("zero sum falls back to 0.5", () => {
    const [a, b] = devigPair(0, 0);
    expect(a).toBe(0.5);
    expect(b).toBe(0.5);
  });
});

describe("shrink", () => {
  it("n=0 returns prior", () => {
    expect(shrink(0.9, 0, 0.5)).toBe(0.5);
  });
  it("large n returns near sample", () => {
    expect(shrink(0.8, 1000, 0.5, 10)).toBeCloseTo(0.797, 2);
  });
  it("monotone in n", () => {
    const a = shrink(0.9, 5, 0.5);
    const b = shrink(0.9, 50, 0.5);
    expect(b).toBeGreaterThan(a);
  });
});

describe("shrinkRate", () => {
  it("all hits on 0 trials returns prior", () => {
    expect(shrinkRate(0, 0, 0.3, 10)).toBeCloseTo(0.3, 6);
  });
  it("matches beta-binomial posterior mean", () => {
    // 7 hits in 10 with Beta(3,7) prior (mean 0.3, strength 10)
    const expected = (7 + 3) / (10 + 10);
    expect(shrinkRate(7, 10, 0.3, 10)).toBeCloseTo(expected, 6);
  });
});

describe("plattCalibrate", () => {
  it("a=1,b=0 at 0.5 gives ~0.622", () => {
    expect(plattCalibrate(0.5, { a: 1, b: 0 })).toBeCloseTo(1 / (1 + Math.exp(-0.5)), 6);
  });
  it("large a=8,b=-4 pushes 0.5→~0.5 sigmoid", () => {
    const v = plattCalibrate(0.5, { a: 8, b: -4 });
    expect(v).toBeCloseTo(0.5, 6);
  });
});

describe("isotonicCalibrate", () => {
  it("identity when bins cover [0,1] with rate=midpoint", () => {
    const bins = [
      { lo: 0, hi: 0.5, rate: 0.25 },
      { lo: 0.5, hi: 1.0001, rate: 0.75 },
    ];
    expect(isotonicCalibrate(0.2, bins)).toBe(0.25);
    expect(isotonicCalibrate(0.9, bins)).toBe(0.75);
  });
  it("clamps into [0,1]", () => {
    const bins = [{ lo: 0, hi: 1.0001, rate: 1.5 }];
    expect(isotonicCalibrate(0.5, bins)).toBe(1);
  });
});

describe("fitPlatt", () => {
  it("recovers near-identity when data is already well-calibrated", () => {
    // y = 1 with probability x; 500 samples
    const n = 500;
    const scores: number[] = [];
    const labels: number[] = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < n; i++) {
      const x = rand();
      scores.push(x);
      labels.push(rand() < x ? 1 : 0);
    }
    const p = fitPlatt(scores, labels, 100);
    // Should map extremes reasonably: p(0.1) < p(0.9).
    expect(plattCalibrate(0.9, p)).toBeGreaterThan(plattCalibrate(0.1, p));
  });
  it("returns stable finite params on empty input", () => {
    const p = fitPlatt([], []);
    expect(Number.isFinite(p.a)).toBe(true);
    expect(Number.isFinite(p.b)).toBe(true);
  });
});

describe("fitIsotonic", () => {
  it("is monotone non-decreasing", () => {
    const n = 400;
    const scores: number[] = [];
    const labels: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = i / n;
      scores.push(x);
      labels.push(x > 0.5 ? 1 : 0);
    }
    const bins = fitIsotonic(scores, labels, 10);
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i].rate).toBeGreaterThanOrEqual(bins[i - 1].rate - 1e-9);
    }
  });
});

describe("brier / logLoss", () => {
  it("perfect predictions → 0", () => {
    expect(brier([1, 0], [1, 0])).toBe(0);
  });
  it("logLoss is lower for better predictions", () => {
    const l1 = logLoss([0.9, 0.1], [1, 0]);
    const l2 = logLoss([0.6, 0.4], [1, 0]);
    expect(l1).toBeLessThan(l2);
  });
});

describe("adjustJoint", () => {
  it("rho=1 equals product", () => {
    expect(adjustJoint([0.6, 0.5], 1)).toBeCloseTo(0.3, 6);
  });
  it("rho>1 lifts joint; rho<1 drops it; clamped to [0,1]", () => {
    expect(adjustJoint([0.6, 0.5], 1.5)).toBeCloseTo(0.45, 6);
    expect(adjustJoint([0.9, 0.9], 1.5)).toBeLessThanOrEqual(1);
  });
});

describe("applyCalibration identity fallback", () => {
  it("clamps to [0,1]", () => {
    expect(applyCalibration(-0.2, { method: "identity" })).toBe(0);
    expect(applyCalibration(2, { method: "identity" })).toBe(1);
  });
});

describe("clamp01", () => {
  it("non-finite → 0 (safe default)", () => {
    // Treating ±Infinity as invalid input is safer than propagating a 1.
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
  });
  it("in-range passes through; out-of-range clamps", () => {
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(-0.1)).toBe(0);
    expect(clamp01(1.1)).toBe(1);
  });
});
