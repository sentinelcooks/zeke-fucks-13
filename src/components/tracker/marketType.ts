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

  const detailParts: string[] = [base];
  if (dir) detailParts[0] = `${base} (${dir.toUpperCase()})`;
  if (line != null) detailParts.push(`(${line})`);
  return {
    headline: sub,
    detail: detailParts.filter(Boolean).join(" "),
  };
}
