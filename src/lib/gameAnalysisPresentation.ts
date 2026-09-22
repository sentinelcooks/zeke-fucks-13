export type GameAnalysisScoreKind = "heuristic_score" | "calibrated_probability" | string | null | undefined;

export interface GameAnalysisDecision {
  winning_side?: "team1" | "team2" | "over" | "under" | null;
  winning_team_name?: string | null;
  win_probability?: number | null;
  conviction_tier?: string | null;
  recommended_units?: number | null;
  grade_explanation?: string | null;
}

/** Per-side season stats, for the team comparison card. */
export interface GameAnalysisTeamStats {
  runsPerGame?: number | null;
  ops?: number | null;
  bullpenEra?: number | null;
}

/**
 * Verified game context the model already gathers: park, weather, starters and
 * lineup confirmation. Every field is optional — the model reports what it
 * could verify and nothing else, and a section with no data hides rather than
 * inventing a league average.
 */
export interface GameAnalysisContext {
  parkRunFactor?: number | null;
  weather?: {
    temperatureF?: number | null;
    windMph?: number | null;
    windDirection?: string | null;
    condition?: string | null;
    roofType?: string | null;
  } | null;
  homeLineupConfirmed?: boolean | null;
  awayLineupConfirmed?: boolean | null;
  homeStarter?: { name?: string | null; era?: number | null } | null;
  awayStarter?: { name?: string | null; era?: number | null } | null;
  homeTeamStats?: GameAnalysisTeamStats | null;
  awayTeamStats?: GameAnalysisTeamStats | null;
}

export interface GameAnalysisResponse {
  team1?: { name?: string; shortName?: string };
  team2?: { name?: string; shortName?: string };
  matchup?: {
    confirmed?: boolean;
    gameDate?: string | null;
    oddsEventId?: string | null;
    venue?: string | null;
    status?: string | null;
  };
  /**
   * The model's own projected value for the market, on the market's scale —
   * runs for a total. Only the totals path produces one, so the model-vs-line
   * gauge renders for totals and hides elsewhere.
   */
  predicted_total?: number | null;
  predicted_margin?: number | null;
  /** Share of the model's weight budget that had real data behind it, 0-1. */
  data_coverage?: number | null;
  /** Raw input keys the model could not use. Map through `gameAnalysisInputs`. */
  missing_inputs?: string[];
  feed_missing?: string[];
  context?: GameAnalysisContext | null;
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

/**
 * The label for a selected market quote, with its number appended exactly once.
 *
 * A total's number is a threshold, not a handicap, so it carries no sign — an
 * "Over +8" reads as if the line were plus-eight runs. Spreads keep their sign,
 * because there the sign is the whole meaning.
 *
 * The de-duplication matters because a total's label arrives already carrying
 * the number: over/under has no `winning_team_name` to overwrite it, so the
 * request-time label ("Over 167.5") survives and appending the point again
 * rendered "Over 167.5 167.5". Spreads are not affected — a team name replaces
 * their label — but the guard is general so neither market can regress.
 */
export function quoteSelectionLabel(
  label: string,
  point: number | null | undefined,
  side?: string | null,
): string {
  if (point == null || !Number.isFinite(point)) return label;

  const trailing = /([+-]?\d+(?:\.\d+)?)\s*$/.exec(label ?? "");
  if (trailing && Math.abs(Number(trailing[1]) - point) < 1e-9) return label;

  const isTotal = side === "over" || side === "under";
  if (isTotal) return `${label} ${point.toFixed(1)}`;
  return `${label} ${point > 0 ? "+" : ""}${point}`;
}

export function analysisNarrative(response: GameAnalysisResponse | undefined): string | null {
  const writeup = response?.writeup?.trim();
  if (writeup) return writeup;
  const decisionExplanation = response?.decision?.grade_explanation?.trim();
  if (decisionExplanation) return decisionExplanation;
  return null;
}
