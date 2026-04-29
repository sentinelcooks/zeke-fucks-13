// Category filter helpers for the Picks tab.
//
// The DB stores prop_type values in many shapes (NBA_POINTS, points, PTS,
// nba_threes, 3-pointers, shots_on_goal, SOG, MLB_HR, home_runs, ...).
// The Picks UI exposes a single canonical filter value per category button.
// We normalize the stored value to a token and look it up in an allowlist.

const SPORT_PREFIX_RE = /^(NHL|NBA|MLB|UFC|NFL|WNBA|MLS)_/;

export function normalizePropType(propType: string | null | undefined): string {
  if (!propType) return "";
  let s = String(propType).trim().toUpperCase();
  s = s.replace(SPORT_PREFIX_RE, "");
  s = s.replace(/[-\s]+/g, "_").replace(/_+/g, "_");
  return s.toLowerCase();
}

export const CATEGORY_PROP_MAP: Record<string, ReadonlySet<string>> = {
  // NBA
  points: new Set(["points", "pts"]),
  rebounds: new Set(["rebounds", "reb"]),
  assists: new Set(["assists", "ast"]),
  "3-pointers": new Set([
    "3_pointers",
    "3pointers",
    "threes",
    "three_pointers",
    "3pm",
    "3pt",
  ]),
  steals: new Set(["steals", "stl"]),
  blocks: new Set(["blocks", "blk"]),
  "pts+reb+ast": new Set(["pts+reb+ast", "pra", "points_rebounds_assists"]),

  // MLB
  hits: new Set(["hits", "hit"]),
  home_runs: new Set(["home_runs", "hr", "homeruns"]),
  rbi: new Set(["rbi", "rbis"]),
  strikeouts: new Set(["strikeouts", "k", "ks"]),
  total_bases: new Set(["total_bases", "tb", "totalbases"]),
  runs: new Set(["runs"]),

  // NHL
  goals: new Set(["goals"]),
  shots_on_goal: new Set(["shots_on_goal", "sog"]),
  saves: new Set(["saves"]),

  // UFC
  moneyline: new Set(["moneyline", "ml"]),
  sig_strikes: new Set(["sig_strikes", "significant_strikes", "sigstrikes"]),
  takedowns: new Set(["takedowns", "td"]),
  ko_tko: new Set(["ko_tko", "kotko", "ko", "tko"]),
  submission: new Set(["submission", "sub"]),
  rounds: new Set(["rounds"]),
};

export function pickMatchesCategory(
  pick: { prop_type?: string | null; sport?: string | null },
  activeCategory: string,
  _activeSport: string,
): boolean {
  if (!activeCategory || activeCategory === "all") return true;
  const allowed = CATEGORY_PROP_MAP[activeCategory];
  if (!allowed) return false;
  return allowed.has(normalizePropType(pick.prop_type));
}
