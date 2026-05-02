const TEAM_MARKET_TOKENS = [
  "moneyline", "money line", "ml", "winner",
  "spread", "run line", "puck line", "rl", "pl", "ats", "handicap",
];

const GAME_TOTAL_TOKENS = [
  "game total", "game o/u", "o/u", "over under", "over/under",
  "runs total", "goals total", "points total", "total rounds",
  " total", "total ", "totals", "gt",
];

// UFC-specific market token arrays
const UFC_METHOD_BETS = ["method of victory", "win by ko/tko", "win by submission", "win by decision"];
const UFC_GOES_DISTANCE_BETS = ["fight goes the distance", "fight to go distance"];
const UFC_INSIDE_DISTANCE_BETS = ["fight ends inside distance"];
const UFC_DISTANCE_BETS = [...UFC_GOES_DISTANCE_BETS, ...UFC_INSIDE_DISTANCE_BETS];
const UFC_ROUND_PROP_BETS = ["round props", "fight starts round", "fight ends in round"];
const UFC_FIGHT_TOTAL_BETS = ["total rounds"];
const UFC_FIGHTER_STAT_BETS = ["significant strikes", "takedowns", "submission attempts", "knockdowns", "control time"];

function norm(betType: string | null | undefined): string {
  return (betType || "").toLowerCase().trim();
}

export function isGameTotal(betType: string | null | undefined): boolean {
  const t = norm(betType);
  if (!t) return false;
  if (t === "total" || t === "totals" || t === "o/u" || t === "gt") return true;
  return GAME_TOTAL_TOKENS.some((tok) => t.includes(tok));
}

export function isTeamMarket(betType: string | null | undefined): boolean {
  const t = norm(betType);
  if (!t) return false;
  if (isGameTotal(t)) return false;
  return TEAM_MARKET_TOKENS.some((tok) => t.includes(tok));
}

export function needsDirection(betType: string | null | undefined): boolean {
  const t = norm(betType);
  if (!t) return false;
  if (isTeamMarket(t)) return false;
  return true;
}

// ── UFC market classifiers ──────────────────────────────────────────────────

export function isUfcMethodMarket(betType: string | null | undefined): boolean {
  const t = norm(betType);
  return UFC_METHOD_BETS.some((tok) => t.startsWith(tok));
}

export function isUfcDistanceMarket(betType: string | null | undefined): boolean {
  const t = norm(betType);
  return UFC_DISTANCE_BETS.some((tok) => t.includes(tok));
}

export function isUfcRoundProp(betType: string | null | undefined): boolean {
  const t = norm(betType);
  return UFC_ROUND_PROP_BETS.some((tok) => t.includes(tok));
}

export function isUfcFightTotal(betType: string | null | undefined): boolean {
  const t = norm(betType);
  return UFC_FIGHT_TOTAL_BETS.some((tok) => t.includes(tok));
}

export function isUfcFighterStat(betType: string | null | undefined): boolean {
  const t = norm(betType);
  return UFC_FIGHTER_STAT_BETS.some((tok) => t.includes(tok));
}

// ── Direction mode: determines which UI control to render ──────────────────

export type DirectionMode =
  | "over_under"
  | "method"
  | "goes_distance"
  | "inside_distance"
  | "round_prop"
  | "none";

export function getDirectionMode(
  sport: string,
  betType: string | null | undefined
): DirectionMode {
  if (sport === "ufc") {
    if (isUfcMethodMarket(betType)) return "method";
    const t = norm(betType);
    if (UFC_GOES_DISTANCE_BETS.some((tok) => t.includes(tok))) return "goes_distance";
    if (UFC_INSIDE_DISTANCE_BETS.some((tok) => t.includes(tok))) return "inside_distance";
    if (isUfcRoundProp(betType)) return "round_prop";
    if (isUfcFightTotal(betType) || isUfcFighterStat(betType)) return "over_under";
    return "none"; // moneyline + unknown
  }
  if (isTeamMarket(betType)) return "none";
  return "over_under";
}

// ── Subject mode: determines label/placeholder/search for the player field ─

export type SubjectMode = "matchup" | "team" | "fighter" | "fight" | "player";

export function getSubjectMode(
  sport: string,
  betType: string | null | undefined
): SubjectMode {
  if (sport === "ufc") {
    if (
      isUfcDistanceMarket(betType) ||
      isUfcRoundProp(betType) ||
      isUfcFightTotal(betType)
    )
      return "fight";
    return "fighter"; // moneyline, method, stat props
  }
  if (isGameTotal(betType)) return "matchup";
  if (isTeamMarket(betType)) return "team";
  return "player";
}

// ── Label helpers ───────────────────────────────────────────────────────────

function stripDirection(betType: string): { base: string; direction: "over" | "under" | null } {
  const m = betType.match(/^(.*?)\s*\((over|under)\)\s*$/i);
  if (m) {
    return { base: m[1].trim(), direction: m[2].toLowerCase() as "over" | "under" };
  }
  return { base: betType.trim(), direction: null };
}

