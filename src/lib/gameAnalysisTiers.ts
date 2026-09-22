/**
 * Verdict tiers for the game analysis screen.
 *
 * These cutoffs are the frontend mirror of
 * `supabase/functions/_shared/thresholds.ts` (PROB_STRONG 0.72, PROB_LEAN 0.58,
 * PROB_FLOOR 0.42), expressed on the 0-100 scale the model scores on. They are
 * duplicated rather than imported because that module is Deno source and
 * pulling it into the bundle drags `Deno` globals with it — `gameAnalysisTiers.test.ts`
 * asserts the two stay in step, so drift fails the suite rather than shipping.
 *
 * The backend has four tiers and the redesign shows three colours: RISKY and
 * PASS both read amber, because the distinction the design cares about is
 * "actionable or not". The verdict text itself stays truthful — a RISKY game
 * still says RISKY.
 */

export type GameAnalysisTier = "STRONG" | "LEAN" | "RISKY" | "PASS";

export const GAME_ANALYSIS_TIERS = {
  STRONG: 72,
  LEAN: 58,
  RISKY: 42,
} as const;

export interface TierPresentation {
  tier: GameAnalysisTier;
  /** Label rendered under the dial. */
  label: GameAnalysisTier;
  /** CSS colour for the dial, tier text, gauge fill and model-side highlight. */
  color: string;
  /** True when the model is leaning hard enough to be worth acting on. */
  actionable: boolean;
}

const STRONG_COLOR = "hsl(158 64% 52%)";
const LEAN_COLOR = "hsl(220 100% 65%)";
const CAUTION_COLOR = "hsl(38 92% 61%)";

export function tierForScore(score: number | null | undefined): TierPresentation {
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return { tier: "PASS", label: "PASS", color: CAUTION_COLOR, actionable: false };
  }
  if (value >= GAME_ANALYSIS_TIERS.STRONG) {
    return { tier: "STRONG", label: "STRONG", color: STRONG_COLOR, actionable: true };
  }
  if (value >= GAME_ANALYSIS_TIERS.LEAN) {
    return { tier: "LEAN", label: "LEAN", color: LEAN_COLOR, actionable: true };
  }
  if (value >= GAME_ANALYSIS_TIERS.RISKY) {
    return { tier: "RISKY", label: "RISKY", color: CAUTION_COLOR, actionable: false };
  }
  return { tier: "PASS", label: "PASS", color: CAUTION_COLOR, actionable: false };
}
