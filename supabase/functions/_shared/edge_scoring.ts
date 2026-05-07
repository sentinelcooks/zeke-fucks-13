// Unified scoring + verdict tiering for the daily slate engine. v3-calibrated
// qualityScore = calibratedProb * reliability * (1 + edge) * hitRateFactor
//
// v3 changes (vs v2-strict-longshot-cap):
//   • probability math lives in prob_math.ts (vig removal + calibration + shrinkage)
//   • tier thresholds live in thresholds.ts (single source of truth)
//   • `projected_prob` and `confidence` are now CALIBRATED (0-1); callers pass the
//     raw model confidence and we calibrate + de-vig here if the caller
//     supplies an opposing American price (`odds_opp`).
//   • rankAndDistribute fallback filler now pulls from the full sorted list
//     (Strong + Lean), not the already-drained Strong set — fixes empty
//     Today's Edge on slow slates.
//
// All probabilities are 0-1 scale.

import {
  americanToImplied,
  fairImpliedFromPair,
  calcEvPct,
  applyCalibration,
  clamp01,
  type Calibration,
} from "./prob_math.ts";
import {
  PROB_STRONG,
  PROB_LEAN,
  PROB_FLOOR,
  EDGE_STRONG_MIN,
  EDGE_LEAN_MIN,
  RELIABILITY_STRONG_MIN,
  RELIABILITY_LEAN_MIN,
  RELIABILITY_FLOOR,
  LONGSHOT_ODDS_MAX,
  MID_LONGSHOT_ODDS_MIN,
  MID_LONGSHOT_CONF_MIN,
  MID_LONGSHOT_EDGE_MIN,
  MID_LONGSHOT_RELIABILITY_MIN,
  VOLATILE_UNDER_CONF_MIN,
  VOLATILE_UNDER_EDGE_MIN,
  NBA_HEAVY_JUICE_ODDS,
  NBA_EXTREME_JUICE_ODDS,
  NBA_EXTREME_JUICE_EXEMPT_CONF_MIN,
  NBA_EXTREME_JUICE_EXEMPT_EV_MIN,
  NBA_EXTREME_JUICE_EXEMPT_EDGE_MIN,
} from "./thresholds.ts";
import {
  normalizeCanonicalVerdict,
  normalizeConfidencePercent,
  scoredVerdictToCanonical,
  type CanonicalVerdict,
} from "./canonical_verdict.ts";
import { normalizeNbaPropType } from "./prop_normalization.ts";

export interface ScoredPlay {
  sport: string;
  bet_type: "prop" | "moneyline" | "spread" | "total";
  player_name: string;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type: string;
  line: number;
  spread_line?: number | null;
  total_line?: number | null;
  direction: string;
  odds: number;
  odds_opp?: number | null;       // opposing book price, if known — used for vig removal
  projected_prob: number;          // calibrated probability of the bet cashing
  implied_prob: number;            // fair (vig-removed) implied prob of the bet
  raw_implied_prob: number;        // unadjusted american→implied (audit only)
  edge: number;                    // projected_prob − implied_prob (vig-free)
  ev_pct: number;
  confidence: number;              // = projected_prob, kept for legacy readers
  raw_confidence: number;          // pre-calibration factor-sum score (0-1)
  reliability: number;             // 0.4-1.0 market reliability
  score: number;                   // legacy edge*confidence
  quality_score: number;           // composite curated score
  verdict: "Strong" | "Lean" | "Pass";
  reasoning: string;
  // Event identity carried through from the Odds API event for downstream
  // public display (filter by actual game_date, not pick_date).
  event_id?: string | null;
  commence_time?: string | null;
  game_date?: string | null;
  // Phase-1 model/debug diagnostics (playoff series, line cushion, market depth,
  // data quality). Structured fields only — never user-facing prose. Persisted
  // into daily_picks.model_diagnostics for admin/history visibility. Verdict
  // tiering and unit sizing do NOT consult this field.
  model_diagnostics?: Record<string, unknown> | null;
}

// Back-compat exports — new callers should import from prob_math.ts directly.
export { americanToImplied as americanToImpliedProb, calcEvPct as calcEv };

// ── Market reliability map ─────────────────────────────────
// 1.0 = highly stable / repeatable signal
// 0.75 = moderate (multi-component or volatile-but-trackable)
// 0.5  = volatile / low-signal markets that need elite confidence to surface
const HIGH_RELIABILITY_PROPS = new Set([
  "points", "rebounds", "assists",         // NBA core
  "hits", "total_bases",                   // MLB core (total_bases is mid normally; promoted by volume)
  "shots_on_goal", "sog",                  // NHL core
  "passing_yards", "rushing_yards", "receiving_yards", // NFL core (future)
]);
const MID_RELIABILITY_PROPS = new Set([
  "3-pointers", "threes", "three_pointers_made", "pra", "pts_reb_ast",
  "rbi", "runs", "singles",
  "points_nhl", "saves",
]);
export const LOW_RELIABILITY_PROPS = new Set([
  "steals", "blocks", "stl_blk",
  "home_runs", "hr", "strikeouts", "ks", "pitcher_strikeouts",
  "first_basket", "first_td", "anytime_td",
  "goals",  // NHL goals — high variance
]);

