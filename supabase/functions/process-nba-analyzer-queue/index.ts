// process-nba-analyzer-queue
//
// Drain the nba_analyzer_queue in safe batches. Candidates that
// slate-scanner-nba had to defer (analyzer_call_budget_exceeded or
// analyzer_rate_limit_budget_exhausted) get analyzed here so they can
// be promoted from tier='daily'/'value' to 'edge' when they finalize
// as STRONG/LEAN and pass the existing NBA edge gate.
//
// All locking/promotion is done through SECURITY DEFINER RPCs:
//   claim_nba_analyzer_queue, promote_nba_queue_pick,
//   refresh_nba_pick_diagnostics, finalize_nba_queue_row,
//   reschedule_nba_queue_row.
//
// Concurrency is sequential per row (mirrors ANALYZER_LIMIT['nba']=3 of
// scanSport but kept at 1 here on purpose — the cron runs every 2 min,
// and we never want to add analyzer pressure beyond what scanSport
// already imposes during a slate run).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  scorePrecomputed,
  type ScoredPlay,
} from "../_shared/edge_scoring.ts";
import { canonicalToScoredVerdict } from "../_shared/canonical_verdict.ts";
import {
  newAnalyzerDiagnostics,
  parseRetryAfterMs,
  passNbaEdgeGate,
  validateWithAnalyzer,
  NBA_EDGE_CAP,
  type AnalyzerErrorCandidate,
} from "../_shared/sport_scan.ts";

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
    return typeof Deno !== "undefined"
      ? Deno.env.get(name) ?? undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveBatchSize(): number {
  const raw = Number(getEnv("NBA_QUEUE_BATCH_SIZE"));
  if (!Number.isFinite(raw) || raw <= 0) return 20;
  return Math.max(1, Math.min(25, Math.round(raw)));
}

function resolveFailureBackoffMs(): number {
  const raw = Number(getEnv("NBA_QUEUE_FAILURE_BACKOFF_MS"));
  if (!Number.isFinite(raw) || raw <= 0) return 300_000;
  return Math.max(60_000, Math.round(raw));
}

interface QueueRow {
  id: string;
  pick_date: string;
  event_id: string | null;
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  odds_snapshot: string;
  dedupe_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_after: string;
  retry_after_ms: number | null;
  skipped_reason: string;
  payload: Record<string, unknown>;
  diagnostics: Record<string, unknown> | null;
  game_date: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

type Supa = ReturnType<typeof createClient>;

async function preflightExpire(
  supabase: Supa,
  row: QueueRow,
): Promise<{ expire: true; reason: string } | { expire: false }> {
  const today = todayET();
  if (row.pick_date < today) {
    return { expire: true, reason: "pick_date_passed" };
  }
  if (row.game_date && row.game_date < today) {
    return { expire: true, reason: "game_date_passed" };
  }

  const { data: livePick, error } = await supabase
    .from("daily_picks")
    .select("id, odds, model_diagnostics")
    .eq("pick_date", row.pick_date)
    .eq("sport", "nba")
    .eq("player_name", row.player_name)
    .eq("prop_type", row.prop_type)
    .eq("direction", row.direction)
    .eq("line", row.line)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      `[nba-queue] live pick lookup error for ${row.id}:`,
      error.message,
    );
    // Treat as a transient failure path; the analyzer attempt will retry.
    return { expire: false };
  }
  if (!livePick) {
    return { expire: true, reason: "live_pick_missing" };
  }
  if (
    typeof livePick.odds === "string" &&
    livePick.odds !== row.odds_snapshot
  ) {
    return { expire: true, reason: "odds_changed" };
  }
  return { expire: false };
}

function payloadToScoredPlay(payload: Record<string, unknown>): ScoredPlay {
  // payload was stored via supabase JSON serialization of a ScoredPlay.
  return payload as unknown as ScoredPlay;
}

