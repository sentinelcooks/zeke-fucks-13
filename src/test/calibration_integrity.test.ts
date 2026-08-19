import { describe, expect, it } from "vitest";
import {
  calibrationActivationDecision,
  chronologicalCalibrationSplit,
  hasSupportedCalibration,
} from "../../supabase/functions/_shared/calibration_policy";

function samples(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    score: 0.4 + (index % 20) / 100,
    label: index % 2,
    occurred_at: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
  })).reverse();
}

describe("chronological calibration evidence", () => {
  it("keeps the newest observations exclusively in the holdout", () => {
    const split = chronologicalCalibrationSplit(samples(250));
    expect(split.train).toHaveLength(200);
    expect(split.test).toHaveLength(50);
    expect(Date.parse(split.train.at(-1)!.occurred_at)).toBeLessThan(
      Date.parse(split.test[0].occurred_at),
    );
  });

  it("rejects fits without at least 200 training and 50 holdout samples", () => {
    expect(calibrationActivationDecision({
      trainSamples: 199,
      testSamples: 50,
      baselineBrier: 0.25,
      calibratedBrier: 0.24,
      baselineLogLoss: 0.7,
      calibratedLogLoss: 0.69,
    })).toEqual({ activate: false, reason: "insufficient_training_samples" });
  });

  it("requires both holdout Brier and log loss to improve", () => {
    expect(calibrationActivationDecision({
      trainSamples: 200,
      testSamples: 50,
      baselineBrier: 0.25,
      calibratedBrier: 0.24,
      baselineLogLoss: 0.69,
      calibratedLogLoss: 0.70,
    })).toEqual({ activate: false, reason: "holdout_log_loss_not_improved" });

    expect(calibrationActivationDecision({
      trainSamples: 200,
      testSamples: 50,
      baselineBrier: 0.25,
      calibratedBrier: 0.24,
      baselineLogLoss: 0.70,
      calibratedLogLoss: 0.69,
    })).toEqual({ activate: true, reason: "chronological_holdout_improved" });
  });

  it("does not trust a legacy active row without holdout evidence", () => {
    expect(hasSupportedCalibration({
      active: true,
      method: "platt",
      model_version: "wnba-v1",
      train_samples: 500,
      test_samples: 0,
      holdout_passed: false,
      evaluation_method: null,
    }, "wnba-v1")).toBe(false);

    expect(hasSupportedCalibration({
      active: true,
      method: "platt",
      model_version: "wnba-v1",
      train_samples: 200,
      test_samples: 50,
      holdout_passed: true,
      evaluation_method: "chronological_holdout",
    }, "wnba-v1")).toBe(true);
    expect(hasSupportedCalibration({
      active: true,
      method: "platt",
      model_version: "wnba-v1",
      train_samples: 200,
      test_samples: 50,
      holdout_passed: true,
      evaluation_method: "chronological_holdout",
    }, "wnba-v2")).toBe(false);
  });
});
