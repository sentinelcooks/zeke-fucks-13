// Home's queue-safe slate refresh endpoint.
//
// The legacy `slate-scanner` orchestrator deletes today's rows before it
// delegates. That conflicts with the current discovery-only scanners: they
// enqueue analyzer work and do not create legacy `_pending` rows. Invoking it
// could therefore leave Home empty while valid candidates waited in the queue.
// This endpoint keeps finalized rows intact and invokes the current per-sport
// scanners, whose bounded workers are the only path that can publish a pick.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requirePremiumAccess } from "../_shared/premium-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sentinel-device-id",
};

const APP_TZ = "America/New_York";
const SCAN_SPORTS = ["nba", "wnba", "mlb", "nhl", "ufc"] as const;

type RefreshMode = "rerank" | "queued" | "in_progress";
type ScanSummary = {
  sport: string;
  state: "queued" | "no_candidates" | "unavailable";
  queued: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isPublicPick(row: Record<string, unknown>): boolean {
  const tier = String(row.tier ?? "").toLowerCase();
  const status = String(row.status ?? "").toLowerCase();
  return ["edge", "daily", "value"].includes(tier) && status !== "empty_slate";
}

async function readTodayPicks(
  supabase: ReturnType<typeof createClient>,
  today: string,
): Promise<Record<string, unknown>[]> {
  const [byGameDate, legacyByPickDate] = await Promise.all([
    supabase
      .from("daily_picks")
      .select("*")
      .eq("game_date", today)
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("daily_picks")
      .select("*")
      .is("game_date", null)
      .eq("pick_date", today)
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  if (byGameDate.error || legacyByPickDate.error) {
    throw byGameDate.error ?? legacyByPickDate.error;
  }

  return [
    ...((byGameDate.data as Record<string, unknown>[] | null) ?? []),
    ...((legacyByPickDate.data as Record<string, unknown>[] | null) ?? []),
  ].filter(isPublicPick);
}

async function hasRecentQueuedScan(
  supabase: ReturnType<typeof createClient>,
  today: string,
): Promise<boolean> {
  const recentSince = new Date(Date.now() - 12 * 60_000).toISOString();
  const { data, error } = await supabase
    .from("scan_run_metrics")
    .select("queued, processed")
    .eq("pick_date", today)
    .gte("updated_at", recentSince);

  if (error) {
    console.warn("force-refresh-edge could not read recent scan activity:", error.message);
    return false;
  }

  return ((data as Array<Record<string, unknown>> | null) ?? []).some((run) => {
    const queued = Number(run.queued ?? 0);
    const processed = Number(run.processed ?? 0);
    return queued > 0 && processed < queued;
  });
}

async function startQueuedScans(
  supabase: ReturnType<typeof createClient>,
): Promise<ScanSummary[]> {
  const scans: ScanSummary[] = [];

  for (const sport of SCAN_SPORTS) {
    const { data, error } = await supabase.functions.invoke(`slate-scanner-${sport}`, {
      body: {},
    });
    if (error || (data && typeof data === "object" && "error" in data)) {
      console.error(`force-refresh-edge scanner failed sport=${sport}:`, error ?? data);
      scans.push({ sport, state: "unavailable", queued: 0 });
      continue;
    }

    const queued = Number((data as Record<string, unknown> | null)?.queued ?? 0);
    scans.push({
      sport,
      state: queued > 0 ? "queued" : "no_candidates",
      queued: Number.isFinite(queued) && queued > 0 ? queued : 0,
    });
  }

  return scans;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const access = await requirePremiumAccess(req, corsHeaders);
  if (!access.ok) return access.response;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    console.error("force-refresh-edge missing Supabase service credentials");
    return json({ ok: false, error: "refresh_unavailable", mode: "unavailable" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const today = todayET();
  let rows: Record<string, unknown>[];

  try {
    rows = await readTodayPicks(supabase, today);
  } catch (error) {
    console.error("force-refresh-edge could not read daily picks:", error);
    return json({ ok: false, error: "live_picks_unavailable", mode: "unavailable" }, 503);
  }

  let mode: RefreshMode = "rerank";
  let scans: ScanSummary[] = [];
  if (rows.length === 0) {
    if (await hasRecentQueuedScan(supabase, today)) {
      mode = "in_progress";
    } else {
      mode = "queued";
      scans = await startQueuedScans(supabase);
    }

    try {
      rows = await readTodayPicks(supabase, today);
    } catch (error) {
      console.error("force-refresh-edge could not re-read daily picks:", error);
      return json({ ok: false, error: "live_picks_unavailable", mode }, 503);
    }
  }

  const oddsOk = (odds: unknown) => {
    if (!odds) return true;
    const value = parseInt(String(odds).replace(/[^\d-]/g, ""), 10);
    if (Number.isNaN(value)) return true;
    return Math.abs(value) < 1000;
  };

  const filtered = rows.filter(
    (pick) => oddsOk(pick.odds) && pick.tier !== "pass" && pick.tier !== "_pending",
  );
  const seen = new Set<string>();
  const deduped = filtered.filter((pick) => {
    const key = `${pick.sport}|${pick.player_name}|${pick.prop_type}|${pick.direction}|${pick.line}|${pick.tier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const edge = deduped.filter((pick) => pick.tier === "edge");
  const daily = deduped.filter((pick) => pick.tier !== "edge");

  return json({
    ok: true,
    mode,
    refresh_after_ms: mode === "rerank" ? 0 : 15_000,
    counts: {
      total: deduped.length,
      todaysEdge: edge.length,
      queued: scans.reduce((total, scan) => total + scan.queued, 0),
    },
    scans,
    edge,
    daily,
  });
});