function rescore(p: ScoredPlay): ScoredPlay {
  const rescored = scorePrecomputed({
    sport: p.sport,
    bet_type: p.bet_type,
    player_name: p.player_name,
    team: p.team ?? null,
    opponent: p.opponent ?? null,
    home_team: p.home_team ?? null,
    away_team: p.away_team ?? null,
    prop_type: p.prop_type,
    line: p.line,
    spread_line: p.spread_line ?? null,
    total_line: p.total_line ?? null,
    direction: p.direction,
    odds: p.odds,
    projected_prob: p.projected_prob,
    implied_prob: p.implied_prob,
    edge: p.edge,
    ev_pct: p.ev_pct,
    confidence: p.confidence,
    event_id: p.event_id ?? null,
    commence_time: p.commence_time ?? null,
    game_date: p.game_date ?? null,
  });
  rescored.reasoning = p.reasoning || rescored.reasoning;
  rescored.model_diagnostics = p.model_diagnostics ?? null;
  const canonical = (rescored.model_diagnostics ?? {})?.canonical_verdict as
    | string
    | undefined;
  if (
    canonical === "STRONG" ||
    canonical === "LEAN" ||
    canonical === "RISKY" ||
    canonical === "PASS"
  ) {
    rescored.verdict = canonicalToScoredVerdict(canonical);
  }
  return rescored;
}

async function currentEdgeCount(supabase: Supa, pickDate: string): Promise<number> {
  const { count, error } = await supabase
    .from("daily_picks")
    .select("id", { count: "exact", head: true })
    .eq("pick_date", pickDate)
    .eq("sport", "nba")
    .eq("tier", "edge");
  if (error) {
    console.warn(`[nba-queue] edge count error:`, error.message);
    return NBA_EDGE_CAP; // be defensive: assume full to block promotion
  }
  return count ?? 0;
}

function buildFinalDiagnostics(
  base: Record<string, unknown> | null | undefined,
  finalTier: "edge" | "daily" | "value",
  gateResult: ReturnType<typeof passNbaEdgeGate> | null,
  ev_pct: number,
  edge: number,
): Record<string, unknown> {
  const md: Record<string, unknown> = { ...(base ?? {}) };
  // Drop the analyzer_skipped_reason now that we have an analyzer result.
  delete md.analyzer_skipped_reason;
  if (gateResult) {
    md.edgeEligible = gateResult.ok;
    md.edge_gate_result = gateResult.edge_gate_result;
    md.edge_gate_inputs = gateResult.inputs;
    md.edge_gate_decision = gateResult.edge_gate_decision;
    md.edgeRejectionReasons = gateResult.reasons ?? [];
    md.edgeDowngradeReason =
      !gateResult.ok && gateResult.reasons.length > 0
        ? gateResult.reasons[0]
        : null;
    md.heavy_juice_threshold = gateResult.heavyJuiceThreshold;
    md.heavy_juice_action = gateResult.heavyJuiceAction;
  }
  md.postGateTier = finalTier;
  md.final_edge_eligible = finalTier === "edge";
  md.evPct = Math.round(ev_pct * 100) / 100;
  md.modelEdge = Math.round(edge * 10000) / 10000;
  md.queue_processed_at = new Date().toISOString();
  return md;
}

