import type { GameAnalysisDecision } from "@/lib/gameAnalysisPresentation";

export interface GameAnalysisMarketQuote {
  side: "home" | "away" | "over" | "under";
  label: string;
  price: number;
  point?: number;
}

export interface GameAnalysisTeamIdentity {
  name: string;
  shortName?: string;
  abbr?: string;
  aliases?: string[];
}

export interface GameAnalysisEventTeams {
  home: GameAnalysisTeamIdentity;
  away: GameAnalysisTeamIdentity;
}

function normalizeName(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesTeam(value: string | null | undefined, team: GameAnalysisTeamIdentity) {
  const normalizedValue = normalizeName(value);
  if (!normalizedValue) return false;

  return [team.name, team.shortName, team.abbr, ...(team.aliases || [])]
    .some((candidate) => normalizeName(candidate) === normalizedValue);
}

export function quoteForModelDecision<T extends GameAnalysisMarketQuote>(
  quotes: T[],
  decision: GameAnalysisDecision | null | undefined,
  teams: GameAnalysisEventTeams | null | undefined,
): T | undefined {
  if (!decision || !teams) return undefined;

  if (decision.winning_side === "over" || decision.winning_side === "under") {
    return quotes.find((quote) => quote.side === decision.winning_side);
  }

  const winnerName = decision.winning_team_name;
  const isHomeWinner = matchesTeam(winnerName, teams.home);
  const isAwayWinner = matchesTeam(winnerName, teams.away);

  if (isHomeWinner === isAwayWinner) return undefined;
  return quotes.find((quote) => quote.side === (isHomeWinner ? "home" : "away"));
}
