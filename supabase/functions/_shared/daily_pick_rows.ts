import type { ScoredPlay } from "./edge_scoring.ts";
import {
  normalizeConfidencePercent,
  scoredVerdictToCanonical,
  type CanonicalVerdict,
} from "./canonical_verdict.ts";
import { normalizeNbaPropType } from "./prop_normalization.ts";
// normalizeNhlPropType is exported by prop_normalization.ts but intentionally
// NOT applied here. nba-api/analyze switches on the prefixed NHL keys
// ("nhl_points", "nhl_assists") so storing the canonical form would break
// Manual Analyze, which sends the stored prop_type back to the analyzer.
// Frontend formatPropType() already strips the prefix at render time.

export interface DailyPickRowInput {
  pickDate: string;
  play: ScoredPlay;
  tier: "edge" | "daily" | "value" | "_pending";
  raw?: Record<string, unknown> | null;
  status?: string | null;
  sourceFunction: string;
  modelUsed?: string | null;
  reasoning?: string | null;
  avgValue?: number | null;
  runId?: string | null;
}

function formatOdds(odds: unknown, fallback: number): string {
  if (typeof odds === "string" && odds.trim()) return odds;
  return fallback > 0 ? `+${fallback}` : `${fallback}`;
}

// analyzer-finalize.v1 — hard insert-time guard. Final defense before any
// .from("daily_picks").insert(...) call. Filters a batch of candidate rows,
// dropping any edge/daily/value row that is not analyzer-finalized, with full
// logging. Returns the surviving rows and per-reason drop counts.
//
// Applies uniformly to NBA, MLB, NHL, UFC, and every future sport.
export interface AnalyzerFinalizeGuardResult {
  rows: Record<string, unknown>[];
  rows_before_guard: number;
  rows_after_guard: number;
  rows_dropped_non_analyzer: number;
  rows_dropped_missing_payload: number;
  rows_dropped_missing_snapshot: number;
  rows_dropped_other: number;
}

export function applyAnalyzerFinalizeInsertGuard(
  rows: Array<Record<string, unknown> | null | undefined>,
  callSite: string,
): AnalyzerFinalizeGuardResult {
  const out: Record<string, unknown>[] = [];
  let rows_dropped_non_analyzer = 0;
  let rows_dropped_missing_payload = 0;
  let rows_dropped_missing_snapshot = 0;
  let rows_dropped_other = 0;
  const before = rows.length;

  for (const row of rows) {
    if (!row) continue;
    const tier = row.tier as string | null | undefined;
    // Only edge/daily/value are user-facing. _pending or other tiers pass
    // through (queue placeholders, free_props handled elsewhere).
    if (tier !== "edge" && tier !== "daily" && tier !== "value") {
      out.push(row);
      continue;
    }
    const md = (row.model_diagnostics ?? {}) as Record<string, unknown>;
    const sport = (row.sport as string | undefined) ?? "unknown";
    const player = (row.player_name as string | undefined) ?? "(team)";
    let reason: string | null = null;
    if (md.confidenceSource !== "analyzer") reason = "non_analyzer_source";
    else if (md.analyzer_payload === null || md.analyzer_payload === undefined) {
      reason = "missing_analyzer_payload";
    } else if (
      md.analyzer_response_snapshot === null ||
      md.analyzer_response_snapshot === undefined
    ) {
      reason = "missing_analyzer_response_snapshot";
    } else if (md.sourceContractVersion !== "analyzer-finalize.v1") {
      reason = "missing_source_contract_version";
    }
    if (reason === null) {
      out.push(row);
      continue;
    }
    if (reason === "non_analyzer_source") rows_dropped_non_analyzer++;
    else if (reason === "missing_analyzer_payload") rows_dropped_missing_payload++;
    else if (reason === "missing_analyzer_response_snapshot") rows_dropped_missing_snapshot++;
    else rows_dropped_other++;
    console.warn(
      `[scanner][analyzer-required] sport=${sport} tier=${tier} player=${player} ` +
        `reason=${reason} skipped_user_facing=1 callSite=${callSite}`,
    );
  }

  console.log(
    `[scanner][analyzer-finalize-guard] callSite=${callSite} ` +
      `rows_before_guard=${before} rows_after_guard=${out.length} ` +
      `rows_dropped_non_analyzer=${rows_dropped_non_analyzer} ` +
      `rows_dropped_missing_payload=${rows_dropped_missing_payload} ` +
      `rows_dropped_missing_snapshot=${rows_dropped_missing_snapshot} ` +
      `rows_dropped_other=${rows_dropped_other}`,
  );

  return {
    rows: out,
    rows_before_guard: before,
    rows_after_guard: out.length,
    rows_dropped_non_analyzer,
    rows_dropped_missing_payload,
    rows_dropped_missing_snapshot,
    rows_dropped_other,
  };
}

