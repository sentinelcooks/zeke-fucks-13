import { useAuth } from "@/contexts/AuthContext";
import { formatOdds } from "@/utils/oddsFormat";
import { useCallback } from "react";

/**
 * Returns the user's preferred odds format and a formatter function.
 * Use `fmt(odds)` everywhere instead of local formatOdds.
 *
 * Resolution order:
 *   1. profile.odds_format from the DB (source of truth once loaded)
 *   2. localStorage onboarding choice (covers the brief window between
 *      onboarding save and profile fetch on first session)
 *   3. fallback to "american"
 */
export function useOddsFormat() {
  const { profile } = useAuth();

  let resolved: "american" | "decimal" = "american";
  if (profile?.odds_format === "american" || profile?.odds_format === "decimal") {
    resolved = profile.odds_format;
  } else if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("sentinel_odds_format")
      ?? window.localStorage.getItem("sentinel_onboarding_odds_format");
    if (stored === "american" || stored === "decimal") resolved = stored;
  }

  const oddsFormat = resolved;

  const fmt = useCallback(
    (odds: number | string) => formatOdds(odds, oddsFormat),
    [oddsFormat]
  );

  return { oddsFormat, fmt };
}
