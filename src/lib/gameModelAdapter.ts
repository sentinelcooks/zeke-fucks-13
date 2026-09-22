import type { GameAnalysisResponse } from "./gameAnalysisPresentation";

/**
 * Adapts the new per-sport game-model endpoints (`mlb-game-model`,
 * `wnba-game-model`) onto the `GameAnalysisResponse` contract the Analyze UI
 * already consumes.
 *
 * Two orientation facts make this necessary:
 *
 *  - The NEW functions always score from the HOME side: `home_score` of 68
 *    means "home is favoured", regardless of which bet the user tapped.
 *  - The EXISTING UI is written from the SELECTED side: `team1` is whatever the
 *    user is considering backing, and `team1_pct` is that side's number.
 *
 * So when the user is looking at the away side, every factor has to be mirrored
 * — team1Score and team2Score swap. Getting this backwards would silently
 * invert the entire model, which is exactly the kind of bug that looks like a
 * bad model rather than a bad adapter, so it is unit-tested in both directions.
 */

export type GameModelSide = "home" | "away";

export interface GameModelFactor {
  key?: string;
  label?: string;
  group?: string;
  team1Score?: number;
  team2Score?: number;
  weight?: number;
  detail?: string;
}

/** Response shape emitted by mlb-game-model / wnba-game-model. */
export interface GameModelResponse {
  model_version?: string;
  market?: string;
  sport?: string;
  matchup?: {
    home?: { name?: string; abbreviation?: string };
    away?: { name?: string; abbreviation?: string };
    game_date?: string | null;
    venue?: string | null;
    status?: string | null;
  };
  home_score?: number | null;
  away_score?: number | null;
  side_score?: number | null;
  total_side?: string | null;
  predicted_margin?: number | null;
  projected_total?: number | null;
  verdict?: string | null;
  factors?: GameModelFactor[];
  factor_count?: number;
  missing_inputs?: string[];
  feed_missing?: string[];
  data_coverage?: number;
  score_kind?: string;
  disclaimer?: string;
  /**
   * Verified game context. `*_starter` and `*_team_stats` are only present on
   * deployments carrying the starter/team-stats addition; the UI treats them
   * as optional and hides those sections until they arrive.
   */
  context?: {
    park_run_factor?: number | null;
    weather?: {
      temperatureF?: number | null;
      windMph?: number | null;
      windDirection?: string | null;
      condition?: string | null;
      roofType?: string | null;
    } | null;
    home_lineup_confirmed?: boolean | null;
    away_lineup_confirmed?: boolean | null;
    home_starter?: string | { name?: string | null; era?: number | null } | null;
    away_starter?: string | { name?: string | null; era?: number | null } | null;
    home_team_stats?: { runsPerGame?: number | null; ops?: number | null; bullpenEra?: number | null } | null;
    away_team_stats?: { runsPerGame?: number | null; ops?: number | null; bullpenEra?: number | null } | null;
  } | null;
  error?: string;
  reason?: string;
}

/**
 * Starters were serialised as a bare name before ERA was added. Accept both so
 * the UI works against either deployment.
 */
