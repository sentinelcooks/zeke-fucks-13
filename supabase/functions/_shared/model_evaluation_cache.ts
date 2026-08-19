// Cached read-only release evidence. Missing tables, reports, or model-version
// matches always return an unvalidated state and never break analysis routes.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ModelEvaluationState {
  validated: boolean;
  status: "validated" | "insufficient_evidence" | "failed" | "missing";
  reasons: string[];
  evaluatedAt: string | null;
  runId: string | null;
}

type CacheEntry = { value: ModelEvaluationState; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;
let supa: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  if (supa) return supa;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  supa = createClient(url, key);
  return supa;
}

function missing(reason: string): ModelEvaluationState {
  return { validated: false, status: "missing", reasons: [reason], evaluatedAt: null, runId: null };
}

function normalizeBetType(value: string): string {
  const betType = value.trim().toLowerCase();
  return betType === "over_under" ? "total" : betType;
}

export async function getModelEvaluationState(
  sport: string,
  betType: string,
  modelVersion: string | null | undefined,
): Promise<ModelEvaluationState> {
  const version = String(modelVersion ?? "").trim();
  const key = `${sport}|${normalizeBetType(betType)}|${version}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (!version) {
    const value = missing("model_version_missing");
    cache.set(key, { value, expiresAt: now + TTL_MS });
    return value;
  }
  const supabase = client();
  if (!supabase) {
    const value = missing("evaluation_client_unavailable");
    cache.set(key, { value, expiresAt: now + TTL_MS });
    return value;
  }

  try {
    const { data, error } = await supabase
      .from("model_evaluation_runs")
      .select("id,evaluated_at,report")
      .order("evaluated_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    for (const run of data ?? []) {
      const report = run.report && typeof run.report === "object"
        ? run.report as Record<string, unknown>
        : {};
      const gates = Array.isArray(report.edgeEvidence) ? report.edgeEvidence : [];
      const gate = gates.find((candidate: unknown) => {
        if (!candidate || typeof candidate !== "object") return false;
        return String((candidate as Record<string, unknown>).key ?? "").toLowerCase() === key;
      }) as Record<string, unknown> | undefined;
      if (!gate) continue;
      const status = String(gate.status ?? "missing") as ModelEvaluationState["status"];
      const value: ModelEvaluationState = {
        validated: status === "validated",
        status: ["validated", "insufficient_evidence", "failed"].includes(status) ? status : "missing",
        reasons: Array.isArray(gate.reasons) ? gate.reasons.map(String) : [],
        evaluatedAt: typeof run.evaluated_at === "string" ? run.evaluated_at : null,
        runId: typeof run.id === "string" ? run.id : null,
      };
      cache.set(key, { value, expiresAt: now + TTL_MS });
      return value;
    }
  } catch {
    // Fail closed below.
  }
  const value = missing("evaluation_evidence_missing");
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

export function bustModelEvaluationCache(): void {
  cache.clear();
}
