// Generic analyzer queue helpers. Used by sport_scan (enqueue) and
// process-analyzer-queue (claim/finalize/reschedule). NBA stays on its
// dedicated queue (nba_analyzer_queue) — this module never touches NBA.

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type { ScoredPlay } from "./edge_scoring.ts";

export type SupaClient = ReturnType<typeof createClient>;

export interface EnqueueClassification {
  reason:
    | "rate_limited"
    | "analyzer_timeout"
    | "budget_exceeded"
    | "http_5xx"
    | "network";
  retry_after_ms?: number;
}

export interface QueueRow {
  id: string;
  sport: string;
  pick_date: string;
  analyzer_endpoint: string;
  analyzer_payload: Record<string, unknown>;
  candidate_payload: Record<string, unknown>;
  intended_tier: string | null;
  pre_gate_tier: string | null;
  scanner_trace_id: string | null;
  dedupe_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_after: string;
  retry_after_ms: number | null;
  error_reason: string | null;
  diagnostics: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

// Stable dedupe key. Mirrors the daily_picks identity used everywhere else
// in the system: sport + pick_date + (player||team) + (prop||bet) + line +
// direction + (event_id || home@away).
export function dedupeKey(
  sport: string,
  pickDate: string,
  c: {
    player_name?: string | null;
    team?: string | null;
    prop_type?: string | null;
    bet_type?: string | null;
    direction: string;
    line: number | string;
    event_id?: string | null;
    home_team?: string | null;
    away_team?: string | null;
  },
): string {
  const ident = (c.player_name ?? c.team ?? "").toString().trim().toLowerCase();
  const prop = (c.prop_type ?? c.bet_type ?? "").toString().trim().toLowerCase();
  const game =
    c.event_id ??
    `${(c.home_team ?? "").toString().trim().toLowerCase()}@${(c.away_team ?? "").toString().trim().toLowerCase()}`;
  return [sport.toLowerCase(), pickDate, ident, prop, c.direction, c.line, game].join("|");
}

// Per-tier exact-identity delete filter for the queue processor. NEVER
// broad-deletes by sport+pick_date — only the exact prior pick that this
// finalized row should replace.
export interface DailyPickIdentity {
  sport: string;
  pick_date: string;
  player_name: string | null;
  team: string | null;
  prop_type: string;
  line: number;
  direction: string;
  event_id: string | null;
  home_team: string | null;
  away_team: string | null;
}

export function dailyPickDeleteFilter(
  candidate: Record<string, unknown>,
): DailyPickIdentity {
  return {
    sport: String(candidate.sport ?? ""),
    pick_date: String(candidate.pick_date ?? ""),
    player_name: (candidate.player_name as string | null) ?? null,
    team: (candidate.team as string | null) ?? null,
    prop_type: String(candidate.prop_type ?? candidate.bet_type ?? ""),
    line: Number(candidate.line ?? 0),
    direction: String(candidate.direction ?? ""),
    event_id: (candidate.event_id as string | null) ?? null,
    home_team: (candidate.home_team as string | null) ?? null,
    away_team: (candidate.away_team as string | null) ?? null,
  };
}

// Required candidate_payload keys the processor needs to reconstruct a
// daily_picks row without re-running the scanner. Missing keys = enqueue
// refused with a loud log; we never queue a row we can't finalize.
const REQUIRED_CANDIDATE_KEYS = [
  "event_id",
  "home_team",
  "away_team",
  "commence_time",
  "odds",
  "player_name",
  "team",
  "opponent",
  "prop_type",
  "line",
  "direction",
  "bet_type",
  "intended_tier",
  "pre_gate_tier",
  "pick_date",
] as const;

function assertCandidatePayload(
  candidate: Record<string, unknown>,
  scannerTraceId: string | null,
): string | null {
  for (const k of REQUIRED_CANDIDATE_KEYS) {
    if (!(k in candidate)) {
      // Some keys are allowed to be null but must be present.
      if (k === "player_name" && candidate.team) continue;
      if (k === "team" && candidate.player_name) continue;
      if (k === "event_id" && candidate.home_team && candidate.away_team) continue;
      return k;
    }
  }
  if (!candidate.commence_time) return "commence_time";
  if (
    !Number.isFinite(Number(candidate.line)) ||
    Number(candidate.line) <= 0 &&
      candidate.bet_type === "prop"
  ) {
    return "line";
  }
  return null;
}

export interface EnqueueArgs {
  supabase: SupaClient;
  today: string; // YYYY-MM-DD
  sport: string;
  analyzerEndpoint: string;
  analyzerPayload: Record<string, unknown>;
  candidatePayload: Record<string, unknown>;
  intendedTier: string | null;
  preGateTier: string | null;
  scannerTraceId: string | null;
  classification: EnqueueClassification;
}

// Bulk enqueue helper. Each entry passes through `assertCandidatePayload`
// before going to the RPC. Returns how many were enqueued vs. refused.
export async function enqueueGenericAnalyzerCandidates(
  supabase: SupaClient,
  today: string,
  sport: string,
  entries: Array<{
    play: ScoredPlay;
    analyzerEndpoint: string;
    analyzerPayload: Record<string, unknown>;
    candidatePayload: Record<string, unknown>;
    intendedTier: string | null;
    preGateTier: string | null;
    scannerTraceId: string | null;
    classification: EnqueueClassification;
  }>,
): Promise<{ enqueued: number; skipped: number; refused: number }> {
  if (!entries.length) return { enqueued: 0, skipped: 0, refused: 0 };

  const rows: Record<string, unknown>[] = [];
  let refused = 0;
  for (const e of entries) {
    const missing = assertCandidatePayload(e.candidatePayload, e.scannerTraceId);
    if (missing) {
      console.warn(
        `[analyzer-queue] enqueue refused sport=${sport} reason=missing_candidate_key key=${missing} ` +
          `dedupe=${dedupeKey(sport, today, e.candidatePayload as never)}`,
      );
      refused++;
      continue;
    }
    const key = dedupeKey(sport, today, e.candidatePayload as never);
    rows.push({
      sport,
      pick_date: today,
      analyzer_endpoint: e.analyzerEndpoint,
      analyzer_payload: e.analyzerPayload,
      candidate_payload: e.candidatePayload,
      intended_tier: e.intendedTier,
      pre_gate_tier: e.preGateTier,
      scanner_trace_id: e.scannerTraceId,
      dedupe_key: key,
      status: "pending",
      retry_after_ms: e.classification.retry_after_ms ?? null,
      error_reason: e.classification.reason,
    });
  }

  if (!rows.length) return { enqueued: 0, skipped: 0, refused };

  const { error } = await supabase.rpc("enqueue_analyzer_candidates", {
    p_rows: rows,
  });
  if (error) {
    console.error(
      `[analyzer-queue] enqueue_analyzer_candidates RPC error sport=${sport}:`,
      error.message ?? error,
    );
    return { enqueued: 0, skipped: 0, refused };
  }

  return { enqueued: rows.length, skipped: 0, refused };
}

// Wrappers around the queue RPCs (claim / reschedule / finalize).

export async function claimAnalyzerQueueBatch(
  supabase: SupaClient,
  batchSize: number,
): Promise<QueueRow[]> {
  const { data, error } = await supabase.rpc("claim_analyzer_queue", {
    p_batch_size: batchSize,
  });
  if (error) {
    console.error("[analyzer-queue] claim_analyzer_queue RPC error:", error.message ?? error);
    return [];
  }
  return (data ?? []) as QueueRow[];
}

export async function rescheduleAnalyzerQueueRow(
  supabase: SupaClient,
  queueId: string,
  retryAfterMs: number,
  diagnostics: Record<string, unknown> | null,
  incrementAttempts: boolean,
  errorReason: string,
): Promise<void> {
  const { error } = await supabase.rpc("reschedule_analyzer_queue_row", {
    p_queue_id: queueId,
    p_retry_after_ms: retryAfterMs,
    p_diagnostics: diagnostics,
    p_increment_attempts: incrementAttempts,
    p_error_reason: errorReason,
  });
  if (error) {
    console.error(
      `[analyzer-queue] reschedule RPC error id=${queueId}:`,
      error.message ?? error,
    );
  }
}

export async function finalizeAnalyzerQueueRow(
  supabase: SupaClient,
  queueId: string,
  status: "done" | "failed" | "expired" | "missing_analyzer_endpoint",
  diagnostics: Record<string, unknown> | null,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_analyzer_queue_row", {
    p_queue_id: queueId,
    p_status: status,
    p_diagnostics: diagnostics,
  });
  if (error) {
    console.error(
      `[analyzer-queue] finalize RPC error id=${queueId} status=${status}:`,
      error.message ?? error,
    );
  }
}

// Exponential backoff for non-rate-limit transient failures.
// 60s → 120s → 240s → 480s → 960s, capped at 30 min.
export function exponentialBackoffMs(attempts: number): number {
  const base = 60_000 * Math.pow(2, Math.max(0, attempts));
  return Math.min(base, 1_800_000);
}
