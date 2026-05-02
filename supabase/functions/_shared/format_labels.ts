// Server-side mirror of src/lib/formatPickLabel.ts so prop codes
// (NHL_SOG, NBA_THREES, MLB_RBI, etc.) never reach AI prompts or storage.

const PROP_LABEL_MAP: Record<string, string> = {
  // NHL
  NHL_ASSISTS: "Assists",
  NHL_POINTS: "Points",
  NHL_GOALS: "Goals",
  NHL_SOG: "Shots on Goal",
  NHL_SHOTS_ON_GOAL: "Shots on Goal",
  NHL_SAVES: "Saves",
  SOG: "Shots on Goal",
  SHOTS_ON_GOAL: "Shots on Goal",
  SAVES: "Saves",
  GOALS: "Goals",

  // NBA
  NBA_POINTS: "Points",
  NBA_REBOUNDS: "Rebounds",
  NBA_ASSISTS: "Assists",
  NBA_THREES: "3-Pointers",
  NBA_3PM: "3-Pointers",
  NBA_3PT: "3-Pointers",
  NBA_BLOCKS: "Blocks",
  NBA_STEALS: "Steals",
  NBA_TURNOVERS: "Turnovers",
  NBA_PRA: "Pts+Reb+Ast",
  PTS: "Points",
  REB: "Rebounds",
  AST: "Assists",
  BLK: "Blocks",
  STL: "Steals",
  TOV: "Turnovers",
  TO: "Turnovers",
  "3PM": "3-Pointers",
  "3PT": "3-Pointers",
  THREE_POINTERS: "3-Pointers",
  "3-POINTERS": "3-Pointers",
  PRA: "Pts+Reb+Ast",
  "PTS+REB+AST": "Pts+Reb+Ast",

  POINTS: "Points",
  REBOUNDS: "Rebounds",
  ASSISTS: "Assists",
  BLOCKS: "Blocks",
  STEALS: "Steals",
  TURNOVERS: "Turnovers",

  // MLB
  MLB_HITS: "Hits",
  MLB_HOME_RUNS: "Home Runs",
  MLB_RBI: "RBI",
  MLB_RBIS: "RBI",
  MLB_STRIKEOUTS: "Strikeouts",
  MLB_TOTAL_BASES: "Total Bases",
  MLB_TB: "Total Bases",
  MLB_RUNS: "Runs",
  HITS: "Hits",
  HR: "Home Runs",
  HOME_RUNS: "Home Runs",
  RBI: "RBI",
  K: "Strikeouts",
  STRIKEOUTS: "Strikeouts",
  TB: "Total Bases",
  TOTAL_BASES: "Total Bases",
  RUNS: "Runs",

  // UFC
  UFC_SIG_STRIKES: "Significant Strikes",
  UFC_TAKEDOWNS: "Takedowns",
  UFC_KO_TKO: "KO/TKO",
  UFC_SUBMISSION: "Submission",
  UFC_ROUNDS: "Rounds",
  SIG_STRIKES: "Significant Strikes",
  TAKEDOWNS: "Takedowns",
  KO_TKO: "KO/TKO",
  SUBMISSION: "Submission",
  ROUNDS: "Rounds",

  // Game-level bet types
  MONEYLINE: "Moneyline",
  ML: "Moneyline",
  SPREAD: "Spread",
  TOTAL: "Total",
};

const SPORT_PREFIX_RE = /^(NHL|NBA|MLB|UFC|NFL|WNBA|MLS)_/;
const PROP_CODE_RE = /\b(?:(?:NHL|NBA|MLB|UFC)_[A-Z0-9_]+|SOG|3PM|TOTAL_BASES)\b/g;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatPropTypeServer(propType: string | null | undefined): string {
  if (!propType) return "";
  const key = String(propType).trim().toUpperCase();
  if (PROP_LABEL_MAP[key]) return PROP_LABEL_MAP[key];

  const stripped = key.replace(SPORT_PREFIX_RE, "");
  if (PROP_LABEL_MAP[stripped]) return PROP_LABEL_MAP[stripped];

  return titleCase(stripped.replace(/_/g, " "));
}

// Replace any raw prop codes inside a free-form string with display labels.
export function stripPropCodes(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(PROP_CODE_RE, (match) => formatPropTypeServer(match) || match);
}
