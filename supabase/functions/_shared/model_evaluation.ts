// Deterministic evaluation of immutable, pregame Sentinel predictions.
//
// This module never refits a model and never treats heuristic scores as
// probabilities. It evaluates only predictions that were timestamped before
// commencement and later graded by an approved automated source.

export interface ModelEvaluationPick {
  id?: string | null;
  sport: string;
  betType: string;
  propType?: string | null;
  tier?: string | null;
  shadowEdgeCandidate?: boolean;
  modelVersion?: string | null;
  result: string;
  odds: string | number | null;
  profitUnits?: number | null;
  stakeUnits?: number | null;
  confidence?: number | null;
  rawModelScore?: number | null;
  calibratedProbability?: number | null;
  scoreKind?: string | null;
  calibrationStatus?: string | null;
  pickDate?: string | null;
  predictionRecordedAt?: string | null;
  commenceTime?: string | null;
  gradedAt?: string | null;
  gradingSource?: string | null;
  clv?: number | null;
  clvMethod?: string | null;
  closingOdds?: string | number | null;
}

export type EvaluationExclusionReason =
  | "result_unresolved"
  | "grading_source_unverified"
  | "prediction_timestamp_missing"
  | "commence_timestamp_missing"
  | "prediction_not_pregame"
  | "grading_timestamp_invalid"
  | "model_version_missing"
  | "odds_invalid";

export interface ConfidenceInterval {
  low: number | null;
  high: number | null;
  method: string;
}

export interface EvaluationMetrics {
  sampleSize: number;
  resolvedBets: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number | null;
  hitRate95: ConfidenceInterval;
  averageAmericanOdds: number | null;
  averageBreakEvenProbability: number | null;
  stakedUnits: number;
  profitUnits: number;
  roi: number | null;
  roi95: ConfidenceInterval;
  maximumDrawdownUnits: number;
  clv: {
    sampleSize: number;
    coverage: number;
    averagePercentagePoints: number | null;
    positiveRate: number | null;
  };
  calibration: {
    sampleSize: number;
    brier: number | null;
    logLoss: number | null;
    expectedCalibrationError: number | null;
    bins: Array<{
      label: string;
      sampleSize: number;
      meanPredicted: number;
      observedRate: number;
    }>;
  };
  periodStart: string | null;
  periodEnd: string | null;
}

export interface EvaluationGroup {
  key: string;
  metrics: EvaluationMetrics;
}

export interface EdgeEvidenceGate {
  key: string;
  status: "validated" | "insufficient_evidence" | "failed";
  reasons: string[];
  full: EvaluationMetrics;
  chronologicalHoldout: EvaluationMetrics;
  holdoutFraction: number;
  evidenceModelVersion: string;
}

export interface ModelEvaluationReport {
  methodology: "frozen_predictions_chronological";
  generatedAt: string;
  inputRows: number;
  includedRows: number;
  exclusions: Record<string, number>;
  overall: EvaluationMetrics;
  bySport: EvaluationGroup[];
  byMarket: EvaluationGroup[];
  byTier: EvaluationGroup[];
  byConfidenceTier: EvaluationGroup[];
  byOddsRange: EvaluationGroup[];
  byPeriod: EvaluationGroup[];
  byModelVersion: EvaluationGroup[];
  edgeEvidence: EdgeEvidenceGate[];
  limitations: string[];
}

const DAY_MS = 86_400_000;
const Z_95 = 1.959963984540054;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedResult(value: unknown): "hit" | "miss" | "push" | null {
  const result = normalize(value);
  if (result === "hit" || result === "win") return "hit";
  if (result === "miss" || result === "loss") return "miss";
  if (result === "push") return "push";
  return null;
}

export function normalizeProbability(value: unknown): number | null {
  const parsed = finite(value);
  if (parsed === null) return null;
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) return parsed / 100;
  return null;
}

