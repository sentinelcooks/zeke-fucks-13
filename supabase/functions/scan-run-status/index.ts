// scan-run-status
//
// Read-only status endpoint for the discovery -> queue -> worker pipeline.
// Combines two sources:
//   1. scan_run_metrics  - per-run counters/histograms written by discovery
//                          and by each analyzer-worker invocation.
//   2. analyzer_queue    - live status counts (pending/processing/done/...)
//                          for the run, so the caller can tell how much
//                          work remains right now.
//
// Lookup paths:
//   GET ?run_id=<uuid>             - single run
//   GET ?sport=<sport>[&date=YYYY-MM-DD]  - most recent run for sport+date
//                                            (date defaults to today ET)
//
// Auth: requires a service-role or anon JWT (verify_jwt=true on deploy).
// All DB reads use the function's service-role client so the caller does
// not need RLS-readable access to scan_run_metrics / analyzer_queue.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

interface MetricsRow {
  run_id: string;
  sport: string;
  pick_date: string;
  discovered: number;
  queued: number;
  processed: number;
  finalized_edge: number;
  finalized_daily: number;
  finalized_value: number;
  pass_count: number;
  failed_count: number;
  skipped_count: number;
  low_confidence_drops: number;
  prefilter_drop_reasons: Record<string, number>;
  edge_gate_blocked_reasons: Record<string, number>;
  hard_safety_drops: Record<string, number>;
  last_error: string | null;
  started_at: string;
  updated_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const runIdParam = url.searchParams.get("run_id");
  const sportParam = url.searchParams.get("sport");
  const dateParam = url.searchParams.get("date");

  if (!runIdParam && !sportParam) {
    return jsonResponse(
      { ok: false, error: "missing_params", detail: "provide run_id, or sport (date optional)" },
      400,
    );
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const resolved = resolveServiceRoleKey();
  if (!supabaseUrl || !resolved) {
    return jsonResponse({ ok: false, error: "missing_credentials" }, 500);
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

  // Resolve which run we're looking at.
  let metrics: MetricsRow | null = null;
  if (runIdParam) {
    const { data, error } = await supabase
      .from("scan_run_metrics")
      .select("*")
      .eq("run_id", runIdParam)
      .maybeSingle();
    if (error) return jsonResponse({ ok: false, error: "db_read", detail: error.message }, 500);
    metrics = (data as MetricsRow | null) ?? null;
  } else {
    const date = dateParam || todayET();
    const { data, error } = await supabase
      .from("scan_run_metrics")
      .select("*")
      .eq("sport", sportParam)
      .eq("pick_date", date)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return jsonResponse({ ok: false, error: "db_read", detail: error.message }, 500);
    metrics = (data as MetricsRow | null) ?? null;
  }

  if (!metrics) {
    return jsonResponse(
      {
        ok: true,
        found: false,
        run_id: runIdParam ?? null,
        sport: sportParam ?? null,
        pick_date: dateParam ?? null,
      },
      200,
    );
  }

  // Live queue status counts for this run_id.
  const { data: statusRows, error: statusErr } = await supabase
    .from("analyzer_queue")
    .select("status")
    .eq("sport", metrics.sport)
    .eq("run_id", metrics.run_id);

  const queueByStatus: Record<string, number> = {};
  if (!statusErr && Array.isArray(statusRows)) {
    for (const r of statusRows as Array<{ status: string }>) {
      queueByStatus[r.status] = (queueByStatus[r.status] ?? 0) + 1;
    }
  }

  const analyzing = queueByStatus.processing ?? 0;
  const pending = queueByStatus.pending ?? 0;
  const done = queueByStatus.done ?? 0;
  const failed = queueByStatus.failed ?? 0;
  const expired = queueByStatus.expired ?? 0;
  const missingEndpoint = queueByStatus.missing_analyzer_endpoint ?? 0;
  const unanalyzed_remaining = pending + analyzing;

  const finalized_total =
    metrics.finalized_edge + metrics.finalized_daily + metrics.finalized_value;

  return jsonResponse({
    ok: true,
    found: true,
    run_id: metrics.run_id,
    sport: metrics.sport,
    pick_date: metrics.pick_date,
    discovered: metrics.discovered,
    queued: metrics.queued,
    processed: metrics.processed,
    analyzing,
    pending,
    finalized: finalized_total,
    failed: metrics.failed_count + failed,
    skipped: metrics.skipped_count + expired,
    missing_analyzer_endpoint: missingEndpoint,
    unanalyzed_remaining,
    tier_counts: {
      edge: metrics.finalized_edge,
      daily: metrics.finalized_daily,
      value: metrics.finalized_value,
      pass: metrics.pass_count,
    },
    prefilter_drop_reasons: metrics.prefilter_drop_reasons ?? {},
    edge_gate_blocked_reasons: metrics.edge_gate_blocked_reasons ?? {},
    hard_safety_drops: metrics.hard_safety_drops ?? {},
    low_confidence_drops: metrics.low_confidence_drops,
    last_error: metrics.last_error,
    started_at: metrics.started_at,
    updated_at: metrics.updated_at,
    queue_status_counts: queueByStatus,
  });
});