const MARKET_LABELS: Record<string, string> = {
  points: "Points",
  pts: "Points",
  nba_points: "Points",
  rebounds: "Rebounds",
  reb: "Rebounds",
  rebs: "Rebounds",
  nba_rebounds: "Rebounds",
  assists: "Assists",
  ast: "Assists",
  nba_assists: "Assists",
  "3-pointers": "3-Pointers",
  "3 pointers": "3-Pointers",
  "3pt": "3-Pointers",
  "3pm": "3-Pointers",
  nba_3pt: "3-Pointers",
  nba_3pm: "3-Pointers",
  steals: "Steals",
  stl: "Steals",
  blocks: "Blocks",
  blk: "Blocks",
  turnovers: "Turnovers",
  turnover: "Turnovers",
  tov: "Turnovers",
  to: "Turnovers",
  "pts+reb": "Points + Rebounds",
  pts_reb: "Points + Rebounds",
  nba_pts_reb: "Points + Rebounds",
  "points+rebounds": "Points + Rebounds",
  "points rebounds": "Points + Rebounds",
  "points + rebounds": "Points + Rebounds",
  "pts+ast": "Points + Assists",
  pts_ast: "Points + Assists",
  nba_pts_ast: "Points + Assists",
  "points+assists": "Points + Assists",
  "points assists": "Points + Assists",
  "points + assists": "Points + Assists",
  "reb+ast": "Rebounds + Assists",
  reb_ast: "Rebounds + Assists",
  nba_reb_ast: "Rebounds + Assists",
  "rebounds+assists": "Rebounds + Assists",
  "rebounds assists": "Rebounds + Assists",
  "rebounds + assists": "Rebounds + Assists",
  pra: "Points + Rebounds + Assists",
  nba_pra: "Points + Rebounds + Assists",
  pts_reb_ast: "Points + Rebounds + Assists",
  points_rebounds_assists: "Points + Rebounds + Assists",
  "pts+reb+ast": "Points + Rebounds + Assists",
  "points+rebounds+assists": "Points + Rebounds + Assists",
  "points rebounds assists": "Points + Rebounds + Assists",
  "points + rebounds + assists": "Points + Rebounds + Assists",
  "free throws made": "Free Throws Made",
  "free throws": "Free Throws Made",
  free_throws: "Free Throws Made",
  ftm: "Free Throws Made",
  nba_ftm: "Free Throws Made",
  "free throw attempts": "Free Throw Attempts",
  "free throws attempted": "Free Throw Attempts",
  "ft attempts": "Free Throw Attempts",
  ft_attempts: "Free Throw Attempts",
  free_throw_attempts: "Free Throw Attempts",
  fta: "Free Throw Attempts",
  nba_fta: "Free Throw Attempts",
};

function titleCaseMarket(s: string): string {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatMarketLabel(betType: string | null | undefined): string {
  const raw = (betType || "").trim();
  if (!raw) return "";
  const { base } = stripDirection(raw);
  const lower = base.toLowerCase().trim();
  const compactPlus = lower.replace(/\s*\+\s*/g, "+");
  const compactWords = compactPlus.replace(/[^a-z0-9+_]+/g, " ").trim();
  return (
    MARKET_LABELS[lower] ||
    MARKET_LABELS[compactPlus] ||
    MARKET_LABELS[compactWords] ||
    titleCaseMarket(base)
  );
}

export interface BetLabelInput {
  subject: string;
  betType: string;
  line?: number | null;
  direction?: "over" | "under" | null;
  sport?: string;
}

export interface BetLabelOutput {
  headline: string;
  detail: string;
}

export function formatBetLabel({
  subject,
  betType,
  line,
  direction,
  sport,
}: BetLabelInput): BetLabelOutput {
  const { base, direction: encoded } = stripDirection(betType || "");
  const dir = direction ?? encoded;
  const sub = subject || "";

  // ── UFC-specific formatting ──
  if (sport === "ufc") {
    // Method market: "Method of Victory: KO/TKO" → headline + "by KO/TKO"
    if (isUfcMethodMarket(base)) {
      const colonIdx = base.indexOf(":");
      const method = colonIdx >= 0 ? base.slice(colonIdx + 1).trim() : "";
      return {
        headline: sub,
        detail: method ? `by ${method}` : base,
      };
    }

    // Goes distance
    const bt = norm(base);
    if (UFC_GOES_DISTANCE_BETS.some((tok) => bt.includes(tok))) {
      return { headline: sub, detail: "Fight Goes Distance" };
    }

    // Inside distance
    if (UFC_INSIDE_DISTANCE_BETS.some((tok) => bt.includes(tok))) {
      return { headline: sub, detail: "Fight Ends Inside Distance" };
    }

    // Round props — "Round Props: Round 2 Ends"
    if (isUfcRoundProp(base)) {
      const colonIdx = base.indexOf(":");
      const detail = colonIdx >= 0 ? base.slice(colonIdx + 1).trim() : base;
      return { headline: sub, detail };
    }

    // Fight total rounds
    if (isUfcFightTotal(base)) {
      const dirLabel = dir ? dir.charAt(0).toUpperCase() + dir.slice(1) : "";
      const lineStr = line != null ? String(line) : "";
      const parts = [dirLabel, lineStr, "Total Rounds"].filter(Boolean);
      return { headline: sub, detail: parts.join(" ").trim() };
    }

    // Fighter stat props (over/under)
    if (isUfcFighterStat(base)) {
      const dirLabel = dir ? ` (${dir.toUpperCase()})` : "";
      const lineStr = line != null ? ` (${line})` : "";
      return { headline: sub, detail: `${base}${dirLabel}${lineStr}` };
    }

    // UFC Moneyline / fallback
    return { headline: sub, detail: base };
  }

  // ── Non-UFC formatting (unchanged) ──
  if (isGameTotal(base)) {
    const dirLabel = dir ? dir.charAt(0).toUpperCase() + dir.slice(1) : "";
    const lineStr = line != null ? String(line) : "";
    const parts = [dirLabel, lineStr, "Total"].filter(Boolean);
    return {
      headline: sub,
      detail: parts.join(" ").trim(),
    };
  }

  const label = formatMarketLabel(base);
  const dirLabel = dir ? dir.charAt(0).toUpperCase() + dir.slice(1) : "";
  const lineStr = line != null ? String(line) : "";
  const detailParts = [dirLabel, lineStr, label].filter(Boolean);
  return {
    headline: sub,
    detail: detailParts.join(" ").trim(),
  };
}
