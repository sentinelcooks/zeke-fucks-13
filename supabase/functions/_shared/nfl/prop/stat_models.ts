/**
 * NFL PLAYER PROP EDGE ENGINE — per-stat outcome distributions.
 *
 * Each prop type gets the distribution family its statistic actually follows:
 *   targets / carries / pass attempts   negative binomial (over-dispersed counts)
 *   receptions / completions            binomial thinning of the opportunity PMF
 *   receiving / rushing / passing yards zero-inflated gamma matched to the
 *                                       compound (random-sum) mean and variance
 *   pass TDs / INTs                     Poisson
 *   anytime TD                          Poisson(λ_rec + λ_rush) → P(≥ 1)
 *   FG made / XP made                   Poisson
 *   kicking points                      exact convolution of 3·FG ⊕ XP
 */

import {
  binomialThin,
  compoundYards,
  convolve,
  mixture,
  negativeBinomial,
  pmfMean,
  pmfSd,
  poisson,
  scale,
  type IntPmf,
} from "../distributions.ts";
import type { PropProjection } from "./projection.ts";
import type { NflPropType, PropDistributionParams } from "./weights.ts";

export interface StatDistribution {
  pmf: IntPmf;
  family: string;
}

function countPmf(mean: number, r: number): IntPmf {
  return negativeBinomial(Math.max(mean, 0.01), r);
}

/** QB pass attempts: full-game NB mixed with an early-exit NB, mean-preserving. */
function passAttPmf(mean: number, params: PropDistributionParams): IntPmf {
  const { prob, fraction } = params.qb_early_exit ?? { prob: 0, fraction: 0.35 };
  if (!(prob > 0)) return countPmf(mean, params.dispersion.pass_att);
  const full = mean / (1 - prob + prob * fraction);
  return mixture(
    countPmf(full * fraction, params.dispersion.pass_att),
    countPmf(full, params.dispersion.pass_att),
    prob,
  );
}

/** Apply the train-fitted mean calibration to a raw projection. */
export function calibratedProjection(p: PropProjection, params: PropDistributionParams, position: string): PropProjection {
  const s = params.scale;
  const catchRate = Math.min(0.95, p.catch_rate * s.catch);
  const cmp = Math.min(0.85, p.completion_pct * s.cmp);
  return {
    ...p,
    targets: p.targets * s.targets,
    catch_rate: catchRate,
    yards_per_reception: p.yards_per_reception * s.ypr,
    carries: p.carries * (position === "QB" ? s.qb_carries : s.carries),
    yards_per_carry: p.yards_per_carry * s.ypc,
    pass_att: p.pass_att * s.pass_att,
    completion_pct: cmp,
    yards_per_completion: p.yards_per_completion * s.ypcmp,
    pass_td_rate: p.pass_td_rate * s.pass_td,
    int_rate: p.int_rate * s.int,
    rec_td_lambda: p.rec_td_lambda * s.td,
    rush_td_lambda: p.rush_td_lambda * s.td,
    fg_att: p.fg_att * s.fg,
    xp_mean: p.xp_mean * s.xp,
  };
}

export function propDistribution(
  stat: NflPropType,
  raw: PropProjection,
  params: PropDistributionParams,
  position: string,
): StatDistribution {
  // A player ruled Out produces nothing: point mass at zero (the numerical
  // floors in the count families would otherwise leave a sliver above 0).
  if (raw.availability_mult === 0) return { pmf: { offset: 0, p: [1] }, family: "point_mass(out)" };
  const p = calibratedProjection(raw, params, position);
  const d = params.dispersion;
  const cv = params.per_unit_cv;
  switch (stat) {
    case "targets":
      return { pmf: countPmf(p.targets, d.targets), family: "negative_binomial" };
    case "receptions":
      return { pmf: binomialThin(countPmf(p.targets, d.targets), p.catch_rate), family: "negative_binomial⊗binomial" };
    case "rec_yds": {
      const rec = binomialThin(countPmf(p.targets, d.targets), p.catch_rate);
      const sd = pmfSd(rec);
      return {
        pmf: compoundYards(pmfMean(rec), sd * sd, p.yards_per_reception, cv.rec * p.yards_per_reception, rec.p[0]),
        family: "zero_inflated_gamma(compound)",
      };
    }
    case "rush_att":
      return { pmf: countPmf(p.carries, position === "QB" ? d.qb_carries : d.carries), family: "negative_binomial" };
    case "rush_yds": {
      const car = countPmf(p.carries, position === "QB" ? d.qb_carries : d.carries);
      const sd = pmfSd(car);
      return {
        pmf: compoundYards(pmfMean(car), sd * sd, p.yards_per_carry, cv.rush * p.yards_per_carry, car.p[0]),
        family: "zero_inflated_gamma(compound)",
      };
    }
    case "pass_att":
      return { pmf: passAttPmf(p.pass_att, params), family: "negative_binomial_mixture(early_exit)" };
    case "pass_cmp":
      return { pmf: binomialThin(passAttPmf(p.pass_att, params), p.completion_pct), family: "negative_binomial_mixture⊗binomial" };
    case "pass_yds": {
      const cmp = binomialThin(passAttPmf(p.pass_att, params), p.completion_pct);
      const sd = pmfSd(cmp);
      return {
        pmf: compoundYards(pmfMean(cmp), sd * sd, p.yards_per_completion, cv.pass * p.yards_per_completion, cmp.p[0]),
        family: "zero_inflated_gamma(compound)",
      };
    }
    case "pass_tds":
      return { pmf: poisson(p.pass_att * p.pass_td_rate), family: "poisson" };
    case "pass_ints":
      return { pmf: poisson(p.pass_att * p.int_rate), family: "poisson" };
    case "anytime_td":
      return { pmf: poisson(p.rec_td_lambda + p.rush_td_lambda), family: "poisson" };
    case "fg_made":
      return { pmf: poisson(p.fg_att * p.fg_pct), family: "poisson" };
    case "xp_made":
      return { pmf: poisson(p.xp_mean), family: "poisson" };
    case "kicking_points":
      return { pmf: convolve(scale(poisson(p.fg_att * p.fg_pct), 3), poisson(p.xp_mean)), family: "poisson(3·FG)⊕poisson(XP)" };
  }
}
