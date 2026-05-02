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
  NBA_PRA: "Points + Rebounds + Assists",
  NBA_FTM: "Free Throws Made",
  NBA_FTA: "Free Throw Attempts",
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
  PRA: "Points + Rebounds + Assists",
  "PTS+REB+AST": "Points + Rebounds + Assists",
  "POINTS+REBOUNDS+ASSISTS": "Points + Rebounds + Assists",
  PTS_REB: "Points + Rebounds",
  POINTS_REBOUNDS: "Points + Rebounds",
  "PTS+REB": "Points + Rebounds",
  "POINTS+REBOUNDS": "Points + Rebounds",
  PTS_AST: "Points + Assists",
  POINTS_ASSISTS: "Points + Assists",
  "PTS+AST": "Points + Assists",
  "POINTS+ASSISTS": "Points + Assists",
  REB_AST: "Rebounds + Assists",
  REBOUNDS_ASSISTS: "Rebounds + Assists",
  "REB+AST": "Rebounds + Assists",
  "REBOUNDS+ASSISTS": "Rebounds + Assists",
  FTM: "Free Throws Made",
  FTA: "Free Throw Attempts",
  FREE_THROWS: "Free Throws Made",
  FREE_THROWS_MADE: "Free Throws Made",
  FREE_THROW_ATTEMPTS: "Free Throw Attempts",
  FT_ATTEMPTS: "Free Throw Attempts",

  // Generic lowercased legacy values
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

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatPropType(propType: string | null | undefined): string {
  if (!propType) return "";
  const key = String(propType).trim().toUpperCase();
  if (PROP_LABEL_MAP[key]) return PROP_LABEL_MAP[key];

  const stripped = key.replace(SPORT_PREFIX_RE, "");
  if (PROP_LABEL_MAP[stripped]) return PROP_LABEL_MAP[stripped];

  return titleCase(stripped.replace(/_/g, " "));
}

export function formatPropTypeCompact(propType: string | null | undefined): string {
  return formatPropType(propType).toLowerCase();
}
