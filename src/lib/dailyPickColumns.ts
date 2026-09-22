/**
 * Column selection for `daily_picks` list queries.
 *
 * `select("*")` must never be used against this table from the client. Every row
 * carries `model_diagnostics`, a jsonb blob holding the full analyzer snapshot
 * (per-game stat arrays, raw provider payloads). Measured on a real slate:
 *
 *   select=*                     120 rows → 35,642 KB, 4.9s → statement timeout
 *   explicit columns             120 rows →     86 KB, 1.0s
 *   explicit + 4 diagnostic keys 120 rows →     99 KB, 1.6s
 *
 * The dashboard only needs four keys out of that blob, so it asks for exactly
 * those. The full diagnostics are still available on demand for a single pick
 * (see `fetchPickDiagnostics`) when the user opens a detail view.
 */

/** Scalar columns the dashboard renders. */
const SCALAR_COLUMNS = [
  "id", "player_name", "team", "opponent", "prop_type", "line", "direction",
  "hit_rate", "confidence", "verdict", "odds", "reasoning", "result",
  "actual_value", "pick_date", "created_at", "sport", "bet_type",
  "home_team", "away_team", "spread_line", "total_line", "tier", "status",
  "event_id", "commence_time", "game_date", "model_used", "score_kind",
  "calibration_status", "calibrated_probability",
].join(",");

/**
 * The only `model_diagnostics` keys the list logic reads:
 *  - shadow_edge_candidate / confidenceSource → selectTodaysEdgePicks eligibility
 *  - raw_model_score                          → comparePickQuality tie-break
 *  - shadow_edge_warning                      → the fallback card's warning text
 *
 * Aliased so they come back under predictable names, then reassembled by
 * `hydrateDailyPick` into the shape the rest of the code already expects.
 */
const DIAGNOSTIC_COLUMNS = [
  "diag_shadow_edge_candidate:model_diagnostics->shadow_edge_candidate",
  "diag_confidence_source:model_diagnostics->confidenceSource",
  "diag_raw_model_score:model_diagnostics->raw_model_score",
  "diag_shadow_edge_warning:model_diagnostics->shadow_edge_warning",
].join(",");

export const DAILY_PICK_LIST_COLUMNS = `${SCALAR_COLUMNS},${DIAGNOSTIC_COLUMNS}`;

interface RawListRow {
  diag_shadow_edge_candidate?: unknown;
  diag_confidence_source?: unknown;
  diag_raw_model_score?: unknown;
  diag_shadow_edge_warning?: unknown;
  [key: string]: unknown;
}

/**
 * Rebuilds `model_diagnostics` from the aliased keys so callers see the same
 * shape they always have. Only the four keys above are present — this object is
 * for list logic, not for a detail view.
 *
 * Note the jsonb `->` operator returns JSON, so a boolean arrives as `true` and
 * a string arrives quoted-then-parsed by the client; both are normalised here.
 */
export function hydrateDailyPick<T extends RawListRow>(row: T): T & { model_diagnostics: Record<string, unknown> } {
  const {
    diag_shadow_edge_candidate,
    diag_confidence_source,
    diag_raw_model_score,
    diag_shadow_edge_warning,
    ...rest
  } = row;

  return {
    ...(rest as T),
    model_diagnostics: {
      // `->` yields JSON, so a true boolean can arrive as the string "true".
      shadow_edge_candidate: diag_shadow_edge_candidate === true || diag_shadow_edge_candidate === "true",
      confidenceSource: typeof diag_confidence_source === "string" ? diag_confidence_source : undefined,
      raw_model_score: Number.isFinite(Number(diag_raw_model_score)) ? Number(diag_raw_model_score) : undefined,
      shadow_edge_warning: typeof diag_shadow_edge_warning === "string" ? diag_shadow_edge_warning : undefined,
    },
  };
}

export function hydrateDailyPicks<T extends RawListRow>(rows: T[] | null | undefined) {
  return Array.isArray(rows) ? rows.map(hydrateDailyPick) : [];
}

/**
 * Row ceiling for a single day's `daily_picks` slate query.
 *
 * This used to be 120, ordered newest-first. The scanner writes game lines
 * (moneyline / spread / total) at the START of a run and player props after,
 * and a full MLB day now produces ~150-170 rows — so the cap sliced off exactly
 * the oldest rows, which were every game line on the slate. On 2026-09-16 all
 * 18 of them ranked #127-#161 and never reached the lineup, including a 0.88
 * Dodgers -1.5 that was the strongest MLB pick of the day.
 *
 * The ceiling now sits well above any real day (roughly 3x the busiest slate)
 * so the whole day is loaded. It still exists because PostgREST requires one
 * and an unbounded query is a latent timeout; `warnIfSlateTruncated` makes it
 * loud if a day ever does reach it, instead of silently dropping picks again.
 */
export const DAILY_SLATE_ROW_LIMIT = 500;

/**
 * Logs when a slate query came back exactly at its ceiling, which means rows
 * were very likely cut. Returns true when truncation is suspected.
 */
export function warnIfSlateTruncated(rowCount: number, limit: number, label: string): boolean {
  if (rowCount < limit) return false;
  console.warn(
    `[daily_picks] ${label} returned ${rowCount} rows, the query ceiling of ${limit}. ` +
      "Picks past the ceiling were dropped — raise DAILY_SLATE_ROW_LIMIT.",
  );
  return true;
}
