import type { GameAnalysisResponse } from "./gameAnalysisPresentation";

/**
 * Adapts the NFL Game Edge engine (`nfl-game-edge`) onto the same
 * `GameAnalysisResponse` contract MLB/WNBA use, so NFL renders in the existing
 * Analyze experience (scan screen → full report → per-market cards) with no
 * separate UI.
 *
 * Two differences from the MLB adapter:
 *
 *  - `nfl-game-edge` answers for ALL THREE markets in one call, so the caller
 *    fetches once per event and adapts that response per market/side.
 *  - The NFL engine emits real probabilities plus a publish decision. A market
 *    is presented as a recommendation ONLY when its result is status "PLAY"
 *    (proven profitable — docs/claude/nfl-edge-engines.md). Everything else is
 *    presented as a directional lean, exactly like an uncalibrated sport, so
 *    unproven output can never read as a betting recommendation.
 */

export type NflSide = "home" | "away";
export type NflMarket = "moneyline" | "spread" | "total";

export interface NflGameEdgeResultRow {
  market_type: NflMarket;
  selection: string;
  side: "home" | "away" | "over" | "under";
  line: number | null;
  model_probability: number;
  push_probability: number;
  no_vig_probability: number;
  fair_price: number | null;
  market_price: number;
  market_book: string | null;
  edge_percentage: number;
  expected_value: number;
  confidence: number;
  fair_line: number | null;
  status: "PLAY" | "NO PLAY";
  shadow_play?: boolean;
  no_play_reasons: string[];
}

export interface NflGameEdgeFactor {
  id: number;
  name: string;
  home: number | null;
  away: number | null;
  source: string;
  proxy: boolean;
  missing: boolean;
}

export interface NflGameEdgeResponse {
  model_version?: string;
  game_id?: string;
  matchup?: { home?: string; away?: string; kickoff?: string | null; season?: number; week?: number };
  market_available?: Record<NflMarket, boolean>;
  projections?: {
    p_home_win: number;
    projected_margin: number;
    projected_total: number;
    structural_total?: number;
    margin_contributions: Record<string, number>;
    total_contributions: Record<string, number>;
  };
  results?: NflGameEdgeResultRow[];
  factors?: NflGameEdgeFactor[];
  qb?: Record<string, { starter_name?: string | null; starter_status?: string | null; delta?: number }>;
  injuries?: Record<string, { points_lost?: number; out_players?: string[]; questionable_starters?: string[] }>;
  forward_test?: Record<NflMarket, { proven: boolean; status: string }>;
  data_quality?: number;
  error?: string;
  reason?: string;
}

export interface NflAdaptOptions {
  market: NflMarket;
  /** The side the user tapped: home/away for team markets, over/under for totals. */
  side: NflSide;
  totalSide?: "over" | "under";
  oddsEventId?: string | null;
  /** Sportsbook team names, so the report can confirm it answered about this game. */
  homeTeamName: string;
  awayTeamName: string;
}

/** Which of the 25 factors each model feature belongs to (mirrors GAME_FACTORS). */
const FEATURE_TO_FACTOR: Record<string, number> = {
  off_epa: 1, def_epa: 2, off_sr: 3, def_sr: 4, pass_eff: 5, qb_eff: 6, qb_pressure: 7, pass_rush: 8,
  coverage: 9, run_off: 10, run_def: 11, explosive: 12, ppd: 13, red_zone: 14, strength: 15, scoring_env: 15,
  recent_form: 16, turnover_regression: 17, ol_quality: 18, injuries: 19, home_field: 20, rest: 21,
  short_week: 21, travel: 22, weather: 23, wind: 23, cold: 23, dome: 23, coaching: 24, pace: 24, proe: 24,
};

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pctOf = (p: number) => Math.round(p * 1000) / 10;
const fmtPts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;

/**
 * Converts a factor's model contribution (in points) into the 0–100 advantage
 * score the report's bars use. 50 is dead even; ±45 caps the scale so one
 * dominant factor cannot render as a full bar.
 */
function scoreFromPoints(points: number): number {
  return Math.round(Math.max(5, Math.min(95, 50 + points * 4)) * 10) / 10;
}

