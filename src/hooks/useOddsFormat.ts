import { useAuth } from "@/contexts/AuthContext";
import { formatOdds } from "@/utils/oddsFormat";
import { useCallback } from "react";

/**
 * Returns the user's preferred odds format and a formatter function.
 * Use `fmt(odds)` everywhere instead of local formatOdds.
 */
export function useOddsFormat() {
  const { profile } = useAuth();
  const oddsFormat = (profile?.odds_format ?? "american") as "american" | "decimal";

  const fmt = useCallback(
    (odds: number | string) => formatOdds(odds, oddsFormat),
    [oddsFormat]
  );

  return { oddsFormat, fmt };
}
