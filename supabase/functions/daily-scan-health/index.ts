// daily-scan-health
//
// End-of-day report endpoint for the nightly scanner pipeline. Reads the
// public.v_daily_scan_health view (added in 20260514000300_v_daily_scan_health.sql)
// and returns a per-sport breakdown for a single calendar day.
//
//   GET ?date=YYYY-MM-DD     - explicit day
//   GET                      - defaults to today ET
//
// Auth: service-role required (verify_jwt=true on deploy). Same pattern as
// scan-run-status. The response shape is intentionally flat per sport so a
// future Discord-webhook job can map each row to a single embed field
// without further reshaping.

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

interface HealthRow {
  pick_date: string;
  sport: string;
  runs: number;
  discovered: number;
  queued: number;
  processed: number;
  finalized_edge: number;
  finalized_daily: number;
  finalized_value: number;
  failed: number;
  expired_skipped: number;
  outcome_counts: Record<string, number>;
  last_updated_at: string | null;
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
  const date = url.searchParams.get("date") || todayET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ ok: false, error: "bad_date", detail: "expected YYYY-MM-DD" }, 400);
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const key = resolveServiceRoleKey();
  if (!supabaseUrl || !key) {
    return jsonResponse({ ok: false, error: "missing_credentials" }, 500);
  }

  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${key}`, apikey: key } },
  });

  const { data, error } = await supabase
    .from("v_daily_scan_health")
    .select("*")
    .eq("pick_date", date);

  if (error) {
    return jsonResponse({ ok: false, error: "db_read", detail: error.message }, 500);
  }

  const rows = (data ?? []) as HealthRow[];
  const sports = rows.map((r) => ({
    sport: r.sport,
    runs: Number(r.runs ?? 0),
    discovered: Number(r.discovered ?? 0),
    queued: Number(r.queued ?? 0),
    processed: Number(r.processed ?? 0),
    finalized_edge: Number(r.finalized_edge ?? 0),
    finalized_daily: Number(r.finalized_daily ?? 0),
    finalized_value: Number(r.finalized_value ?? 0),
    finalized_total:
      Number(r.finalized_edge ?? 0) +
      Number(r.finalized_daily ?? 0) +
      Number(r.finalized_value ?? 0),
    failed: Number(r.failed ?? 0),
    expired_skipped: Number(r.expired_skipped ?? 0),
    outcome_counts: r.outcome_counts ?? {},
    last_updated_at: r.last_updated_at,
  }));

  const totals = sports.reduce(
    (acc, s) => {
      acc.discovered += s.discovered;
      acc.queued += s.queued;
      acc.processed += s.processed;
      acc.finalized_edge += s.finalized_edge;
      acc.finalized_daily += s.finalized_daily;
      acc.finalized_value += s.finalized_value;
      acc.finalized_total += s.finalized_total;
      acc.failed += s.failed;
      acc.expired_skipped += s.expired_skipped;
      return acc;
    },
    {
      discovered: 0,
      queued: 0,
      processed: 0,
      finalized_edge: 0,
      finalized_daily: 0,
      finalized_value: 0,
      finalized_total: 0,
      failed: 0,
      expired_skipped: 0,
    },
  );

  return jsonResponse({
    ok: true,
    date,
    timezone: APP_TZ,
    sports,
    totals,
  });
});
