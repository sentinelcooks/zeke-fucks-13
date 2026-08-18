import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  brier,
  clamp01,
  fitPlatt,
  logLoss,
  plattCalibrate,
} from "../_shared/prob_math.ts";
import {
  calibrationActivationDecision,
  chronologicalCalibrationSplit,
  type TimestampedCalibrationSample,
} from "../_shared/calibration_policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-calibrate-model-secret",
};

interface Sample extends TimestampedCalibrationSample {
  sport: string;
  bet_type: string;
  identity: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const calibrationSecret = Deno.env.get("CALIBRATE_MODEL_SECRET") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const suppliedSecret = req.headers.get("x-calibrate-model-secret") ?? "";
  const authorized =
    (!!serviceRoleKey && authorization === `Bearer ${serviceRoleKey}`) ||
    (!!calibrationSecret &&
      (suppliedSecret === calibrationSecret || authorization === `Bearer ${calibrationSecret}`));
  if (!authorized) return json({ error: "unauthorized" }, 401);
  if (!url || !serviceRoleKey) return json({ error: "server_configuration_missing" }, 500);

  const supabase = createClient(url, serviceRoleKey);
  const requestUrl = new URL(req.url);
  const dry = requestUrl.searchParams.get("dry") === "1";
  const onlySport = requestUrl.searchParams.get("sport");
  const onlyBetType = requestUrl.searchParams.get("bet_type");
  const lookbackDays = Math.max(30, Math.min(730, Number(requestUrl.searchParams.get("days") ?? "365")));

