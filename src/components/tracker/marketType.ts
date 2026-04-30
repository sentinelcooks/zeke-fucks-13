const TEAM_MARKET_TOKENS = [
  "moneyline", "money line", "ml", "winner",
  "spread", "run line", "puck line", "rl", "pl", "ats", "handicap",
];

const GAME_TOTAL_TOKENS = [
  "game total", "game o/u", "o/u", "over under", "over/under",
  "runs total", "goals total", "points total", "total rounds",
  " total", "total ", "totals", "gt",
];

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
  line: number | null | undefined;
  direction?: "over" | "under" | null;
}

export interface BetLabelOutput {
  headline: string;
  detail: string;
}

export function formatBetLabel({ subject, betType, line, direction }: BetLabelInput): BetLabelOutput {
  const { base, direction: encoded } = stripDirection(betType || "");
  const dir = direction ?? encoded;

  if (isGameTotal(base)) {
    const dirLabel = dir ? dir.charAt(0).toUpperCase() + dir.slice(1) : "";
    const lineStr = line != null ? String(line) : "";
    const parts = [dirLabel, lineStr, "Total"].filter(Boolean);
    return {
      headline: subject || "",
      detail: parts.join(" ").trim(),
    };
  }

  const detailParts: string[] = [base];
  if (dir) detailParts[0] = `${base} (${dir.toUpperCase()})`;
  if (line != null) detailParts.push(`(${line})`);
  return {
    headline: subject || "",
    detail: detailParts.filter(Boolean).join(" "),
  };
}