// NBA high-variance prop keys used by the NBA edge gate
export const NBA_HIGH_VARIANCE_KEYS = new Set([
  "steals", "blocks", "stl_blk", "turnovers",
]);

// Low-line threshold: props at or below this line need stricter gates
export const NBA_LOW_LINE_MAX = 1.5;

export type NbaHeavyJuiceAction = "penalty" | "downgrade" | "hard_block";

export interface NbaEdgeGateInputs {
  canonical_confidence: number;
  canonical_verdict: CanonicalVerdict;
  stored_confidence: number;
  stored_verdict: CanonicalVerdict;
  oddsAmerican: number;
  evPct: number;
  modelEdge: number;
  bookCount: number | null;
  marketDataQuality: string | null;
  marketDepth: string | null;
  opponentResolutionStatus: string | null;
  hasTeam: boolean;
  hasOpponent: boolean;
}

export interface NbaEdgeGateResult {
  ok: boolean;
  reasons: string[];
  hardSafetyFail: boolean;
  edge_gate_result: "passed" | "failed";
  edge_gate_decision: Record<string, unknown>;
  inputs: NbaEdgeGateInputs;
  heavyJuiceThreshold: number;
  heavyJuiceAction: NbaHeavyJuiceAction;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value)
      : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function canonicalVerdictForGate(p: ScoredPlay, confidencePercent: number): CanonicalVerdict {
  const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;
  if (md.canonical_verdict != null) {
    return normalizeCanonicalVerdict(md.canonical_verdict, confidencePercent);
  }
  const scored = String(p.verdict ?? "").trim().toUpperCase();
  if (scored === "RISKY") return "RISKY";
  return scoredVerdictToCanonical(p.verdict);
}