export function adaptNflGameEdgeResponse(
  model: NflGameEdgeResponse | null | undefined,
  options: NflAdaptOptions,
): GameAnalysisResponse {
  if (!model) return { error: "No model response." };
  if (model.error) return { error: model.reason ? `${model.error}: ${model.reason}` : model.error };
  const projections = model.projections;
  const results = Array.isArray(model.results) ? model.results : [];
  if (!projections || results.length === 0) {
    return { error: "The NFL model returned no market for this game." };
  }

  const isTotal = options.market === "total";
  const isAway = options.side === "away";
  const wantSide = isTotal ? (options.totalSide ?? "over") : options.side;
  const row = results.find((r) => r.market_type === options.market && r.side === wantSide);
  if (!row) {
    return { error: `No ${options.market} price was available for this game when the model ran.` };
  }

  const selectedName = isAway ? options.awayTeamName : options.homeTeamName;
  const opponentName = isAway ? options.homeTeamName : options.awayTeamName;

  // Contributions are oriented to the home side (margin) or to "more points"
  // (total). Mirror them when the user is looking at the away side.
  const rawContrib = isTotal ? projections.total_contributions : projections.margin_contributions;
  const orient = isTotal ? (wantSide === "under" ? -1 : 1) : (isAway ? -1 : 1);
  const factorPoints = new Map<number, number>();
  for (const [feature, value] of Object.entries(rawContrib ?? {})) {
    const id = FEATURE_TO_FACTOR[feature];
    const v = finite(value);
    if (!id || v === null) continue;
    factorPoints.set(id, (factorPoints.get(id) ?? 0) + v * orient);
  }

  const factors = Array.isArray(model.factors) ? model.factors : [];
  const towards = isTotal ? (wantSide === "under" ? "the under" : "the over") : selectedName;
  const breakdown = factors.map((f) => {
    const points = factorPoints.get(f.id) ?? 0;
    const score = scoreFromPoints(points);
    const values = f.home !== null || f.away !== null
      ? ` (${options.awayTeamName} ${f.away ?? "n/a"} · ${options.homeTeamName} ${f.home ?? "n/a"})`
      : "";
    return {
      label: f.name,
      name: `factor_${f.id}`,
      detail: `${fmtPts(points)} toward ${towards}${values}${f.proxy ? " · proxy input" : ""}${f.missing ? " · input unavailable" : ""}`,
      score,
      team1Score: score,
      team2Score: Math.round((100 - score) * 10) / 10,
      weight: Math.round(Math.abs(points) * 1000) / 1000,
    };
  });

  const modelPct = pctOf(row.model_probability);
  const isPick = row.status === "PLAY";
  const favoursSelected = row.model_probability >= 0.5;
  const leanPct = favoursSelected ? modelPct : Math.round((100 - modelPct) * 10) / 10;
  const leanName = favoursSelected ? selectedName : opponentName;
  const marketPct = pctOf(row.no_vig_probability);

  const explanation = isPick
    ? `Proven-profitable NFL market. Model ${modelPct}% vs a no-vig market of ${marketPct}% on ${row.selection} at ${row.market_price > 0 ? "+" : ""}${row.market_price}, an edge of ${row.edge_percentage > 0 ? "+" : ""}${row.edge_percentage.toFixed(1)} points with confidence ${row.confidence}.`
    : `Model ${modelPct}% vs a no-vig market of ${marketPct}% on ${row.selection}. ${row.no_play_reasons.map((r) => r.replace(/^unproven:\s*/, "")).join("; ") || "Gated by Sentinel's NFL pick rules."} This is a directional model signal, not a pick.`;

  const decision = isTotal
    ? {
        winning_side: (favoursSelected ? wantSide : wantSide === "over" ? "under" : "over") as "over" | "under",
        winning_team_name: null,
        win_probability: leanPct,
        conviction_tier: isPick ? (row.confidence >= 70 ? "strong" : "lean") : "noBet",
        recommended_units: isPick ? 1 : 0,
        grade_explanation: explanation,
      }
    : {
        winning_side: (favoursSelected ? "team1" : "team2") as "team1" | "team2",
        winning_team_name: leanName,
        win_probability: leanPct,
        conviction_tier: isPick ? (row.confidence >= 70 ? "strong" : "lean") : "noBet",
        recommended_units: isPick ? 1 : 0,
        grade_explanation: explanation,
      };

  const missing = factors.filter((f) => f.missing).map((f) => f.name);
  const weatherFactor = factors.find((f) => f.id === 23);
  const bullets = [...breakdown]
    .filter((b) => (b.weight ?? 0) >= 0.05)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 6)
    .map((b) => `${b.label} — ${b.detail}`);

  return {
    team1: { name: selectedName },
    team2: { name: opponentName },
    matchup: {
      confirmed: Boolean(selectedName && opponentName),
      gameDate: model.matchup?.kickoff ?? null,
      oddsEventId: options.oddsEventId ?? null,
      venue: null,
      status: null,
    },
    predicted_total: finite(projections.projected_total),
    predicted_margin: finite(projections.projected_margin),
    data_coverage: finite(model.data_quality),
    missing_inputs: missing,
    feed_missing: [],
    context: weatherFactor && !weatherFactor.missing
      ? {
          weather: { temperatureF: weatherFactor.home, windMph: weatherFactor.away, roofType: /dome|closed/i.test(weatherFactor.source) ? "indoor" : null },
          homeLineupConfirmed: null,
          awayLineupConfirmed: null,
        }
      : null,
    // Only a proven market may present as a calibrated probability; everything
    // else is a directional score, which is what the report labels it.
    probability_supported: isPick,
    score_kind: isPick ? "calibrated_probability" : "heuristic_score",
    decision,
    confidence: modelPct,
    team1_pct: modelPct,
    verdict: isPick ? "PLAY" : "Forward testing — not a pick",
    factors: bullets,
    factorBreakdown: breakdown,
    writeup: buildNflWriteup(model, options, row, projections, bullets, towards),
    head_to_head: [],
  };
}

