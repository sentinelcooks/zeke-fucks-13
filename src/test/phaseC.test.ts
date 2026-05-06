/**
 * Phase C source-of-truth tests.
 *
 * These intentionally import the shared frontend verdict utility instead of
 * mirroring page-local threshold logic. If ModernHomeLayout, NbaPropsPage, or
 * WrittenAnalysis need a label, they should flow through this same utility.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeConfidence01,
  normalizeConfidencePercent,
  normalizeVerdict,
  verdictFromConfidence,
} from "@/lib/matchupGrade";

const renderModernHomeLabel = (confidence: unknown, verdict?: unknown) =>
  normalizeVerdict(verdict, normalizeConfidencePercent(confidence));

const renderAnalyzePageLabel = (confidence: unknown, verdict?: unknown) =>
  normalizeVerdict(verdict, normalizeConfidencePercent(confidence));

const renderSavedPickLabel = (confidence: unknown, verdict?: unknown) =>
  normalizeVerdict(verdict, normalizeConfidencePercent(confidence));

describe("canonical confidence normalization", () => {
  it.each([
    [0.83, 83],
    [83, 83],
    [72, 72],
    [0.72, 72],
    [-5, 0],
    [105, 100],
  ])("normalizes %s to %s percent", (input, expected) => {
    expect(normalizeConfidencePercent(input)).toBe(expected);
  });

  it("normalizes to decimal after fixing percent/decimal scale", () => {
    expect(normalizeConfidence01(0.83)).toBeCloseTo(0.83, 5);
    expect(normalizeConfidence01(83)).toBeCloseTo(0.83, 5);
  });
});

describe("canonical verdict mapping", () => {
  it("maps 72 the same everywhere", () => {
    expect(verdictFromConfidence(72)).toBe("STRONG");
    expect(renderModernHomeLabel(72)).toBe("STRONG");
    expect(renderSavedPickLabel(72)).toBe("STRONG");
    expect(renderAnalyzePageLabel(72)).toBe("STRONG");
  });

  it("does not leak decimals as tiny percentages", () => {
    expect(renderModernHomeLabel(0.72)).toBe("STRONG");
    expect(renderSavedPickLabel(0.83)).toBe("STRONG");
  });

  it("preserves explicit canonical analyzer verdicts across renderers", () => {
    for (const verdict of ["STRONG", "LEAN", "RISKY", "PASS"] as const) {
      expect(renderModernHomeLabel(99, verdict)).toBe(verdict);
      expect(renderSavedPickLabel(99, verdict)).toBe(verdict);
      expect(renderAnalyzePageLabel(99, verdict)).toBe(verdict);
    }
  });

  it("keeps a saved Today Edge NBA pick within exact verdict and 1 point confidence tolerance", () => {
    const savedPick = { confidence: 0.72, verdict: "LEAN" };
    const manualAnalyze = { confidence: 72, verdict: "LEAN" };

    const savedConfidence = Math.round(normalizeConfidencePercent(savedPick.confidence));
    const manualConfidence = Math.round(normalizeConfidencePercent(manualAnalyze.confidence));

    expect(renderModernHomeLabel(savedConfidence, savedPick.verdict)).toBe(
      renderAnalyzePageLabel(manualConfidence, manualAnalyze.verdict),
    );
    expect(Math.abs(savedConfidence - manualConfidence)).toBeLessThanOrEqual(1);
  });

  it("daily_picks rows carry the stored canonical fields required by the UI", () => {
    const row = {
      confidence: normalizeConfidence01(72),
      hit_rate: Math.round(normalizeConfidencePercent(72)),
      verdict: normalizeVerdict("LEAN", 72),
      tier: "edge",
    };

    expect(row).toMatchObject({
      confidence: 0.72,
      hit_rate: 72,
      verdict: "LEAN",
      tier: "edge",
    });
  });
});