export function evaluateNbaEdgeGate(p: ScoredPlay): NbaEdgeGateResult {
  const reasons: string[] = [];
  const md = (p.model_diagnostics ?? {}) as Record<string, unknown>;

  const canonicalConfidence = Math.round(
    normalizeConfidencePercent(
      md.canonical_confidence ??
        md.analyzer_confidence_percent ??
        md.stored_confidence ??
        p.confidence,
    ),
  );
  const canonicalVerdict = canonicalVerdictForGate(p, canonicalConfidence);
  const storedConfidence = Math.round(
    normalizeConfidencePercent(md.stored_confidence ?? canonicalConfidence),
  );
  const storedVerdict = md.stored_verdict != null
    ? normalizeCanonicalVerdict(md.stored_verdict, storedConfidence)
    : canonicalVerdict;

  const propKey = normalizeNbaPropType(p.prop_type).replace(/\s+/g, "_");
  const isHighVariance = NBA_HIGH_VARIANCE_KEYS.has(propKey);
  const isLowLine = typeof p.line === "number" && p.line <= NBA_LOW_LINE_MAX;
  const confidence01 = canonicalConfidence / 100;

  const marketDataQuality = stringOrNull(md.marketDataQuality);
  const marketDepth = stringOrNull(md.marketDepth);
  const bookCount = numberOrNull(md.bookCount);
  const opponentStatus = stringOrNull(md.opponentResolutionStatus);
  const unusableMarket =
    marketDataQuality === "unusable" ||
    marketDataQuality === "very_low";
  const lowMarketQuality = unusableMarket || marketDataQuality === "low";

  const inputs: NbaEdgeGateInputs = {
    canonical_confidence: canonicalConfidence,
    canonical_verdict: canonicalVerdict,
    stored_confidence: storedConfidence,
    stored_verdict: storedVerdict,
    oddsAmerican: p.odds,
    evPct: Math.round(p.ev_pct * 100) / 100,
    modelEdge: Math.round(p.edge * 10000) / 10000,
    bookCount,
    marketDataQuality,
    marketDepth,
    opponentResolutionStatus: opponentStatus,
    hasTeam: !!p.team,
    hasOpponent: !!p.opponent,
  };

  const confMin = canonicalVerdict === "STRONG"
    ? isHighVariance ? 0.78 : isLowLine ? 0.76 : 0.72
    : canonicalVerdict === "LEAN" ? 0.70 : 1;
  if (confidence01 < confMin) reasons.push("confidence_below_nba_edge_min");

  if (canonicalVerdict === "PASS") reasons.push("pass_verdict");
  if (canonicalVerdict === "RISKY") reasons.push("risky_verdict");

  if (p.edge <= 0) reasons.push("negative_model_edge");
  if (p.ev_pct <= 0) reasons.push("negative_ev");

  if (unusableMarket) reasons.push("market_quality_unusable");
  else if (marketDataQuality === "low") reasons.push("market_quality_low");
  if (marketDepth === "thin") reasons.push("market_depth_thin");
  if (bookCount !== null && bookCount < 3) {
    if (!reasons.includes("market_depth_thin")) reasons.push("market_depth_thin");
  }

  let heavyJuiceAction: NbaHeavyJuiceAction = "penalty";
  if (p.odds <= NBA_EXTREME_JUICE_ODDS) {
    const extremeJuiceJustified =
      canonicalVerdict === "STRONG" &&
      confidence01 >= NBA_EXTREME_JUICE_EXEMPT_CONF_MIN &&
      p.ev_pct >= NBA_EXTREME_JUICE_EXEMPT_EV_MIN &&
      p.edge >= NBA_EXTREME_JUICE_EXEMPT_EDGE_MIN &&
      (bookCount ?? 0) >= 5 &&
      !lowMarketQuality;
    if (extremeJuiceJustified) {
      heavyJuiceAction = "downgrade";
      reasons.push("heavy_juice");
    } else {
      heavyJuiceAction = "hard_block";
      reasons.push("heavy_juice");
      reasons.push("extreme_juice");
    }
  } else if (p.odds <= NBA_HEAVY_JUICE_ODDS) {
    const heavyJuiceAllowed =
      (canonicalVerdict === "STRONG" || canonicalVerdict === "LEAN") &&
      confidence01 >= 0.70 &&
      p.ev_pct > 0 &&
      p.edge > 0 &&
      (bookCount ?? 0) >= 3 &&
      !lowMarketQuality;
    if (!heavyJuiceAllowed) {
      heavyJuiceAction = "downgrade";
      reasons.push("heavy_juice");
    }
  }

  if (!p.team || !p.opponent || opponentStatus !== "resolved") {
    reasons.push("opponent_unresolved");
  }

  const playoffMode = md.playoffMode === true || md.playoffMode === "true";
  if (playoffMode) {
    const seriesSampleSize =
      typeof md.seriesSampleSize === "number"
        ? md.seriesSampleSize
        : typeof md.seriesSampleSize === "string"
          ? parseInt(md.seriesSampleSize, 10)
          : 0;
    const seriesMatchFailureReason =
      md.seriesMatchFailureReason != null ? String(md.seriesMatchFailureReason) : null;
    const playoffWeightsApplied = md.playoffWeightsApplied === true;

    if (seriesSampleSize < 2) reasons.push("playoff_series_missing");
    if (seriesMatchFailureReason) reasons.push("playoff_series_missing");
    if (!playoffWeightsApplied) {
      const strongEnough = confidence01 >= 0.80 && p.edge > 0 && !lowMarketQuality;
      if (!strongEnough) reasons.push("playoff_series_missing");
    }
  }

  if (isLowLine) {
    const alreadyCaught = reasons.some(r =>
      ["negative_ev", "negative_model_edge", "market_quality_low", "market_quality_unusable", "opponent_unresolved"].includes(r)
    );
    if (!alreadyCaught && (p.ev_pct <= 0 || lowMarketQuality || !p.team || !p.opponent)) {
      reasons.push("low_line_extra_risk");
    }
  }

  if (isHighVariance) {
    const cleanForHighVariance =
      confidence01 >= 0.78 &&
      (marketDataQuality === "medium" || marketDataQuality === "high") &&
      p.edge > 0 &&
      !reasons.includes("opponent_unresolved");
    if (!cleanForHighVariance) {
      if (
        !reasons.includes("confidence_below_nba_edge_min") &&
        !reasons.includes("market_quality_low") &&
        !reasons.includes("market_quality_unusable") &&
        !reasons.includes("negative_ev") &&
        !reasons.includes("negative_model_edge") &&
        !reasons.includes("opponent_unresolved")
      ) {
        reasons.push("high_variance_prop");
      }
    }
  }

  const ok = reasons.length === 0;
  const hardSafetyFail =
    reasons.includes("pass_verdict") ||
    reasons.includes("risky_verdict") ||
    reasons.includes("market_quality_unusable") ||
    reasons.includes("extreme_juice") ||
    (reasons.includes("negative_ev") && reasons.includes("market_quality_low")) ||
    (reasons.includes("negative_model_edge") && reasons.includes("market_quality_low")) ||
    (reasons.includes("opponent_unresolved") && confidence01 < 0.70) ||
    (reasons.includes("playoff_series_missing") && playoffMode);

  return {
    ok,
    reasons: Array.from(new Set(reasons)),
    hardSafetyFail,
    edge_gate_result: ok ? "passed" : "failed",
    edge_gate_decision: {
      ok,
      reasons: Array.from(new Set(reasons)),
      hardSafetyFail,
      heavy_juice_action: heavyJuiceAction,
    },
    inputs,
    heavyJuiceThreshold: NBA_HEAVY_JUICE_ODDS,
    heavyJuiceAction,
  };
}

