// supabase/functions/_shared/calibration_cache.ts
//
// 5-minute in-memory cache of the active calibration row per (sport, bet_type).
// If the table doesn't exist yet, or no row has active=true, returns an
// identity calibration so production never breaks on a cold DB.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Calibration } from "./prob_math.ts";
import { hasSupportedCalibration } from "./calibration_policy.ts";

export interface CalibrationState {
  calibration: Calibration;
  supported: boolean;
  status: "validated" | "missing" | "insufficient_evidence" | "invalid";
  nSamples: number;
  trainSamples: number;
  testSamples: number;
  fittedAt: string | null;
  activationReason: string | null;
}

type CacheEntry = { value: CalibrationState; expiresAt: number };
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

function identity(): Calibration {
  return { method: "identity" };
}

function unsupportedState(status: CalibrationState["status"]): CalibrationState {
  return {
    calibration: identity(),
    supported: false,
    status,
    nSamples: 0,
    trainSamples: 0,
    testSamples: 0,
    fittedAt: null,
    activationReason: null,
  };
}

export async function getCalibrationState(
  sport: string,
  betType: string,
): Promise<CalibrationState> {
  const k = `${sport}|${betType}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) return hit.value;

  const supabase = client();
  if (!supabase) {
    const v = unsupportedState("missing");
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  }
  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("method,params,n_samples,train_samples,test_samples,holdout_passed,evaluation_method,fitted_at,activation_reason,active")
      .eq("sport", sport)
      .eq("bet_type", betType)
      .eq("active", true)
      .order("fitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      const v = unsupportedState("missing");
      cache.set(k, { value: v, expiresAt: now + TTL_MS });
      return v;
    }
    let calibration: Calibration = identity();
    if (data.method === "platt" && data.params?.a != null && data.params?.b != null) {
      calibration = { method: "platt", params: { a: Number(data.params.a), b: Number(data.params.b) } };
    } else if (data.method === "isotonic" && Array.isArray(data.params?.bins)) {
      calibration = { method: "isotonic", params: { bins: data.params.bins } };
    }
    const supported = calibration.method !== "identity" && hasSupportedCalibration(data);
    const v: CalibrationState = {
      calibration: supported ? calibration : identity(),
      supported,
      status: supported
        ? "validated"
        : calibration.method === "identity" ? "invalid" : "insufficient_evidence",
      nSamples: Number(data.n_samples ?? 0),
      trainSamples: Number(data.train_samples ?? 0),
      testSamples: Number(data.test_samples ?? 0),
      fittedAt: typeof data.fitted_at === "string" ? data.fitted_at : null,
      activationReason:
        typeof data.activation_reason === "string" ? data.activation_reason : null,
    };
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  } catch {
    const v = unsupportedState("missing");
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  }
}

export async function getCalibration(
  sport: string,
  betType: string,
): Promise<Calibration> {
  return (await getCalibrationState(sport, betType)).calibration;
}

export function bustCalibrationCache(): void {
  cache.clear();
}
