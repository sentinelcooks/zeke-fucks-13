// Per-sport analyzer worker. Drains public.analyzer_queue for a single sport
// using the claim_analyzer_queue_batch RPC (SKIP LOCKED + lock_owner stamp),
// runs each candidate through the existing nba-api/analyze endpoint, and
// finalizes successful rows into daily_picks via the same hard guard the
// live scanner uses (applyAnalyzerFinalizeInsertGuard).
//
// Differs from process-analyzer-queue:
//   1. Per-sport entrypoint — caller (analyzer-worker-{nba,nhl,mlb}) passes
//      sport, batchSize, softDeadlineMs. The legacy drainer remains in place
//      as a safety net.
//   2. Tier is recomputed from the analyzer result via
//      buildNbaQueueFinalization (verdict + hit rate + edge gate + edge cap)
//      rather than trusting the row's intended_tier. This is the whole
//      point of the refactor: candidates that earn an edge tier from the
//      analyzer can now reach tier='edge', not just the ones that won the
//      inline-scan budget lottery.
//   3. Writes scan_run_metrics counters and reason histograms per row so
//      scan-run-status can answer "why no Today's Edge" without re-running.
//   4. Multi-claim loop bounded by softDeadlineMs and a hard claim-round cap
//      so one invocation drains as much as it safely can within Edge Function
//      worker limits, then returns.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  applyAnalyzerFinalizeInsertGuard,
  buildDailyPickRow,
} from "./daily_pick_rows.ts";
import {
  claimAnalyzerQueueBatchPerSport,
  exponentialBackoffMs,
  finalizeAnalyzerQueueRow,
  rescheduleAnalyzerQueueRow,
  type QueueRow,
  type SupaClient,
} from "./analyzer_queue.ts";
import { buildNbaQueueFinalization } from "./nba_queue_finalization.ts";
import {
  normalizeCanonicalVerdict,
  normalizeConfidencePercent,
  canonicalToScoredVerdict,
} from "./canonical_verdict.ts";
import type { ScoredPlay } from "./edge_scoring.ts";
import { parseRetryAfterMs } from "./sport_scan.ts";

// ──────────────────────────────────────────────────────────────────────
// Edge cap per sport. Mirrors EDGE_CAP_PER_SPORT in sport_scan.ts; kept
// here so the worker can decide promotion without importing sport_scan's
// 3,000-line module just for two numbers.
// ──────────────────────────────────────────────────────────────────────
const EDGE_CAP_PER_SPORT: Record<string, number> = {
  nba: 5,
  mlb: 4,
  nhl: 3,
  ufc: 2,
};

// nba-api/analyze is the unified analyzer entrypoint for every sport in
// scope here. mlb/nhl fan out internally to the per-sport context models.
const CANONICAL_ANALYZER_ENDPOINT: Record<string, string> = {
  nba: "nba-api/analyze",
  mlb: "nba-api/analyze",
  nhl: "nba-api/analyze",
  ufc: "ufc-api/analyze",
};

function canonicalEndpointForSport(sport: string, fallback: string): string {
  return CANONICAL_ANALYZER_ENDPOINT[sport] ?? fallback;
}