// analyzer-finalize.v1 — hard insert guard for any user-facing tier.
// Returns a rejection reason string when the row must NOT be persisted to
// public.daily_picks for edge/daily/value, or null when the row is acceptable.
// Applies uniformly to NBA, MLB, NHL, UFC, and any future sport.
export function analyzerFinalizedRejectReason(args: {
  tier: "edge" | "daily" | "value";
  bet_type: string;
  line: number | null | undefined;
  hit_rate: number;
  confidence: number;
  diagnostics: Record<string, unknown>;
}): string | null {
  const { tier, bet_type, line, hit_rate, confidence, diagnostics } = args;
  if (diagnostics.confidenceSource !== "analyzer") return "scanner_only_not_allowed";
  if (diagnostics.sourceContractVersion !== "analyzer-finalize.v1") {
    return "missing_source_contract_version";
  }
  if (diagnostics.analyzer_payload === null || diagnostics.analyzer_payload === undefined) {
    return "missing_analyzer_payload";
  }
  if (
    diagnostics.analyzer_response_snapshot === null ||
    diagnostics.analyzer_response_snapshot === undefined
  ) {
    return "missing_analyzer_response_snapshot";
  }
  if (bet_type === "prop") {
    if (!Number.isFinite(line) || (line as number) <= 0) return "invalid_line_for_prop";
  }
  // Normalize both confidence and hit_rate to percent (0–100) before comparing.
  const confidencePct = confidence <= 1 ? confidence * 100 : confidence;
  const hitRatePct = hit_rate <= 1 ? hit_rate * 100 : hit_rate;
  if (Math.abs(Math.round(confidencePct) - Math.round(hitRatePct)) > 1) {
    return "confidence_hit_rate_misaligned";
  }
  // tier present in the diagnostics payload should match — defensive only.
  if (diagnostics.tier && diagnostics.tier !== tier && diagnostics.tier !== "_pending") {
    return "tier_mismatch";
  }
  return null;
}

