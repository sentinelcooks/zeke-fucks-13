export interface GenericQualityPenaltyInput {
  rawConfidence: number;
  confidencePenalty: number;
  sport?: string | null;
  model?: string | null;
}

export interface GenericQualityPenaltyResult {
  confidence: number;
  appliedPenalty: number;
  skippedDuplicatePenalty: boolean;
}

/**
 * Applies the generic post-model quality penalty exactly once.
 *
 * The verified MLB player-prop model already shrinks its weighted score toward
 * 50 for missing lineup, pitch-type, recent-start, and sample inputs. Applying
 * the generic subtraction afterward would penalize the same uncertainty twice.
 */
export function applyGenericQualityPenalty({
  rawConfidence,
  confidencePenalty,
  sport,
  model,
}: GenericQualityPenaltyInput): GenericQualityPenaltyResult {
  const raw = Number.isFinite(rawConfidence) ? rawConfidence : 0;
  const requestedPenalty = Number.isFinite(confidencePenalty)
    ? Math.max(0, confidencePenalty)
    : 0;
  const modelAlreadyOwnsQualityAdjustment =
    String(sport || "").toLowerCase() === "mlb"
    && model === "mlb-verified-context-props-v2";
  const appliedPenalty = modelAlreadyOwnsQualityAdjustment ? 0 : requestedPenalty;

  return {
    confidence: Math.max(0, Math.min(100, raw - appliedPenalty)),
    appliedPenalty,
    skippedDuplicatePenalty: modelAlreadyOwnsQualityAdjustment && requestedPenalty > 0,
  };
}