const APP_TZ = "America/New_York";
function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getEnv(name: string): string | undefined {
  try {
    return typeof Deno !== "undefined" ? Deno.env.get(name) ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

// Same key-resolution + JWT-role validation as process-analyzer-queue. We
// duplicate (not extract) so the legacy drainer is unaffected by any
// future change here.
function resolveServiceRoleKey(): { name: string; key: string } | null {
  for (const name of [
    "SERVICE_ROLE_KEY",
    "MASTER_SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const v = getEnv(name);
    if (v && v.trim()) return { name, key: v.trim() };
  }
  return null;
}

function looksLikeJwt(s: string): boolean {
  return s.split(".").length === 3;
}

function decodeJwtRole(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = atob(b64);
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function classifyHttpFailure(status: number): "http_4xx" | "http_5xx" | "other" {
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500) return "http_5xx";
  return "other";
}

function rejectReasonsForAnalyzerResponse(ar: unknown): string[] {
  const reasons: string[] = [];
  if (!ar || typeof ar !== "object") return ["empty_response"];
  const obj = ar as Record<string, unknown>;
  if (obj.ok === false) reasons.push("analyzer_error");
  if (typeof obj.error === "string" && obj.error.trim()) reasons.push("analyzer_error");
  if (
    obj.unsupportedSport === true ||
    obj.reason === "analyzer_unsupported_sport"
  ) {
    reasons.push("analyzer_unsupported_sport");
  }
  const verdictRaw =
    (obj.canonical_verdict as string | undefined) ??
    (obj.verdict as string | undefined) ??
    null;
  if (
    verdictRaw === "PASS" || verdictRaw === "Pass" ||
    verdictRaw === "NO BET" || verdictRaw === "No Bet"
  ) {
    reasons.push("analyzer_no_pick");
  }
  if (obj.playerIsOut === true) reasons.push("player_out");
  const conf = Number(
    obj.canonical_confidence ?? obj.confidence ?? obj.displayConfidence ?? NaN,
  );
  if (!Number.isFinite(conf) || conf <= 0) reasons.push("analyzer_missing_confidence");
  return reasons;
}

function computeEvPct(prob: number, odds: number): number {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || prob <= 0) return 0;
  const payout = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const ev = prob * payout - (1 - prob);
  return Math.round(ev * 1000) / 10;
}

// Build a ScoredPlay from a queue row + analyzer response. Mirrors
// process-analyzer-queue's buildScoredPlayFromQueueRow (duplicated to
// isolate change here from the legacy drainer).
function buildScoredPlayFromQueueRow(
  row: QueueRow,
  ar: Record<string, unknown>,
): ScoredPlay {
  const c = row.candidate_payload as Record<string, unknown>;
  const confPercent = normalizeConfidencePercent(
    (ar.canonical_confidence as number | undefined) ??
      (ar.confidence as number | undefined) ??
      (ar.displayConfidence as number | undefined) ??
      0,
  );
  const conf01 = confPercent / 100;
  const canonicalVerdict = normalizeCanonicalVerdict(
    (ar.canonical_verdict as string | undefined) ?? (ar.verdict as string | undefined),
    confPercent,
  );
  const analyzerCalledAt = new Date().toISOString();
  const md = (c.model_diagnostics ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...md,
    confidenceSource: "analyzer",
    sourceContractVersion: "analyzer-finalize.v1",
    canonical_confidence: Math.round(confPercent),
    canonical_verdict: canonicalVerdict,
    analyzer_payload: row.analyzer_payload,
    analyzer_response_snapshot: ar,
    analyzer_confidence_raw: ar.confidence ?? ar.canonical_confidence ?? null,
    analyzer_verdict_raw: ar.verdict ?? ar.canonical_verdict ?? null,
    analyzer_confidence_percent: Math.round(confPercent),
    analyzer_called_at: analyzerCalledAt,
    queue_finalized: true,
    queue_row_id: row.id,
  };
  const odds = Number(c.odds ?? -110);
  const impliedRaw = odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
  const edge = Math.max(0, conf01 - impliedRaw);
  const analyzerReasoning =
    (typeof ar.reasoning === "string" && ar.reasoning.trim()) ? ar.reasoning :
    (typeof ar.analysis === "string" && ar.analysis.trim()) ? ar.analysis :
    (typeof ar.model_writeup === "string" && ar.model_writeup.trim()) ? ar.model_writeup :
    (typeof ar.writeup === "string" && ar.writeup.trim()) ? ar.writeup : "";
  const scannerReasoning = typeof c.reasoning === "string" ? c.reasoning : "";
  return {
    sport: row.sport,
    bet_type: (String(c.bet_type ?? "prop") as ScoredPlay["bet_type"]) ?? "prop",
    player_name: String(c.player_name ?? ""),
    team: (c.team as string | null) ?? null,
    opponent: (c.opponent as string | null) ?? null,
    home_team: (c.home_team as string | null) ?? null,
    away_team: (c.away_team as string | null) ?? null,
    prop_type: String(c.prop_type ?? ""),
    line: Number(c.line ?? 0),
    spread_line: (c.spread_line as number | null) ?? null,
    total_line: (c.total_line as number | null) ?? null,
    direction: String(c.direction ?? ""),
    odds,
    projected_prob: conf01,
    implied_prob: impliedRaw,
    raw_implied_prob: impliedRaw,
    edge,
    ev_pct: computeEvPct(conf01, odds),
    confidence: conf01,
    raw_confidence: (c.raw_confidence as number | null) ?? conf01,
    reliability: 0.75,
    score: edge * conf01,
    quality_score: edge * conf01,
    verdict: canonicalToScoredVerdict(canonicalVerdict),
    reasoning: analyzerReasoning || scannerReasoning,
    event_id: (c.event_id as string | null) ?? null,
    commence_time: (c.commence_time as string | null) ?? null,
    game_date: (c.commence_time as string | null)?.slice(0, 10) ?? null,
    model_diagnostics: merged,
  };
}

const ANALYZER_TIMEOUT_MS = (() => {
  const raw = Number(getEnv("ANALYZER_WORKER_TIMEOUT_MS"));
  if (Number.isFinite(raw) && raw >= 5_000) return Math.min(60_000, Math.floor(raw));
  return 30_000;
})();

const ANALYZER_TIMEOUT_RESCHEDULE_MS = 480_000; // 8 minutes

async function callAnalyzer(
  supabaseUrl: string,
  serviceKey: string,
  endpoint: string,
  payload: Record<string, unknown>,
  rowId: string,
  sport: string,
): Promise<{ status: number; body: unknown; headers: Headers; duration_ms: number }> {
  const ctrl = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), ANALYZER_TIMEOUT_MS);
  console.log(
    `[analyzer-worker][analyze-start] sport=${sport} row=${rowId} endpoint=${endpoint} timeout_ms=${ANALYZER_TIMEOUT_MS}`,
  );
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let body: unknown = null;
    try { body = await resp.json(); } catch { body = await resp.text().catch(() => null); }
    const duration_ms = Date.now() - startedAt;
    return { status: resp.status, body, headers: resp.headers, duration_ms };
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Per-run accumulators. We flush these to scan_run_metrics in one RPC
// per worker invocation (per run_id) instead of per row so concurrent
// workers minimize contention on the metrics row.
// ──────────────────────────────────────────────────────────────────────
interface RunBucket {
  sport: string;
  pickDate: string;
  counters: {
    processed: number;
    finalized_edge: number;
    finalized_daily: number;
    finalized_value: number;
    pass_count: number;
    failed_count: number;
    skipped_count: number;
    low_confidence_drops: number;
  };
  edgeGateBlockedReasons: Record<string, number>;
  hardSafetyDrops: Record<string, number>;
  // Per-row terminal/reschedule outcome histogram. Keys like
  // 'inserted', 'updated', 'no_pick_analyzer_no_pick',
  // 'guard_non_analyzer_source', 'expired_game_already_started',
  // 'http_5xx_rescheduled', 'worker_soft_deadline_rescheduled'.
  // Sum of values == every row touched by the worker in this run.
  outcomeCounts: Record<string, number>;
  lastError: string | null;
}

function emptyBucket(sport: string, pickDate: string): RunBucket {
  return {
    sport,
    pickDate,
    counters: {
      processed: 0,
      finalized_edge: 0,
      finalized_daily: 0,
      finalized_value: 0,
      pass_count: 0,
      failed_count: 0,
      skipped_count: 0,
      low_confidence_drops: 0,
    },
    edgeGateBlockedReasons: {},
    hardSafetyDrops: {},
    outcomeCounts: {},
    lastError: null,
  };
}

function bumpReason(map: Record<string, number>, key: string | null | undefined): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

async function flushBucketToMetrics(
  supabase: SupaClient,
  runId: string,
  bucket: RunBucket,
): Promise<void> {
  const hasAny =
    Object.values(bucket.counters).some((n) => n > 0) ||
    Object.keys(bucket.edgeGateBlockedReasons).length > 0 ||
    Object.keys(bucket.hardSafetyDrops).length > 0 ||
    Object.keys(bucket.outcomeCounts).length > 0 ||
    bucket.lastError !== null;
  if (!hasAny) return;
  const { error } = await supabase.rpc("increment_scan_run_metrics", {
    p_run_id: runId,
    p_sport: bucket.sport,
    p_pick_date: bucket.pickDate,
    p_counters: bucket.counters,
    p_reason_increments: {
      edge_gate_blocked_reasons: bucket.edgeGateBlockedReasons,
      hard_safety_drops: bucket.hardSafetyDrops,
      outcome_counts: bucket.outcomeCounts,
    },
    p_last_error: bucket.lastError,
  });
  if (error) {
    console.error(
      `[analyzer-worker] increment_scan_run_metrics RPC error run_id=${runId}:`,
      error.message ?? error,
    );
  }
}

export interface AnalyzerWorkerOptions {
  batchSize: number;       // rows claimed per round
  softDeadlineMs: number;  // stop starting new rounds past this
  maxClaimRounds?: number; // hard ceiling on claim() calls per invocation
  maxAttempts?: number;    // override row max_attempts ceiling
}

export interface AnalyzerWorkerResult {
  ok: boolean;
  sport: string;
  ownerId: string;
  rounds: number;
  duration_ms: number;
  processed: number;
  finalized: { edge: number; daily: number; value: number };
  failed: number;
  skipped: number;
  remainingQueued: number;
  lastError: string | null;
  perRun: Record<string, { processed: number; finalized: number; failed: number }>;
}

// Best-effort per-sport mutex. Backed by the worker_locks table; the lock
// auto-expires after ttlSeconds so a crashed worker can't block the sport
// forever. Returns true if we now own the lock.
async function tryAcquireWorkerLock(
  supabase: SupaClient,
  scope: string,
  owner: string,
  ttlSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_worker_lock", {
    p_scope: scope,
    p_owner: owner,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) {
    console.warn(
      `[analyzer-worker] try_acquire_worker_lock error scope=${scope}:`,
      error.message ?? error,
    );
    // Fail-open: if the lock RPC itself errors, let the worker run rather
    // than stranding the queue. The unique constraint on daily_picks still
    // protects against duplicate inserts.
    return true;
  }
  return data === true;
}

