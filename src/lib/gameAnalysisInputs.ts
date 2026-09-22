/**
 * Plain-English labels for the model's data-check grid.
 *
 * The model reports gaps as raw keys — `LINEUP_UNCONFIRMED`,
 * `PROBABLE_STARTER_PROFILE_MISSING`, `official_probable_starter_season_era`.
 * Those are internal names and must never reach the screen; a user reading
 * "LINEUP_UNCONFIRMED" learns nothing except that something leaked.
 *
 * The grid is fixed rather than derived from whatever the model happened to
 * report, so the same six rows appear every time and a verified input is
 * visibly verified rather than silently absent.
 */

/** Keys emitted by `_shared/mlb_data.ts` (feed gaps) and `_shared/mlb_game_model.ts` (factor gaps). */
export interface GameAnalysisInputNode {
  id: string;
  label: string;
  verified: boolean;
}

interface InputDefinition {
  id: string;
  label: string;
  /** Any of these keys appearing in the model's missing list marks the row pending. */
  missingKeys: string[];
}

const INPUT_DEFINITIONS: InputDefinition[] = [
  { id: "team_offense", label: "Team offense", missingKeys: ["TEAM_SEASON_STATS_INCOMPLETE"] },
  { id: "starters", label: "Starting pitchers", missingKeys: ["PROBABLE_STARTER_PROFILE_MISSING", "starter_rest", "starter_workload_spike"] },
  { id: "bullpen", label: "Bullpen form", missingKeys: ["BULLPEN_USAGE_INCOMPLETE"] },
  { id: "park", label: "Park factor", missingKeys: ["CURRENT_PARK_FACTOR_MISSING", "park_factor"] },
  { id: "lineups", label: "Lineups", missingKeys: ["LINEUP_UNCONFIRMED"] },
  { id: "lineup_stats", label: "Lineup stats", missingKeys: ["LINEUP_SEASON_STATS_INCOMPLETE", "platoon_ops", "platoon_k_rate"] },
];

/**
 * Extra keys that have a sensible label but no fixed row. They surface only
 * when the model reports them, appended after the six standard rows.
 */
const OPTIONAL_LABELS: Record<string, string> = {
  WEATHER_MISSING: "Weather",
  temperature: "Weather",
  wind: "Wind",
  PITCH_TYPE_MATCHUP_INSUFFICIENT: "Pitch mix",
  pitch_mix_matchup: "Pitch mix",
  home_field: "Home field",
};

function normalize(keys: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const key of keys) {
    const value = String(key ?? "").trim();
    if (value) set.add(value);
  }
  return set;
}

/**
 * Builds the data-check rows from the model's reported gaps.
 *
 * Everything not reported missing is treated as verified — the model only
 * names an input when it could not use it, so absence from the list is the
 * signal that it had real data behind it.
 */
export function buildInputNodes(
  missingInputs: Iterable<string> | null | undefined,
  feedMissing?: Iterable<string> | null,
): GameAnalysisInputNode[] {
  const missing = normalize([...(missingInputs ?? []), ...(feedMissing ?? [])]);

  const rows = INPUT_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    verified: !definition.missingKeys.some((key) => missing.has(key)),
  }));

  const claimed = new Set(INPUT_DEFINITIONS.flatMap((definition) => definition.missingKeys));
  const seenLabels = new Set(rows.map((row) => row.label));
  for (const key of missing) {
    if (claimed.has(key)) continue;
    const label = OPTIONAL_LABELS[key];
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    rows.push({ id: key.toLowerCase(), label, verified: false });
  }

  return rows;
}

/**
 * Label for a single raw key, for anywhere a lone input name is rendered.
 * Falls back to title-casing so an unmapped key still reads as English rather
 * than as a constant.
 */
export function inputLabel(key: string): string {
  const trimmed = String(key ?? "").trim();
  if (!trimmed) return "";

  const definition = INPUT_DEFINITIONS.find((entry) => entry.missingKeys.includes(trimmed));
  if (definition) return definition.label;
  if (OPTIONAL_LABELS[trimmed]) return OPTIONAL_LABELS[trimmed];

  const words = trimmed.replace(/[_-]+/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}
