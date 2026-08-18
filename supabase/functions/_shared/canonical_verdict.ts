import { PROB_FLOOR, PROB_LEAN, PROB_STRONG } from "./thresholds.ts";

export type CanonicalVerdict = "STRONG" | "LEAN" | "RISKY" | "PASS";
export type ScoredVerdict = "Strong" | "Lean" | "Pass";

export function normalizeConfidencePercent(input: unknown, fallback = 0): number {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string"
        ? Number.parseFloat(input)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  const percent = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, percent));
}

export function normalizeConfidence01(input: unknown, fallback = 0): number {
  return normalizeConfidencePercent(input, fallback * 100) / 100;
}

export function verdictFromConfidence(input: unknown): CanonicalVerdict {
  const confidence = normalizeConfidence01(input, 0);
  if (confidence >= PROB_STRONG) return "STRONG";
  if (confidence >= PROB_LEAN) return "LEAN";
  if (confidence >= PROB_FLOOR) return "RISKY";
  return "PASS";
}

export function normalizeCanonicalVerdict(
  verdict: unknown,
  confidence?: unknown,
): CanonicalVerdict {
  const v = String(verdict ?? "").trim().toUpperCase();
  if (v.includes("STRONG")) return "STRONG";
  if (v.includes("LEAN")) return "LEAN";
  if (v.includes("RISKY") || v.includes("SLIGHT") || v.includes("MARGINAL")) return "RISKY";
  if (v.includes("PASS") || v.includes("FADE") || v.includes("DO NOT BET") || v.includes("NO BET")) return "PASS";
  return verdictFromConfidence(confidence);
}

export function scoredVerdictToCanonical(verdict: unknown): CanonicalVerdict {
  const v = String(verdict ?? "").trim().toUpperCase();
  if (v === "STRONG") return "STRONG";
  if (v === "LEAN") return "LEAN";
  return "PASS";
}

export function canonicalToScoredVerdict(verdict: CanonicalVerdict): ScoredVerdict {
  if (verdict === "STRONG") return "Strong";
  if (verdict === "LEAN") return "Lean";
  return "Pass";
}
