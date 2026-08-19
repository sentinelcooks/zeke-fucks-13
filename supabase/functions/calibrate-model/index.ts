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
import {
  calibrationSampleEligibility,
  type ModelEvaluationPick,
} from "../_shared/model_evaluation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-calibrate-model-secret",
};

interface Sample extends TimestampedCalibrationSample {
  sport: string;
  bet_type: string;
  model_version: string;
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
  let requestBody: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      requestBody = parsed as Record<string, unknown>;
    }
  } catch {
    // Empty bodies remain supported for scheduled and manual invocations.
  }
  const queryDry = requestUrl.searchParams.get("dry");
  const dry = queryDry === "1" || (queryDry === null && requestBody.dry === true);
  const onlySport = requestUrl.searchParams.get("sport") ??
    (typeof requestBody.sport === "string" ? requestBody.sport : null);
  const onlyBetType = requestUrl.searchParams.get("bet_type") ??
    (typeof requestBody.bet_type === "string" ? requestBody.bet_type : null);
  const requestedDays = requestUrl.searchParams.get("days") ?? requestBody.days ?? 365;
  const parsedDays = Number(requestedDays);
  const lookbackDays = Math.max(30, Math.min(730, Number.isFinite(parsedDays) ? parsedDays : 365));

  try {
    const since = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString();
    const samples = await collectSamples(supabase, since, onlySport, onlyBetType);
    const groups = new Map<string, Sample[]>();
    const latestVersionByMarket = new Map<string, { modelVersion: string; occurredAt: string }>();
    for (const sample of samples) {
      const marketKey = `${sample.sport}|${sample.bet_type}`.toLowerCase();
      const latest = latestVersionByMarket.get(marketKey);
      if (!latest || Date.parse(sample.occurred_at) > Date.parse(latest.occurredAt)) {
        latestVersionByMarket.set(marketKey, {
          modelVersion: sample.model_version,
          occurredAt: sample.occurred_at,
        });
      }
      const key = `${marketKey}|${sample.model_version}`;
      const group = groups.get(key) ?? [];
      group.push(sample);
      groups.set(key, group);
    }

    const results: Record<string, unknown>[] = [];
    for (const [, data] of groups) {
      const sport = data[0].sport;
      const bet_type = data[0].bet_type;
      const model_version = data[0].model_version;
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

      const holdoutDecision = calibrationActivationDecision({
        trainSamples: train.length,
        testSamples: test.length,
        baselineBrier,
        calibratedBrier,
        baselineLogLoss,
        calibratedLogLoss,
      });
      const latestVersion = latestVersionByMarket.get(`${sport}|${bet_type}`)?.modelVersion ?? null;
      const decision = latestVersion === model_version
        ? holdoutDecision
        : { activate: false, reason: "superseded_model_version" };
      const row = {
        sport,
        bet_type,
        model_version,
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
      source: "verified_daily_picks_only",
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
  const pageSize = 1_000;
  for (let from = 0; from < 50_000; from += pageSize) {
    let query: any = supabase
      .from("daily_picks")
      .select(
        "id,sport,bet_type,player_name,prop_type,line,direction,hit_rate,result,pick_date,score_kind,model_version,model_diagnostics,odds,profit_units,stake_units,prediction_recorded_at,commence_time,graded_at,grading_source",
      )
      .gte("prediction_recorded_at", sinceIso)
      .in("result", ["hit", "miss"])
      .not("grading_source", "is", null)
      .not("prediction_recorded_at", "is", null)
      .not("model_version", "is", null)
      .order("prediction_recorded_at", { ascending: true })
      .range(from, from + pageSize - 1);
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
      const diagnostics = pick.model_diagnostics && typeof pick.model_diagnostics === "object"
        ? pick.model_diagnostics as Record<string, unknown>
        : {};
      const rawScore = numConf(
        diagnostics.raw_model_score ??
          (String(pick.score_kind ?? "") === "heuristic_score" ? pick.hit_rate : null),
      );
      const label = resultLabel(pick.result);
      const occurredAt = String(pick.prediction_recorded_at ?? "");
      const modelVersion = String(pick.model_version ?? "").trim();
      const evaluationPick: ModelEvaluationPick = {
        id: String(pick.id ?? ""),
        sport,
        betType,
        propType: String(pick.prop_type ?? ""),
        modelVersion,
        result: String(pick.result ?? ""),
        odds: pick.odds as string | number | null,
        profitUnits: pick.profit_units == null ? null : Number(pick.profit_units),
        stakeUnits: pick.stake_units == null ? null : Number(pick.stake_units),
        confidence: numConf(pick.hit_rate),
        rawModelScore: rawScore,
        scoreKind: String(pick.score_kind ?? ""),
        pickDate: String(pick.pick_date ?? ""),
        predictionRecordedAt: occurredAt,
        commenceTime: String(pick.commence_time ?? ""),
        gradedAt: String(pick.graded_at ?? ""),
        gradingSource: String(pick.grading_source ?? ""),
      };
      if (!sport || !betType || rawScore == null || label == null || !calibrationSampleEligibility(evaluationPick)) continue;
      rows.push({
        sport,
        bet_type: betType,
        model_version: modelVersion,
        score: rawScore,
        label,
        occurred_at: occurredAt,
        identity: sampleIdentity({
          sport,
          betType,
          modelVersion,
          occurredAt,
          player: pick.player_name,
          propType: pick.prop_type,
          line: pick.line,
          direction: pick.direction,
        }),
      });
    }
    if ((data ?? []).length < pageSize) break;
  }

  const unique = new Map<string, Sample>();
  for (const row of rows) unique.set(row.identity, row);
  return [...unique.values()];
}

function sampleIdentity(input: {
  sport: string;
  betType: string;
  modelVersion: string;
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
    input.modelVersion,
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
