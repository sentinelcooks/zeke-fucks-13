import { requireServiceRoleAccess } from "../_shared/premium-access.ts";
import {
  evaluateModelPicks,
  type ModelEvaluationPick,
} from "../_shared/model_evaluation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizedBetType(value: unknown): string {
  const betType = String(value ?? "").trim().toLowerCase();
  return betType === "over_under" ? "total" : betType;
}

function releaseStatus(report: ReturnType<typeof evaluateModelPicks>) {
  if (report.edgeEvidence.length === 0) return "no_edge_cohorts" as const;
  if (report.edgeEvidence.some((gate) => gate.status === "failed")) return "failed" as const;
  if (report.edgeEvidence.every((gate) => gate.status === "validated")) return "validated" as const;
  return "insufficient_evidence" as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const access = await requireServiceRoleAccess(req, corsHeaders);
  if (!access.ok) return access.response;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Empty body uses bounded defaults.
  }

  const daysRaw = Number(body.days ?? 365);
  const days = Number.isFinite(daysRaw) ? Math.max(30, Math.min(730, Math.floor(daysRaw))) : 365;
  const maxRowsRaw = Number(body.max_rows ?? 5_000);
  const maxRows = Number.isFinite(maxRowsRaw)
    ? Math.max(1_000, Math.min(20_000, Math.floor(maxRowsRaw)))
    : 5_000;
  const persist = body.persist === true;
  const sport = String(body.sport ?? "").trim().toLowerCase() || null;
  const betType = normalizedBetType(body.bet_type) || null;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1_000;

  try {
    for (let from = 0; from < maxRows; from += pageSize) {
      const through = Math.min(from + pageSize - 1, maxRows - 1);
      const baseQuery = access.admin
        .from("daily_picks")
        .select(
          "id,sport,bet_type,prop_type,tier,model_version,model_diagnostics,result,odds,profit_units,stake_units,confidence,calibrated_probability,score_kind,calibration_status,pick_date,prediction_recorded_at,commence_time,graded_at,grading_source,clv,clv_method,closing_odds",
        )
        .gte("prediction_recorded_at", since)
        .in("result", ["hit", "miss", "push"])
        .order("prediction_recorded_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, through);
      const sportQuery = sport ? baseQuery.eq("sport", sport) : baseQuery;
      const query = betType
        ? sportQuery.eq("bet_type", betType === "total" ? "over_under" : betType)
        : sportQuery;
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if ((data ?? []).length < pageSize) break;
    }

    const picks: ModelEvaluationPick[] = rows.map((row) => {
      const diagnostics = row.model_diagnostics && typeof row.model_diagnostics === "object"
        ? row.model_diagnostics as Record<string, unknown>
        : {};
      return {
        id: String(row.id ?? ""),
        sport: String(row.sport ?? ""),
        betType: normalizedBetType(row.bet_type),
        propType: row.prop_type == null ? null : String(row.prop_type),
        tier: row.tier == null ? null : String(row.tier),
        shadowEdgeCandidate: diagnostics.shadow_edge_candidate === true,
        modelVersion: row.model_version == null ? null : String(row.model_version),
        result: String(row.result ?? ""),
        odds: row.odds as string | number | null,
        profitUnits: row.profit_units == null ? null : Number(row.profit_units),
        stakeUnits: row.stake_units == null ? null : Number(row.stake_units),
        confidence: row.confidence == null ? null : Number(row.confidence),
        calibratedProbability: row.calibrated_probability == null ? null : Number(row.calibrated_probability),
        scoreKind: row.score_kind == null ? null : String(row.score_kind),
        calibrationStatus: row.calibration_status == null ? null : String(row.calibration_status),
        pickDate: row.pick_date == null ? null : String(row.pick_date),
        predictionRecordedAt: row.prediction_recorded_at == null ? null : String(row.prediction_recorded_at),
        commenceTime: row.commence_time == null ? null : String(row.commence_time),
        gradedAt: row.graded_at == null ? null : String(row.graded_at),
        gradingSource: row.grading_source == null ? null : String(row.grading_source),
        clv: row.clv == null ? null : Number(row.clv),
        clvMethod: row.clv_method == null ? null : String(row.clv_method),
        closingOdds: row.closing_odds as string | number | null,
      };
    });
    const report = evaluateModelPicks(picks);
    const inputTruncated = rows.length >= maxRows;
    if (inputTruncated) {
      report.limitations.push(
        `Input was capped at the newest ${maxRows} resolved predictions for bounded execution.`,
      );
    }
    const status = releaseStatus(report);
    let runId: string | null = null;

    if (persist) {
      const { data, error } = await access.admin
        .from("model_evaluation_runs")
        .insert({
          period_start: report.overall.periodStart,
          period_end: report.overall.periodEnd,
          methodology: report.methodology,
          request_filters: { days, sport, bet_type: betType, max_rows: maxRows, input_truncated: inputTruncated },
          input_rows: report.inputRows,
          included_rows: report.includedRows,
          release_status: status,
          report,
        })
        .select("id")
        .single();
      if (error) throw error;
      runId = String(data.id);
    }

    return json({
      ok: true,
      persisted: persist,
      runId,
      releaseStatus: status,
      maxRows,
      inputTruncated,
      report,
    });
  } catch (error) {
    console.error("model-evaluation error:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
