// ─────────────────────────────────────────────────────────────
// force-refresh-edge — single backend endpoint for the home page
// "Refresh" button. Guarantees Today's Edge is regenerated and
// returns the fresh picks in the response so the frontend updates
// even if its own read path is broken/stale.
//
// Behavior:
//   • If today has zero tier='edge' rows → invoke slate-scanner
//     (full wipe + rescan + rank pipeline).
//   • Otherwise → fast path: just re-read today's rows.
//   • Always returns { mode, counts, edge[], daily[] }.
// ─────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(SUPA_URL, SVC_KEY);

  const today = new Date().toISOString().slice(0, 10);

  const { count: edgeCount, error: countErr } = await supabase
    .from("daily_picks")
    .select("id", { count: "exact", head: true })
    .eq("pick_date", today)
    .eq("tier", "edge")
    .neq("status", "empty_slate");

  if (countErr) {
    console.error("count edge rows failed:", countErr);
  }

  let mode: "rescan" | "rerank" = "rerank";
  if (!edgeCount || edgeCount === 0) {
    mode = "rescan";
    console.log("No edge rows for today — invoking slate-scanner");
    const { error: scanErr } = await supabase.functions.invoke("slate-scanner", {
      body: {},
    });
    if (scanErr) {
      console.error("slate-scanner invoke error:", scanErr);
      return json({ ok: false, error: String(scanErr), mode }, 500);
    }
  }

  const { data: rows, error: readErr } = await supabase
    .from("daily_picks")
    .select("*")
    .eq("pick_date", today)
    .order("confidence", { ascending: false, nullsFirst: false })
    .limit(200);

  if (readErr) {
    console.error("read daily_picks failed:", readErr);
    return json({ ok: false, error: String(readErr), mode }, 500);
  }

  const oddsOk = (o: string | null | undefined) => {
    if (!o) return true;
    const n = parseInt(String(o).replace(/[^\d-]/g, ""), 10);
    if (Number.isNaN(n)) return true;
    return Math.abs(n) < 1000;
  };

  const filtered = ((rows as any[]) || []).filter(
    (p) => oddsOk(p.odds) && p.tier !== "pass" && p.tier !== "_pending" && p.status !== "empty_slate",
  );

  const seen = new Set<string>();
  const deduped = filtered.filter((p) => {
    const k = `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}|${p.tier}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const edge = deduped.filter((p) => p.tier === "edge");
  const daily = deduped.filter((p) => p.tier !== "edge");

  return json({
    ok: true,
    mode,
    counts: {
      total: deduped.length,
      todaysEdge: edge.length,
    },
    edge,
    daily,
  });
});