  try {
    const since = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();
    const samples = await collectSamples(supabase, since, onlySport, onlyBetType);
    const groups = new Map<string, Sample[]>();
    for (const sample of samples) {
      const key = `${sample.sport}|${sample.bet_type}`.toLowerCase();
      const group = groups.get(key) ?? [];
      group.push(sample);
      groups.set(key, group);
    }

    const results: Record<string, unknown>[] = [];
    for (const [key, data] of groups) {
      const [sport, bet_type] = key.split("|");
      const { train, test } = chronologicalCalibrationSplit(data);
      const trainScores = train.map((sample) => clamp01(sample.score));
      const trainLabels = train.map((sample) => sample.label);
      const testScores = test.map((sample) => clamp01(sample.score));
      const testLabels = test.map((sample) => sample.label);

      let params: Record<string, unknown> = {};
      let baselineBrier = Number.NaN;
      let baselineLogLoss = Number.NaN;
      let calibratedBrier = Number.NaN;
      let calibratedLogLoss = Number.NaN;

      if (trainScores.length > 0 && testScores.length > 0) {
        const fitted = fitPlatt(trainScores, trainLabels, 50);
        params = { a: fitted.a, b: fitted.b };
        const calibrated = testScores.map((score) => plattCalibrate(score, fitted));
        baselineBrier = brier(testScores, testLabels);
        baselineLogLoss = logLoss(testScores, testLabels);
        calibratedBrier = brier(calibrated, testLabels);
        calibratedLogLoss = logLoss(calibrated, testLabels);
      }

      const decision = calibrationActivationDecision({
        trainSamples: train.length,
        testSamples: test.length,
        baselineBrier,
        calibratedBrier,
        baselineLogLoss,
        calibratedLogLoss,
      });
      const row = {
        sport,
        bet_type,
        method: "platt" as const,
        params,
        n_samples: data.length,
        train_samples: train.length,
        test_samples: test.length,
        brier_score: Number.isFinite(calibratedBrier) ? calibratedBrier : null,
        log_loss: Number.isFinite(calibratedLogLoss) ? calibratedLogLoss : null,
        baseline_brier: Number.isFinite(baselineBrier) ? baselineBrier : null,
        baseline_log_loss: Number.isFinite(baselineLogLoss) ? baselineLogLoss : null,
        holdout_brier: Number.isFinite(calibratedBrier) ? calibratedBrier : null,
        holdout_log_loss: Number.isFinite(calibratedLogLoss) ? calibratedLogLoss : null,
        holdout_baseline_brier: Number.isFinite(baselineBrier) ? baselineBrier : null,
        holdout_baseline_log_loss: Number.isFinite(baselineLogLoss) ? baselineLogLoss : null,
        evaluation_method: "chronological_holdout",
        holdout_passed: decision.activate,
        activation_reason: decision.reason,
        data_start_at: data.length > 0
          ? [...data].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))[0].occurred_at
          : null,
        data_end_at: data.length > 0
          ? [...data].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0].occurred_at
          : null,
        active: decision.activate && !dry,
      };

      if (!dry) {
        if (decision.activate) {
          const { error: deactivateError } = await supabase
            .from("model_calibration")
            .update({ active: false })
            .eq("sport", sport)
            .eq("bet_type", bet_type)
            .eq("active", true);
          if (deactivateError) throw deactivateError;
        }
        const { error: insertError } = await supabase.from("model_calibration").insert(row);
        if (insertError) throw insertError;
      }
      results.push(row);
    }

    return json({
      dry,
      lookbackDays,
      evaluationMethod: "chronological_holdout",
      sampleCount: samples.length,
      groups: results,
    });
  } catch (error) {
    console.error("calibrate-model error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function collectSamples(
  supabase: ReturnType<typeof createClient>,
  sinceIso: string,
  onlySport: string | null,
  onlyBetType: string | null,
): Promise<Sample[]> {
  const rows: Sample[] = [];

  try {
    const { data, error } = await supabase
      .from("outcomes")
      .select(
        "actual_result,created_at,prediction_snapshots!inner(sport,market_type,player_or_team,prop_type,line,direction,confidence,created_at)",
      )
      .gte("created_at", sinceIso);
    if (error) throw error;
    for (const outcome of (data ?? []) as Record<string, unknown>[]) {
      const snapshot = Array.isArray(outcome.prediction_snapshots)
        ? outcome.prediction_snapshots[0]
        : outcome.prediction_snapshots;
      if (!snapshot || typeof snapshot !== "object") continue;
      const snap = snapshot as Record<string, unknown>;
      const sport = String(snap.sport ?? "").toLowerCase();
      const betType = normalizeBetType(snap.market_type);
      if (!sport || !betType || (onlySport && sport !== onlySport.toLowerCase())) continue;
      if (onlyBetType && betType !== normalizeBetType(onlyBetType)) continue;
      const score = numConf(snap.confidence);
      const label = resultLabel(outcome.actual_result);
      const occurredAt = String(snap.created_at ?? outcome.created_at ?? "");
      if (score == null || label == null || !Number.isFinite(Date.parse(occurredAt))) continue;
      rows.push({
        sport,
        bet_type: betType,
        score,
        label,
        occurred_at: occurredAt,
        identity: sampleIdentity({
          sport,
          betType,
          occurredAt,
          player: snap.player_or_team,
          propType: snap.prop_type,
          line: snap.line,
          direction: snap.direction,
        }),
      });
    }
  } catch (error) {
    console.warn("outcomes calibration source unavailable:", error instanceof Error ? error.message : error);
  }

  try {
    let query = supabase
      .from("daily_picks")
      .select("sport,bet_type,player_name,prop_type,line,direction,hit_rate,result,pick_date,created_at,score_kind")
      .gte("pick_date", sinceIso.slice(0, 10))
      .in("result", ["hit", "miss"])
      .eq("score_kind", "heuristic_score");
    if (onlySport) query = query.eq("sport", onlySport.toLowerCase());
    if (onlyBetType) {
      const normalized = normalizeBetType(onlyBetType);
      query = query.eq("bet_type", normalized === "total" ? "over_under" : normalized);
    }
    const { data, error } = await query;
    if (error) throw error;
    for (const pick of (data ?? []) as Record<string, unknown>[]) {
      const sport = String(pick.sport ?? "").toLowerCase();
      const betType = normalizeBetType(pick.bet_type);
      const score = numConf(pick.hit_rate);
      const label = resultLabel(pick.result);
      const occurredAt = String(pick.created_at ?? `${pick.pick_date}T12:00:00Z`);
      if (!sport || !betType || score == null || label == null || !Number.isFinite(Date.parse(occurredAt))) continue;
      rows.push({
        sport,
        bet_type: betType,
        score,
        label,
        occurred_at: occurredAt,
        identity: sampleIdentity({
          sport,
          betType,
          occurredAt,
          player: pick.player_name,
          propType: pick.prop_type,
          line: pick.line,
          direction: pick.direction,
        }),
      });
    }
  } catch (error) {
    console.warn("daily_picks calibration source unavailable:", error instanceof Error ? error.message : error);
  }

  const unique = new Map<string, Sample>();
  for (const row of rows) unique.set(row.identity, row);
  return [...unique.values()];
}

function sampleIdentity(input: {
  sport: string;
  betType: string;
  occurredAt: string;
  player: unknown;
  propType: unknown;
  line: unknown;
  direction: unknown;
}): string {
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
  return [
    input.occurredAt.slice(0, 10),
    input.sport,
    input.betType,
    normalize(input.player),
    normalize(input.propType),
    normalize(input.line),
    normalize(input.direction),
  ].join("|");
}

function resultLabel(value: unknown): 0 | 1 | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "hit") return 1;
  if (normalized === "miss") return 0;
  return null;
}

function normalizeBetType(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "over_under") return "total";
  return normalized || "prop";
}

function numConf(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed >= 0 && parsed <= 1) return clamp01(parsed);
  if (parsed > 1 && parsed <= 100) return clamp01(parsed / 100);
  return null;
}