export interface NbaEdgePoolDiagnostics {
  rank: number | null;
  selected: boolean;
  selectionReason: string;
}

export function nbaEdgePoolKey(p: ScoredPlay): string {
  return `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;
}

export function selectNbaEdgePool(
  sortedByQuality: ScoredPlay[],
  edgeCap: number,
): {
  edgeKeySet: Set<string>;
  gateCache: Map<string, NbaEdgeGateResult>;
  poolDiagnostics: Map<string, NbaEdgePoolDiagnostics>;
} {
  const edgeKeySet = new Set<string>();
  const gateCache = new Map<string, NbaEdgeGateResult>();
  const poolDiagnostics = new Map<string, NbaEdgePoolDiagnostics>();
  let edgeCount = 0;
  let gatePassRank = 0;

  for (const p of sortedByQuality) {
    const key = nbaEdgePoolKey(p);
    const gate = evaluateNbaEdgeGate(p);
    gateCache.set(key, gate);

    if (!gate.ok) {
      poolDiagnostics.set(key, {
        rank: null,
        selected: false,
        selectionReason: gate.hardSafetyFail ? "hard_safety_later" : "failed_edge_gate",
      });
      continue;
    }

    gatePassRank++;
    if (edgeCount < edgeCap) {
      edgeKeySet.add(key);
      edgeCount++;
      poolDiagnostics.set(key, {
        rank: gatePassRank,
        selected: true,
        selectionReason: "selected",
      });
    } else {
      poolDiagnostics.set(key, {
        rank: gatePassRank,
        selected: false,
        selectionReason: edgeCap <= 0 ? "edge_slots_full" : "lower_rank_than_selected_picks",
      });
    }
  }

  return { edgeKeySet, gateCache, poolDiagnostics };
}

export const NBA_ANALYZER_CAP_DEFAULT = 80;
export const NBA_ANALYZER_CAP_HARD_MAX = 100;

export function resolveNbaAnalyzerCap(raw: unknown): number {
  const parsed = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number.parseInt(raw.trim(), 10)
      : NBA_ANALYZER_CAP_DEFAULT;

  if (!Number.isFinite(parsed) || parsed <= 0) return NBA_ANALYZER_CAP_DEFAULT;
  return Math.min(NBA_ANALYZER_CAP_HARD_MAX, Math.max(1, Math.floor(parsed)));
}

export interface AnalyzerPoolCandidate {
  sport: string;
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  confidence: number;
  edge: number;
  quality_score: number;
}

export const NBA_ANALYZER_BUDGET_DEFAULT = 25;
export const NBA_ANALYZER_BUDGET_HARD_MAX = 40;

export function resolveNbaAnalyzerBudget(raw: unknown): number {
  const parsed = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number.parseInt(raw.trim(), 10)
      : NBA_ANALYZER_BUDGET_DEFAULT;
  if (!Number.isFinite(parsed) || parsed <= 0) return NBA_ANALYZER_BUDGET_DEFAULT;
  return Math.min(NBA_ANALYZER_BUDGET_HARD_MAX, Math.max(1, Math.floor(parsed)));
}

export type AnalyzerExclusionReason =
  | "analyzer_pool_cap_exceeded"
  | "analyzer_call_budget_exceeded"
  | "analyzer_rate_limit_budget_exhausted";

export interface AnalyzerPoolExcludedCandidate {
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  confidence: number;
  edge: number;
  quality_score: number;
  exclusion_reason: AnalyzerExclusionReason;
}

export function candidateDiagnostic<T extends AnalyzerPoolCandidate>(
  p: T,
  exclusionReason: AnalyzerExclusionReason,
): AnalyzerPoolExcludedCandidate {
  return {
    player_name: p.player_name,
    prop_type: p.prop_type,
    direction: p.direction,
    line: p.line,
    confidence: Math.round(p.confidence * 1000) / 1000,
    edge: Math.round(p.edge * 10000) / 10000,
    quality_score: Math.round(p.quality_score * 10000) / 10000,
    exclusion_reason: exclusionReason,
  };
}

export function missingDataFieldsForCandidate(p: {
  player_name?: string | null;
  prop_type?: string | null;
  direction?: string | null;
  line?: number | null;
  odds?: number | null;
  game_date?: string | null;
  commence_time?: string | null;
}): string[] {
  const missing: string[] = [];
  if (!p.player_name) missing.push("player_name");
  if (!p.prop_type) missing.push("prop_type");
  if (!p.direction) missing.push("direction");
  if (!Number.isFinite(Number(p.line))) missing.push("line");
  if (!Number.isFinite(Number(p.odds))) missing.push("odds");
  if (!p.game_date && !p.commence_time) missing.push("game_date");
  return missing;
}

export function lowConfidenceRejectionDiagnostic<T extends AnalyzerPoolCandidate>(
  p: T,
  threshold: number,
  features: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    threshold,
    confidence: Math.round(p.confidence * 1000) / 1000,
    edge: Math.round(p.edge * 10000) / 10000,
    quality_score: Math.round(p.quality_score * 10000) / 10000,
    ...features,
  };
}

export function selectNbaAnalyzerPool<T extends AnalyzerPoolCandidate>(
  candidates: T[],
  cap: number,
): {
  selected: T[];
  excluded: AnalyzerPoolExcludedCandidate[];
  truncated: boolean;
} {
  const resolvedCap = resolveNbaAnalyzerCap(cap);
  const sorted = [...candidates].sort((a, b) => {
    const qualityDiff = b.quality_score - a.quality_score;
    if (Math.abs(qualityDiff) > 0.000001) return qualityDiff;
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.000001) return confDiff;
    return b.edge - a.edge;
  });

  const selected = sorted.slice(0, resolvedCap);
  const excluded = sorted
    .slice(resolvedCap)
    .map((p) => candidateDiagnostic(p, "analyzer_pool_cap_exceeded"));

  return {
    selected,
    excluded,
    truncated: excluded.length > 0,
  };
}

export interface AnalyzerPoolRankInfo {
  bucket: "quality" | "confidence" | "edge" | "threes" | "under" | "positive_edge";
  rank: number; // 0-based within bucket of first selection
}

// Diversified pool selection: reserve slots per orthogonal signal so that
// moderate-confidence but high-edge / 3-pointer / under candidates are not
// evicted by a long tail of higher-confidence point-totals.
// Reserves at cap=80: quality=48, confidence=8, edge=8, threes=5, under=5,
// positive_edge=6 (sums to 80). For other caps, reserves scale ~ cap/80.
export function selectNbaAnalyzerPoolDiversified<T extends AnalyzerPoolCandidate>(
  candidates: T[],
  cap: number,
  threesPropType: string = "3-pointers",
): {
  selected: T[];
  excluded: AnalyzerPoolExcludedCandidate[];
  truncated: boolean;
  ranks: Map<string, AnalyzerPoolRankInfo>;
} {
  const resolvedCap = resolveNbaAnalyzerCap(cap);

  const byQuality = [...candidates].sort((a, b) => {
    const d = b.quality_score - a.quality_score;
    if (Math.abs(d) > 1e-6) return d;
    const c = b.confidence - a.confidence;
    if (Math.abs(c) > 1e-6) return c;
    return b.edge - a.edge;
  });
  const byConfidence = [...candidates].sort((a, b) => {
    const d = b.confidence - a.confidence;
    if (Math.abs(d) > 1e-6) return d;
    return b.quality_score - a.quality_score;
  });
  const byEdge = [...candidates].sort((a, b) => {
    const d = b.edge - a.edge;
    if (Math.abs(d) > 1e-6) return d;
    return b.quality_score - a.quality_score;
  });
  const byThrees = [...candidates]
    .filter((p) => String(p.prop_type ?? "").toLowerCase() === threesPropType.toLowerCase())
    .sort((a, b) => b.quality_score - a.quality_score);
  const byUnder = [...candidates]
    .filter((p) => String(p.direction ?? "").toLowerCase() === "under")
    .sort((a, b) => {
      const d = b.quality_score - a.quality_score;
      if (Math.abs(d) > 1e-6) return d;
      return b.edge - a.edge;
    });
  const byPositiveEdge = [...candidates]
    .filter((p) => p.edge > 0)
    .sort((a, b) => {
      const d = b.edge - a.edge;
      if (Math.abs(d) > 1e-6) return d;
      return b.quality_score - a.quality_score;
    });

  const scale = resolvedCap / 80;
  const reserves: Array<{ bucket: AnalyzerPoolRankInfo["bucket"]; list: T[]; reserve: number }> = [
    { bucket: "quality", list: byQuality, reserve: Math.max(1, Math.round(48 * scale)) },
    { bucket: "confidence", list: byConfidence, reserve: Math.max(1, Math.round(8 * scale)) },
    { bucket: "edge", list: byEdge, reserve: Math.max(1, Math.round(8 * scale)) },
    { bucket: "threes", list: byThrees, reserve: Math.max(1, Math.round(5 * scale)) },
    { bucket: "under", list: byUnder, reserve: Math.max(1, Math.round(5 * scale)) },
    { bucket: "positive_edge", list: byPositiveEdge, reserve: Math.max(1, Math.round(6 * scale)) },
  ];

  const keyOf = (p: AnalyzerPoolCandidate) =>
    `${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;

  const selectedKeys = new Set<string>();
  const ranks = new Map<string, AnalyzerPoolRankInfo>();
  const selected: T[] = [];

  // Greedy: fill each bucket's reserve before topping up.
  for (const r of reserves) {
    if (selected.length >= resolvedCap) break;
    let taken = 0;
    let bucketRank = 0;
    for (const p of r.list) {
      if (taken >= r.reserve) break;
      if (selected.length >= resolvedCap) break;
      const k = keyOf(p);
      if (selectedKeys.has(k)) {
        bucketRank++;
        continue;
      }
      selectedKeys.add(k);
      selected.push(p);
      ranks.set(k, { bucket: r.bucket, rank: bucketRank });
      taken++;
      bucketRank++;
    }
  }

  // Top up any remaining cap slots from byQuality order.
  if (selected.length < resolvedCap) {
    let qRank = 0;
    for (const p of byQuality) {
      if (selected.length >= resolvedCap) break;
      const k = keyOf(p);
      if (!selectedKeys.has(k)) {
        selectedKeys.add(k);
        selected.push(p);
        ranks.set(k, { bucket: "quality", rank: qRank });
      }
      qRank++;
    }
  }

  const excluded = candidates
    .filter((p) => !selectedKeys.has(keyOf(p)))
    .map((p) => candidateDiagnostic(p, "analyzer_pool_cap_exceeded"));

  return {
    selected,
    excluded,
    truncated: excluded.length > 0,
    ranks,
  };
}

export interface BudgetPriorityCandidate extends AnalyzerPoolCandidate {
  ev_pct?: number;
  is_trace_target?: boolean;
}

export function applyNbaAnalyzerBudget<T extends BudgetPriorityCandidate>(
  pool: T[],
  budget: number,
  threesPropType: string = "3-pointers",
): { selected: T[]; deferred: T[]; resolvedBudget: number } {
  const resolvedBudget = resolveNbaAnalyzerBudget(budget);
  const isThrees = (p: T) =>
    String(p.prop_type ?? "").toLowerCase() === threesPropType.toLowerCase();
  const isUnder = (p: T) =>
    String(p.direction ?? "").toLowerCase() === "under";
  const score = (p: T): number[] => {
    const ev = Number.isFinite(p.ev_pct as number) ? (p.ev_pct as number) : 0;
    return [
      p.is_trace_target ? 1 : 0,
      p.quality_score ?? 0,
      p.confidence ?? 0,
      p.edge ?? 0,
      ev > 0 ? 1 : 0,
      ev,
      isThrees(p) ? 1 : 0,
      isUnder(p) ? 1 : 0,
    ];
  };
  const sorted = [...pool].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sb[i] - sa[i];
    }
    return 0;
  });
  return {
    selected: sorted.slice(0, resolvedBudget),
    deferred: sorted.slice(resolvedBudget),
    resolvedBudget,
  };
}

