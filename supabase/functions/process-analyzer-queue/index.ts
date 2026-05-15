// process-analyzer-queue
//
// Generic analyzer queue processor. Drains public.analyzer_queue for any
// non-NBA sport (NBA flows through process-nba-analyzer-queue). Each pending
// row carries:
//   - analyzer_endpoint    : where to POST (e.g. 'nba-api/analyze')
//   - analyzer_payload     : the exact body to POST
//   - candidate_payload    : everything the live scanner already knew about
//                            this candidate, so we can rebuild a daily_picks
//                            row without re-running the scanner.
//
// On success we route the finalized row through applyAnalyzerFinalizeInsertGuard
// (the same hard guard the live scanner uses) before any insert. No row may
// land in daily_picks unless confidenceSource==="analyzer" AND analyzer_payload
// AND analyzer_response_snapshot AND sourceContractVersion==="analyzer-finalize.v1".
//
// On 429 we halt the rest of this batch (collateral rollback) and reschedule
// remaining claimed rows with increment=false so they don't burn an attempt
// for work they never performed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  applyAnalyzerFinalizeInsertGuard,
  buildDailyPickRow,
} from "../_shared/daily_pick_rows.ts";
import {
  claimAnalyzerQueueBatch,
  exponentialBackoffMs,
  finalizeAnalyzerQueueRow,
  rescheduleAnalyzerQueueRow,
  type QueueRow,
  type SupaClient,
} from "../_shared/analyzer_queue.ts";
import {
  normalizeCanonicalVerdict,
  normalizeConfidencePercent,
  canonicalToScoredVerdict,
} from "../_shared/canonical_verdict.ts";
import type { ScoredPlay } from "../_shared/edge_scoring.ts";
import { parseRetryAfterMs } from "../_shared/sport_scan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

// Queue-side analyzer timeout. nba-api/analyze with sport=mlb/nhl needs to
// fan out to mlb-model/analyze + nhl-model/analyze (20-factor team context,
// pitchers/parks, goalies/ice). 12s was too aggressive — every NHL row hit
// AbortError. Override per-deploy with ANALYZER_QUEUE_TIMEOUT_MS.
const ANALYZER_TIMEOUT_MS = (() => {
  const raw = Number(getEnv("ANALYZER_QUEUE_TIMEOUT_MS"));
  if (Number.isFinite(raw) && raw >= 5_000) return Math.min(60_000, Math.floor(raw));
  return 30_000;
})();

// Per-invocation per-sport caps. process-analyzer-queue runs every 2 min;
// if we slam every pending row through nba-api/analyze in one cron tick,
// the analyzer either rate-limits or the queue worker times out cascading.
// Drain a small slice each tick instead. Override per-sport via env.
const PER_SPORT_PER_INVOCATION_CAP: Record<string, number> = {
  nhl: 1,
  mlb: 2,
  ufc: 1,
};
const GLOBAL_PER_INVOCATION_CAP = (() => {
  const raw = Number(getEnv("ANALYZER_QUEUE_GLOBAL_CAP"));
  if (Number.isFinite(raw) && raw > 0) return Math.min(25, Math.floor(raw));
  return 3;
})();

// Reschedule delay after analyzer_timeout. Spacing matters: 60s × 5 attempts
// burns the row in ~5 minutes which is barely longer than one cron tick. We
// want at least one *real* analyzer recovery window between attempts.
const ANALYZER_TIMEOUT_RESCHEDULE_MS = (() => {
  const raw = Number(getEnv("ANALYZER_QUEUE_TIMEOUT_RESCHEDULE_MS"));
  if (Number.isFinite(raw) && raw >= 60_000) return Math.min(1_800_000, Math.floor(raw));
  return 480_000; // 8 minutes
})();

function perSportCap(sport: string): number {
  const envKey = `ANALYZER_QUEUE_CAP_${sport.toUpperCase()}`;
  const raw = Number(getEnv(envKey));
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return PER_SPORT_PER_INVOCATION_CAP[sport] ?? 1;
}

