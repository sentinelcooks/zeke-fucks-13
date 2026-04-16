import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BodySchema = z.object({
  snapshot_id: z.string().uuid(),
  actual_result: z.enum(["HIT", "MISS", "PUSH"]),
  actual_value: z.number().optional().nullable(),
  profit_loss: z.number().optional().nullable(),
});

function bucketFor(conf: number): string {
  if (conf >= 80) return "80+";
  if (conf >= 70) return "70-80";
  if (conf >= 60) return "60-70";
  if (conf >= 50) return "50-60";
  return "<50";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { snapshot_id, actual_result, actual_value, profit_loss } = parsed.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch the snapshot to copy fields into outcome row
    const { data: snap, error: snapErr } = await supabase
      .from("prediction_snapshots")
      .select("id, user_id, sport, player_or_team, prop_type, line, direction, confidence")
      .eq("id", snapshot_id)
      .maybeSingle();

    if (snapErr || !snap) {
      return new Response(
        JSON.stringify({ error: "Snapshot not found", details: snapErr?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Insert outcome
    const { error: outErr } = await supabase.from("outcomes").insert({
      snapshot_id: snap.id,
      user_id: snap.user_id,
      sport: snap.sport,
      player_or_team: snap.player_or_team,
      prop_type: snap.prop_type,
      line: snap.line,
      direction: snap.direction,
      predicted_confidence: snap.confidence,
      actual_result,
      actual_value: actual_value ?? null,
      profit_loss: profit_loss ?? null,
    });

    if (outErr) {
      return new Response(
        JSON.stringify({ error: "Failed to insert outcome", details: outErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update snapshot
    await supabase
      .from("prediction_snapshots")
      .update({
        actual_outcome: actual_result,
        outcome_value: actual_value ?? null,
        outcome_logged_at: new Date().toISOString(),
      })
      .eq("id", snapshot_id);

    // Compute aggregate stats from outcomes joined with snapshots
    const { data: allOutcomes } = await supabase
      .from("outcomes")
      .select("actual_result, sport, predicted_confidence")
      .neq("actual_result", "PUSH");

    const stats: any = {
      overall_hit_rate: 0,
      total: 0,
      by_sport: { nba: 0, mlb: 0, nhl: 0, ufc: 0 } as Record<string, number>,
      by_sport_total: { nba: 0, mlb: 0, nhl: 0, ufc: 0 } as Record<string, number>,
      by_confidence_bucket: {
        "<50": { hits: 0, total: 0, rate: 0 },
        "50-60": { hits: 0, total: 0, rate: 0 },
        "60-70": { hits: 0, total: 0, rate: 0 },
        "70-80": { hits: 0, total: 0, rate: 0 },
        "80+": { hits: 0, total: 0, rate: 0 },
      } as Record<string, { hits: number; total: number; rate: number }>,
    };

    if (allOutcomes && allOutcomes.length) {
      let totalHits = 0;
      const bySportHits: Record<string, number> = { nba: 0, mlb: 0, nhl: 0, ufc: 0 };
      const bySportTotal: Record<string, number> = { nba: 0, mlb: 0, nhl: 0, ufc: 0 };

      for (const o of allOutcomes) {
        const sport = (o.sport || "").toLowerCase();
        const isHit = o.actual_result === "HIT";
        if (isHit) totalHits++;
        if (sport in bySportTotal) {
          bySportTotal[sport]++;
          if (isHit) bySportHits[sport]++;
        }
        const bucket = bucketFor(Number(o.predicted_confidence) || 0);
        stats.by_confidence_bucket[bucket].total++;
        if (isHit) stats.by_confidence_bucket[bucket].hits++;
      }

      stats.total = allOutcomes.length;
      stats.overall_hit_rate = +(totalHits / allOutcomes.length * 100).toFixed(2);

      for (const sport of Object.keys(bySportTotal)) {
        const t = bySportTotal[sport];
        stats.by_sport[sport] = t > 0 ? +(bySportHits[sport] / t * 100).toFixed(2) : 0;
        stats.by_sport_total[sport] = t;
      }

      for (const bucket of Object.keys(stats.by_confidence_bucket)) {
        const b = stats.by_confidence_bucket[bucket];
        b.rate = b.total > 0 ? +(b.hits / b.total * 100).toFixed(2) : 0;
      }
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("log-outcome error:", err);
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