async function releaseWorkerLock(
  supabase: SupaClient,
  scope: string,
  owner: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_worker_lock", {
    p_scope: scope,
    p_owner: owner,
  });
  if (error) {
    console.warn(
      `[analyzer-worker] release_worker_lock error scope=${scope}:`,
      error.message ?? error,
    );
  }
}

// Populate the new error_message column on the row alongside the legacy
// error_reason set by reschedule_analyzer_queue_row / finalize_analyzer_queue_row.
// Best-effort; failures here are logged but never block the worker.
async function setRowErrorMessage(
  supabase: SupaClient,
  rowId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("analyzer_queue")
    .update({ error_message: message })
    .eq("id", rowId);
  if (error) {
    console.warn(
      `[analyzer-worker] setRowErrorMessage error id=${rowId}:`,
      error.message ?? error,
    );
  }
}

async function remainingPendingForSport(
  supabase: SupaClient,
  sport: string,
  today: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("analyzer_queue")
    .select("id", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("pick_date", today)
    .eq("status", "pending");
  if (error) {
    console.error(
      `[analyzer-worker] remainingPendingForSport error sport=${sport}:`,
      error.message ?? error,
    );
    return -1;
  }
  return count ?? 0;
}

async function currentEdgeCount(
  supabase: SupaClient,
  sport: string,
  today: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("daily_picks")
    .select("id", { count: "exact", head: true })
    .eq("sport", sport)
    .eq("pick_date", today)
    .eq("tier", "edge");
  if (error) {
    console.warn(
      `[analyzer-worker] currentEdgeCount error sport=${sport} (assuming cap full):`,
      error.message ?? error,
    );
    return EDGE_CAP_PER_SPORT[sport] ?? 0;
  }
  return count ?? 0;
}

// Process a single claimed row. Returns the outcome and the tier (when
// inserted) so the caller can update counters / edge count.
async function processRow(args: {
  supabase: SupaClient;
  supabaseUrl: string;
  serviceKey: string;
  row: QueueRow;
  todayISO: string;
  nowMs: number;
  edgeCount: number;
  edgeCap: number;
  bucketFor: (runId: string | null, sport: string, pickDate: string) => RunBucket;
}): Promise<{
  outcome: "inserted" | "rescheduled" | "failed" | "expired" | "no_pick";
  tier?: "edge" | "daily" | "value";
}> {
  const { supabase, supabaseUrl, serviceKey, row, todayISO, nowMs } = args;
  const bucket = args.bucketFor(row.run_id ?? null, row.sport, row.pick_date);

  // Date + commence_time gate.
  if (row.pick_date < todayISO) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "expired",
      { reason: "pick_date_passed" },
      "pick_date_passed",
    );
    bucket.counters.skipped_count++;
    bumpReason(bucket.outcomeCounts, "expired_pick_date_passed");
    return { outcome: "expired" };
  }
  const commence = (row.candidate_payload as { commence_time?: string })?.commence_time ?? null;
  if (!commence) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "missing_commence_time" },
      "missing_commence_time",
    );
    bucket.counters.failed_count++;
    bucket.lastError = "missing_commence_time";
    bumpReason(bucket.outcomeCounts, "invalid_payload_missing_commence_time");
    return { outcome: "failed" };
  }
  const commenceMs = Date.parse(commence);
  if (Number.isFinite(commenceMs) && commenceMs <= nowMs) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "expired",
      { reason: "game_already_started" },
      "game_already_started",
    );
    bucket.counters.skipped_count++;
    bumpReason(bucket.outcomeCounts, "expired_game_already_started");
    return { outcome: "expired" };
  }

  const endpoint = canonicalEndpointForSport(row.sport, row.analyzer_endpoint);

  let resp: { status: number; body: unknown; headers: Headers; duration_ms: number };
  try {
    resp = await callAnalyzer(
      supabaseUrl, serviceKey, endpoint, row.analyzer_payload, row.id, row.sport,
    );
  } catch (e) {
    const isAbort =
      (e as { name?: string })?.name === "AbortError" ||
      String((e as Error)?.message ?? "").toLowerCase().includes("abort");
    const reason = isAbort ? "analyzer_timeout" : "network";
    const retryAfterMs = isAbort
      ? ANALYZER_TIMEOUT_RESCHEDULE_MS
      : exponentialBackoffMs(row.attempts);
    bucket.lastError = reason;
    if (row.attempts >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed", { reason }, reason,
      );
      bucket.counters.failed_count++;
      bumpReason(bucket.outcomeCounts, `${reason}_failed`);
      return { outcome: "failed" };
    }
    await rescheduleAnalyzerQueueRow(
      supabase, row.id, retryAfterMs, { reason }, false, reason,
    );
    await setRowErrorMessage(supabase, row.id, reason);
    bumpReason(bucket.outcomeCounts, `${reason}_rescheduled`);
    return { outcome: "rescheduled" };
  }

  // Rate-limit / non-2xx handling.
  if (resp.status === 429) {
    const retryAfterMs =
      parseRetryAfterMs(resp.headers.get("Retry-After"), resp.body) ?? 300_000;
    await rescheduleAnalyzerQueueRow(
      supabase, row.id, retryAfterMs, { reason: "rate_limited", status: 429 },
      false, "rate_limited",
    );
    await setRowErrorMessage(supabase, row.id, "rate_limited");
    bucket.lastError = "rate_limited";
    bumpReason(bucket.outcomeCounts, "rate_limited_rescheduled");
    return { outcome: "rescheduled" };
  }
  if (resp.status < 200 || resp.status >= 300) {
    const ftype = classifyHttpFailure(resp.status);
    if (ftype === "http_4xx") {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed",
        { reason: "http_4xx", status: resp.status },
        "http_4xx",
      );
      bucket.counters.failed_count++;
      bucket.lastError = `http_4xx_${resp.status}`;
      bumpReason(bucket.outcomeCounts, "http_4xx_failed");
      return { outcome: "failed" };
    }
    if (row.attempts >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed",
        { reason: ftype, status: resp.status },
        ftype,
      );
      bucket.counters.failed_count++;
      bucket.lastError = `${ftype}_${resp.status}`;
      bumpReason(bucket.outcomeCounts, `${ftype}_failed`);
      return { outcome: "failed" };
    }
    await rescheduleAnalyzerQueueRow(
      supabase, row.id, exponentialBackoffMs(row.attempts),
      { reason: ftype, status: resp.status }, false, ftype,
    );
    await setRowErrorMessage(supabase, row.id, `${ftype}_${resp.status}`);
    bumpReason(bucket.outcomeCounts, `${ftype}_rescheduled`);
    return { outcome: "rescheduled" };
  }

  // Weak / no-pick / unsupported.
  const ar = resp.body as Record<string, unknown> | null;
  const rejectReasons = rejectReasonsForAnalyzerResponse(ar);
  if (rejectReasons.length > 0) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "analyzer_unsupported_or_no_pick", details: rejectReasons },
      "analyzer_unsupported_or_no_pick",
    );
    bucket.counters.pass_count++;
    for (const r of rejectReasons) {
      bumpReason(bucket.edgeGateBlockedReasons, r);
      bumpReason(bucket.outcomeCounts, `no_pick_${r}`);
    }
    return { outcome: "no_pick" };
  }

  // Build scored play + recompute tier via the edge-gate-aware finalizer.
  const scored = buildScoredPlayFromQueueRow(row, ar as Record<string, unknown>);
  const finalization = buildNbaQueueFinalization({
    baseDiagnostics: scored.model_diagnostics ?? null,
    currentEdgeCount: args.edgeCount,
    edgeCap: args.edgeCap,
    finalized: scored,
  });

  // Drop low-confidence rows the gate downgrades to value if they fall
  // below the value floor (mirror legacy behavior at confidence < 0.50).
  // The finalizer already chose tier, so we honor it.
  const tier = finalization.finalTier;

  // Merge the gate diagnostics into the scored play so the insert guard
  // and history endpoints can see them.
  scored.model_diagnostics = finalization.diagnostics;
  scored.confidence = finalization.confidence;

  // Record edge-gate "why" telemetry.
  const gate = finalization.gate;
  if (!gate.ok) {
    const reason = finalization.diagnostics.edgeDowngradeReason as string | null;
    bumpReason(bucket.edgeGateBlockedReasons, reason ?? "edge_gate_failed");
    if (gate.hardSafetyFail) {
      bumpReason(bucket.hardSafetyDrops, reason ?? "hard_safety");
    }
  }
  if (finalization.promotionBlocker === "confidence_below_nba_edge_min") {
    bucket.counters.low_confidence_drops++;
  }

  const finalRow = buildDailyPickRow({
    pickDate: row.pick_date,
    play: scored,
    tier,
    raw: null,
    sourceFunction: `analyzer-worker-${row.sport}`,
    modelUsed: endpoint,
    reasoning: scored.reasoning ?? null,
    avgValue: scored.ev_pct ?? null,
    // Stamp run_id on every daily_picks row this worker produces.
    // Without this, scan_wait.frontend_visible_count and any user-side
    // WHERE run_id=$X query reads zero even though the rows exist.
    runId: row.run_id ?? null,
  });
  if (!finalRow) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "build_daily_pick_row_returned_null" },
      "build_daily_pick_row_returned_null",
    );
    bucket.counters.failed_count++;
    bucket.lastError = "build_daily_pick_row_returned_null";
    bumpReason(bucket.outcomeCounts, "build_daily_pick_row_returned_null");
    return { outcome: "failed" };
  }

  const guarded = applyAnalyzerFinalizeInsertGuard(
    [finalRow], `analyzer-worker:${row.sport}`,
  );
  if (!guarded.rows.length) {
    const guardReason =
      guarded.rows_dropped_non_analyzer ? "non_analyzer_source" :
      guarded.rows_dropped_missing_payload ? "missing_analyzer_payload" :
      guarded.rows_dropped_missing_snapshot ? "missing_analyzer_response_snapshot" :
      "guard_other";
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "analyzer_finalize_guard_rejected", details: guardReason },
      "analyzer_finalize_guard_rejected",
    );
    bucket.counters.failed_count++;
    bucket.lastError = `guard_${guardReason}`;
    bumpReason(bucket.outcomeCounts, `guard_${guardReason}`);
    return { outcome: "failed" };
  }

  // Idempotent upsert via SECURITY DEFINER RPC. Same RPC the legacy drainer
  // uses, so both workers funnel through one ON CONFLICT path matched to the
  // daily_picks_unique_per_day v2 index. A duplicate identity now refreshes
  // the existing row's analyzer fields + run_id instead of raising 23505,
  // which previously made the delete+insert pattern race under concurrent
  // workers.
  const { data: upsertData, error: upsertErr } = await supabase.rpc(
    "upsert_daily_pick",
    { p_row: guarded.rows[0] as Record<string, unknown> },
  );
  if (upsertErr) {
    const pgCode = (upsertErr as { code?: string }).code ?? null;
    const pgDetails = (upsertErr as { details?: string }).details ?? null;
    const pgHint = (upsertErr as { hint?: string }).hint ?? null;
    console.error(
      `[analyzer-worker][upsert-error] queue_id=${row.id} sport=${row.sport} ` +
        `code=${pgCode ?? ""} message=${upsertErr.message} ` +
        `details=${pgDetails ?? ""} hint=${pgHint ?? ""}`,
    );
    const insertDetails = {
      reason: "insert_error",
      message: upsertErr.message,
      code: pgCode,
      details: pgDetails,
      hint: pgHint,
    };
    if (row.attempts >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed", insertDetails, "insert_error",
      );
      bucket.counters.failed_count++;
      bucket.lastError = `insert_error_${pgCode ?? "unknown"}`;
      bumpReason(bucket.outcomeCounts, "insert_error_failed");
      return { outcome: "failed" };
    }
    await rescheduleAnalyzerQueueRow(
      supabase, row.id, 60_000, insertDetails, false, "insert_error",
    );
    await setRowErrorMessage(
      supabase, row.id, `insert_error: ${upsertErr.message ?? pgCode ?? "unknown"}`,
    );
    bucket.lastError = `insert_error_${pgCode ?? "unknown"}`;
    bumpReason(bucket.outcomeCounts, "insert_error_rescheduled");
    return { outcome: "rescheduled" };
  }

  // RPC returns [{ id, inserted }]. inserted=true → fresh row;
  // false → ON CONFLICT DO UPDATE refreshed an existing row.
  const upsertRow = Array.isArray(upsertData) ? upsertData[0] : null;
  const wasInsert = (upsertRow as { inserted?: boolean } | null)?.inserted === true;

  await finalizeAnalyzerQueueRow(supabase, row.id, "done", {
    tier,
    confidence: finalRow.confidence,
    verdict: finalRow.verdict,
    upsert_outcome: wasInsert ? "inserted" : "updated",
    edge_gate: {
      ok: gate.ok,
      reasons: gate.reasons,
      hardSafetyFail: gate.hardSafetyFail,
      downgrade_reason: finalization.diagnostics.edgeDowngradeReason ?? null,
      promotion_blocker: finalization.promotionBlocker,
    },
  });
  // status='done' → RPC clears error_reason; no errorReason arg needed.

  if (tier === "edge") bucket.counters.finalized_edge++;
  else if (tier === "daily") bucket.counters.finalized_daily++;
  else if (tier === "value") bucket.counters.finalized_value++;
  bumpReason(bucket.outcomeCounts, wasInsert ? "inserted" : "updated");

  return { outcome: "inserted", tier };
}