function starterOf(value: string | { name?: string | null; era?: number | null } | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") return { name: value, era: null };
  return { name: value.name ?? null, era: finite(value.era) };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Mirrors a factor so it reads from the away side's perspective. */
function flipFactor(factor: GameModelFactor): GameModelFactor {
  const t1 = finite(factor.team1Score);
  const t2 = finite(factor.team2Score);
  return {
    ...factor,
    team1Score: t2 ?? (t1 === null ? undefined : 100 - t1),
    team2Score: t1 ?? (t2 === null ? undefined : 100 - t2),
  };
}

/**
 * Human-readable one-liners for the report's bullet list, ordered by the weight
 * the model actually gave them so the top bullets are the ones that moved the
 * score most — not just the first ones the model happened to emit.
 */
function factorSummaries(factors: GameModelFactor[], limit = 6): string[] {
  // Same rule as the writeup: a dead-even factor is not a talking point, so
  // the bullets show the inputs that actually moved the score.
  return [...factors]
    .filter((f) => (finite(f.weight) ?? 0) > 0 && f.detail && (finite(f.team1Score) ?? 50) !== 50)
    .sort((a, b) => (finite(b.weight) ?? 0) - (finite(a.weight) ?? 0))
    .slice(0, limit)
    .map((f) => String(f.detail));
}

export interface AdaptOptions {
  /** Which side the user is considering. Determines the orientation. */
  side: GameModelSide;
  /** Odds event id, so the UI can confirm the model answered about this game. */
  oddsEventId?: string | null;
}

/**
 * Converts a game-model response into the UI's analysis contract.
 * Returns an error-shaped response rather than throwing, because the caller
 * renders per-market errors inline.
 */
export function adaptGameModelResponse(
  model: GameModelResponse | null | undefined,
  options: AdaptOptions,
): GameAnalysisResponse {
  if (!model) {
    return { error: "No model response." };
  }
  if (model.error) {
    return { error: model.reason ? `${model.error}: ${model.reason}` : model.error };
  }

  const isAway = options.side === "away";
  const home = model.matchup?.home;
  const away = model.matchup?.away;

  const selected = isAway ? away : home;
  const opponent = isAway ? home : away;

  // A total market has no "side" in the team sense — the score already belongs
  // to the requested over/under, so it is used as-is.
  const isTotal = String(model.market ?? "").toLowerCase() === "total";
  const rawScore = isTotal
    ? finite(model.side_score)
    : isAway
      ? finite(model.away_score)
      : finite(model.home_score);

  const factors = Array.isArray(model.factors) ? model.factors : [];
  const orientedFactors = isAway && !isTotal ? factors.map(flipFactor) : factors;

  return {
    team1: { name: selected?.name, shortName: selected?.abbreviation },
    team2: { name: opponent?.name, shortName: opponent?.abbreviation },
    matchup: {
      // The model resolved the matchup from the league feed, so reaching this
      // point with names attached means the event was confirmed.
      confirmed: Boolean(selected?.name && opponent?.name),
      gameDate: model.matchup?.game_date ?? null,
      oddsEventId: options.oddsEventId ?? null,
      venue: model.matchup?.venue ?? null,
      status: model.matchup?.status ?? null,
    },
    // Verified context, coverage and input gaps are what the report screen
    // renders as Conditions, the coverage tile and the data check. They used to
    // be dropped here, which is why those sections had nothing to show.
    predicted_total: finite(model.projected_total),
    predicted_margin: finite(model.predicted_margin),
    data_coverage: finite(model.data_coverage),
    missing_inputs: Array.isArray(model.missing_inputs) ? model.missing_inputs : [],
    feed_missing: Array.isArray(model.feed_missing) ? model.feed_missing : [],
    context: model.context
      ? {
          parkRunFactor: finite(model.context.park_run_factor),
          weather: model.context.weather ?? null,
          homeLineupConfirmed: model.context.home_lineup_confirmed ?? null,
          awayLineupConfirmed: model.context.away_lineup_confirmed ?? null,
          homeStarter: starterOf(model.context.home_starter),
          awayStarter: starterOf(model.context.away_starter),
          homeTeamStats: model.context.home_team_stats ?? null,
          awayTeamStats: model.context.away_team_stats ?? null,
        }
      : null,
    // These models are explicitly uncalibrated. Saying otherwise here is what
    // would turn a directional lean into an implied win probability.
    probability_supported: false,
    score_kind: "heuristic_score",
    // The UI renders a lean from `decision`; with none it shows "Analysis
    // unavailable" even though the model answered. `win_probability` is the
    // field name the contract uses, but because `probability_supported` is
    // false and `score_kind` is "heuristic_score", the UI treats it as a
    // directional score — which is what it is.
    decision: buildDecision(model, rawScore, isTotal, selected?.name, opponent?.name),
    confidence: rawScore,
    team1_pct: rawScore,
    verdict: model.verdict ?? null,
    factors: factorSummaries(orientedFactors),
    factorBreakdown: orientedFactors.map((f) => ({
      label: f.label,
      name: f.key,
      detail: f.detail,
      score: finite(f.team1Score) ?? undefined,
      team1Score: finite(f.team1Score) ?? undefined,
      team2Score: finite(f.team2Score) ?? undefined,
      weight: finite(f.weight) ?? undefined,
    })),
    writeup: buildWriteup(model, selected?.name ?? "the selected side", orientedFactors),
    head_to_head: [],
  };
}

/**
 * Builds the directional lean the report renders.
 *
 * `rawScore` is the SELECTED side's score. A score below 50 means the model
 * actually favours the opponent, so the decision names the opponent and carries
 * the opponent's score — reporting "45 for the side you picked" as if it were a
 * lean would invert the model's meaning.
 *
 * `conviction_tier` and `recommended_units` stay at "noBet"/0 on purpose: a
 * staking recommendation requires calibrated evidence this model does not have.
 */
function buildDecision(
  model: GameModelResponse,
  rawScore: number | null,
  isTotal: boolean,
  selectedName: string | undefined,
  opponentName: string | undefined,
) {
  if (rawScore === null) return null;

  const favoursSelected = rawScore >= 50;
  const leanScore = favoursSelected ? rawScore : 100 - rawScore;

  if (isTotal) {
    const requested = String(model.total_side ?? "over").toLowerCase() === "under" ? "under" : "over";
    const leaning = favoursSelected ? requested : (requested === "over" ? "under" : "over");
    return {
      winning_side: leaning as "over" | "under",
      winning_team_name: null,
      win_probability: leanScore,
      conviction_tier: "noBet",
      recommended_units: 0,
      grade_explanation: explainLean(model, leanScore),
    };
  }

  return {
    winning_side: (favoursSelected ? "team1" : "team2") as "team1" | "team2",
    winning_team_name: (favoursSelected ? selectedName : opponentName) ?? null,
    win_probability: leanScore,
    conviction_tier: "noBet",
    recommended_units: 0,
    grade_explanation: explainLean(model, leanScore),
  };
}

function explainLean(model: GameModelResponse, leanScore: number): string {
  const count = Array.isArray(model.factors) ? model.factors.length : (model.factor_count ?? 0);
  const coverage = finite(model.data_coverage);
  const coverageText = coverage !== null ? ` on ${Math.round(coverage * 100)}% input coverage` : "";
  return `Directional model score of ${Math.round(leanScore)} from ${count} weighted factor${count === 1 ? "" : "s"}${coverageText}. This is not a calibrated win probability and carries no staking recommendation.`;
}

/**
 * A short, data-grounded paragraph. Deliberately built from the model's own
 * numbers rather than an AI call: every clause has to be traceable to a factor,
 * and "no blank or generic analysis outputs" is a project non-negotiable.
 */
function buildWriteup(
  model: GameModelResponse,
  selectedName: string,
  factors: GameModelFactor[],
): string {
  const parts: string[] = [];
  const count = factors.length || model.factor_count || 0;
  const coverage = finite(model.data_coverage);

  parts.push(
    `Sentinel scored ${count} factor${count === 1 ? "" : "s"} across offence, pitching or efficiency, situational context and environment for this market.`,
  );

  // "Heaviest input" must mean heaviest input that actually SAYS something. A
  // factor sitting at exactly 50 is dead even — when both teams have, say, 0
  // questionable minutes, it carries weight but no direction, and renormalising
  // a group onto one survivor can push such a factor to the top of the list.
  // Leading the writeup with "the heaviest input is 0 vs 0" reads as broken.
  const directional = [...factors].filter(
    (f) => (finite(f.weight) ?? 0) > 0 && (finite(f.team1Score) ?? 50) !== 50,
  );
  const top = directional
    .sort((a, b) => (finite(b.weight) ?? 0) - (finite(a.weight) ?? 0))[0];
  if (top?.label && top.detail) {
    parts.push(`The heaviest input is ${top.label.toLowerCase()} — ${top.detail}`);
  }

  const margin = finite(model.predicted_margin);
  if (margin !== null) {
    parts.push(
      `Projected margin is ${margin > 0 ? "+" : ""}${margin} for the home side.`,
    );
  }
  const total = finite(model.projected_total);
  if (total !== null) parts.push(`Projected combined total is ${total}.`);

  const missing = Array.isArray(model.missing_inputs) ? model.missing_inputs : [];
  if (missing.length > 0) {
    parts.push(
      `${missing.length} input${missing.length === 1 ? " was" : "s were"} unavailable and ${missing.length === 1 ? "was" : "were"} excluded rather than assumed neutral: ${missing.slice(0, 6).join(", ")}.`,
    );
  }
  if (coverage !== null) {
    parts.push(`Model data coverage for ${selectedName} is ${Math.round(coverage * 100)}% of the full weighting budget.`);
  }

  parts.push(
    "This is a directional model signal only. It is not a calibrated win probability and should not be read as one.",
  );

  return parts.join(" ");
}

export interface GameModelRequest {
  /** Edge function to invoke. */
  fn: string;
  /** Body for that function. */
  payload: Record<string, unknown>;
  /** Orientation for adapting the response back. */
  side: GameModelSide;
}

/**
 * Translates the existing per-side analysis body into a call against the new
 * per-sport endpoints. Returns null when the sport or market has no dedicated
 * model, so the caller can fall back to `moneyline-api` untouched.
 *
 * The subtle part is the spread. The legacy body carries `spread_line` from the
 * SELECTED team's perspective (away +1.5), while the endpoints want it from the
 * HOME team's perspective. Picking the away side therefore requires negating
 * the number — miss that and every away spread is evaluated against the wrong
 * line, which is why it is covered by tests.
 */
export function buildGameModelRequest(
  body: Record<string, unknown>,
): GameModelRequest | null {
  const fn = gameModelFunctionFor(String(body.sport ?? ""));
  if (!fn) return null;

  const betType = String(body.bet_type ?? "").toLowerCase();
  const market = betType === "moneyline" ? "moneyline"
    : betType === "spread" ? "spread"
    : betType === "total" || betType === "over_under" ? "total"
    : null;
  if (!market) return null;

  // The WNBA endpoint serves totals; the MLB one does not yet.
  if (market === "total" && fn !== "wnba-game-model") return null;

  const homeTeam = String(body.odds_home_team ?? "");
  const awayTeam = String(body.odds_away_team ?? "");
  if (!homeTeam || !awayTeam) return null;

  const selected = String(body.team1 ?? "");
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const selectedIsHome = normalize(selected) === normalize(homeTeam);
  const side: GameModelSide = selectedIsHome ? "home" : "away";

  const payload: Record<string, unknown> = {
    market,
    homeTeam,
    awayTeam,
    gameDate: body.odds_commence_time ?? null,
    // Sent as well as the date so a doubleheader resolves to the game the user
    // actually tapped; without it the endpoint takes the day's first meeting.
    gameStartTime: body.odds_commence_time ?? null,
  };

  if (market === "spread") {
    const line = Number(body.spread_line);
    if (!Number.isFinite(line)) return null;
    // Convert the selected side's line to the home side's line.
    payload.homeSpread = selectedIsHome ? line : -line;
  }

  if (market === "total") {
    const line = Number(body.total_line);
    if (!Number.isFinite(line)) return null;
    payload.totalLine = line;
    payload.totalSide = String(body.over_under ?? "over").toLowerCase() === "under" ? "under" : "over";
  }

  return { fn, payload, side };
}

/** Maps a UI market key onto the endpoint's market name. */
export function marketKeyToModelMarket(key: string): "moneyline" | "spread" | "total" | null {
  if (key === "h2h") return "moneyline";
  if (key === "spreads") return "spread";
  if (key === "totals") return "total";
  return null;
}

/** Which edge function serves a given sport, or null when unsupported. */
export function gameModelFunctionFor(sport: string): string | null {
  const value = String(sport ?? "").toLowerCase();
  if (value.includes("mlb") || value.includes("baseball")) return "mlb-game-model";
  if (value.includes("wnba")) return "wnba-game-model";
  return null;
}
