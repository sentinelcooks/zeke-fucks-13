import { describe, expect, it } from "vitest";
import {
  calibrationSampleEligibility,
  evaluateModelPicks,
  evaluationEligibility,
  evaluationMetrics,
  type ModelEvaluationPick,
} from "../../supabase/functions/_shared/model_evaluation";

function pick(overrides: Partial<ModelEvaluationPick> = {}): ModelEvaluationPick {
  return {
    id: "pick-1",
    sport: "wnba",
    betType: "prop",
    propType: "points",
    tier: "edge",
    modelVersion: "wnba-verified-props-v1",
    result: "hit",
    odds: -110,
    profitUnits: 0.9091,
    stakeUnits: 1,
    confidence: 0.70,
    calibratedProbability: 0.70,
    scoreKind: "calibrated_probability",
    calibrationStatus: "validated",
    pickDate: "2026-08-18",
    predictionRecordedAt: "2026-08-18T12:00:00Z",
    commenceTime: "2026-08-18T20:00:00Z",
    gradedAt: "2026-08-18T23:00:00Z",
    gradingSource: "espn:wnba",
    clv: 1.25,
    clvMethod: "american_implied_probability_percentage_points",
    closingOdds: -120,
    ...overrides,
  };
}

describe("model evaluation cohort integrity", () => {
  it("requires an automated grade, immutable model version, and a pregame timestamp", () => {
    expect(evaluationEligibility(pick())).toEqual({ eligible: true });
    expect(evaluationEligibility(pick({ gradingSource: "manual" }))).toEqual({
      eligible: false,
      reason: "grading_source_unverified",
    });
    expect(evaluationEligibility(pick({ predictionRecordedAt: "2026-08-18T21:00:00Z" }))).toEqual({
      eligible: false,
      reason: "prediction_not_pregame",
    });
    expect(evaluationEligibility(pick({ modelVersion: null }))).toEqual({
      eligible: false,
      reason: "model_version_missing",
    });
  });

  it("allows calibration training only from verified heuristic scores", () => {
    expect(calibrationSampleEligibility(pick({
      scoreKind: "heuristic_score",
      calibratedProbability: null,
    }))).toBe(true);
    expect(calibrationSampleEligibility(pick())).toBe(false);
    expect(calibrationSampleEligibility(pick({ rawModelScore: 0.68 }))).toBe(true);
    expect(calibrationSampleEligibility(pick({ scoreKind: "heuristic_score", gradingSource: "user" }))).toBe(false);
  });

  it("calculates hit rate, ROI, drawdown, CLV, and calibration without imputation", () => {
    const metrics = evaluationMetrics([
      pick({ id: "1", result: "miss", profitUnits: -1, clv: null, clvMethod: null }),
      pick({ id: "2", result: "miss", profitUnits: -1, predictionRecordedAt: "2026-08-18T12:01:00Z" }),
      pick({ id: "3", result: "hit", profitUnits: 0.9091, predictionRecordedAt: "2026-08-18T12:02:00Z" }),
      pick({ id: "4", result: "push", profitUnits: 0, predictionRecordedAt: "2026-08-18T12:03:00Z" }),
    ]);

    expect(metrics.resolvedBets).toBe(3);
    expect(metrics.hitRate).toBeCloseTo(1 / 3, 4);
    expect(metrics.profitUnits).toBe(-1.09);
    expect(metrics.roi).toBeCloseTo(-0.2727, 3);
    expect(metrics.maximumDrawdownUnits).toBe(2);
    expect(metrics.clv.sampleSize).toBe(3);
    expect(metrics.clv.coverage).toBe(0.75);
    expect(metrics.calibration.sampleSize).toBe(3);
    expect(metrics.hitRate95.method).toBe("wilson_95");
  });

  it("never validates an Edge cohort with too little chronological evidence", () => {
    const report = evaluateModelPicks([pick()], "2026-08-19T00:00:00Z");
    expect(report.edgeEvidence[0].status).toBe("insufficient_evidence");
    expect(report.edgeEvidence[0].reasons).toContain("full_sample_below_200");
  });

  it("validates only when full and chronological holdout evidence clear every gate", () => {
    const rows = Array.from({ length: 250 }, (_, index) => {
      const result = index % 25 < 18 ? "hit" : "miss";
      const prediction = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000);
      const commence = new Date(prediction.getTime() + 8 * 3_600_000);
      const graded = new Date(commence.getTime() + 3 * 3_600_000);
      return pick({
        id: String(index),
        tier: "daily",
        shadowEdgeCandidate: true,
        result,
        profitUnits: result === "hit" ? 0.9091 : -1,
        predictionRecordedAt: prediction.toISOString(),
        commenceTime: commence.toISOString(),
        gradedAt: graded.toISOString(),
        clv: index % 2 === 0 ? 1 : null,
        clvMethod: index % 2 === 0 ? "american_implied_probability_percentage_points" : null,
      });
    });
    const report = evaluateModelPicks(rows, "2027-01-01T00:00:00Z");
    expect(report.edgeEvidence[0].status).toBe("validated");
    expect(report.edgeEvidence[0].chronologicalHoldout.resolvedBets).toBe(50);
    expect(report.bySport[0].metrics.sampleSize).toBe(250);
    expect(report.byPeriod.length).toBeGreaterThan(1);
  });
});
