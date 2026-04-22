// supabase/functions/_shared/correlation.ts
//
// Multi-sport same-game-parlay correlation adjustment.
// Replaces the NBA-only `correlated-props` behavior; also used by slip
// grading in sport_scan.
//
// Given N legs whose individual cashed probabilities are p_i, the naive
// SGP probability is ∏ p_i. That overestimates joint probability for
// positively-correlated legs (e.g. "Team X ML" + "Team X starter Over Ks")
// and underestimates for negatively-correlated ones.
//
// We correct by a multiplicative correction ρ, derived from a lookup
// table plus a simple structural bump:
//
//   • same team + same "outcome direction"            → ρ = 1.12
//   • same team + mixed directions (team W + player U) → ρ = 0.92
//   • opposing teams + same side (both overs)         → ρ = 0.96
//   • opposing teams + mirrored (home cover + away ML dog) → ρ = 1.08
//   • different games                                  → ρ = 1.00
//
// These are defaults; if `correlation_lookup` rows exist for a given
// (sport, prop_type_a, prop_type_b, same_team), they override.
//
// This is intentionally a shrinkage-friendly heuristic — not claiming
// to be a full copula. It closes the biggest gap (overestimating
// correlated SGP EV by +2-3%) with ~30 lines of logic.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adjustJoint, clamp01 } from "./prob_math.ts";

export interface CorrLeg {
  sport: string;
  game_id: string;
  team?: string | null;
  opponent?: string | null;
  prop_type: string;
  direction: string;        // "over" | "under" | "home" | "away"
  cashed_prob: number;      // calibrated probability of the leg cashing
}

export interface CorrelationResult {
  joint_prob: number;
  rho: number;
  naive_prob: number;
  notes: string[];
}

function structuralRho(legs: CorrLeg[]): { rho: number; notes: string[] } {
  const notes: string[] = [];
  if (legs.length < 2) return { rho: 1, notes };

  const byGame = new Map<string, CorrLeg[]>();
  for (const l of legs) {
    const arr = byGame.get(l.game_id) ?? [];
    arr.push(l);
    byGame.set(l.game_id, arr);
  }

  let rhoProd = 1;
  for (const [gid, grp] of byGame) {
    if (grp.length < 2) continue;
    for (let i = 0; i < grp.length; i++) {
      for (let j = i + 1; j < grp.length; j++) {
        const a = grp[i];
        const b = grp[j];
        const sameTeam = !!a.team && a.team === b.team;
        const aPos = ["over", "home", "yes"].includes(a.direction?.toLowerCase());
        const bPos = ["over", "home", "yes"].includes(b.direction?.toLowerCase());
        const sameDir = aPos === bPos;

        let pairRho = 1;
        if (sameTeam && sameDir) { pairRho = 1.12; notes.push(`+same-team/same-dir in ${gid}`); }
        else if (sameTeam && !sameDir) { pairRho = 0.92; notes.push(`−same-team/mixed-dir in ${gid}`); }
        else if (!sameTeam && sameDir) { pairRho = 0.96; notes.push(`−opposing/same-dir in ${gid}`); }
        else if (!sameTeam && !sameDir) { pairRho = 1.08; notes.push(`+opposing/mirrored in ${gid}`); }

        rhoProd *= pairRho;
      }
    }
  }
  return { rho: Math.max(0.5, Math.min(1.6, rhoProd)), notes };
}

export async function adjustJointProbability(
  legs: CorrLeg[],
): Promise<CorrelationResult> {
  const probs = legs.map((l) => clamp01(l.cashed_prob));
  const naive = probs.reduce((a, p) => a * p, 1);

  let { rho, notes } = structuralRho(legs);

  // Optional DB override — only hit if a lookup table is present.
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key && legs.length === 2) {
    try {
      const supa = createClient(url, key);
      const a = legs[0];
      const b = legs[1];
      const { data } = await supa
        .from("correlation_lookup")
        .select("rho")
        .eq("sport", a.sport)
        .in("prop_type_a", [a.prop_type, b.prop_type])
        .in("prop_type_b", [a.prop_type, b.prop_type])
        .eq("same_team", !!a.team && a.team === b.team)
        .limit(1)
        .maybeSingle();
      if (data?.rho && Number.isFinite(data.rho)) {
        rho = Number(data.rho);
        notes.push(`lookup rho=${rho}`);
      }
    } catch {
      // swallow — fallback to structural.
    }
  }

  const joint = adjustJoint(probs, rho);
  return { joint_prob: joint, rho, naive_prob: naive, notes };
}
