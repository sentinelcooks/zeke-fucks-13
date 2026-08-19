export const CALIBRATION_MIN_TRAIN_SAMPLES = 200;
export const CALIBRATION_MIN_TEST_SAMPLES = 50;
export const CALIBRATION_HOLDOUT_FRACTION = 0.2;

export interface TimestampedCalibrationSample {
  score: number;
  label: number;
  occurred_at: string;
}

export interface CalibrationEvidence {
  active?: boolean | null;
  method?: string | null;
  n_samples?: number | null;
  train_samples?: number | null;
  test_samples?: number | null;
  holdout_passed?: boolean | null;
  evaluation_method?: string | null;
  model_version?: string | null;
}

export interface CalibrationActivationMetrics {
  trainSamples: number;
  testSamples: number;
  baselineBrier: number;
  calibratedBrier: number;
  baselineLogLoss: number;
  calibratedLogLoss: number;
}

export function chronologicalCalibrationSplit<T extends TimestampedCalibrationSample>(
  samples: T[],
): { train: T[]; test: T[] } {
  const sorted = [...samples]
    .filter((sample) => Number.isFinite(Date.parse(sample.occurred_at)))
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  if (sorted.length === 0) return { train: [], test: [] };
  const requestedTest = Math.max(
    CALIBRATION_MIN_TEST_SAMPLES,
    Math.ceil(sorted.length * CALIBRATION_HOLDOUT_FRACTION),
  );
  const testSize = Math.min(requestedTest, sorted.length);
  const splitIndex = sorted.length - testSize;
  return {
    train: sorted.slice(0, splitIndex),
    test: sorted.slice(splitIndex),
  };
}

export function calibrationActivationDecision(metrics: CalibrationActivationMetrics): {
  activate: boolean;
  reason: string;
} {
  if (metrics.trainSamples < CALIBRATION_MIN_TRAIN_SAMPLES) {
    return { activate: false, reason: "insufficient_training_samples" };
  }
  if (metrics.testSamples < CALIBRATION_MIN_TEST_SAMPLES) {
    return { activate: false, reason: "insufficient_holdout_samples" };
  }
  if (!Number.isFinite(metrics.baselineBrier) || !Number.isFinite(metrics.calibratedBrier)) {
    return { activate: false, reason: "invalid_brier_score" };
  }
  if (!Number.isFinite(metrics.baselineLogLoss) || !Number.isFinite(metrics.calibratedLogLoss)) {
    return { activate: false, reason: "invalid_log_loss" };
  }
  if (metrics.calibratedBrier >= metrics.baselineBrier) {
    return { activate: false, reason: "holdout_brier_not_improved" };
  }
  if (metrics.calibratedLogLoss >= metrics.baselineLogLoss) {
    return { activate: false, reason: "holdout_log_loss_not_improved" };
  }
  return { activate: true, reason: "chronological_holdout_improved" };
}

export function hasSupportedCalibration(
  evidence: CalibrationEvidence | null | undefined,
  expectedModelVersion: string | null | undefined,
): boolean {
  if (!evidence) return false;
  const expected = String(expectedModelVersion ?? "").trim();
  const fitted = String(evidence.model_version ?? "").trim();
  if (!expected || !fitted || expected !== fitted) return false;
  return evidence.active === true &&
    evidence.method !== "identity" &&
    evidence.holdout_passed === true &&
    evidence.evaluation_method === "chronological_holdout" &&
    Number(evidence.train_samples ?? 0) >= CALIBRATION_MIN_TRAIN_SAMPLES &&
    Number(evidence.test_samples ?? 0) >= CALIBRATION_MIN_TEST_SAMPLES;
}