// ──────────────────────────────────────────────────────────────────────
// Public entrypoint. Called by analyzer-worker-{nba,nhl,mlb}/index.ts.
// ──────────────────────────────────────────────────────────────────────
export async function runAnalyzerWorker(
  sport: string,
  opts: AnalyzerWorkerOptions,
): Promise<AnalyzerWorkerResult> {
  const startedAt = Date.now();
  const ownerId = crypto.randomUUID();
  const maxClaimRounds = Math.max(1, Math.min(opts.maxClaimRounds ?? 3, 10));
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);

  const supabaseUrl = getEnv("SUPABASE_URL");
  const resolved = resolveServiceRoleKey();
  if (!supabaseUrl || !resolved) {
    return {
      ok: false, sport, ownerId, rounds: 0, duration_ms: 0,
      processed: 0, finalized: { edge: 0, daily: 0, value: 0 },
      failed: 0, skipped: 0, remainingQueued: -1, lastError: "missing_credentials",
      perRun: {},
    };
  }

  const isJwt = looksLikeJwt(resolved.key);
  const role = isJwt ? decodeJwtRole(resolved.key) : null;
  if (isJwt && role !== "service_role") {
    return {
      ok: false, sport, ownerId, rounds: 0, duration_ms: 0,
      processed: 0, finalized: { edge: 0, daily: 0, value: 0 },
      failed: 0, skipped: 0, remainingQueued: -1,
      lastError: `service_role_key_invalid env=${resolved.name} role=${role ?? "unknown"}`,
      perRun: {},
    };
  }

  const supabase = createClient(supabaseUrl, resolved.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        apikey: resolved.key,
      },
    },
  });

  // Per-sport mutex. TTL must exceed softDeadlineMs so the lock outlives a
  // worker that's still running; we add 30s headroom for the last row in
  // flight plus the metrics flush.
  const lockScope = `analyzer-worker:${sport}`;
  const lockTtlSeconds = Math.max(
    60,
    Math.ceil(opts.softDeadlineMs / 1000) + 30,
  );
  const lockAcquired = await tryAcquireWorkerLock(
    supabase, lockScope, ownerId, lockTtlSeconds,
  );
  if (!lockAcquired) {
    console.log(
      `[analyzer-worker] sport=${sport} another worker active; skipping`,
    );
    return {
      ok: true, sport, ownerId, rounds: 0, duration_ms: Date.now() - startedAt,
      processed: 0, finalized: { edge: 0, daily: 0, value: 0 },
      failed: 0, skipped: 0, remainingQueued: -1,
      lastError: "another_worker_active", perRun: {},
    };
  }

  const todayISO = todayET();
  const edgeCap = EDGE_CAP_PER_SPORT[sport] ?? 5;
  let edgeCount = await currentEdgeCount(supabase, sport, todayISO);

  // run_id → bucket. We only have run_id on rows that came through the
  // refactored discovery path; legacy enqueues set run_id NULL, in which
  // case we use a sentinel "legacy" bucket scoped to today's pick_date.
  const buckets = new Map<string, RunBucket>();
  const bucketFor = (
    runId: string | null,
    sportArg: string,
    pickDate: string,
  ): RunBucket => {
    const key = runId ?? `legacy:${sportArg}:${pickDate}`;
    let b = buckets.get(key);
    if (!b) {
      b = emptyBucket(sportArg, pickDate);
      buckets.set(key, b);
    }
    return b;
  };

  let rounds = 0;
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let lastError: string | null = null;
  const finalized = { edge: 0, daily: 0, value: 0 };

  try {
  while (rounds < maxClaimRounds) {
    if (Date.now() - startedAt > opts.softDeadlineMs) break;

    const claimed = await claimAnalyzerQueueBatchPerSport(
      supabase, sport, ownerId, opts.batchSize, maxAttempts,
    );
    rounds++;
    if (!claimed.length) break;

    for (const row of claimed) {
      if (Date.now() - startedAt > opts.softDeadlineMs) {
        // Soft deadline hit mid-batch: release the row back to pending
        // without burning an attempt — claim_analyzer_queue_batch already
        // incremented attempts, so we decrement via reschedule with
        // increment=false will leave it as-is. Use a short retry so the
        // next cron tick can re-pick it up.
        await rescheduleAnalyzerQueueRow(
          supabase, row.id, 60_000,
          { reason: "worker_soft_deadline" }, false, "worker_soft_deadline",
        );
        await setRowErrorMessage(supabase, row.id, "worker_soft_deadline");
        // Bucket reads run_id from the row even though we didn't process it,
        // so per-run scan-run-status can see how many MLB rows were
        // throughput-deferred vs. truly expired.
        const sdBucket = bucketFor(row.run_id ?? null, row.sport, row.pick_date);
        bumpReason(sdBucket.outcomeCounts, "worker_soft_deadline_rescheduled");
        skipped++;
        continue;
      }

      // Increment attempts is already done by claim_analyzer_queue_batch.
      const bucket = bucketFor(row.run_id ?? null, row.sport, row.pick_date);
      bucket.counters.processed++;
      processed++;

      try {
        const res = await processRow({
          supabase, supabaseUrl, serviceKey: resolved.key, row,
          todayISO, nowMs: Date.now(),
          edgeCount, edgeCap, bucketFor,
        });
        if (res.outcome === "inserted") {
          if (res.tier === "edge") {
            edgeCount++;
            finalized.edge++;
          } else if (res.tier === "daily") finalized.daily++;
          else if (res.tier === "value") finalized.value++;
        } else if (res.outcome === "failed") failed++;
        else if (res.outcome === "expired") skipped++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        lastError = msg;
        bucket.lastError = msg;
        if (row.attempts >= row.max_attempts) {
          await finalizeAnalyzerQueueRow(
            supabase, row.id, "failed",
            { reason: "unexpected_error", details: msg },
            "unexpected_error",
          );
          bucket.counters.failed_count++;
          bumpReason(bucket.outcomeCounts, "unexpected_error_failed");
          failed++;
        } else {
          await rescheduleAnalyzerQueueRow(
            supabase, row.id, exponentialBackoffMs(row.attempts),
            { reason: "unexpected_error", details: msg },
            false, "unexpected_error",
          );
          await setRowErrorMessage(supabase, row.id, `unexpected_error: ${msg}`);
          bumpReason(bucket.outcomeCounts, "unexpected_error_rescheduled");
        }
      }
    }
  }

  } finally {
    await releaseWorkerLock(supabase, lockScope, ownerId);
  }

  // Flush buckets to scan_run_metrics. One RPC per run_id.
  const perRun: Record<string, { processed: number; finalized: number; failed: number }> = {};
  for (const [runIdKey, bucket] of buckets.entries()) {
    perRun[runIdKey] = {
      processed: bucket.counters.processed,
      finalized:
        bucket.counters.finalized_edge +
        bucket.counters.finalized_daily +
        bucket.counters.finalized_value,
      failed: bucket.counters.failed_count,
    };
    // Only flush rows that have a real run_id; legacy buckets have no
    // matching scan_run_metrics row and would needlessly create one keyed
    // by a synthetic UUID we don't track. Skip them.
    if (runIdKey.startsWith("legacy:")) continue;
    await flushBucketToMetrics(supabase, runIdKey, bucket);
  }

  const remainingQueued = await remainingPendingForSport(supabase, sport, todayISO);
  const duration_ms = Date.now() - startedAt;

  console.log(
    `[analyzer-worker] sport=${sport} owner=${ownerId} rounds=${rounds} ` +
      `processed=${processed} edge=${finalized.edge} daily=${finalized.daily} ` +
      `value=${finalized.value} failed=${failed} skipped=${skipped} ` +
      `remaining=${remainingQueued} duration_ms=${duration_ms}` +
      (lastError ? ` last_error=${lastError}` : ""),
  );

  return {
    ok: true,
    sport, ownerId, rounds, duration_ms,
    processed,
    finalized,
    failed, skipped,
    remainingQueued,
    lastError,
    perRun,
  };
}
