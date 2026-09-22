import { getGameDate } from "./gameDate";
import {
  selectTodaysEdgePicks,
  type TodaysEdgeCandidate,
  type PresentedTodaysEdgePick,
} from "./todaysEdgeSelection";

// Hard odds guard: drop extreme longshots (|odds| >= 1000). Mirrors the guard
// Today's Edge applies so both rails select from the same pool.
export function oddsWithinGuard(o: string | null | undefined): boolean {
  if (!o) return true;
  const n = parseInt(String(o).replace(/[^\d-]/g, ""), 10);
  if (Number.isNaN(n)) return true;
  return Math.abs(n) < 1000;
}

export type YesterdayRecapCandidate = TodaysEdgeCandidate & {
  odds?: string | null;
};

/**
 * Rebuilds the Today's Edge lineup for a past slate so the recap card can show
 * how those exact plays settled.
 *
 * The live rail's selection is computed client-side at render time and never
 * persisted, so the only way to recap it is to recompute it over the same rows
 * with the same selector.
 *
 * Two rules matter here:
 *
 *  1. Do NOT filter on `tier === "edge"`. The scanners stopped emitting that
 *     tier on 2026-08-18 — Today's Edge now surfaces analyzer-backed
 *     `tier=daily` shadow candidates through `selectTodaysEdgePicks`. A
 *     tier=edge filter matches zero rows and strands the card on its
 *     "No edge yesterday" empty state forever.
 *
 *  2. Do NOT drop graded rows. The live rail excludes anything already settled,
 *     but a settled hit or miss is the entire point of the recap.
 */
export function selectYesterdayEdgeRecap<T extends YesterdayRecapCandidate>(
  rows: T[],
  targetDate: string,
  limit = 5,
): PresentedTodaysEdgePick<T>[] {
  const candidates = rows.filter(
    (p) =>
      oddsWithinGuard(p.odds) &&
      String(p.tier ?? "").toLowerCase() !== "pass" &&
      String(p.status ?? "").toLowerCase() !== "empty_slate" &&
      getGameDate(p) === targetDate,
  );

  return selectTodaysEdgePicks(candidates, limit).picks;
}
