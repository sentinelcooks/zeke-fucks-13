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
  dailyPickDeleteFilter,
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

const ANALYZER_TIMEOUT_MS = 12_000;

function resolveServiceRoleKey(): string | null {
  for (const name of [
    "SERVICE_ROLE_KEY",
    "MASTER_SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const v = getEnv(name);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function classifyHttpFailure(status: number): "http_4xx" | "http_5xx" | "other" {
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500) return "http_5xx";
  return "other";
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
  const reasoning =
    (typeof c.reasoning === "string" ? c.reasoning : "") ||
    (typeof ar.reasoning === "string" ? ar.reasoning : "");

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
    ev_pct: Number(c.ev_pct ?? 0),
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
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANALYZER_TIMEOUT_MS);
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
    return { status: resp.status, body, headers: resp.headers };
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
): Promise<"inserted" | "rescheduled" | "failed" | "expired" | "no_pick"> {
  // 1. Date + commence_time gate. Schema has NO game_date column.
  if (row.pick_date < todayISO) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "expired", {
      reason: "pick_date_passed",
    });
    return "expired";
  }
  const commence = (row.candidate_payload as { commence_time?: string })?.commence_time ?? null;
  if (!commence) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
      reason: "missing_commence_time",
    });
    return "failed";
  }
  const commenceMs = Date.parse(commence);
  if (Number.isFinite(commenceMs) && commenceMs <= nowMs) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "expired", {
      reason: "game_already_started",
    });
    return "expired";
  }

  // 2. Call analyzer.
  let resp: { status: number; body: unknown; headers: Headers };
  try {
    resp = await callAnalyzer(
      supabaseUrl,
      serviceKey,
      row.analyzer_endpoint,
      row.analyzer_payload,
    );
  } catch (e) {
    const isAbort =
      (e as { name?: string })?.name === "AbortError" ||
      String((e as Error)?.message ?? "").toLowerCase().includes("abort");
    const reason = isAbort ? "analyzer_timeout" : "network";
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(supabase, row.id, "failed", { reason });
      return "failed";
    }
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      isAbort ? 60_000 : exponentialBackoffMs(row.attempts),
      { reason },
      true,
      reason,
    );
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
    return "rescheduled";
  }

  if (resp.status < 200 || resp.status >= 300) {
    const ftype = classifyHttpFailure(resp.status);
    if (ftype === "http_4xx") {
      // Not retryable.
      await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
        reason: "http_4xx",
        status: resp.status,
      });
      return "failed";
    }
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
        reason: ftype,
        status: resp.status,
      });
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
    return "rescheduled";
  }

  // 4. Reject weak / no-pick / unsupported analyzer output.
  const ar = resp.body as Record<string, unknown> | null;
  const rejectReasons = rejectReasonsForAnalyzerResponse(ar);
  if (rejectReasons.length > 0) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
      reason: "analyzer_unsupported_or_no_pick",
      details: rejectReasons,
    });
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
    modelUsed: row.analyzer_endpoint,
    reasoning: scored.reasoning ?? null,
    avgValue: scored.ev_pct ?? null,
  });
  if (!finalRow) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
      reason: "build_daily_pick_row_returned_null",
    });
    return "failed";
  }
  const guarded = applyAnalyzerFinalizeInsertGuard(
    [finalRow],
    `process-analyzer-queue:${row.sport}`,
  );
  if (!guarded.rows.length) {
    await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
      reason: "analyzer_finalize_guard_rejected",
    });
    return "failed";
  }

  // 6. Exact-identity delete (NEVER broad sport+pick_date wipe), then insert.
  const f = dailyPickDeleteFilter(row.candidate_payload);
  let q = supabase
    .from("daily_picks")
    .delete()
    .eq("sport", row.sport)
    .eq("pick_date", row.pick_date)
    .eq("line", f.line)
    .eq("direction", f.direction)
    .eq("prop_type", f.prop_type);
  if (f.player_name) q = q.eq("player_name", f.player_name);
  if (f.event_id) q = q.eq("event_id", f.event_id);
  else if (f.home_team && f.away_team)
    q = q.eq("home_team", f.home_team).eq("away_team", f.away_team);
  await q;

  const { error } = await supabase.from("daily_picks").insert(guarded.rows);
  if (error) {
    if (row.attempts + 1 >= row.max_attempts) {
      await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
        reason: "insert_error",
        details: error.message,
      });
      return "failed";
    }
    await rescheduleAnalyzerQueueRow(
      supabase,
      row.id,
      60_000,
      { reason: "insert_error", details: error.message },
      true,
      "insert_error",
    );
    return "rescheduled";
  }

  await finalizeAnalyzerQueueRow(supabase, row.id, "done", {
    tier,
    confidence: finalRow.confidence,
    verdict: finalRow.verdict,
  });
  console.log(
    `[analyzer-queue][row] sport=${row.sport} endpoint=${row.analyzer_endpoint} ` +
      `outcome=inserted attempt=${row.attempts + 1} dedupe=${row.dedupe_key}`,
  );
  return "inserted";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = resolveServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    console.error("[process-analyzer-queue] missing SUPABASE_URL or service-role key");
    return new Response(JSON.stringify({ ok: false, error: "missing_credentials" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  });

  const batchSize = Math.max(1, Math.min(25, Number(getEnv("ANALYZER_QUEUE_BATCH_SIZE")) || 10));
  const rows = await claimAnalyzerQueueBatch(supabase, batchSize);
  const todayISO = todayET();
  const nowMs = Date.now();
  const state: ProcessState = { rateLimitTripped: false, lastRetryAfterMs: null };

  const summary = {
    depth: rows.length,
    processed: 0,
    inserted: 0,
    rescheduled: 0,
    failed: 0,
    expired: 0,
    no_pick: 0,
  };

  for (const row of rows) {
    summary.processed++;
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
      summary.rescheduled++;
      continue;
    }
    try {
      const outcome = await processOne(
        supabase,
        supabaseUrl,
        serviceKey,
        row,
        state,
        todayISO,
        nowMs,
      );
      summary[outcome]++;
    } catch (e) {
      console.error(
        `[analyzer-queue][row] sport=${row.sport} unexpected error:`,
        (e as Error)?.message ?? e,
      );
      if (row.attempts + 1 >= row.max_attempts) {
        await finalizeAnalyzerQueueRow(supabase, row.id, "failed", {
          reason: "unexpected_error",
          details: String((e as Error)?.message ?? e),
        });
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
        summary.rescheduled++;
      }
    }
  }

  console.log(
    `[analyzer-queue] depth=${summary.depth} processed=${summary.processed} ` +
      `inserted=${summary.inserted} failed=${summary.failed} ` +
      `rescheduled=${summary.rescheduled} expired=${summary.expired} ` +
      `no_pick=${summary.no_pick}`,
  );

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