async function processOne(
  supabase: Supa,
  row: QueueRow,
  state: { rateLimitTripped: boolean; lastRetryAfterMs: number | null },
): Promise<{
  outcome:
    | "expired"
    | "promoted"
    | "refreshed"
    | "rate_limited"
    | "failed"
    | "rescheduled";
}> {
  // 1. Pre-flight expiry (no analyzer call).
  const exp = await preflightExpire(supabase, row);
  if (exp.expire) {
    await supabase.rpc("finalize_nba_queue_row", {
      p_queue_id: row.id,
      p_status: "expired",
      p_diagnostics: { expired_reason: exp.reason },
    });
    return { outcome: "expired" };
  }

  // 2. Call analyzer for this row using the shared validateWithAnalyzer.
  //    A fresh diagnostics container makes the call independent of the
  //    scanner run — analyzer concurrency stays at 1 (sequential).
  const play = payloadToScoredPlay(row.payload);
  const diagnostics = newAnalyzerDiagnostics("nba");
  const errorCandidates: AnalyzerErrorCandidate[] = [];
  let analyzed: ScoredPlay | null = null;
  try {
    analyzed = await validateWithAnalyzer(
      play,
      new Map(),
      diagnostics,
      [],
      errorCandidates,
    );
  } catch (e) {
    // Network / abort — counts as a row that did consume a call attempt.
    const msg = e instanceof Error ? e.message : String(e);
    const willFail = row.attempts + 1 >= row.max_attempts;
    if (willFail) {
      await supabase.rpc("finalize_nba_queue_row", {
        p_queue_id: row.id,
        p_status: "failed",
        p_diagnostics: { last_error: msg, error_type: "network_or_abort" },
      });
      return { outcome: "failed" };
    }
    await supabase.rpc("reschedule_nba_queue_row", {
      p_queue_id: row.id,
      p_retry_after_ms: resolveFailureBackoffMs(),
      p_diagnostics: { last_error: msg, error_type: "network_or_abort" },
      p_increment_attempts: true,
    });
    return { outcome: "rescheduled" };
  }

  // 3. Detect rate limit. validateWithAnalyzer keeps the candidate alive on
  //    rate-limit by returning the original play tagged with
  //    failureTypes.rate_limited > 0. The caller is expected to halt the
  //    rest of the batch.
  if (diagnostics.failureTypes.rate_limited > 0) {
    const lastErr = errorCandidates[errorCandidates.length - 1];
    const retryMs =
      (lastErr ? parseRetryAfterMs(null, lastErr.error) : null) ?? 60_000;
    state.rateLimitTripped = true;
    state.lastRetryAfterMs = retryMs;
    await supabase.rpc("reschedule_nba_queue_row", {
      p_queue_id: row.id,
      p_retry_after_ms: retryMs,
      p_diagnostics: { rate_limited: true, retry_after_ms: retryMs },
      p_increment_attempts: true, // this row consumed an analyzer call
    });
    return { outcome: "rate_limited" };
  }

  // 4. Other analyzer failures (callsFailed > 0 but not rate-limited).
  if (diagnostics.callsFailed > 0) {
    const willFail = row.attempts + 1 >= row.max_attempts;
    const failureDiag = {
      analyzer_failure_types: diagnostics.failureTypes,
      analyzer_calls_failed: diagnostics.callsFailed,
    };
    if (willFail) {
      await supabase.rpc("finalize_nba_queue_row", {
        p_queue_id: row.id,
        p_status: "failed",
        p_diagnostics: failureDiag,
      });
      return { outcome: "failed" };
    }
    await supabase.rpc("reschedule_nba_queue_row", {
      p_queue_id: row.id,
      p_retry_after_ms: resolveFailureBackoffMs(),
      p_diagnostics: failureDiag,
      p_increment_attempts: true,
    });
    return { outcome: "rescheduled" };
  }

  // 5. Analyzer returned. Re-score, re-evaluate the NBA edge gate.
  const finalized = analyzed ?? play;
  const rescored = rescore(finalized);
  const canonical = (rescored.model_diagnostics ?? {})?.canonical_verdict as
    | string
    | undefined;
  const isStrongOrLean = canonical === "STRONG" || canonical === "LEAN";
  const gate = passNbaEdgeGate(rescored);

  // Edge cap reconciliation: only promote if there is room.
  const live = await currentEdgeCount(supabase, row.pick_date);
  const canPromote = isStrongOrLean && gate.ok && live < NBA_EDGE_CAP;

  const finalTier: "edge" | "daily" | "value" = canPromote
    ? "edge"
    : rescored.confidence >= 0.70
      ? "daily"
      : "value";

  const finalDiag = buildFinalDiagnostics(
    rescored.model_diagnostics ?? null,
    finalTier,
    gate,
    rescored.ev_pct,
    rescored.edge,
  );

  const match = {
    pick_date: row.pick_date,
    sport: "nba",
    player_name: row.player_name,
    prop_type: row.prop_type,
    direction: row.direction,
    line: row.line,
  };

  const verdictTag =
    rescored.verdict === "Strong" || rescored.verdict === "Lean"
      ? `[VERDICT:${rescored.verdict}] `
      : "";
  const reasoning = `${verdictTag}${rescored.reasoning ?? ""}`.trim();

  if (canPromote) {
    const { error: promoteErr } = await supabase.rpc("promote_nba_queue_pick", {
      p_queue_id: row.id,
      p_final_pick_payload: {
        tier: "edge",
        verdict:
          (rescored.model_diagnostics ?? {}).canonical_verdict ??
          rescored.verdict,
        confidence: Math.round(rescored.confidence * 1000) / 1000,
        reasoning,
        model_diagnostics: finalDiag,
        match,
      },
    });
    if (promoteErr) {
      console.error(`[nba-queue] promote failed for ${row.id}:`, promoteErr);
      // Mark the queue row as failed so we don't retry forever on a logic error.
      await supabase.rpc("finalize_nba_queue_row", {
        p_queue_id: row.id,
        p_status: "failed",
        p_diagnostics: { promote_error: String(promoteErr.message ?? promoteErr) },
      });
      return { outcome: "failed" };
    }
    return { outcome: "promoted" };
  }

  // Not promoting. Refresh the live daily_picks row's diagnostics + verdict
  // to reflect the analyzer outcome (so analyzer_skipped_reason is cleared
  // and the canonical_verdict is now correct), then mark queue row done.
  const { error: refreshErr } = await supabase.rpc(
    "refresh_nba_pick_diagnostics",
    {
      p_match: match,
      p_diagnostics: finalDiag,
      p_verdict:
        (rescored.model_diagnostics ?? {}).canonical_verdict ??
        rescored.verdict,
      p_confidence: Math.round(rescored.confidence * 1000) / 1000,
      p_reasoning: reasoning,
    },
  );
  if (refreshErr) {
    console.warn(
      `[nba-queue] refresh diagnostics failed for ${row.id}:`,
      refreshErr.message,
    );
  }
  await supabase.rpc("finalize_nba_queue_row", {
    p_queue_id: row.id,
    p_status: "done",
    p_diagnostics: {
      analyzer_canonical_verdict: canonical ?? null,
      gate_ok: gate.ok,
      gate_reasons: gate.reasons ?? [],
      promoted: false,
      promotion_blocker: !isStrongOrLean
        ? "verdict_not_strong_or_lean"
        : !gate.ok
          ? "edge_gate_failed"
          : "edge_cap_full",
    },
  });
  return { outcome: "refreshed" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl =
    getEnv("PROJECT_URL")?.trim() || getEnv("SUPABASE_URL")?.trim();
  const serviceRoleKey =
    getEnv("SERVICE_ROLE_KEY")?.trim() ||
    getEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing PROJECT_URL or SERVICE_ROLE_KEY" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const batchSize = resolveBatchSize();

  const counters = {
    claimed: 0,
    analyzed: 0,
    promoted_to_edge: 0,
    refreshed: 0,
    expired: 0,
    rate_limited: 0,
    failed: 0,
    rescheduled: 0,
    errors: [] as string[],
    last_retry_after_ms: null as number | null,
  };

  try {
    const { data: claimedRaw, error: claimErr } = await supabase.rpc(
      "claim_nba_analyzer_queue",
      { p_batch_size: batchSize },
    );
    if (claimErr) {
      console.error("[nba-queue] claim error:", claimErr);
      return new Response(
        JSON.stringify({ ok: false, error: claimErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const claimed = (claimedRaw ?? []) as QueueRow[];
    counters.claimed = claimed.length;

    const state = { rateLimitTripped: false, lastRetryAfterMs: null as number | null };

    for (let i = 0; i < claimed.length; i++) {
      const row = claimed[i];

      // Collateral rollback: if a peer earlier in this batch hit a rate
      // limit, do NOT call the analyzer for the remaining claimed rows.
      // Reschedule them WITHOUT incrementing attempts — they never
      // performed work, so they must not burn max_attempts.
      if (state.rateLimitTripped) {
        await supabase.rpc("reschedule_nba_queue_row", {
          p_queue_id: row.id,
          p_retry_after_ms: state.lastRetryAfterMs ?? 60_000,
          p_diagnostics: {
            collateral_rate_limit: true,
            triggered_by_peer: true,
          },
          p_increment_attempts: false,
        });
        counters.rescheduled++;
        continue;
      }

      try {
        const r = await processOne(supabase, row, state);
        switch (r.outcome) {
          case "expired":
            counters.expired++;
            break;
          case "promoted":
            counters.analyzed++;
            counters.promoted_to_edge++;
            break;
          case "refreshed":
            counters.analyzed++;
            counters.refreshed++;
            break;
          case "rate_limited":
            counters.rate_limited++;
            counters.last_retry_after_ms = state.lastRetryAfterMs;
            break;
          case "failed":
            counters.failed++;
            break;
          case "rescheduled":
            counters.rescheduled++;
            break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[nba-queue] processOne threw for ${row.id}:`, msg);
        counters.errors.push(`${row.id}: ${msg}`);
        // Best-effort recovery: bump and reschedule (counts as a real attempt
        // since we don't know whether the analyzer call landed).
        try {
          await supabase.rpc("reschedule_nba_queue_row", {
            p_queue_id: row.id,
            p_retry_after_ms: resolveFailureBackoffMs(),
            p_diagnostics: { unhandled_error: msg },
            p_increment_attempts: true,
          });
        } catch {
          // Swallow — the row remains in 'processing' and will be retried
          // by the next claim cycle once a fault is observed.
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, batch_size: batchSize, ...counters }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[nba-queue] fatal:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e), counters }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
