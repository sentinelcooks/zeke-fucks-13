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
import {
  EDGE_LEAN_MIN,
  PROB_LEAN,
} from "./thresholds.ts";

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

function probabilityIsSupported(play: ScoredPlay): boolean {
  const diagnostics = (play.model_diagnostics ?? {}) as Record<string, unknown>;
  return diagnostics.probability_supported === true &&
    diagnostics.score_kind === "calibrated_probability" &&
    diagnostics.calibration_status === "validated";
}

function promotionBlockerFor(args: {
  canonicalVerdict: CanonicalVerdict;
  hitRate: number;
  gate: NbaEdgeGateResult;
  currentEdgeCount: number;
  edgeCap: number;
  probabilitySupported: boolean;
}): string | null {
  if (!args.probabilitySupported) return "calibration_not_supported";
  if (args.canonicalVerdict !== "STRONG" && args.canonicalVerdict !== "LEAN") {
    return "verdict_not_strong_or_lean";
  }
  if (args.hitRate < 70) return "confidence_below_nba_edge_min";
  if (!args.gate.ok) return "edge_gate_failed";
  if (args.currentEdgeCount >= args.edgeCap) return "edge_cap_full";
  return null;
}

// For sports other than NBA the NBA edge gate would always fail (it requires
// NBA-only diagnostic fields like marketDataQuality / opponentResolutionStatus
// and applies NBA heavy-juice thresholds). WNBA/MLB/NHL/UFC picks never carry those
// fields, so every queue row was being demoted to daily/value and tier='edge'
// was permanently empty for those sports. This finalizer mirrors the non-NBA
// branch in sport_scan.ts but operates per-row using the running edge count
// the worker maintains. It preserves the shared Lean thresholds instead of
// applying NBA's 70% edge minimum to every sport.
export function buildGenericQueueFinalization(args: {
  baseDiagnostics: Record<string, unknown> | null | undefined;
  currentEdgeCount: number;
  edgeCap: number;
  finalized: ScoredPlay;
  now?: Date;
}): NbaQueueFinalizationResult {
  const hitRate = Math.round(normalizeConfidencePercent(args.finalized.confidence));
  const confidence = roundedConfidence01(args.finalized);
  const canonicalVerdict = finalCanonicalVerdict(args.finalized, hitRate);

  let promotionBlocker: string | null = null;
  if (!probabilityIsSupported(args.finalized)) {
    promotionBlocker = "calibration_not_supported";
  } else if (canonicalVerdict !== "STRONG" && canonicalVerdict !== "LEAN") {
    promotionBlocker = "verdict_not_strong_or_lean";
  } else if (args.finalized.confidence < PROB_LEAN) {
    promotionBlocker = "confidence_below_lean_min";
  } else if (args.finalized.edge < EDGE_LEAN_MIN) {
    promotionBlocker = "edge_below_lean_min";
  } else if (args.currentEdgeCount >= args.edgeCap) {
    promotionBlocker = "edge_cap_full";
  }
  const canPromote = promotionBlocker === null;
  const finalTier: NbaQueueFinalTier = canPromote
    ? "edge"
    : confidence >= PROB_LEAN
      ? "daily"
      : "value";

  const diagnostics: Record<string, unknown> = { ...(args.baseDiagnostics ?? {}) };
  delete diagnostics.analyzer_skipped_reason;
  diagnostics.canonical_confidence = hitRate;
  diagnostics.canonical_verdict = canonicalVerdict;
  diagnostics.stored_confidence = hitRate;
  diagnostics.stored_verdict = canonicalVerdict;
  diagnostics.postGateTier = finalTier;
  diagnostics.final_edge_eligible = canPromote;
  diagnostics.edge_pool_rank = null;
  diagnostics.edge_pool_selected = canPromote;
  diagnostics.edge_pool_selection_reason = canPromote
    ? "selected_from_queue_generic"
    : promotionBlocker;
  diagnostics.edgeDowngradeReason = promotionBlocker;
  diagnostics.evPct = Math.round(args.finalized.ev_pct * 100) / 100;
  diagnostics.modelEdge = Math.round(args.finalized.edge * 10000) / 10000;
  diagnostics.queue_processed_at = (args.now ?? new Date()).toISOString();

  // Synthesize a minimal gate result matching the NBA gate shape so the
  // worker's downstream telemetry (which assumes that shape) is uniform.
  // Non-NBA sports don't have an analogous gate today; this is a placeholder.
  const gate: NbaEdgeGateResult = {
    ok: canPromote,
    reasons: promotionBlocker ? [promotionBlocker] : [],
    hardSafetyFail: false,
    edge_gate_result: canPromote ? "passed" : "failed",
    edge_gate_decision: {},
    inputs: {
      canonical_confidence: hitRate,
      canonical_verdict: canonicalVerdict,
      stored_confidence: hitRate,
      stored_verdict: canonicalVerdict,
      oddsAmerican: args.finalized.odds,
      evPct: Math.round(args.finalized.ev_pct * 100) / 100,
      modelEdge: Math.round(args.finalized.edge * 10000) / 10000,
      bookCount: null,
      marketDataQuality: null,
      marketDepth: null,
      opponentResolutionStatus: null,
      hasTeam: !!args.finalized.team,
      hasOpponent: !!args.finalized.opponent,
    },
    heavyJuiceThreshold: 0,
    heavyJuiceAction: "penalty",
  };

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

export function buildWnbaQueueFinalization(args: {
  baseDiagnostics: Record<string, unknown> | null | undefined;
  currentEdgeCount: number;
  edgeCap: number;
  finalized: ScoredPlay;
  now?: Date;
}): NbaQueueFinalizationResult {
  const generic = buildGenericQueueFinalization(args);
  const diagnostics = { ...generic.diagnostics } as Record<string, unknown>;
  const missing = Array.isArray(diagnostics.missing_inputs)
    ? diagnostics.missing_inputs.map((value) => String(value))
    : [];
  const quality = String(diagnostics.wnba_data_quality ?? "").toLowerCase();
  const marketQuality = String(diagnostics.marketDataQuality ?? "").toLowerCase();
  const bookCount = Number(diagnostics.bookCount ?? 0);
  const betType = args.finalized.bet_type;
  let wnbaBlocker: string | null = generic.promotionBlocker;

  if (!wnbaBlocker && quality === "low") wnbaBlocker = "wnba_data_quality_low";
  if (!wnbaBlocker && diagnostics.injury_source_available !== true) {
    wnbaBlocker = "wnba_injury_source_unavailable";
  }
  if (!wnbaBlocker && (!Number.isFinite(bookCount) || bookCount < 3 || !["medium", "high"].includes(marketQuality))) {
    wnbaBlocker = "wnba_market_depth_insufficient";
  }

  if (betType === "prop") {
    const currentSample = Number(diagnostics.current_season_sample ?? 0);
    if (!wnbaBlocker && diagnostics.lineup_status !== "confirmed") {
      wnbaBlocker = "wnba_starting_lineup_unconfirmed";
    }
    if (!wnbaBlocker && diagnostics.player_starting === false) {
      wnbaBlocker = "wnba_player_not_starting";
    }
    if (!wnbaBlocker && ["questionable", "day-to-day", "out", "doubtful"].includes(String(diagnostics.player_availability ?? "").toLowerCase())) {
      wnbaBlocker = "wnba_player_availability_risk";
    }
    if (!wnbaBlocker && diagnostics.minutes_restriction === true) {
      wnbaBlocker = "wnba_minutes_restriction";
    }
    if (!wnbaBlocker && currentSample < 10) {
      wnbaBlocker = "wnba_current_sample_below_10";
    }
  } else {
    const samples = diagnostics.current_season_samples as Record<string, unknown> | null | undefined;
    if (!wnbaBlocker && diagnostics.matchup_confirmed !== true) {
      wnbaBlocker = "wnba_matchup_unconfirmed";
    }
    if (!wnbaBlocker && diagnostics.lineup_status !== "confirmed") {
      wnbaBlocker = "wnba_starting_lineups_unconfirmed";
    }
    if (!wnbaBlocker && diagnostics.selected_side_confirmed !== true) {
      wnbaBlocker = "wnba_selected_side_unverified";
    }
    if (!wnbaBlocker && (Number(samples?.selected ?? 0) < 5 || Number(samples?.opponent ?? 0) < 5)) {
      wnbaBlocker = "wnba_team_sample_below_5";
    }
  }

  if (!wnbaBlocker && missing.includes("INJURY_SOURCE_UNAVAILABLE")) {
    wnbaBlocker = "wnba_injury_source_unavailable";
  }

  const canPromote = wnbaBlocker === null;
  const finalTier: NbaQueueFinalTier = canPromote
    ? "edge"
    : generic.confidence >= PROB_LEAN
      ? "daily"
      : "value";
  diagnostics.postGateTier = finalTier;
  diagnostics.final_edge_eligible = canPromote;
  diagnostics.edge_pool_selected = canPromote;
  diagnostics.edge_pool_selection_reason = canPromote ? "selected_from_queue_wnba" : wnbaBlocker;
  diagnostics.edgeDowngradeReason = wnbaBlocker;
  diagnostics.wnba_edge_gate = {
    ok: canPromote,
    blocker: wnbaBlocker,
    data_quality: quality || null,
    market_quality: marketQuality || null,
    book_count: Number.isFinite(bookCount) ? bookCount : null,
  };

  return {
    ...generic,
    canPromote,
    diagnostics,
    finalTier,
    gate: {
      ...generic.gate,
      ok: canPromote,
      reasons: wnbaBlocker ? [wnbaBlocker] : [],
      hardSafetyFail: !!wnbaBlocker && [
        "wnba_injury_source_unavailable",
        "wnba_player_availability_risk",
        "wnba_minutes_restriction",
        "wnba_matchup_unconfirmed",
        "wnba_starting_lineups_unconfirmed",
        "wnba_selected_side_unverified",
      ].includes(wnbaBlocker),
      edge_gate_result: canPromote ? "passed" : "failed",
    },
    promotionBlocker: wnbaBlocker,
  };
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
    probabilitySupported: probabilityIsSupported(args.finalized),
  });
  const canPromote = promotionBlocker === null;
  const finalTier: NbaQueueFinalTier = canPromote
    ? "edge"
    : confidence >= PROB_LEAN
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
