// supabase/functions/calibrate-model/index.ts
//
// Nightly (cron-driven) calibration job.
//   1. Pull last 90 days of graded outcomes joined to prediction snapshots.
//   2. Per (sport, bet_type): fit Platt when n≥200, else 10-bin isotonic.
//   3. Compare Brier + log-loss to identity baseline; only activate if strictly better.
//   4. Insert a new row into model_calibration and flip `active=true`.
//
// Invoke:
//   POST /functions/v1/calibrate-model          → runs the job
//   POST /functions/v1/calibrate-model?dry=1    → fits but does not activate
//   POST /functions/v1/calibrate-model?sport=nba&bet_type=prop → one-off
//
// Closes the README roadmap item "Closed-loop weight tuning from outcomes".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fitPlatt,
  fitIsotonic,
  plattCalibrate,
  isotonicCalibrate,
  brier,
  logLoss,
  clamp01,
} from "../_shared/prob_math.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Sample { score: number; label: number; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const onlySport = u.searchParams.get("sport");
  const onlyBetType = u.searchParams.get("bet_type");
  const lookbackDays = Number(u.searchParams.get("days") ?? "90");

  try {
    const since = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();

    // Pull outcomes + their predicted confidence. Schema expected:
    //   outcomes(prediction_id, actual_result, created_at)
    //   prediction_snapshots(id, sport, bet_type, predicted_confidence)
    // Fallback path: grade-picks writes back into daily_picks.result with
    // hit_rate available. We union both sources.
    const samples = await collectSamples(supabase, since, onlySport, onlyBetType);

    // Group by (sport, bet_type).
    const groups = new Map<string, Sample[]>();
    for (const s of samples) {
      const k = `${s.sport}|${s.bet_type}`;
      const arr = groups.get(k) ?? [];
      arr.push({ score: s.score, label: s.label });
      groups.set(k, arr);
    }

    const results: Record<string, unknown>[] = [];
    for (const [k, data] of groups) {
      const [sport, bet_type] = k.split("|");
      if (data.length < 50) {
        results.push({ sport, bet_type, n: data.length, skipped: "insufficient_samples" });
        continue;
      }

      const scores = data.map((d) => clamp01(d.score));
      const labels = data.map((d) => (d.label ? 1 : 0));

      // Baseline (identity) metrics.
      const bBaseline = brier(scores, labels);
      const lBaseline = logLoss(scores, labels);

      // Try Platt first when sample is large enough.
      let method: "platt" | "isotonic" = data.length >= 200 ? "platt" : "isotonic";
      let params: Record<string, unknown> = {};
      let calibrated: number[] = [];

      if (method === "platt") {
        const p = fitPlatt(scores, labels, 50);
        params = { a: p.a, b: p.b };
        calibrated = scores.map((x) => plattCalibrate(x, p));
      } else {
        const bins = fitIsotonic(scores, labels, 10);
        params = { bins };
        calibrated = scores.map((x) => isotonicCalibrate(x, bins));
      }

      const bCal = brier(calibrated, labels);
      const lCal = logLoss(calibrated, labels);
      const improved = bCal < bBaseline && lCal < lBaseline;

      const row = {
        sport,
        bet_type,
        method,
        params,
        n_samples: data.length,
        brier_score: bCal,
        log_loss: lCal,
        baseline_brier: bBaseline,
        baseline_log_loss: lBaseline,
        active: improved && !dry,
      };

      if (!dry) {
        if (improved) {
          // Flip existing active rows off for this (sport, bet_type).
          await supabase
            .from("model_calibration")
            .update({ active: false })
            .eq("sport", sport)
            .eq("bet_type", bet_type)
            .eq("active", true);
        }
        const { error } = await supabase.from("model_calibration").insert(row);
        if (error) console.warn("insert calibration error:", error.message);
      }
      results.push({ ...row, improved });
    }

    return new Response(JSON.stringify({ dry, lookbackDays, groups: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("calibrate-model error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Sample collection ─────────────────────────────────────────────
// Combines: (a) prediction_snapshots + outcomes if present,
//           (b) daily_picks rows with result IN ('hit','miss').
// Every sample is (sport, bet_type, score∈[0,1], label∈{0,1}).

type Row = { sport: string; bet_type: string; score: number; label: number };

async function collectSamples(
  supabase: ReturnType<typeof createClient>,
  sinceIso: string,
  onlySport: string | null,
  onlyBetType: string | null,
): Promise<Row[]> {
  const rows: Row[] = [];

  // Path 1: outcomes + snapshots.
  try {
    let q = supabase
      .from("outcomes")
      .select("actual_result, prediction_snapshots!inner(sport, bet_type, predicted_confidence, created_at)")
      .gte("created_at", sinceIso);
    const { data } = await q;
    for (const o of (data ?? []) as any[]) {
      const snap = o.prediction_snapshots;
      if (!snap) continue;
      if (onlySport && snap.sport !== onlySport) continue;
      if (onlyBetType && snap.bet_type !== onlyBetType) continue;
      const score = numConf(snap.predicted_confidence);
      const label = String(o.actual_result).toUpperCase() === "HIT" ? 1
        : String(o.actual_result).toUpperCase() === "MISS" ? 0
        : null;
      if (score == null || label == null) continue;
      rows.push({ sport: snap.sport, bet_type: snap.bet_type, score, label });
    }
  } catch (e) {
    console.warn("outcomes path failed:", (e as Error).message);
  }

  // Path 2: daily_picks graded results (fallback / additional signal).
  try {
    let q = supabase
      .from("daily_picks")
      .select("sport, bet_type, hit_rate, result, pick_date")
      .gte("pick_date", sinceIso.slice(0, 10))
      .in("result", ["hit", "miss"]);
    if (onlySport) q = q.eq("sport", onlySport);
    if (onlyBetType) q = q.eq("bet_type", onlyBetType === "total" ? "over_under" : onlyBetType);
    const { data } = await q;
    for (const p of (data ?? []) as any[]) {
      const score = numConf(p.hit_rate);
      if (score == null) continue;
      const label = p.result === "hit" ? 1 : 0;
      const bet_type = p.bet_type === "over_under" ? "total" : (p.bet_type ?? "prop");
      rows.push({ sport: p.sport, bet_type, score, label });
    }
  } catch (e) {
    console.warn("daily_picks path failed:", (e as Error).message);
  }

  return rows;
}

function numConf(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return clamp01(n);
  if (n <= 100) return clamp01(n / 100);
  return null;
}