export function buildDailyPickRow({
  pickDate,
  play,
  tier,
  raw,
  status = null,
  sourceFunction,
  modelUsed = null,
  reasoning,
  avgValue,
  runId = null,
}: DailyPickRowInput): Record<string, unknown> | null {
  // analyzer-finalize.v1: reject prop rows with no real sportsbook line.
  // Moneyline/spread/total may legitimately store line=0; props must not.
  if (
    play.bet_type === "prop" &&
    (!Number.isFinite(play.line) || (play.line as number) <= 0)
  ) {
    console.warn(
      `[scanner][analyzer-finalize] reject_zero_line sport=${play.sport} player=${play.player_name} prop=${play.prop_type} dir=${play.direction} line=${play.line}`,
    );
    return null;
  }

  const confidencePercent = normalizeConfidencePercent(play.confidence);
  const confidence01 = confidencePercent / 100;
  const storedVerdict: CanonicalVerdict =
    (play.model_diagnostics?.canonical_verdict as CanonicalVerdict | undefined) ??
    scoredVerdictToCanonical(play.verdict);
  const rawDiagnostics =
    raw && typeof raw.model_diagnostics === "object" && raw.model_diagnostics !== null
      ? raw.model_diagnostics as Record<string, unknown>
      : {};
  const playDiag = (play.model_diagnostics ?? {}) as Record<string, unknown>;
  const modelDiagnostics = {
    ...rawDiagnostics,
    ...playDiag,
    canonical_confidence:
      playDiag.canonical_confidence ??
      playDiag.analyzer_confidence_percent ??
      Math.round(confidencePercent),
    canonical_verdict: storedVerdict,
    scanner_confidence_raw:
      playDiag.scanner_confidence_raw ??
      play.raw_confidence ??
      (typeof raw?.hit_rate === "number" ? raw.hit_rate : null),
    scanner_confidence_percent:
      playDiag.scanner_confidence_percent ??
      normalizeConfidencePercent(play.raw_confidence ?? raw?.hit_rate ?? play.confidence),
    analyzer_confidence_percent:
      playDiag.analyzer_confidence_percent ??
      (playDiag.confidenceSource === "analyzer" ? confidencePercent : null),
    // analyzer-finalize.v1 — replayable analyzer side-car. Pass through whatever
    // validateWithAnalyzer attached so See Why and audit logs can replay.
    analyzer_payload: playDiag.analyzer_payload ?? null,
    analyzer_response_snapshot: playDiag.analyzer_response_snapshot ?? null,
    analyzer_confidence_raw: playDiag.analyzer_confidence_raw ?? null,
    analyzer_verdict_raw: playDiag.analyzer_verdict_raw ?? null,
    analyzer_called_at: playDiag.analyzer_called_at ?? null,
    confidenceSource: playDiag.confidenceSource ?? "scanner",
    sourceContractVersion: playDiag.sourceContractVersion ?? "analyzer-finalize.v1",
    stored_confidence: Math.round(confidencePercent),
    stored_verdict: storedVerdict,
    tier,
    sport: play.sport,
    source_function: sourceFunction,
    model_used: modelUsed,
    runId: runId ?? (playDiag.runId as string | null | undefined) ?? null,
  };

  // For NBA props we must store the *normalized* prop_type so manual Analyze
  // (which sends whatever prop_type is on the saved row) hits the same
  // analyzer key the scanner used. Other sports keep the raw value: NHL in
  // particular relies on the "nhl_points"/"nhl_assists" prefixed form
  // because nba-api/analyze's stat switch matches on those keys.
  const storedPropType =
    play.sport === "nba" && play.bet_type === "prop"
      ? normalizeNbaPropType(play.prop_type)
      : play.prop_type;

  const storedHitRate = Math.round(confidencePercent);
  const storedConfidence = Math.round(confidence01 * 1000) / 1000;

  if (play.bet_type === "prop") {
    console.log(
      `[scanner][analyzer-finalize] stored sport=${play.sport} player=${play.player_name} prop=${storedPropType} line=${play.line} dir=${play.direction} stored_hit_rate=${storedHitRate} stored_confidence=${storedConfidence} stored_verdict=${storedVerdict} tier=${tier} source=${modelDiagnostics.confidenceSource}`,
    );
  }

  // analyzer-finalize.v1 hard guard: edge/daily/value rows must be analyzer-backed.
  // _pending rows skip the gate (they're queue placeholders, not user-facing).
  const guardTier = tier === "_pending" ? null : tier;
  if (guardTier) {
    const reason = analyzerFinalizedRejectReason({
      tier: guardTier,
      bet_type: play.bet_type,
      line: play.line,
      hit_rate: storedHitRate,
      confidence: confidencePercent,
      diagnostics: modelDiagnostics,
    });
    if (reason) {
      console.warn(
        `[scanner][analyzer-required] sport=${play.sport} player=${play.player_name} prop=${storedPropType} tier=${tier} skipped_user_facing=1 reason=${reason}`,
      );
      return null;
    }
  }

  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    pick_date: pickDate,
    event_id: play.event_id ?? raw?.event_id ?? null,
    commence_time: play.commence_time ?? raw?.commence_time ?? null,
    game_date: play.game_date ?? raw?.game_date ?? null,
    sport: play.sport,
    player_name: play.player_name,
    team: play.team || null,
    opponent: play.opponent || null,
    prop_type: storedPropType,
    line: play.line,
    direction: play.direction,
    hit_rate: storedHitRate,
    confidence: storedConfidence,
    verdict: storedVerdict,
    last_n_games: 10,
    avg_value: avgValue ?? (typeof raw?.avg_value === "number" ? raw.avg_value : play.ev_pct),
    reasoning: reasoning ?? (typeof raw?.reasoning === "string" ? raw.reasoning : play.reasoning),
    odds: formatOdds(raw?.odds, play.odds),
    result: "pending",
    bet_type: play.bet_type === "total" ? "over_under" : play.bet_type,
    spread_line: play.spread_line ?? null,
    total_line: play.total_line ?? null,
    home_team: play.home_team ?? null,
    away_team: play.away_team ?? null,
    tier,
    status,
    model_used: modelUsed,
    model_diagnostics: modelDiagnostics,
    run_id: runId ?? null,
  };
}