export function getMarketReliability(
  betType: string,
  propType: string,
  direction: string,
  odds: number,
): number {
  // Game lines
  if (betType === "moneyline") {
    if (odds >= 200) return 0.5;        // longshot dog
    if (odds >= 130) return 0.7;        // mid dog
    return 0.95;                         // favorites / pickem
  }
  if (betType === "spread") return 0.85;
  if (betType === "total") return 0.78;

  // Player props — normalize key
  const normalizedProp = normalizeNbaPropType(propType);
  const key = normalizedProp.replace(/\s+/g, "_");

  // Special: under on volatile counting stats is the worst signal
  const isUnder = (direction || "").toLowerCase() === "under";
  if (LOW_RELIABILITY_PROPS.has(key)) {
    return isUnder ? 0.4 : 0.55;
  }
  if (MID_RELIABILITY_PROPS.has(normalizedProp) || MID_RELIABILITY_PROPS.has(key)) return 0.75;
  if (HIGH_RELIABILITY_PROPS.has(normalizedProp) || HIGH_RELIABILITY_PROPS.has(key)) return 0.95;

  // Unknown prop — treat as mid-low
  return 0.65;
}

// ── Quality + verdict tiering ──────────────────────────────
export function computeQualityScore(
  confidence: number,
  edge: number,
  reliability: number,
): number {
  const hitRateFactor = Math.max(0, (confidence - 0.5) * 2); // 0 at 50%, 1 at 100%
  return confidence * reliability * (1 + Math.max(0, edge)) * (0.5 + 0.5 * hitRateFactor);
}

