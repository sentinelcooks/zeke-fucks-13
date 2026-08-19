// Shared prop normalization for scanner/analyzer boundaries.
// Keep NBA canonical values aligned with nba-api getStatValue().

function compactKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[&+]/g, "_")
    .replace(/-/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const NBA_PROP_ALIASES: Record<string, string> = {
  points: "points",
  player_points: "points",
  pts: "points",
  rebounds: "rebounds",
  player_rebounds: "rebounds",
  reb: "rebounds",
  assists: "assists",
  player_assists: "assists",
  ast: "assists",
  "3_pointers": "3-pointers",
  "3_pointers_made": "3-pointers",
  "3_pointer_made": "3-pointers",
  three_pointers: "3-pointers",
  three_pointers_made: "3-pointers",
  threes: "3-pointers",
  player_threes: "3-pointers",
  player_three_pointers: "3-pointers",
  player_three_pointers_made: "3-pointers",
  "3pm": "3-pointers",
  "3pt": "3-pointers",
  fg3m: "3-pointers",
  blocks: "blocks",
  player_blocks: "blocks",
  blk: "blocks",
  steals: "steals",
  player_steals: "steals",
  stl: "steals",
  turnovers: "turnovers",
  player_turnovers: "turnovers",
  tov: "turnovers",
  pts_reb_ast: "pts+reb+ast",
  points_rebounds_assists: "pts+reb+ast",
  player_points_rebounds_assists: "pts+reb+ast",
  pra: "pts+reb+ast",
  pts_reb: "pts+reb",
  points_rebounds: "pts+reb",
  player_points_rebounds: "pts+reb",
  pts_ast: "pts+ast",
  points_assists: "pts+ast",
  player_points_assists: "pts+ast",
  reb_ast: "reb+ast",
  rebounds_assists: "reb+ast",
  player_rebounds_assists: "reb+ast",
  stl_blk: "stl+blk",
  blocks_steals: "stl+blk",
  player_blocks_steals: "stl+blk",
};

export function normalizeNbaPropType(propType: string | null | undefined): string {
  const raw = String(propType ?? "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase().trim();
  if (lower.startsWith("1q_")) {
    const base = normalizeNbaPropType(lower.slice(3));
    return base ? `1q_${base}` : lower;
  }

  const key = compactKey(raw);
  if (NBA_PROP_ALIASES[key]) return NBA_PROP_ALIASES[key];

  if (
    key.includes("three_pointer") ||
    key.includes("3_pointer") ||
    key === "three" ||
    key === "three_made"
  ) {
    return "3-pointers";
  }

  return lower.replace(/\s+/g, "_");
}

// NHL canonical prop_type. Strips the "nhl_" prefix that the NHL_MAP in
// sport_scan.ts historically emitted for points/assists. Goals/sog/saves
// were already canonical. Frontend formatPropType() handles either form,
// but we want stored prop_type, analyzer_payload, and queue rows to use the
// canonical key so manual Analyze and See Why match without prefix-stripping.
const NHL_PROP_ALIASES: Record<string, string> = {
  points: "points",
  player_points: "points",
  nhl_points: "points",
  assists: "assists",
  player_assists: "assists",
  nhl_assists: "assists",
  goals: "goals",
  player_goals: "goals",
  sog: "sog",
  shots: "sog",
  shots_on_goal: "sog",
  player_shots_on_goal: "sog",
  saves: "saves",
  player_total_saves: "saves",
  total_saves: "saves",
};

export function normalizeNhlPropType(propType: string | null | undefined): string {
  const raw = String(propType ?? "").trim();
  if (!raw) return "";
  const key = compactKey(raw);
  if (NHL_PROP_ALIASES[key]) return NHL_PROP_ALIASES[key];
  // Strip nhl_ prefix as a fallback.
  const stripped = key.startsWith("nhl_") ? key.slice(4) : key;
  return NHL_PROP_ALIASES[stripped] ?? stripped;
}

const MLB_PROP_ALIASES: Record<string, string> = {
  pitcher_strikeouts: "pitcher_strikeouts",
  pitcher_k: "pitcher_strikeouts",
  pitcher_ks: "pitcher_strikeouts",
  pitching_strikeouts: "pitcher_strikeouts",
  hits_allowed: "hits_allowed",
  pitcher_hits_allowed: "hits_allowed",
  earned_runs: "earned_runs",
  pitcher_earned_runs: "earned_runs",
  walks_allowed: "walks_allowed",
  pitcher_walks: "walks_allowed",
  pitcher_walks_allowed: "walks_allowed",
  outs: "outs_recorded",
  pitcher_outs: "outs_recorded",
  outs_recorded: "outs_recorded",
  innings_pitched: "innings_pitched",
  hits: "hits",
  batter_hits: "hits",
  runs: "runs",
  batter_runs_scored: "runs",
  rbi: "rbi",
  rbis: "rbi",
  batter_rbis: "rbi",
  home_runs: "home_runs",
  batter_home_runs: "home_runs",
  doubles: "doubles",
  batter_doubles: "doubles",
  total_bases: "total_bases",
  batter_total_bases: "total_bases",
  walks: "walks",
  batter_walks: "walks",
  stolen_bases: "stolen_bases",
  batter_stolen_bases: "stolen_bases",
  batter_strikeouts: "batter_strikeouts",
};

export function isMlbPitcherPosition(position: string | null | undefined): boolean {
  return new Set(["P", "SP", "RP", "CP", "CL", "LHP", "RHP"])
    .has(String(position ?? "").trim().toUpperCase());
}

/**
 * MLB's bare `strikeouts` key was historically ambiguous. New callers use an
 * explicit key; legacy callers are resolved only after the player's role is
 * known, so a batting row can never be evaluated as a pitching line.
 */
export function normalizeMlbPropType(
  propType: string | null | undefined,
  role?: "pitcher" | "batter" | null,
): string {
  const raw = String(propType ?? "").trim();
  if (!raw) return "";
  const key = compactKey(raw);
  if (["strikeouts", "strikeout", "k", "ks", "so"].includes(key)) {
    return role === "pitcher" ? "pitcher_strikeouts" : "batter_strikeouts";
  }
  return MLB_PROP_ALIASES[key] ?? key;
}

export function isMlbPitchingProp(propType: string | null | undefined): boolean {
  return new Set([
    "pitcher_strikeouts",
    "hits_allowed",
    "earned_runs",
    "walks_allowed",
    "outs_recorded",
    "innings_pitched",
  ]).has(normalizeMlbPropType(propType, "pitcher"));
}

export function normalizeDirection(direction: string | null | undefined): string {
  const d = String(direction ?? "").trim().toLowerCase();
  if (d.startsWith("u")) return "under";
  if (d.startsWith("o")) return "over";
  return d;
}

export function propTraceKey(propType: string | null | undefined): string {
  return normalizeNbaPropType(propType);
}
