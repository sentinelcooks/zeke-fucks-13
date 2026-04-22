// supabase/functions/_shared/calibration_cache.ts
//
// 5-minute in-memory cache of the active calibration row per (sport, bet_type).
// If the table doesn't exist yet, or no row has active=true, returns an
// identity calibration so production never breaks on a cold DB.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Calibration } from "./prob_math.ts";

type CacheEntry = { value: Calibration; expiresAt: number };
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

export async function getCalibration(
  sport: string,
  betType: string,
): Promise<Calibration> {
  const k = `${sport}|${betType}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.expiresAt > now) return hit.value;

  const supabase = client();
  if (!supabase) {
    const v = identity();
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  }
  try {
    const { data, error } = await supabase
      .from("model_calibration")
      .select("method, params")
      .eq("sport", sport)
      .eq("bet_type", betType)
      .eq("active", true)
      .order("fitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      const v = identity();
      cache.set(k, { value: v, expiresAt: now + TTL_MS });
      return v;
    }
    let v: Calibration = identity();
    if (data.method === "platt" && data.params?.a != null && data.params?.b != null) {
      v = { method: "platt", params: { a: Number(data.params.a), b: Number(data.params.b) } };
    } else if (data.method === "isotonic" && Array.isArray(data.params?.bins)) {
      v = { method: "isotonic", params: { bins: data.params.bins } };
    }
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  } catch {
    const v = identity();
    cache.set(k, { value: v, expiresAt: now + TTL_MS });
    return v;
  }
}

export function bustCalibrationCache(): void {
  cache.clear();
}