export function tierVerdict(
  confidence: number,
  edge: number,
  reliability: number,
  betType: string,
  propType: string,
  direction: string,
  odds: number,
): "Strong" | "Lean" | "Pass" {
  const key = normalizeNbaPropType(propType).replace(/\s+/g, "_");
  const isUnder = (direction || "").toLowerCase() === "under";

  // Absolute longshot cap — never surface +LONGSHOT_ODDS_MAX or longer.
  if (odds >= LONGSHOT_ODDS_MAX) return "Pass";

  const isLongshot = odds >= MID_LONGSHOT_ODDS_MIN;
  const isVolatileUnder = isUnder && LOW_RELIABILITY_PROPS.has(key);

  if (isLongshot) {
    if (
      confidence >= MID_LONGSHOT_CONF_MIN &&
      edge >= MID_LONGSHOT_EDGE_MIN &&
      reliability >= MID_LONGSHOT_RELIABILITY_MIN
    ) return "Strong";
    return "Pass";
  }
  if (isVolatileUnder) {
    if (confidence >= VOLATILE_UNDER_CONF_MIN && edge >= VOLATILE_UNDER_EDGE_MIN) return "Strong";
    return "Pass";
  }

  if (confidence >= PROB_STRONG && edge >= EDGE_STRONG_MIN && reliability >= RELIABILITY_STRONG_MIN) return "Strong";
  if (confidence >= PROB_LEAN && edge >= EDGE_LEAN_MIN && reliability >= RELIABILITY_LEAN_MIN) return "Lean";
  return "Pass";
}

