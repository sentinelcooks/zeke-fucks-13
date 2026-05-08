import type { ScoredPlay } from "./edge_scoring.ts";
import {
  normalizeConfidencePercent,
  scoredVerdictToCanonical,
  type CanonicalVerdict,
} from "./canonical_verdict.ts";
import { normalizeNbaPropType } from "./prop_normalization.ts";

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
}

function formatOdds(odds: unknown, fallback: number): string {
  if (typeof odds === "string" && odds.trim()) return odds;
  return fallback > 0 ? `+${fallback}` : `${fallback}`;
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
  };

  // For NBA props we must store the *normalized* prop_type so manual Analyze
  // (which sends whatever prop_type is on the saved row) hits the same
  // analyzer key the scanner used. Other sports keep the raw value.
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
  };
}
