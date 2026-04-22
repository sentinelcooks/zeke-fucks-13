// supabase/functions/_shared/factor_log.ts
//
// Sport-agnostic factor logger. Every model (NBA/MLB/NHL/UFC) writes
// its per-factor advantage scores + weights through this helper so that:
//   1. "Why this pick?" can be answered for any sport
//   2. Weight-drift audits compare apples to apples
//   3. Closed-loop retraining has a single table to read from
//
// Requires the migration `<ts>_factor_log_and_calibration.sql`.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface FactorRow {
  factor_name: string;
  score: number;        // -100..100 or 0..100 advantage score
  weight: number;       // 0..1
  contribution?: number; // score * weight; we compute if missing
  notes?: string | null;
}

export interface LogFactorsArgs {
  sport: string;
  bet_type: string;
  game_id: string;
  pick_id?: string | null;
  player_name?: string | null;
  model_version: string;
  factors: FactorRow[];
}

let cachedClient: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedClient = createClient(url, key);
  return cachedClient;
}

export async function logFactors(args: LogFactorsArgs): Promise<void> {
  const supa = client();
  if (!supa) return; // best-effort; never block a prediction on a log write
  try {
    const rows = args.factors.map((f) => ({
      sport: args.sport,
      bet_type: args.bet_type,
      game_id: String(args.game_id),
      pick_id: args.pick_id ?? null,
      player_name: args.player_name ?? null,
      model_version: args.model_version,
      factor_name: f.factor_name,
      score: round6(f.score),
      weight: round6(f.weight),
      contribution: round6(f.contribution ?? f.score * f.weight),
      notes: f.notes ?? null,
    }));
    if (rows.length === 0) return;
    const { error } = await supa.from("factor_log").insert(rows);
    if (error) console.warn("factor_log insert error:", error.message);
  } catch (e) {
    console.warn("factor_log exception:", (e as Error).message);
  }
}

function round6(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}
