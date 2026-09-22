import { describe, expect, it } from "vitest";
import {
  binomialThin,
  compoundYards,
  convolve,
  expectedValue,
  gammaP,
  keyedDiscreteNormal,
  negativeBinomial,
  normalCdf,
  pmfMean,
  pmfSd,
  poisson,
  probToAmerican,
  probVsLine,
  scale,
  summarize,
} from "../../supabase/functions/_shared/nfl/distributions";

const total = (p: number[]) => p.reduce((a, b) => a + b, 0);

describe("nfl distributions", () => {
  it("poisson sums to 1 and has mean λ", () => {
    const d = poisson(0.65);
    expect(total(d.p)).toBeCloseTo(1, 10);
    expect(pmfMean(d)).toBeCloseTo(0.65, 6);
    expect(1 - d.p[0]).toBeCloseTo(1 - Math.exp(-0.65), 8); // anytime TD
  });

  it("negative binomial matches mean and over-dispersed variance", () => {
    const mu = 7.2, r = 6;
    const d = negativeBinomial(mu, r);
    expect(pmfMean(d)).toBeCloseTo(mu, 4);
    expect(pmfSd(d) ** 2).toBeCloseTo(mu + (mu * mu) / r, 2);
    expect(pmfSd(d) ** 2).toBeGreaterThan(mu); // not Poisson
  });

  it("binomial thinning gives mean E[N]·p (receptions from targets)", () => {
    const targets = negativeBinomial(8, 10);
    const rec = binomialThin(targets, 0.65);
    expect(total(rec.p)).toBeCloseTo(1, 10);
    expect(pmfMean(rec)).toBeCloseTo(8 * 0.65, 3);
  });

  it("compound yards preserves the compound mean and is right-skewed", () => {
    const d = compoundYards(7, 7 + 49 / 8, 8.3, 10.5, 0.04);
    expect(pmfMean(d)).toBeCloseTo(7 * 8.3, 0);
    const s = summarize(d);
    expect(s.median).toBeLessThan(s.mean + 0.5); // skew: median ≤ mean
    expect(s.p10).toBeLessThan(s.median);
    expect(s.p90).toBeGreaterThan(s.median);
  });

  it("over + under + push = 1 at whole and half lines", () => {
    const d = negativeBinomial(5.1, 8);
    for (const line of [4.5, 5, 5.5]) {
      const p = probVsLine(d, line);
      expect(p.over + p.under + p.push).toBeCloseTo(1, 10);
      if (line % 1 !== 0) expect(p.push).toBe(0);
      else expect(p.push).toBeGreaterThan(0);
    }
  });

  it("keyed discrete normal keeps the projected mean and lifts key numbers", () => {
    const plain = keyedDiscreteNormal(-2.5, 13.5, -70, 70);
    const keyed = keyedDiscreteNormal(-2.5, 13.5, -70, 70, { 3: 2.2, [-3]: 2.2, 7: 1.6, [-7]: 1.6 });
    expect(pmfMean(keyed)).toBeCloseTo(-2.5, 3);
    expect(keyed.p[3 + 70]).toBeGreaterThan(plain.p[3 + 70]);
  });

  it("kicker points = 3·FG ⊕ XP convolution", () => {
    const pts = convolve(scale(poisson(1.7), 3), poisson(2.4));
    expect(pmfMean(pts)).toBeCloseTo(3 * 1.7 + 2.4, 4);
  });

  it("special functions are accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(gammaP(1, 2)).toBeCloseTo(1 - Math.exp(-2), 10); // exponential
    expect(gammaP(5, 5)).toBeCloseTo(0.5595, 3);
  });

  it("price helpers", () => {
    expect(probToAmerican(0.5)).toBe(-100);
    expect(probToAmerican(0.6)).toBe(-150);
    expect(probToAmerican(0.4)).toBe(150);
    // -110 break-even ≈ 52.38%
    expect(expectedValue(110 / 210, 0, -110)).toBeCloseTo(0, 6);
    // Push refunds stake: 50/10/40 at +100 → EV = 0.5 − 0.4
    expect(expectedValue(0.5, 0.1, 100)).toBeCloseTo(0.1, 8);
  });
});
