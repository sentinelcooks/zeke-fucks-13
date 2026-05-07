import {
  evaluateNbaEdgeGate,
  type NbaEdgeGateResult,
  type ScoredPlay,
} from "./edge_scoring.ts";
import {
  normalizeCanonicalVerdict,
  normalizeConfidencePercent,
  type CanonicalVerdict,
} from "./canonical_verdict.ts";

export type NbaQueueFinalTier = "edge" | "daily" | "value";

export interface NbaQueueFinalizationResult {
  canPromote: boolean;
  canonicalVerdict: CanonicalVerdict;
  confidence: number;
  hitRate: number;
  diagnostics: Record<string, unknown>;
  finalTier: NbaQueueFinalTier;
  gate: NbaEdgeGateResult;
  promotionBlocker: string | null;
}

function roundedConfidence01(play: ScoredPlay): number {
  return Math.round(play.confidence * 1000) / 1000;
}

function finalCanonicalVerdict(play: ScoredPlay, hitRate: number): CanonicalVerdict {
  const md = (play.model_diagnostics ?? {}) as Record<string, unknown>;
  return normalizeCanonicalVerdict(md.canonical_verdict ?? play.verdict, hitRate);
}

function promotionBlockerFor(args: {
  canonicalVerdict: CanonicalVerdict;
  hitRate: number;
  gate: NbaEdgeGateResult;
  currentEdgeCount: number;
  edgeCap: number;
}): string | null {
  if (args.canonicalVerdict !== "STRONG" && args.canonicalVerdict !== "LEAN") {
    return "verdict_not_strong_or_lean";
  }
  if (args.hitRate < 70) return "confidence_below_nba_edge_min";
  if (!args.gate.ok) return "edge_gate_failed";
  if (args.currentEdgeCount >= args.edgeCap) return "edge_cap_full";
  return null;
}

export function buildNbaQueueFinalization(args: {
  baseDiagnostics: Record<string, unknown> | null | undefined;
  currentEdgeCount: number;
  edgeCap: number;
  finalized: ScoredPlay;
  now?: Date;
}): NbaQueueFinalizationResult {
  const hitRate = Math.round(normalizeConfidencePercent(args.finalized.confidence));
  const confidence = roundedConfidence01(args.finalized);
  const canonicalVerdict = finalCanonicalVerdict(args.finalized, hitRate);
  const gate = evaluateNbaEdgeGate(args.finalized);
  const promotionBlocker = promotionBlockerFor({
    canonicalVerdict,
    hitRate,
    gate,
    currentEdgeCount: args.currentEdgeCount,
    edgeCap: args.edgeCap,
  });
  const canPromote = promotionBlocker === null;
  const finalTier: NbaQueueFinalTier = canPromote
    ? "edge"
    : confidence >= 0.70
      ? "daily"
      : "value";

  const diagnostics: Record<string, unknown> = { ...(args.baseDiagnostics ?? {}) };
  delete diagnostics.analyzer_skipped_reason;

  diagnostics.canonical_confidence = hitRate;
  diagnostics.canonical_verdict = canonicalVerdict;
  diagnostics.stored_confidence = hitRate;
  diagnostics.stored_verdict = canonicalVerdict;
  diagnostics.edgeEligible = gate.ok;
  diagnostics.edge_gate_result = gate.edge_gate_result;
  diagnostics.edge_gate_inputs = gate.inputs;
  diagnostics.edge_gate_decision = gate.edge_gate_decision;
  diagnostics.edgeRejectionReasons = gate.reasons ?? [];
  diagnostics.edgeDowngradeReason =
    !gate.ok && gate.reasons.length > 0 ? gate.reasons[0] : null;
  diagnostics.heavy_juice_threshold = gate.heavyJuiceThreshold;
  diagnostics.heavy_juice_action = gate.heavyJuiceAction;
  diagnostics.postGateTier = finalTier;
  diagnostics.final_edge_eligible = canPromote;
  diagnostics.edge_pool_rank = null;
  diagnostics.edge_pool_selected = canPromote;
  diagnostics.edge_pool_selection_reason = canPromote
    ? "selected_from_queue"
    : promotionBlocker;
  diagnostics.evPct = Math.round(args.finalized.ev_pct * 100) / 100;
  diagnostics.modelEdge = Math.round(args.finalized.edge * 10000) / 10000;
  diagnostics.queue_processed_at = (args.now ?? new Date()).toISOString();

  return {
    canPromote,
    canonicalVerdict,
    confidence,
    hitRate,
    diagnostics,
    finalTier,
    gate,
    promotionBlocker,
  };
}