// Pick the service-role key from Supabase function env. We prefer custom
// secrets (SERVICE_ROLE_KEY, MASTER_SUPABASE_SERVICE_KEY) over the platform-
// injected SUPABASE_SERVICE_ROLE_KEY because the Supabase CLI does not let
// us override SUPABASE_* secrets, and the injected slot has been observed to
// decode as role=unknown in this project. Returns the chosen env name
// alongside the key so we can log which slot was used.
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

// Legacy Supabase service-role keys are JWTs (three dot-separated base64url
// segments). New-format secrets (sb_secret_…) are not JWTs and have no
// decodable role claim — those should pass the role check by virtue of not
// being a JWT at all.
function looksLikeJwt(s: string): boolean {
  return s.split(".").length === 3;
}

// Decode the middle segment of a JWT and return its `role` claim. We never log
// the key itself — only the env-var name and the decoded role — so this is safe
// to call before client construction. base64url decoding is done manually so we
// don't pull in extra deps.
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

// Canonical sport → analyzer endpoint. Mirrors ANALYZER_ENDPOINT in
// _shared/sport_scan.ts. Duplicated here so the queue worker can override
// any stale row.analyzer_endpoint without pulling sport_scan into this
// function. mlb/nhl MUST route to nba-api/analyze for now — the separate
// mlb-api/analyze endpoint is unfinished and must not be called.
const CANONICAL_ANALYZER_ENDPOINT: Record<string, string> = {
  nba: "nba-api/analyze",
  mlb: "nba-api/analyze",
  nhl: "nba-api/analyze",
  ufc: "ufc-api/analyze",
};
function canonicalEndpointForSport(sport: string, fallback: string): string {
  return CANONICAL_ANALYZER_ENDPOINT[sport] ?? fallback;
}

function classifyHttpFailure(status: number): "http_4xx" | "http_5xx" | "other" {
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500) return "http_5xx";
  return "other";
}

// Per-row outcome histogram increment. Mirrors bumpReason in
// _shared/analyzer_worker.ts so scan-run-status gets the same key shape
// regardless of which drainer processed the row.
function bumpOutcome(map: Record<string, number>, key: string): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

// Identify weak / unsupported / no-pick analyzer responses. We never
// convert these into a published pick.
function rejectReasonsForAnalyzerResponse(ar: unknown): string[] {
  const reasons: string[] = [];
  if (!ar || typeof ar !== "object") {
    reasons.push("empty_response");
    return reasons;
  }
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
    verdictRaw === "PASS" ||
    verdictRaw === "Pass" ||
    verdictRaw === "NO BET" ||
    verdictRaw === "No Bet"
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

// Recompute EV% from analyzer-derived win probability and American odds.
// Returns percent with one decimal of precision (e.g. 7.4 means +7.4% EV).
function computeEvPct(prob: number, odds: number): number {
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || prob <= 0) return 0;
  const payout = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const ev = prob * payout - (1 - prob);
  return Math.round(ev * 1000) / 10;
}

// Build a ScoredPlay that buildDailyPickRow can consume. The candidate_payload
// already carries every immutable field; we splice in analyzer-derived
// confidence/verdict and the analyzer side-car for replay.
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
  // Prefer analyzer-authored writeup so See Why matches manual Analyze.
  // Scanner candidate.reasoning is only used when the analyzer returned no text.
  const analyzerReasoning =
    (typeof ar.reasoning === "string" && ar.reasoning.trim()) ? ar.reasoning :
    (typeof ar.analysis === "string" && ar.analysis.trim()) ? ar.analysis :
    (typeof ar.model_writeup === "string" && ar.model_writeup.trim()) ? ar.model_writeup :
    (typeof ar.writeup === "string" && ar.writeup.trim()) ? ar.writeup :
    "";
  const scannerReasoning = typeof c.reasoning === "string" ? c.reasoning : "";
  const reasoning = analyzerReasoning || scannerReasoning;

  const play: ScoredPlay = {
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
    reasoning,
    event_id: (c.event_id as string | null) ?? null,
    commence_time: (c.commence_time as string | null) ?? null,
    game_date: (c.commence_time as string | null)?.slice(0, 10) ?? null,
    model_diagnostics: merged,
  };
  return play;
}

