// Scanner ?wait=1 poll helper. Used by every slate-scanner-{sport} so that
// callers (manual runs, deploy gates) can block on a single round-trip until
// the analyzer queue drains for a run_id, instead of returning while async
// work is still in flight.
//
// NBA is still on the legacy `nba_analyzer_queue` table. MLB/NHL/UFC use the
// shared `analyzer_queue`. This helper routes to the correct queue table by
// sport so callers stay identical. When NBA migrates to the shared queue in
// a later PR, the NBA branch and the interim run_id column on
// nba_analyzer_queue (migration 20260513000100) can be dropped together.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type SupaClient = ReturnType<typeof createClient>;

function envOrNull(name: string): string | null {
  try {
    const v = Deno.env.get(name);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

// Build a service-role Supabase client suitable for read-only polling of
// (nba_)analyzer_queue + daily_picks. Returns null when env is missing so
// the caller can skip wait mode gracefully instead of crashing the run.
export function buildWaitClient(): SupaClient | null {
  const url = envOrNull("PROJECT_URL") ?? envOrNull("SUPABASE_URL");
  const key =
    envOrNull("SERVICE_ROLE_KEY") ??
    envOrNull("MASTER_SUPABASE_SERVICE_KEY") ??
    envOrNull("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${key}`, apikey: key } },
  });
}

export interface ScanWaitMetrics {
  // analyzer_queue (or nba_analyzer_queue) rows for this run_id grouped
  // by terminal/non-terminal status.
  analyzer_done_count: number;
  analyzer_failed_count: number;
  pending: number;
  processing: number;
  // daily_picks rows visible to the frontend for this run_id (tier in
  // edge/daily/value). Frozen rows from earlier runs are excluded by the
  // run_id filter.
  frontend_visible_count: number;
  timed_out: boolean;
  polled_iterations: number;
  queue_table: QueueTable;
}

type QueueTable = "analyzer_queue" | "nba_analyzer_queue" | "both";

// NBA can land in either queue depending on the scanner path: the discovery-only
// branch enqueues to the shared `analyzer_queue` (with run_id), while the
// legacy inline branch routes analyzer-deferred candidates into the legacy
// `nba_analyzer_queue`. Polling only one would under-count. For NBA we poll
// BOTH; for the other sports the shared queue is the only target.
function pickQueueTable(sport: string): QueueTable {
  return sport.toLowerCase() === "nba" ? "both" : "analyzer_queue";
}

async function queueCounts(
  supabase: SupaClient,
  table: QueueTable,
  runId: string,
): Promise<{ done: number; failed: number; pending: number; processing: number }> {
  const tables: Array<"analyzer_queue" | "nba_analyzer_queue"> =
    table === "both" ? ["analyzer_queue", "nba_analyzer_queue"] : [table];
  let done = 0, failed = 0, pending = 0, processing = 0;
  for (const t of tables) {
    const { data, error } = await supabase
      .from(t)
      .select("status")
      .eq("run_id", runId);
    if (error) {
      console.warn(`[scan-wait] queue read error table=${t} run=${runId}:`, error.message);
      continue;
    }
    for (const r of (data ?? []) as Array<{ status: string }>) {
      const s = r.status;
      if (s === "done") done++;
      else if (s === "failed" || s === "expired") failed++;
      else if (s === "processing") processing++;
      else if (s === "pending") pending++;
    }
  }
  return { done, failed, pending, processing };
}

async function frontendVisibleCount(
  supabase: SupaClient,
  runId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("daily_picks")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("tier", ["edge", "daily", "value"]);
  if (error) {
    console.warn(`[scan-wait] daily_picks count error run=${runId}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

// Poll the sport-appropriate queue + daily_picks until pending+processing == 0
// for this run_id, or timeoutMs elapses. Default timeout 90s, hard cap 240s
// to stay under Edge Function limits. Returns the final metrics snapshot.
export async function waitForRunCompletion(
  supabase: SupaClient,
  sport: string,
  runId: string,
  timeoutMs?: number,
): Promise<ScanWaitMetrics> {
  const queueTable = pickQueueTable(sport);
  const cap = Math.max(5_000, Math.min(240_000, timeoutMs ?? 90_000));
  const startedAt = Date.now();
  let iter = 0;
  let counts = await queueCounts(supabase, queueTable, runId);
  while (counts.pending + counts.processing > 0) {
    if (Date.now() - startedAt >= cap) {
      const visible = await frontendVisibleCount(supabase, runId);
      return {
        analyzer_done_count: counts.done,
        analyzer_failed_count: counts.failed,
        pending: counts.pending,
        processing: counts.processing,
        frontend_visible_count: visible,
        timed_out: true,
        polled_iterations: iter,
        queue_table: queueTable,
      };
    }
    // Light cadence; the worker cron is 2 min so poll every 2s gives us a
    // chance to catch state flips without flooding the DB.
    await new Promise((r) => setTimeout(r, 2_000));
    iter++;
    counts = await queueCounts(supabase, queueTable, runId);
  }
  const visible = await frontendVisibleCount(supabase, runId);
  return {
    analyzer_done_count: counts.done,
    analyzer_failed_count: counts.failed,
    pending: 0,
    processing: 0,
    frontend_visible_count: visible,
    timed_out: false,
    polled_iterations: iter,
    queue_table: queueTable,
  };
}

// Apply ?wait=1 onto a scanSport() result. Mutates result.metrics with the
// post-drain counts and returns the same object. Safe to call with a result
// that lacks .metrics (older return shape) — it's filled in as needed.
export async function applyWaitToScanResult(
  supabase: SupaClient,
  sport: string,
  // deno-lint-ignore no-explicit-any
  result: any,
  timeoutMs?: number,
): Promise<unknown> {
  const runId: string | undefined = result?.run_id ?? result?.metrics?.run_id;
  if (!runId) return result;
  const m = await waitForRunCompletion(supabase, sport, runId, timeoutMs);
  result.metrics = {
    ...(result.metrics ?? { run_id: runId }),
    run_id: runId,
    analyzer_done_count: m.analyzer_done_count,
    analyzer_failed_count: m.analyzer_failed_count,
    frontend_visible_count: m.frontend_visible_count,
    wait_mode: true,
    wait_timed_out: m.timed_out,
    wait_iterations: m.polled_iterations,
    wait_queue_table: m.queue_table,
  };
  return result;
}

// Parse ?wait=1 / { wait: true, timeoutMs?: number } from a Request. Returns
// null when wait was not requested; otherwise returns the (clamped) timeout
// in ms.
export async function parseWaitOptions(
  req: Request,
): Promise<{ wait: boolean; timeoutMs?: number }> {
  try {
    const url = new URL(req.url);
    const qWait = url.searchParams.get("wait");
    const qTimeout = url.searchParams.get("timeoutMs");
    let wait = qWait === "1" || qWait === "true";
    let timeoutMs: number | undefined = qTimeout
      ? Number(qTimeout)
      : undefined;
    // Body may also carry wait/timeoutMs. Only parse if it's a POST/PUT with
    // application/json — never consume a body that callers depend on
    // elsewhere.
    if (req.method !== "GET" && req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await req.clone().json();
        if (body && typeof body === "object") {
          if (body.wait === true) wait = true;
          if (typeof body.timeoutMs === "number") timeoutMs = body.timeoutMs;
        }
      } catch {
        // body not JSON / empty — fine.
      }
    }
    return { wait, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined };
  } catch {
    return { wait: false };
  }
}
