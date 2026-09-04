export type GameAnalysisScoreKind = "heuristic_score" | "calibrated_probability" | string | null | undefined;

export interface GameAnalysisDecision {
  winning_side?: "team1" | "team2" | "over" | "under" | null;
  winning_team_name?: string | null;
  win_probability?: number | null;
  conviction_tier?: string | null;
  recommended_units?: number | null;
  grade_explanation?: string | null;
}

export interface GameAnalysisResponse {
  team1?: { name?: string; shortName?: string };
  team2?: { name?: string; shortName?: string };
  matchup?: { confirmed?: boolean; gameDate?: string | null; oddsEventId?: string | null };
  probability_supported?: boolean;
  score_kind?: GameAnalysisScoreKind;
  decision?: GameAnalysisDecision | null;
  confidence?: number | null;
  team1_pct?: number | null;
  verdict?: string | null;
  factors?: string[];
  writeup?: string | null;
  factorBreakdown?: Array<{
    label?: string;
    name?: string;
    detail?: string;
    score?: number;
    team1Score?: number;
    team2Score?: number;
    weight?: number;
  }>;
  head_to_head?: Array<{
    date?: string;
    name?: string;
    team1_score?: number;
    team2_score?: number;
    team1_winner?: boolean;
    team2_winner?: boolean;
    venue?: string;
  }>;
  error?: string;
}

export interface HeadToHeadRow {
  id: string;
  dateLabel: string;
  scoreLabel: string;
  outcomeLabel: string;
  venue?: string;
}

export interface GameModelMetric {
  value: number | null;
  display: string;
  label: "Win probability" | "Model score";
  isProbability: boolean;
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function gameModelMetric(response: GameAnalysisResponse | undefined): GameModelMetric {
  const decisionValue = finiteNumber(response?.decision?.win_probability);
  const responseValue = finiteNumber(response?.confidence ?? response?.team1_pct);
  const value = decisionValue ?? responseValue;
  const isProbability = response?.probability_supported === true && response?.score_kind === "calibrated_probability";

  return {
    value,
    display: value == null ? "--" : isProbability ? `${Math.round(value)}%` : `${Math.round(value)}/100`,
    label: isProbability ? "Win probability" : "Model score",
    isProbability,
  };
}

export function headToHeadRows(
  response: GameAnalysisResponse | undefined,
  team1Name: string,
  team2Name: string,
  limit = 5,
): HeadToHeadRow[] {
  const games = Array.isArray(response?.head_to_head) ? response.head_to_head : [];

  return games
    .filter((game) => finiteNumber(game.team1_score) != null && finiteNumber(game.team2_score) != null && !!game.date)
    .slice(0, limit)
    .map((game, index) => {
      const date = new Date(game.date!);
      const dateLabel = Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
        : "Previous meeting";
      const team1Score = finiteNumber(game.team1_score)!;
      const team2Score = finiteNumber(game.team2_score)!;
      const outcomeLabel = game.team1_winner === true
        ? `${team1Name} won`
        : game.team2_winner === true
          ? `${team2Name} won`
          : "Final score";

      return {
        id: `${game.date}-${index}`,
        dateLabel,
        scoreLabel: `${team1Name} ${team1Score} – ${team2Score} ${team2Name}`,
        outcomeLabel,
        venue: game.venue || undefined,
      };
    });
}

export function analysisNarrative(response: GameAnalysisResponse | undefined): string | null {
  const writeup = response?.writeup?.trim();
  if (writeup) return writeup;
  const decisionExplanation = response?.decision?.grade_explanation?.trim();
  if (decisionExplanation) return decisionExplanation;
  return null;
}