interface ProcessState {
  rateLimitTripped: boolean;
  lastRetryAfterMs: number | null;
}

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
    `[analyzer-queue][analyze-start] sport=${sport} row=${rowId} endpoint=${endpoint} timeout_ms=${ANALYZER_TIMEOUT_MS}`,
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
    try {
      body = await resp.json();
    } catch {
      body = await resp.text().catch(() => null);
    }
    const duration_ms = Date.now() - startedAt;
    console.log(
      `[analyzer-queue][analyze-done] sport=${sport} row=${rowId} duration_ms=${duration_ms} status=${resp.status}`,
    );
    return { status: resp.status, body, headers: resp.headers, duration_ms };
  } finally {
    clearTimeout(timer);
  }
}

async function processOne(
  supabase: SupaClient,
  supabaseUrl: string,
  serviceKey: string,
  row: QueueRow,
  state: ProcessState,
  todayISO: string,
  nowMs: number,
  outcomeCounts: Record<string, number>,
): Promise<"inserted" | "updated" | "rescheduled" | "failed" | "expired" | "no_pick"> {
  // 1. Date + commence_time gate. Schema has NO game_date column.
  if (row.pick_date < todayISO) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "expired",
      { reason: "pick_date_passed" },
      "pick_date_passed",
    );
    bumpOutcome(outcomeCounts, "expired_pick_date_passed");
    return "expired";
  }
  const commence = (row.candidate_payload as { commence_time?: string })?.commence_time ?? null;
  if (!commence) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "missing_commence_time" },
      "missing_commence_time",
    );
    bumpOutcome(outcomeCounts, "invalid_payload_missing_commence_time");
    return "failed";
  }
  const commenceMs = Date.parse(commence);
  if (Number.isFinite(commenceMs) && commenceMs <= nowMs) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "expired",
      { reason: "game_already_started" },
      "game_already_started",
    );
    bumpOutcome(outcomeCounts, "expired_game_already_started");
    return "expired";
  }

  // 2. Call analyzer.
  // Defensive endpoint normalization: any pending row whose analyzer_endpoint
  // column is stale (e.g. 'mlb-api/analyze' from before the routing change)
  // is silently routed to the canonical endpoint for its sport. Logged so we
  // can confirm cleanup.
  const endpoint = canonicalEndpointForSport(row.sport, row.analyzer_endpoint);
  if (endpoint !== row.analyzer_endpoint) {
    console.log(
      `[analyzer-queue][endpoint-normalized] queue_id=${row.id} sport=${row.sport} ` +
        `from=${row.analyzer_endpoint} to=${endpoint}`,
    );
  }

  let resp: { status: number; body: unknown; headers: Headers; duration_ms: number };
  const callStartedAt = Date.now();
  try {
    resp = await callAnalyzer(
      supabaseUrl,
      serviceKey,
      endpoint,
      row.analyzer_payload,
      row.id,
      row.sport,
    );
  } catch (e) {
    const duration_ms = Date.now() - callStartedAt;
    const isAbort =
      (e as { name?: string })?.name === "AbortError" ||
      String((e as Error)?.message ?? "").toLowerCase().includes("abort");
    const reason = isAbort ? "analyzer_timeout" : "network";
    const retryAfterMs = isAbort
      ? ANALYZER_TIMEOUT_RESCHEDULE_MS
      : exponentialBackoffMs(row.attempts);
    if (isAbort) {
      console.warn(
        `[analyzer-queue][analyze-timeout] sport=${row.sport} row=${row.id} ` +
          `duration_ms=${duration_ms} retry_after_ms=${retryAfterMs} attempt=${row.attempts + 1}/${row.max_attempts}`,
      );
    } else {
      console.warn(
        `[analyzer-queue][analyze-network-error] sport=${row.sport} row=${row.id} ` +
          `duration_ms=${duration_ms} retry_after_ms=${retryAfterMs} ` +
          `attempt=${row.attempts + 1}/${row.max_attempts} err=${(e as Error)?.message ?? e}`,
      );
    }
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed",
        { reason, duration_ms },
        reason,
      );
      bumpOutcome(outcomeCounts, `${reason}_failed`);
      return "failed";
    }
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      retryAfterMs,
      { reason, duration_ms },
      true,
      reason,
    );
    bumpOutcome(outcomeCounts, `${reason}_rescheduled`);
    return "rescheduled";
  }

  // 3. Rate-limit handling — halt the rest of this batch.
  if (resp.status === 429) {
    const retryAfterMs =
      parseRetryAfterMs(resp.headers.get("Retry-After"), resp.body) ?? 300_000;
    state.rateLimitTripped = true;
    state.lastRetryAfterMs = retryAfterMs;
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      retryAfterMs,
      { reason: "rate_limited", status: 429 },
      true,
      "rate_limited",
    );
    bumpOutcome(outcomeCounts, "rate_limited_rescheduled");
    return "rescheduled";
  }

  if (resp.status < 200 || resp.status >= 300) {
    const ftype = classifyHttpFailure(resp.status);
    if (ftype === "http_4xx") {
      // Not retryable.
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed",
        { reason: "http_4xx", status: resp.status },
        "http_4xx",
      );
      bumpOutcome(outcomeCounts, "http_4xx_failed");
      return "failed";
    }
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed",
        { reason: ftype, status: resp.status },
        ftype,
      );
      bumpOutcome(outcomeCounts, `${ftype}_failed`);
      return "failed";
    }
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      exponentialBackoffMs(row.attempts),
      { reason: ftype, status: resp.status },
      true,
      ftype,
    );
    bumpOutcome(outcomeCounts, `${ftype}_rescheduled`);
    return "rescheduled";
  }

  // 4. Reject weak / no-pick / unsupported analyzer output.
  const ar = resp.body as Record<string, unknown> | null;
  const c0 = row.candidate_payload as Record<string, unknown>;
  const md0 = (c0.model_diagnostics ?? {}) as Record<string, unknown>;
  const arObj = (ar ?? {}) as Record<string, unknown>;
  console.log(
    `[analyzer-queue][analyze-result] queue_id=${row.id} sport=${row.sport} ` +
      `player=${c0.player_name ?? "(team)"} prop_type=${c0.prop_type ?? ""} ` +
      `line=${c0.line ?? ""} over_under=${c0.direction ?? ""} ` +
      `endpoint=${endpoint} ` +
      `analyzer_confidence=${arObj.canonical_confidence ?? arObj.confidence ?? arObj.displayConfidence ?? "null"} ` +
      `analyzer_verdict=${arObj.canonical_verdict ?? arObj.verdict ?? "null"} ` +
      `scanner_confidence=${md0.scanner_confidence_percent ?? c0.raw_confidence ?? "null"} ` +
      `scanner_verdict=${md0.canonical_verdict ?? "null"} ` +
      `has_analyzer_payload=${row.analyzer_payload ? 1 : 0} ` +
      `has_analyzer_response_snapshot=${ar ? 1 : 0}`,
  );
  const rejectReasons = rejectReasonsForAnalyzerResponse(ar);
  if (rejectReasons.length > 0) {
    console.warn(
      `[analyzer-queue][no-pick] queue_id=${row.id} sport=${row.sport} ` +
        `reasons=${rejectReasons.join(",")}`,
    );
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "analyzer_unsupported_or_no_pick", details: rejectReasons },
      "analyzer_unsupported_or_no_pick",
    );
    for (const r of rejectReasons) bumpOutcome(outcomeCounts, `no_pick_${r}`);
    return "no_pick";
  }

  // 5. Build the final daily_picks row and gate it through the same hard
  // guard the live scanner uses.
  const scored = buildScoredPlayFromQueueRow(row, ar as Record<string, unknown>);
  const tier = (row.intended_tier as "edge" | "daily" | "value" | null) ?? "value";
  const finalRow = buildDailyPickRow({
    pickDate: row.pick_date,
    play: scored,
    tier,
    raw: null,
    sourceFunction: "process-analyzer-queue",
    modelUsed: endpoint,
    reasoning: scored.reasoning ?? null,
    avgValue: scored.ev_pct ?? null,
    runId: row.run_id ?? null,
  });
  if (!finalRow) {
    await finalizeAnalyzerQueueRow(
      supabase, row.id, "failed",
      { reason: "build_daily_pick_row_returned_null" },
      "build_daily_pick_row_returned_null",
    );
    bumpOutcome(outcomeCounts, "build_daily_pick_row_returned_null");
    return "failed";
  }
  const finalMd = (finalRow.model_diagnostics ?? {}) as Record<string, unknown>;
  console.log(
    `[analyzer-queue][pre-guard] queue_id=${row.id} sport=${row.sport} ` +
      `tier=${tier} confidenceSource=${finalMd.confidenceSource} ` +
      `sourceContractVersion=${finalMd.sourceContractVersion} ` +
      `has_analyzer_payload=${finalMd.analyzer_payload ? 1 : 0} ` +
      `has_analyzer_response_snapshot=${finalMd.analyzer_response_snapshot ? 1 : 0} ` +
      `confidence=${finalRow.confidence} verdict=${finalRow.verdict}`,
  );
  const guarded = applyAnalyzerFinalizeInsertGuard(
    [finalRow],
    `process-analyzer-queue:${row.sport}`,
  );
  console.log(
    `[analyzer-queue][guard] queue_id=${row.id} sport=${row.sport} ` +
      `before=${guarded.rows_before_guard} after=${guarded.rows_after_guard} ` +
      `dropped_non_analyzer=${guarded.rows_dropped_non_analyzer} ` +
      `dropped_missing_payload=${guarded.rows_dropped_missing_payload} ` +
      `dropped_missing_snapshot=${guarded.rows_dropped_missing_snapshot} ` +
      `dropped_other=${guarded.rows_dropped_other}`,
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
    bumpOutcome(outcomeCounts, `guard_${guardReason}`);
    return "failed";
  }

  // 6. Idempotent upsert via SECURITY DEFINER RPC. The RPC's ON CONFLICT key
  // matches the new daily_picks_unique_per_day (v2) index exactly, so a
  // duplicate identity from a prior run refreshes the existing row's
  // analyzer fields + run_id instead of failing. The graded result column
  // is preserved by the RPC (COALESCE) so a still-final game can't be
  // wiped back to 'pending'.
  const { data: upsertData, error: upsertErr } = await supabase.rpc(
    "upsert_daily_pick",
    { p_row: guarded.rows[0] as Record<string, unknown> },
  );
  if (upsertErr) {
    const pgCode = (upsertErr as { code?: string }).code ?? null;
    const pgDetails = (upsertErr as { details?: string }).details ?? null;
    const pgHint = (upsertErr as { hint?: string }).hint ?? null;
    console.error(
      `[analyzer-queue][upsert-error] queue_id=${row.id} sport=${row.sport} ` +
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
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(
        supabase, row.id, "failed", insertDetails, "insert_error",
      );
      bumpOutcome(outcomeCounts, "insert_error_failed");
      return "failed";
    }
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      60_000,
      insertDetails,
      true,
      "insert_error",
    );
    bumpOutcome(outcomeCounts, "insert_error_rescheduled");
    return "rescheduled";
  }

  // RPC returns [{ id, inserted }]. inserted=true → fresh row; false → an
  // existing row was refreshed (duplicate identity, counted separately).
  const upsertRow = Array.isArray(upsertData) ? upsertData[0] : null;
  const wasInsert = (upsertRow as { inserted?: boolean } | null)?.inserted === true;

  // status='done' → RPC clears error_reason (no errorReason arg).
  await finalizeAnalyzerQueueRow(supabase, row.id, "done", {
    tier,
    confidence: finalRow.confidence,
    verdict: finalRow.verdict,
    upsert_outcome: wasInsert ? "inserted" : "updated",
  });
  bumpOutcome(outcomeCounts, wasInsert ? "inserted" : "updated");
  console.log(
    `[analyzer-queue][row] sport=${row.sport} endpoint=${endpoint} ` +
      `outcome=${wasInsert ? "inserted" : "updated"} attempt=${row.attempts + 1} ` +
      `dedupe=${row.dedupe_key}`,
  );
  return wasInsert ? "inserted" : "updated";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = getEnv("SUPABASE_URL");
  const resolved = resolveServiceRoleKey();
  if (!supabaseUrl || !resolved) {
    console.error("[process-analyzer-queue] missing SUPABASE_URL or service-role key");
    return new Response(JSON.stringify({ ok: false, error: "missing_credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate the chosen key. RLS on daily_picks is enabled (force_rls=false),
  // so a true service_role JWT bypasses it but an anon JWT does not — exactly
  // the 42501 failure mode we have been chasing. For legacy JWT keys, decode
  // the role claim and fail fast if it isn't service_role. For new-format
  // secrets (sb_secret_…), there's no decodable role; we accept them.
  const isJwt = looksLikeJwt(resolved.key);
  const role = isJwt ? decodeJwtRole(resolved.key) : null;
  const roleForLog = isJwt ? (role ?? "unknown") : "non_jwt_secret";
  console.log(
    `[process-analyzer-queue] service-role key selected env=${resolved.name} role=${roleForLog}`,
  );
  if (isJwt && role !== "service_role") {
    console.error(
      `[process-analyzer-queue] service_role_key_invalid env=${resolved.name} role=${role ?? "unknown"}`,
    );
    return new Response(
      JSON.stringify({
        ok: false,
        error: "service_role_key_invalid",
        env: resolved.name,
        role: role ?? "unknown",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const serviceKey = resolved.key;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  });

  // Cap how many rows we claim per cron tick. Default 3 globally; per-sport
  // caps (default NHL=1, MLB=2, UFC=1) are enforced below as we iterate.
  const batchSize = Math.max(1, Math.min(25, GLOBAL_PER_INVOCATION_CAP));
  const rows = await claimAnalyzerQueueBatch(supabase, batchSize);
  const todayISO = todayET();
  const nowMs = Date.now();
  const state: ProcessState = { rateLimitTripped: false, lastRetryAfterMs: null };
  const sportRunCount: Record<string, number> = {};

  const summary = {
    depth: rows.length,
    processed: 0,
    inserted: 0,
    // Rows that hit the new daily_picks_unique_per_day index and were
    // refreshed via ON CONFLICT DO UPDATE instead of failing as before.
    updated: 0,
    rescheduled: 0,
    failed: 0,
    expired: 0,
    no_pick: 0,
    cap_skipped: 0,
  };

  // Per-run outcome histogram + sport/pick_date for the scan_run_metrics
  // flush at the end. Same key namespace as _shared/analyzer_worker.ts so
  // scan-run-status reads one merged histogram regardless of which drainer
  // touched the row. Rows without a run_id (legacy enqueues) accumulate into
  // a sentinel bucket that we do NOT flush — scan_run_metrics is keyed by
  // run_id and there is nothing useful to attribute legacy rows against.
  interface RunOutcome {
    sport: string;
    pickDate: string;
    counts: Record<string, number>;
  }
  const runOutcomes = new Map<string, RunOutcome>();
  function getRunOutcome(row: QueueRow): Record<string, number> {
    const runId = row.run_id ?? null;
    const key = runId ?? `legacy:${row.sport}:${row.pick_date}`;
    let entry = runOutcomes.get(key);
    if (!entry) {
      entry = { sport: row.sport, pickDate: row.pick_date, counts: {} };
      runOutcomes.set(key, entry);
    }
    return entry.counts;
  }
  // Aggregate map used for the HTTP response summary; sums every run's
  // contribution so manual invocations still see the full picture.
  const aggregateOutcomeCounts: Record<string, number> = {};
  function rollUpOutcomes(): void {
    for (const entry of runOutcomes.values()) {
      for (const [k, v] of Object.entries(entry.counts)) {
        aggregateOutcomeCounts[k] = (aggregateOutcomeCounts[k] ?? 0) + v;
      }
    }
  }

  for (const row of rows) {
    if (state.rateLimitTripped) {
      // Collateral rollback — don't burn an attempt for work we never performed.
      await rescheduleAnalyzerQueueRow(
        supabase,
        row.id,
        state.lastRetryAfterMs ?? 300_000,
        { reason: "collateral_rate_limit" },
        false,
        "collateral_rate_limit",
      );
      bumpOutcome(getRunOutcome(row), "collateral_rate_limit_rescheduled");
      summary.rescheduled++;
      continue;
    }
    // Per-sport per-invocation cap. If the sport already had its slice for
    // this tick, release the row back to pending without burning an attempt.
    const cap = perSportCap(row.sport);
    const used = sportRunCount[row.sport] ?? 0;
    if (used >= cap) {
      await rescheduleAnalyzerQueueRow(
        supabase,
        row.id,
        120_000,
        { reason: "per_sport_cap" },
        false,
        "per_sport_cap",
      );
      bumpOutcome(getRunOutcome(row), "per_sport_cap_rescheduled");
      summary.cap_skipped++;
      continue;
    }
    sportRunCount[row.sport] = used + 1;
    summary.processed++;
    try {
      const outcome = await processOne(
        supabase,
        supabaseUrl,
        serviceKey,
        row,
        state,
        todayISO,
        nowMs,
        getRunOutcome(row),
      );
      summary[outcome]++;
    } catch (e) {
      console.error(
        `[analyzer-queue][row] sport=${row.sport} unexpected error:`,
        (e as Error)?.message ?? e,
      );
      if (row.attempts + 1 >= row.max_attempts) {
        await finalizeAnalyzerQueueRow(
          supabase, row.id, "failed",
          { reason: "unexpected_error", details: String((e as Error)?.message ?? e) },
          "unexpected_error",
        );
        bumpOutcome(getRunOutcome(row), "unexpected_error_failed");
        summary.failed++;
      } else {
        await rescheduleAnalyzerQueueRow(
          supabase,
          row.id,
          exponentialBackoffMs(row.attempts),
          { reason: "unexpected_error" },
          true,
          "unexpected_error",
        );
        bumpOutcome(getRunOutcome(row), "unexpected_error_rescheduled");
        summary.rescheduled++;
      }
    }
  }

  // Flush per-run outcomes to scan_run_metrics. One RPC per run_id; legacy
  // (run_id NULL) buckets are skipped because there is no scan_run_metrics
  // row to attribute them to. The RPC merges atomically with prior worker
  // contributions for the same run via jsonb_merge_counts().
  for (const [key, entry] of runOutcomes.entries()) {
    if (key.startsWith("legacy:")) continue;
    if (Object.keys(entry.counts).length === 0) continue;
    const { error: metricsErr } = await supabase.rpc("increment_scan_run_metrics", {
      p_run_id: key,
      p_sport: entry.sport,
      p_pick_date: entry.pickDate,
      p_counters: {},
      p_reason_increments: { outcome_counts: entry.counts },
      p_last_error: null,
    });
    if (metricsErr) {
      console.error(
        `[analyzer-queue] increment_scan_run_metrics RPC error run_id=${key}:`,
        metricsErr.message ?? metricsErr,
      );
    }
  }
  rollUpOutcomes();

  console.log(
    `[analyzer-queue] depth=${summary.depth} processed=${summary.processed} ` +
      `inserted=${summary.inserted} updated=${summary.updated} ` +
      `failed=${summary.failed} rescheduled=${summary.rescheduled} ` +
      `expired=${summary.expired} no_pick=${summary.no_pick} ` +
      `cap_skipped=${summary.cap_skipped} ` +
      `timeout_ms=${ANALYZER_TIMEOUT_MS} global_cap=${GLOBAL_PER_INVOCATION_CAP} ` +
      `outcome_counts=${JSON.stringify(aggregateOutcomeCounts)}`,
  );

  return new Response(
    JSON.stringify({ ok: true, ...summary, outcome_counts: aggregateOutcomeCounts }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