export function parseEvaluationOdds(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/^\+/, ""));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function impliedProbabilityFromAmerican(value: unknown): number | null {
  const odds = parseEvaluationOdds(value);
  if (odds === null) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function calculatedProfit(pick: ModelEvaluationPick): number | null {
  const persisted = finite(pick.profitUnits);
  if (persisted !== null) return persisted;
  const result = normalizedResult(pick.result);
  const odds = parseEvaluationOdds(pick.odds);
  const stake = Math.max(0, finite(pick.stakeUnits) ?? 1);
  if (!result || odds === null || stake <= 0) return null;
  if (result === "push") return 0;
  if (result === "miss") return -stake;
  return odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
}

export function evaluationEligibility(
  pick: ModelEvaluationPick,
): { eligible: true } | { eligible: false; reason: EvaluationExclusionReason } {
  if (!normalizedResult(pick.result)) return { eligible: false, reason: "result_unresolved" };
  if (!/^espn:(nba|wnba|mlb|nhl)$/i.test(String(pick.gradingSource ?? ""))) {
    return { eligible: false, reason: "grading_source_unverified" };
  }
  const predictionMs = Date.parse(String(pick.predictionRecordedAt ?? ""));
  if (!Number.isFinite(predictionMs)) return { eligible: false, reason: "prediction_timestamp_missing" };
  const commenceMs = Date.parse(String(pick.commenceTime ?? ""));
  if (!Number.isFinite(commenceMs)) return { eligible: false, reason: "commence_timestamp_missing" };
  if (predictionMs >= commenceMs) return { eligible: false, reason: "prediction_not_pregame" };
  const gradedMs = Date.parse(String(pick.gradedAt ?? ""));
  if (!Number.isFinite(gradedMs) || gradedMs < commenceMs) {
    return { eligible: false, reason: "grading_timestamp_invalid" };
  }
  if (!String(pick.modelVersion ?? "").trim()) return { eligible: false, reason: "model_version_missing" };
  if (parseEvaluationOdds(pick.odds) === null || calculatedProfit(pick) === null) {
    return { eligible: false, reason: "odds_invalid" };
  }
  return { eligible: true };
}

export function calibrationSampleEligibility(pick: ModelEvaluationPick): boolean {
  const rawScore = normalizeProbability(
    pick.rawModelScore ??
      (normalize(pick.scoreKind) === "heuristic_score" ? pick.confidence : null),
  );
  return evaluationEligibility(pick).eligible &&
    normalizedResult(pick.result) !== "push" &&
    rawScore !== null;
}

function wilsonInterval(hits: number, total: number): ConfidenceInterval {
  if (total <= 0) return { low: null, high: null, method: "wilson_95" };
  const p = hits / total;
  const z2 = Z_95 ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return {
    low: round(Math.max(0, center - margin)),
    high: round(Math.min(1, center + margin)),
    method: "wilson_95",
  };
}

function normalMeanInterval(values: number[]): ConfidenceInterval {
  if (values.length < 2) return { low: null, high: null, method: "normal_mean_95" };
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  const margin = Z_95 * Math.sqrt(variance / values.length);
  return { low: round(average - margin), high: round(average + margin), method: "normal_mean_95" };
}

function probabilityForCalibration(pick: ModelEvaluationPick): number | null {
  if (normalize(pick.scoreKind) !== "calibrated_probability") return null;
  if (normalize(pick.calibrationStatus) !== "validated") return null;
  return normalizeProbability(pick.calibratedProbability ?? pick.confidence);
}

function calibrationMetrics(rows: ModelEvaluationPick[]): EvaluationMetrics["calibration"] {
  const samples = rows.flatMap((pick) => {
    const result = normalizedResult(pick.result);
    const probability = probabilityForCalibration(pick);
    return result && result !== "push" && probability !== null
      ? [{ probability, label: result === "hit" ? 1 : 0 }]
      : [];
  });
  if (samples.length === 0) {
    return { sampleSize: 0, brier: null, logLoss: null, expectedCalibrationError: null, bins: [] };
  }
  const epsilon = 1e-12;
  const brier = samples.reduce((sum, sample) => sum + (sample.probability - sample.label) ** 2, 0) / samples.length;
  const logLoss = -samples.reduce((sum, sample) => {
    const p = Math.min(1 - epsilon, Math.max(epsilon, sample.probability));
    return sum + sample.label * Math.log(p) + (1 - sample.label) * Math.log(1 - p);
  }, 0) / samples.length;
  const bins = Array.from({ length: 10 }, (_, index) => {
    const low = index / 10;
    const high = (index + 1) / 10;
    const members = samples.filter((sample) =>
      sample.probability >= low && (index === 9 ? sample.probability <= high : sample.probability < high)
    );
    if (!members.length) return null;
    return {
      label: `${Math.round(low * 100)}-${Math.round(high * 100)}%`,
      sampleSize: members.length,
      meanPredicted: round(members.reduce((sum, member) => sum + member.probability, 0) / members.length),
      observedRate: round(members.reduce((sum, member) => sum + member.label, 0) / members.length),
    };
  }).filter((value): value is NonNullable<typeof value> => value !== null);
  const ece = bins.reduce((sum, bin) =>
    sum + (bin.sampleSize / samples.length) * Math.abs(bin.meanPredicted - bin.observedRate), 0);
  return {
    sampleSize: samples.length,
    brier: round(brier),
    logLoss: round(logLoss),
    expectedCalibrationError: round(ece),
    bins,
  };
}

export function evaluationMetrics(rows: ModelEvaluationPick[]): EvaluationMetrics {
  const sorted = [...rows].sort((a, b) =>
    Date.parse(String(a.predictionRecordedAt ?? "")) - Date.parse(String(b.predictionRecordedAt ?? ""))
  );
  const results = sorted.map((pick) => normalizedResult(pick.result));
  const hits = results.filter((result) => result === "hit").length;
  const misses = results.filter((result) => result === "miss").length;
  const pushes = results.filter((result) => result === "push").length;
  const resolved = hits + misses;
  const odds = sorted.map((pick) => parseEvaluationOdds(pick.odds)).filter((value): value is number => value !== null);
  const breakEven = sorted
    .filter((pick) => normalizedResult(pick.result) !== "push")
    .map((pick) => impliedProbabilityFromAmerican(pick.odds))
    .filter((value): value is number => value !== null);
  const stakes = sorted.map((pick) => Math.max(0, finite(pick.stakeUnits) ?? 1));
  const profits = sorted.map((pick) => calculatedProfit(pick) ?? 0);
  const stakedUnits = stakes.reduce((sum, stake) => sum + stake, 0);
  const profitUnits = profits.reduce((sum, profit) => sum + profit, 0);
  const returns = profits.map((profit, index) => stakes[index] > 0 ? profit / stakes[index] : 0);
  let cumulative = 0;
  let peak = 0;
  let maximumDrawdown = 0;
  for (const profit of profits) {
    cumulative += profit;
    peak = Math.max(peak, cumulative);
    maximumDrawdown = Math.max(maximumDrawdown, peak - cumulative);
  }
  const clvRows = sorted
    .filter((pick) => normalize(pick.clvMethod) === "american_implied_probability_percentage_points")
    .map((pick) => finite(pick.clv))
    .filter((value): value is number => value !== null);
  const periodDates = sorted
    .map((pick) => String(pick.predictionRecordedAt ?? ""))
    .filter((value) => Number.isFinite(Date.parse(value)));
  return {
    sampleSize: sorted.length,
    resolvedBets: resolved,
    hits,
    misses,
    pushes,
    hitRate: resolved ? round(hits / resolved) : null,
    hitRate95: wilsonInterval(hits, resolved),
    averageAmericanOdds: odds.length ? round(odds.reduce((sum, value) => sum + value, 0) / odds.length, 2) : null,
    averageBreakEvenProbability: breakEven.length
      ? round(breakEven.reduce((sum, value) => sum + value, 0) / breakEven.length)
      : null,
    stakedUnits: round(stakedUnits, 2),
    profitUnits: round(profitUnits, 2),
    roi: stakedUnits > 0 ? round(profitUnits / stakedUnits) : null,
    roi95: normalMeanInterval(returns),
    maximumDrawdownUnits: round(maximumDrawdown, 2),
    clv: {
      sampleSize: clvRows.length,
      coverage: sorted.length ? round(clvRows.length / sorted.length) : 0,
      averagePercentagePoints: clvRows.length
        ? round(clvRows.reduce((sum, value) => sum + value, 0) / clvRows.length, 3)
        : null,
      positiveRate: clvRows.length ? round(clvRows.filter((value) => value > 0).length / clvRows.length) : null,
    },
    calibration: calibrationMetrics(sorted),
    periodStart: periodDates[0] ?? null,
    periodEnd: periodDates.at(-1) ?? null,
  };
}

function grouped(rows: ModelEvaluationPick[], key: (pick: ModelEvaluationPick) => string): EvaluationGroup[] {
  const groups = new Map<string, ModelEvaluationPick[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const values = groups.get(groupKey) ?? [];
    values.push(row);
    groups.set(groupKey, values);
  }
  return [...groups.entries()]
    .map(([groupKey, values]) => ({ key: groupKey, metrics: evaluationMetrics(values) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function confidenceTier(pick: ModelEvaluationPick): string {
  const calibrated = probabilityForCalibration(pick);
  const score = calibrated ?? normalizeProbability(pick.confidence);
  const prefix = calibrated !== null ? "calibrated" : "heuristic";
  if (score === null) return `${prefix}:unknown`;
  if (score >= 0.70) return `${prefix}:70%+`;
  if (score >= 0.65) return `${prefix}:65-69%`;
  if (score >= 0.60) return `${prefix}:60-64%`;
  if (score >= 0.55) return `${prefix}:55-59%`;
  return `${prefix}:below-55%`;
}

function oddsRange(pick: ModelEvaluationPick): string {
  const odds = parseEvaluationOdds(pick.odds);
  if (odds === null) return "unknown";
  if (odds <= -151) return "favorite:-151-or-shorter";
  if (odds <= -111) return "favorite:-150-to--111";
  if (odds <= 110) return "near-even:-110-to+110";
  if (odds <= 200) return "plus-money:+111-to+200";
  return "longshot:+201-or-longer";
}

function marketKey(pick: ModelEvaluationPick): string {
  const betType = normalize(pick.betType) === "over_under" ? "total" : normalize(pick.betType) || "prop";
  return betType === "prop" ? `prop:${normalize(pick.propType) || "unknown"}` : betType;
}

function releaseGate(key: string, rows: ModelEvaluationPick[]): EdgeEvidenceGate {
  const calibrated = rows
    .filter((pick) => normalize(pick.tier) === "edge" || pick.shadowEdgeCandidate === true)
    .filter((pick) => probabilityForCalibration(pick) !== null)
    .sort((a, b) => Date.parse(String(a.predictionRecordedAt)) - Date.parse(String(b.predictionRecordedAt)));
  const holdoutSize = Math.min(calibrated.length, Math.max(50, Math.ceil(calibrated.length * 0.20)));
  const holdout = calibrated.slice(Math.max(0, calibrated.length - holdoutSize));
  const full = evaluationMetrics(calibrated);
  const chronologicalHoldout = evaluationMetrics(holdout);
  const reasons: string[] = [];
  if (full.resolvedBets < 200) reasons.push("full_sample_below_200");
  if (chronologicalHoldout.resolvedBets < 50) reasons.push("holdout_sample_below_50");
  if (full.hitRate95.low === null || full.averageBreakEvenProbability === null || full.hitRate95.low <= full.averageBreakEvenProbability) {
    reasons.push("full_hit_rate_ci_not_above_break_even");
  }
  if (
    chronologicalHoldout.hitRate95.low === null ||
    chronologicalHoldout.averageBreakEvenProbability === null ||
    chronologicalHoldout.hitRate95.low <= chronologicalHoldout.averageBreakEvenProbability
  ) reasons.push("holdout_hit_rate_ci_not_above_break_even");
  if (full.roi95.low === null || full.roi95.low <= 0) reasons.push("full_roi_ci_not_positive");
  if (chronologicalHoldout.roi95.low === null || chronologicalHoldout.roi95.low <= 0) {
    reasons.push("holdout_roi_ci_not_positive");
  }
  if (full.calibration.sampleSize < 100) reasons.push("calibration_sample_below_100");
  if (
    full.calibration.expectedCalibrationError === null ||
    full.calibration.expectedCalibrationError > 0.05
  ) reasons.push("calibration_error_above_5pct");
  const insufficient = reasons.some((reason) => reason.includes("sample_below"));
  return {
    key,
    status: reasons.length === 0 ? "validated" : insufficient ? "insufficient_evidence" : "failed",
    reasons,
    full,
    chronologicalHoldout,
    holdoutFraction: calibrated.length ? round(holdout.length / calibrated.length) : 0,
    evidenceModelVersion: String(rows[0]?.modelVersion ?? ""),
  };
}

export function evaluateModelPicks(
  input: ModelEvaluationPick[],
  generatedAt = new Date().toISOString(),
): ModelEvaluationReport {
  const exclusions: Record<string, number> = {};
  const included: ModelEvaluationPick[] = [];
  for (const pick of input) {
    const eligibility = evaluationEligibility(pick);
    if (eligibility.eligible) included.push(pick);
    else exclusions[eligibility.reason] = (exclusions[eligibility.reason] ?? 0) + 1;
  }
  included.sort((a, b) => Date.parse(String(a.predictionRecordedAt)) - Date.parse(String(b.predictionRecordedAt)));
  const versionGroups = new Map<string, ModelEvaluationPick[]>();
  for (const pick of included) {
    const betType = normalize(pick.betType) === "over_under" ? "total" : normalize(pick.betType) || "prop";
    const key = `${normalize(pick.sport)}|${betType}|${String(pick.modelVersion)}`;
    const rows = versionGroups.get(key) ?? [];
    rows.push(pick);
    versionGroups.set(key, rows);
  }
  return {
    methodology: "frozen_predictions_chronological",
    generatedAt,
    inputRows: input.length,
    includedRows: included.length,
    exclusions,
    overall: evaluationMetrics(included),
    bySport: grouped(included, (pick) => normalize(pick.sport) || "unknown"),
    byMarket: grouped(included, (pick) => `${normalize(pick.sport)}:${marketKey(pick)}`),
    byTier: grouped(included, (pick) => normalize(pick.tier) || "unknown"),
    byConfidenceTier: grouped(included, confidenceTier),
    byOddsRange: grouped(included, oddsRange),
    byPeriod: grouped(included, (pick) => String(pick.predictionRecordedAt).slice(0, 7)),
    byModelVersion: grouped(included, (pick) => String(pick.modelVersion)),
    edgeEvidence: [...versionGroups.entries()].map(([key, rows]) => releaseGate(key, rows)),
    limitations: [
      "Evaluation uses frozen pregame predictions only; it does not retroactively reconstruct model inputs.",
      "ROI confidence intervals use a normal approximation to per-bet unit returns.",
      "CLV is reported only where a verified closing snapshot exists; missing CLV is never imputed.",
      `Calendar periods are UTC months; one day equals ${DAY_MS} milliseconds for deterministic ordering metadata only.`,
    ],
  };
}
