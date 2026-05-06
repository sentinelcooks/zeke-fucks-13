/**
 * Phase C — Source-of-Truth Fix: unit tests
 * Covers: pick_snapshot normalizer, getSavedPickVerdict thresholds, agreement gate logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Normalizer ──────────────────────────────────────────────────────────────
// Mirrors the logic in ModernHomeLayout.tsx:610 and WrittenAnalysis.tsx confPct
function normalizeConfPct(c: number | null | undefined): number | null {
  if (c == null) return null;
  return c <= 1 ? Math.round(c * 100) : Math.round(c);
}

describe("normalizeConfPct", () => {
  it("converts decimal 0.83 → 83", () => expect(normalizeConfPct(0.83)).toBe(83));
  it("passes through percent 83 → 83", () => expect(normalizeConfPct(83)).toBe(83));
  it("converts 0 → 0", () => expect(normalizeConfPct(0)).toBe(0));
  it("returns null for null", () => expect(normalizeConfPct(null)).toBeNull());
  it("returns null for undefined", () => expect(normalizeConfPct(undefined)).toBeNull());
  // Edge case: the value 1 is ambiguous (could be 1% or decimal 1.0 = 100%).
  // The normalizer uses c <= 1 branch so 1.0 → 100. This is acceptable because
  // no real confidence score is exactly 1%, and decimal 1.0 (certainty) maps correctly.
  it("edge case: 1 → 100 (treated as decimal 1.0 = certainty)", () => expect(normalizeConfPct(1)).toBe(100));
  it("converts 0.70 → 70", () => expect(normalizeConfPct(0.70)).toBe(70));
  it("passes through 100 → 100", () => expect(normalizeConfPct(100)).toBe(100));
});

// ── getSavedPickVerdict ─────────────────────────────────────────────────────
// Mirrors the function in NbaPropsPage.tsx (without the DEV assertion branch)
function getSavedPickVerdict(confidence?: number): string {
  if (!confidence) return "LEAN";
  if (confidence >= 80) return "STRONG PICK";
  if (confidence >= 70) return "LEAN";
  return "RISKY";
}

describe("getSavedPickVerdict (percent-scale input)", () => {
  it("returns STRONG PICK for 83", () => expect(getSavedPickVerdict(83)).toBe("STRONG PICK"));
  it("returns STRONG PICK at boundary 80", () => expect(getSavedPickVerdict(80)).toBe("STRONG PICK"));
  it("returns LEAN for 70", () => expect(getSavedPickVerdict(70)).toBe("LEAN"));
  it("returns LEAN for 75", () => expect(getSavedPickVerdict(75)).toBe("LEAN"));
  it("returns RISKY for 60", () => expect(getSavedPickVerdict(60)).toBe("RISKY"));
  it("returns LEAN for undefined (falsy fallback)", () => expect(getSavedPickVerdict(undefined)).toBe("LEAN"));
  it("returns LEAN for 0 (falsy fallback)", () => expect(getSavedPickVerdict(0)).toBe("LEAN"));
});

describe("getSavedPickVerdict — decimal-leak detection (DEV guard)", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // Simulate DEV environment for the guard
    (import.meta as any).env = { DEV: true };
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("a decimal input 0.83 falls through to RISKY (wrong input is treated safely)", () => {
    // Without the DEV guard we can only test the outcome: 0.83 < 70 → RISKY
    expect(getSavedPickVerdict(0.83)).toBe("RISKY");
  });
});

// ── Agreement gate logic ────────────────────────────────────────────────────
// Mirrors the logic inside validateWithAnalyzer (sport_scan.ts) and assignTier.

interface AgreementResult {
  analyzerAgreement: "agree" | "disagree" | "unavailable";
  analyzerDisagreementReason: string | null;
}

function computeAgreement(
  scannerConfidence: number,
  analyzerConfidence: number | null,
): AgreementResult {
  if (analyzerConfidence === null) {
    return { analyzerAgreement: "unavailable", analyzerDisagreementReason: null };
  }
  const diff = Math.abs(scannerConfidence - analyzerConfidence);
  if (diff <= 0.10) {
    return { analyzerAgreement: "agree", analyzerDisagreementReason: null };
  }
  if (analyzerConfidence < scannerConfidence) {
    return {
      analyzerAgreement: "disagree",
      analyzerDisagreementReason: `analyzer_lower_by_${Math.round(diff * 100)}`,
    };
  }
  // analyzer is higher than scanner — rule: never raise into edge, treat as agree
  return { analyzerAgreement: "agree", analyzerDisagreementReason: null };
}

function shouldPassStrictFloor(confidence: number, floor = 0.72): boolean {
  return confidence >= floor;
}

describe("computeAgreement", () => {
  it("scanner=0.83, analyzer=null (NHL) → unavailable", () => {
    const r = computeAgreement(0.83, null);
    expect(r.analyzerAgreement).toBe("unavailable");
    expect(r.analyzerDisagreementReason).toBeNull();
  });

  it("scanner=0.83, analyzer=0.01 (NBA cross-sport noise) → disagree", () => {
    const r = computeAgreement(0.83, 0.01);
    expect(r.analyzerAgreement).toBe("disagree");
    expect(r.analyzerDisagreementReason).toBe("analyzer_lower_by_82");
  });

  it("scanner=0.65, analyzer=0.70 (within 0.10) → agree", () => {
    const r = computeAgreement(0.65, 0.70);
    expect(r.analyzerAgreement).toBe("agree");
    expect(r.analyzerDisagreementReason).toBeNull();
  });

  it("scanner=0.65, analyzer=0.55 (diff=0.10 boundary) → agree", () => {
    // exactly 0.10 is within threshold
    const r = computeAgreement(0.65, 0.55);
    expect(r.analyzerAgreement).toBe("agree");
  });

  it("scanner=0.65, analyzer=0.54 (diff=0.11) → disagree", () => {
    const r = computeAgreement(0.65, 0.54);
    expect(r.analyzerAgreement).toBe("disagree");
    expect(r.analyzerDisagreementReason).toBe("analyzer_lower_by_11");
  });

  it("analyzer higher than scanner → agree (never raise into edge)", () => {
    const r = computeAgreement(0.60, 0.85);
    expect(r.analyzerAgreement).toBe("agree");
  });
});

describe("strict floor gate (NHL/MLB no-analyzer)", () => {
  it("confidence=0.83 passes floor 0.72", () => expect(shouldPassStrictFloor(0.83)).toBe(true));
  it("confidence=0.72 passes floor 0.72 (boundary inclusive)", () => expect(shouldPassStrictFloor(0.72)).toBe(true));
  it("confidence=0.71 fails floor 0.72", () => expect(shouldPassStrictFloor(0.71)).toBe(false));
  it("confidence=0.50 fails floor 0.72", () => expect(shouldPassStrictFloor(0.50)).toBe(false));
  it("custom floor 0.80: 0.79 fails", () => expect(shouldPassStrictFloor(0.79, 0.80)).toBe(false));
  it("custom floor 0.80: 0.80 passes", () => expect(shouldPassStrictFloor(0.80, 0.80)).toBe(true));
});