export function buildReasoning(p: {
  bet_type: string;
  player_name: string;
  prop_type: string;
  line: number;
  direction: string;
  edge: number;
  confidence: number;
  ev_pct: number;
  reliability: number;
}): string {
  const edgePct = (p.edge * 100).toFixed(1);
  const conf = (p.confidence * 100).toFixed(0);
  const relTag = p.reliability >= 0.9 ? "high-signal market" : p.reliability >= 0.7 ? "stable market" : "volatile market";
  if (p.bet_type === "moneyline") {
    return `Model gives ${p.player_name} a ${conf}% win probability (${relTag}) — ${edgePct}% edge, ${p.ev_pct.toFixed(1)}% EV.`;
  }
  if (p.bet_type === "spread") {
    return `${p.player_name} ${p.direction === "home" ? "covers" : "fades"} the ${p.line} spread in ${conf}% of model sims (${edgePct}% edge, ${relTag}).`;
  }
  if (p.bet_type === "total") {
    return `Pace + matchup model projects ${p.direction.toUpperCase()} ${p.line} at ${conf}% probability — ${edgePct}% edge.`;
  }
  return `${p.player_name} ${p.direction} ${p.line} ${p.prop_type}: ${conf}% hit rate, ${edgePct}% edge (${relTag}).`;
}

// ── Primary scorer ────────────────────────────────────────
// Accepts raw model confidence (0-1 or 0-100). Performs:
//   1. Vig removal (if odds_opp supplied).
//   2. Calibration (if calibration supplied).
//   3. Reliability / verdict / quality-score assembly.
export interface ScoreInput {
  sport: string;
  bet_type: "prop" | "moneyline" | "spread" | "total";
  player_name: string;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type: string;
  line: number;
  spread_line?: number | null;
  total_line?: number | null;
  direction: string;
  odds: number;
  odds_opp?: number | null;
  // Raw confidence — either 0-100 (percent) or 0-1. We detect and normalize.
  raw_confidence: number;
  // Optional explicit calibration; if omitted, identity is used.
  calibration?: Calibration;
  // Optional reliability override (otherwise derived from market table).
  reliability?: number;
}

export function score(input: ScoreInput): ScoredPlay {
  // Normalize raw confidence to 0-1.
  const raw01 = clamp01(
    input.raw_confidence > 1 ? input.raw_confidence / 100 : input.raw_confidence,
  );
  const calibrated = input.calibration
    ? clamp01(applyCalibration(raw01, input.calibration))
    : raw01;

  const rawImplied = americanToImplied(input.odds);
  const fairImplied =
    input.odds_opp != null ? fairImpliedFromPair(input.odds, input.odds_opp) : rawImplied;

  const edge = calibrated - fairImplied;
  const evPct = calcEvPct(calibrated, input.odds);

  const reliability = input.reliability ?? getMarketReliability(input.bet_type, input.prop_type, input.direction, input.odds);
  const legacyScore = edge * calibrated;
  const qualityScore = computeQualityScore(calibrated, edge, reliability);
  const verdict = tierVerdict(calibrated, edge, reliability, input.bet_type, input.prop_type, input.direction, input.odds);
  const reasoning = buildReasoning({
    bet_type: input.bet_type,
    player_name: input.player_name,
    prop_type: input.prop_type,
    line: input.line,
    direction: input.direction,
    edge,
    confidence: calibrated,
    ev_pct: evPct,
    reliability,
  });

  return {
    sport: input.sport,
    bet_type: input.bet_type,
    player_name: input.player_name,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    home_team: input.home_team ?? null,
    away_team: input.away_team ?? null,
    prop_type: input.prop_type,
    line: input.line,
    spread_line: input.spread_line ?? null,
    total_line: input.total_line ?? null,
    direction: input.direction,
    odds: input.odds,
    odds_opp: input.odds_opp ?? null,
    projected_prob: calibrated,
    implied_prob: fairImplied,
    raw_implied_prob: rawImplied,
    edge,
    ev_pct: evPct,
    confidence: calibrated,
    raw_confidence: raw01,
    reliability,
    score: legacyScore,
    quality_score: qualityScore,
    verdict,
    reasoning,
  };
}

