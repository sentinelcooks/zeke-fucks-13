import type { ScoredPlay } from "./edge_scoring.ts";
import {
  normalizeConfidencePercent,
  scoredVerdictToCanonical,
  type CanonicalVerdict,
} from "./canonical_verdict.ts";

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
}: DailyPickRowInput): Record<string, unknown> {
  const confidencePercent = normalizeConfidencePercent(play.confidence);
  const confidence01 = confidencePercent / 100;
  const storedVerdict: CanonicalVerdict =
    (play.model_diagnostics?.canonical_verdict as CanonicalVerdict | undefined) ??
    scoredVerdictToCanonical(play.verdict);
  const rawDiagnostics =
    raw && typeof raw.model_diagnostics === "object" && raw.model_diagnostics !== null
      ? raw.model_diagnostics as Record<string, unknown>
      : {};
  const modelDiagnostics = {
    ...rawDiagnostics,
    ...(play.model_diagnostics ?? {}),
    scanner_confidence_raw:
      play.model_diagnostics?.scanner_confidence_raw ??
      play.raw_confidence ??
      (typeof raw?.hit_rate === "number" ? raw.hit_rate : null),
    scanner_confidence_percent:
      play.model_diagnostics?.scanner_confidence_percent ??
      normalizeConfidencePercent(play.raw_confidence ?? raw?.hit_rate ?? play.confidence),
    analyzer_confidence_percent:
      play.model_diagnostics?.analyzer_confidence_percent ??
      (play.model_diagnostics?.confidenceSource === "analyzer" ? confidencePercent : null),
    stored_confidence: Math.round(confidencePercent),
    stored_verdict: storedVerdict,
    tier,
    sport: play.sport,
    source_function: sourceFunction,
    model_used: modelUsed,
  };

  return {
    pick_date: pickDate,
    event_id: play.event_id ?? raw?.event_id ?? null,
    commence_time: play.commence_time ?? raw?.commence_time ?? null,
    game_date: play.game_date ?? raw?.game_date ?? null,
    sport: play.sport,
    player_name: play.player_name,
    team: play.team || null,
    opponent: play.opponent || null,
    prop_type: play.prop_type,
    line: play.line,
    direction: play.direction,
    hit_rate: Math.round(confidencePercent),
    confidence: Math.round(confidence01 * 1000) / 1000,
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