function buildNflWriteup(
  model: NflGameEdgeResponse,
  options: NflAdaptOptions,
  row: NflGameEdgeResultRow,
  projections: NonNullable<NflGameEdgeResponse["projections"]>,
  bullets: string[],
  towards: string,
): string {
  const parts: string[] = [];
  const home = options.homeTeamName;
  const away = options.awayTeamName;
  const homePts = (projections.projected_total + projections.projected_margin) / 2;
  const awayPts = (projections.projected_total - projections.projected_margin) / 2;
  parts.push(
    `Sentinel's NFL Game Edge model projects ${away} ${awayPts.toFixed(1)} – ${home} ${homePts.toFixed(1)} (margin ${projections.projected_margin > 0 ? "+" : ""}${projections.projected_margin} toward ${home}, total ${projections.projected_total}).`,
  );
  parts.push(
    `On ${row.selection} it has ${pctOf(row.model_probability)}% against a no-vig market price of ${pctOf(row.no_vig_probability)}%, an edge of ${row.edge_percentage > 0 ? "+" : ""}${row.edge_percentage.toFixed(1)} points at ${row.market_price > 0 ? "+" : ""}${row.market_price}${row.market_book ? ` (${row.market_book})` : ""}.`,
  );
  if (bullets[0]) parts.push(`The heaviest input is ${bullets[0].toLowerCase()}.`);
  const qbHome = model.qb?.home?.starter_name;
  const qbAway = model.qb?.away?.starter_name;
  if (qbHome || qbAway) parts.push(`Projected starters: ${away} ${qbAway ?? "unconfirmed"}, ${home} ${qbHome ?? "unconfirmed"}.`);
  const injuries = model.injuries;
  const injuryPts = (injuries?.home?.points_lost ?? 0) + (injuries?.away?.points_lost ?? 0);
  if (injuryPts > 0) parts.push(`The injury report costs a combined ${injuryPts.toFixed(1)} projected points across both sides.`);
  parts.push(`Scoring runs toward ${towards} in this model, on ${Math.round((model.data_quality ?? 0) * 100)}% input coverage.`);
  if (row.status === "PLAY") {
    parts.push("This market has proven profitable on graded results, so it is published as a pick.");
  } else {
    const ft = model.forward_test?.[options.market]?.status;
    parts.push(`NFL ${options.market} is still in forward testing${ft ? ` (${ft})` : ""}, so this is model analysis and not a pick.`);
  }
  return parts.join(" ");
}

export interface NflGameEdgeRequest {
  fn: "nfl-game-edge";
  payload: Record<string, unknown>;
  options: NflAdaptOptions;
}

/**
 * Builds the NFL request from the Analyze screen's per-side body. Returns null
 * when the body is not an NFL game market, so callers fall through untouched.
 */
export function buildNflGameEdgeRequest(body: Record<string, unknown>): NflGameEdgeRequest | null {
  const sport = String(body.sport ?? "").toLowerCase();
  if (!sport.includes("nfl") && !sport.includes("football")) return null;

  const betType = String(body.bet_type ?? "").toLowerCase();
  const market: NflMarket | null = betType === "moneyline" ? "moneyline"
    : betType === "spread" ? "spread"
    : betType === "total" || betType === "over_under" ? "total"
    : null;
  if (!market) return null;

  const homeTeamName = String(body.odds_home_team ?? "");
  const awayTeamName = String(body.odds_away_team ?? "");
  if (!homeTeamName || !awayTeamName) return null;

  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const selectedIsHome = normalize(String(body.team1 ?? "")) === normalize(homeTeamName);

  return {
    fn: "nfl-game-edge",
    payload: {
      home_team: homeTeamName,
      away_team: awayTeamName,
      commence_time: body.odds_commence_time ?? null,
    },
    options: {
      market,
      side: selectedIsHome ? "home" : "away",
      totalSide: String(body.over_under ?? "over").toLowerCase() === "under" ? "under" : "over",
      oddsEventId: (body.odds_event_id as string) ?? null,
      homeTeamName,
      awayTeamName,
    },
  };
}