// Legacy shape for callers that already did their own calibration/vig work
// and just want to stuff a fully-formed row through reliability + verdict.
export function scorePrecomputed(
  play: Omit<ScoredPlay, "score" | "quality_score" | "verdict" | "reasoning" | "reliability" | "raw_confidence" | "raw_implied_prob" | "odds_opp"> & {
    reliability?: number;
    raw_confidence?: number;
    raw_implied_prob?: number;
    odds_opp?: number | null;
  },
): ScoredPlay {
  const reliability = play.reliability ?? getMarketReliability(play.bet_type, play.prop_type, play.direction, play.odds);
  const s = play.edge * play.confidence;
  const quality_score = computeQualityScore(play.confidence, play.edge, reliability);
  const verdict = tierVerdict(play.confidence, play.edge, reliability, play.bet_type, play.prop_type, play.direction, play.odds);
  const reasoning = buildReasoning({ ...play, reliability });
  return {
    ...play,
    odds_opp: play.odds_opp ?? null,
    raw_confidence: play.raw_confidence ?? play.confidence,
    raw_implied_prob: play.raw_implied_prob ?? play.implied_prob,
    reliability,
    score: s,
    quality_score,
    verdict,
    reasoning,
  } as ScoredPlay;
}

// ── Ranking + distribution with quality caps ──────────────
const PER_SPORT_CAP = 25;
const MAX_LOW_RELIABILITY_TOTAL = 0;
const FREE_PICKS_CAP = 30;
const TODAYS_EDGE_CAP = 5;
const DAILY_PICKS_CAP = 80;

export function rankAndDistribute(plays: ScoredPlay[]) {
  // 1. Hard floor: drop anything that fails the absolute minimums.
  const floorOk = plays.filter(
    (p) => p.confidence >= PROB_FLOOR && p.reliability >= RELIABILITY_FLOOR && p.edge > 0,
  );
  // 2. Reject anything that fails verdict tiering.
  const passing = floorOk.filter((p) => p.verdict !== "Pass");
  // 3. Sort by quality_score desc.
  const sorted = [...passing].sort((a, b) => b.quality_score - a.quality_score);

  // ── Free Picks: per-sport + low-reliability caps ──
  const sportCounts: Record<string, number> = {};
  let lowRelCount = 0;
  const freePicks: ScoredPlay[] = [];
  for (const p of sorted) {
    if (freePicks.length >= FREE_PICKS_CAP) break;
    sportCounts[p.sport] = sportCounts[p.sport] || 0;
    if (sportCounts[p.sport] >= PER_SPORT_CAP) continue;
    const isLow = p.reliability < 0.65;
    if (isLow && lowRelCount >= MAX_LOW_RELIABILITY_TOTAL) continue;
    freePicks.push(p);
    sportCounts[p.sport]++;
    if (isLow) lowRelCount++;
  }

  // ── Today's Edge: top 5 canonical passing picks, max 2 per sport for diversity ──
  const todaysEdge: ScoredPlay[] = [];
  const edgeSportCount: Record<string, number> = {};
  const edgeKeys = new Set<string>();
  const keyOf = (p: ScoredPlay) =>
    `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;

  for (const p of sorted) {
    if (todaysEdge.length >= TODAYS_EDGE_CAP) break;
    if ((edgeSportCount[p.sport] || 0) >= 2) continue;
    todaysEdge.push(p);
    edgeKeys.add(keyOf(p));
    edgeSportCount[p.sport] = (edgeSportCount[p.sport] || 0) + 1;
  }
  // Fallback: fill remaining slots ignoring the per-sport cap.
  if (todaysEdge.length < TODAYS_EDGE_CAP) {
    for (const p of sorted) {
      if (todaysEdge.length >= TODAYS_EDGE_CAP) break;
      const k = keyOf(p);
      if (edgeKeys.has(k)) continue;
      todaysEdge.push(p);
      edgeKeys.add(k);
    }
  }

  // ── Daily Picks: top Strong + Lean up to cap ──
  const dailyPicks = sorted.slice(0, DAILY_PICKS_CAP);

  return { todaysEdge, dailyPicks, freePicks, sorted };
}

// Sanity checks
export function sanityCheck(plays: ScoredPlay[]) {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const p of plays) {
    const key = `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;
    if (seen.has(key)) issues.push(`duplicate: ${key}`);
    seen.add(key);
    if (p.confidence < 0 || p.confidence > 1) issues.push(`confidence OOB: ${key} = ${p.confidence}`);
    if (Math.abs(p.edge) > 0.5) issues.push(`edge >50%: ${key} = ${p.edge}`);
    if (!isFinite(p.ev_pct)) issues.push(`EV non-finite: ${key}`);
    if (p.reliability < 0.4 || p.reliability > 1) issues.push(`reliability OOB: ${key} = ${p.reliability}`);
  }
  return issues;
}
