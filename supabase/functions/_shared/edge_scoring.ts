// Unified scoring + verdict tiering for the daily slate engine. v3-calibrated
// qualityScore = calibratedProb * reliability * (1 + edge) * hitRateFactor
//
// v3 changes (vs v2-strict-longshot-cap):
//   • probability math lives in prob_math.ts (vig removal + calibration + shrinkage)
//   • tier thresholds live in thresholds.ts (single source of truth)
//   • `projected_prob` and `confidence` are now CALIBRATED (0-1); callers pass the
//     raw model confidence and we calibrate + de-vig here if the caller
//     supplies an opposing American price (`odds_opp`).
//   • rankAndDistribute fallback filler now pulls from the full sorted list
//     (Strong + Lean), not the already-drained Strong set — fixes empty
//     Today's Edge on slow slates.
//
// All probabilities are 0-1 scale.

import {
  americanToImplied,
  fairImpliedFromPair,
  calcEvPct,
  applyCalibration,
  clamp01,
  type Calibration,
} from "./prob_math.ts";
import {
  PROB_STRONG,
  PROB_LEAN,
  PROB_FLOOR,
  EDGE_STRONG_MIN,
  EDGE_LEAN_MIN,
  RELIABILITY_STRONG_MIN,
  RELIABILITY_LEAN_MIN,
  RELIABILITY_FLOOR,
  LONGSHOT_ODDS_MAX,
  MID_LONGSHOT_ODDS_MIN,
  MID_LONGSHOT_CONF_MIN,
  MID_LONGSHOT_EDGE_MIN,
  MID_LONGSHOT_RELIABILITY_MIN,
  VOLATILE_UNDER_CONF_MIN,
  VOLATILE_UNDER_EDGE_MIN,
} from "./thresholds.ts";

export interface ScoredPlay {
  sport: string;
  bet_type: "prop" | "moneyline" | "spread" | "total";
  player_name: string;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type: string;
  line: number;
  spread_line?: number | null;
  total_line?: number | null;
  direction: string;
  odds: number;
  odds_opp?: number | null;       // opposing book price, if known — used for vig removal
  projected_prob: number;          // calibrated probability of the bet cashing
  implied_prob: number;            // fair (vig-removed) implied prob of the bet
  raw_implied_prob: number;        // unadjusted american→implied (audit only)
  edge: number;                    // projected_prob − implied_prob (vig-free)
  ev_pct: number;
  confidence: number;              // = projected_prob, kept for legacy readers
  raw_confidence: number;          // pre-calibration factor-sum score (0-1)
  reliability: number;             // 0.4-1.0 market reliability
  score: number;                   // legacy edge*confidence
  quality_score: number;           // composite curated score
  verdict: "Strong" | "Lean" | "Pass";
  reasoning: string;
  // Event identity carried through from the Odds API event for downstream
  // public display (filter by actual game_date, not pick_date).
  event_id?: string | null;
  commence_time?: string | null;
  game_date?: string | null;
}

// Back-compat exports — new callers should import from prob_math.ts directly.
export { americanToImplied as americanToImpliedProb, calcEvPct as calcEv };

// ── Market reliability map ─────────────────────────────────
// 1.0 = highly stable / repeatable signal
// 0.75 = moderate (multi-component or volatile-but-trackable)
// 0.5  = volatile / low-signal markets that need elite confidence to surface
const HIGH_RELIABILITY_PROPS = new Set([
  "points", "rebounds", "assists",         // NBA core
  "hits", "total_bases",                   // MLB core (total_bases is mid normally; promoted by volume)
  "shots_on_goal", "sog",                  // NHL core
  "passing_yards", "rushing_yards", "receiving_yards", // NFL core (future)
]);
const MID_RELIABILITY_PROPS = new Set([
  "threes", "three_pointers_made", "pra", "pts_reb_ast",
  "rbi", "runs", "singles",
  "points_nhl", "saves",
]);
const LOW_RELIABILITY_PROPS = new Set([
  "steals", "blocks", "stl_blk",
  "home_runs", "hr", "strikeouts", "ks", "pitcher_strikeouts",
  "first_basket", "first_td", "anytime_td",
  "goals",  // NHL goals — high variance
]);

export function getMarketReliability(
  betType: string,
  propType: string,
  direction: string,
  odds: number,
): number {
  // Game lines
  if (betType === "moneyline") {
    if (odds >= 200) return 0.5;        // longshot dog
    if (odds >= 130) return 0.7;        // mid dog
    return 0.95;                         // favorites / pickem
  }
  if (betType === "spread") return 0.85;
  if (betType === "total") return 0.78;

  // Player props — normalize key
  const key = (propType || "").toLowerCase().replace(/\s+/g, "_");

  // Special: under on volatile counting stats is the worst signal
  const isUnder = (direction || "").toLowerCase() === "under";
  if (LOW_RELIABILITY_PROPS.has(key)) {
    return isUnder ? 0.4 : 0.55;
  }
  if (MID_RELIABILITY_PROPS.has(key)) return 0.75;
  if (HIGH_RELIABILITY_PROPS.has(key)) return 0.95;

  // Unknown prop — treat as mid-low
  return 0.65;
}

// ── Quality + verdict tiering ──────────────────────────────
export function computeQualityScore(
  confidence: number,
  edge: number,
  reliability: number,
): number {
  const hitRateFactor = Math.max(0, (confidence - 0.5) * 2); // 0 at 50%, 1 at 100%
  return confidence * reliability * (1 + Math.max(0, edge)) * (0.5 + 0.5 * hitRateFactor);
}

export function tierVerdict(
  confidence: number,
  edge: number,
  reliability: number,
  betType: string,
  propType: string,
  direction: string,
  odds: number,
): "Strong" | "Lean" | "Pass" {
  const key = (propType || "").toLowerCase().replace(/\s+/g, "_");
  const isUnder = (direction || "").toLowerCase() === "under";

  // Absolute longshot cap — never surface +LONGSHOT_ODDS_MAX or longer.
  if (odds >= LONGSHOT_ODDS_MAX) return "Pass";

  const isLongshot = odds >= MID_LONGSHOT_ODDS_MIN;
  const isVolatileUnder = isUnder && LOW_RELIABILITY_PROPS.has(key);

  if (isLongshot) {
    if (
      confidence >= MID_LONGSHOT_CONF_MIN &&
      edge >= MID_LONGSHOT_EDGE_MIN &&
      reliability >= MID_LONGSHOT_RELIABILITY_MIN
    ) return "Strong";
    return "Pass";
  }
  if (isVolatileUnder) {
    if (confidence >= VOLATILE_UNDER_CONF_MIN && edge >= VOLATILE_UNDER_EDGE_MIN) return "Strong";
    return "Pass";
  }

  if (confidence >= PROB_STRONG && edge >= EDGE_STRONG_MIN && reliability >= RELIABILITY_STRONG_MIN) return "Strong";
  if (confidence >= PROB_LEAN && edge >= EDGE_LEAN_MIN && reliability >= RELIABILITY_LEAN_MIN) return "Lean";
  return "Pass";
}

export function buildReasoning(p: {
  bet_type: string;
  player_name: string;
  prop_type: string;
  line: number;
  direction: string;
  edge: number;
  confidence: number;
  ev_pct: number;
  reliability: number;
}): string {
  const edgePct = (p.edge * 100).toFixed(1);
  const conf = (p.confidence * 100).toFixed(0);
  const relTag = p.reliability >= 0.9 ? "high-signal market" : p.reliability >= 0.7 ? "stable market" : "volatile market";
  if (p.bet_type === "moneyline") {
    return `Model gives ${p.player_name} a ${conf}% win probability (${relTag}) — ${edgePct}% edge, ${p.ev_pct.toFixed(1)}% EV.`;
  }
  if (p.bet_type === "spread") {
    return `${p.player_name} ${p.direction === "home" ? "covers" : "fades"} the ${p.line} spread in ${conf}% of model sims (${edgePct}% edge, ${relTag}).`;
  }
  if (p.bet_type === "total") {
    return `Pace + matchup model projects ${p.direction.toUpperCase()} ${p.line} at ${conf}% probability — ${edgePct}% edge.`;
  }
  return `${p.player_name} ${p.direction} ${p.line} ${p.prop_type}: ${conf}% hit rate, ${edgePct}% edge (${relTag}).`;
}

// ── Primary scorer ────────────────────────────────────────
// Accepts raw model confidence (0-1 or 0-100). Performs:
//   1. Vig removal (if odds_opp supplied).
//   2. Calibration (if calibration supplied).
//   3. Reliability / verdict / quality-score assembly.
export interface ScoreInput {
  sport: string;
  bet_type: "prop" | "moneyline" | "spread" | "total";
  player_name: string;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type: string;
  line: number;
  spread_line?: number | null;
  total_line?: number | null;
  direction: string;
  odds: number;
  odds_opp?: number | null;
  // Raw confidence — either 0-100 (percent) or 0-1. We detect and normalize.
  raw_confidence: number;
  // Optional explicit calibration; if omitted, identity is used.
  calibration?: Calibration;
  // Optional reliability override (otherwise derived from market table).
  reliability?: number;
}

export function score(input: ScoreInput): ScoredPlay {
  // Normalize raw confidence to 0-1.
  const raw01 = clamp01(
    input.raw_confidence > 1 ? input.raw_confidence / 100 : input.raw_confidence,
  );
  const calibrated = input.calibration
    ? clamp01(applyCalibration(raw01, input.calibration))
    : raw01;

  const rawImplied = americanToImplied(input.odds);
  const fairImplied =
    input.odds_opp != null ? fairImpliedFromPair(input.odds, input.odds_opp) : rawImplied;

  const edge = calibrated - fairImplied;
  const evPct = calcEvPct(calibrated, input.odds);

  const reliability = input.reliability ?? getMarketReliability(input.bet_type, input.prop_type, input.direction, input.odds);
  const legacyScore = edge * calibrated;
  const qualityScore = computeQualityScore(calibrated, edge, reliability);
  const verdict = tierVerdict(calibrated, edge, reliability, input.bet_type, input.prop_type, input.direction, input.odds);
  const reasoning = buildReasoning({
    bet_type: input.bet_type,
    player_name: input.player_name,
    prop_type: input.prop_type,
    line: input.line,
    direction: input.direction,
    edge,
    confidence: calibrated,
    ev_pct: evPct,
    reliability,
  });

  return {
    sport: input.sport,
    bet_type: input.bet_type,
    player_name: input.player_name,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    home_team: input.home_team ?? null,
    away_team: input.away_team ?? null,
    prop_type: input.prop_type,
    line: input.line,
    spread_line: input.spread_line ?? null,
    total_line: input.total_line ?? null,
    direction: input.direction,
    odds: input.odds,
    odds_opp: input.odds_opp ?? null,
    projected_prob: calibrated,
    implied_prob: fairImplied,
    raw_implied_prob: rawImplied,
    edge,
    ev_pct: evPct,
    confidence: calibrated,
    raw_confidence: raw01,
    reliability,
    score: legacyScore,
    quality_score: qualityScore,
    verdict,
    reasoning,
  };
}

// Legacy shape for callers that already did their own calibration/vig work
// and just want to stuff a fully-formed row through reliability + verdict.
export function scorePrecomputed(
  play: Omit<ScoredPlay, "score" | "quality_score" | "verdict" | "reasoning" | "reliability" | "raw_confidence" | "raw_implied_prob" | "odds_opp"> & {
    reliability?: number;
    raw_confidence?: number;
    raw_implied_prob?: number;
    odds_opp?: number | null;
  },
): ScoredPlay {
  const reliability = play.reliability ?? getMarketReliability(play.bet_type, play.prop_type, play.direction, play.odds);
  const s = play.edge * play.confidence;
  const quality_score = computeQualityScore(play.confidence, play.edge, reliability);
  const verdict = tierVerdict(play.confidence, play.edge, reliability, play.bet_type, play.prop_type, play.direction, play.odds);
  const reasoning = buildReasoning({ ...play, reliability });
  return {
    ...play,
    odds_opp: play.odds_opp ?? null,
    raw_confidence: play.raw_confidence ?? play.confidence,
    raw_implied_prob: play.raw_implied_prob ?? play.implied_prob,
    reliability,
    score: s,
    quality_score,
    verdict,
    reasoning,
  } as ScoredPlay;
}

// ── Ranking + distribution with quality caps ──────────────
const PER_SPORT_CAP = 25;
const MAX_LOW_RELIABILITY_TOTAL = 0;
const FREE_PICKS_CAP = 30;
const TODAYS_EDGE_CAP = 5;
const DAILY_PICKS_CAP = 80;

export function rankAndDistribute(plays: ScoredPlay[]) {
  // 1. Hard floor: drop anything that fails the absolute minimums.
  const floorOk = plays.filter(
    (p) => p.confidence >= PROB_FLOOR && p.reliability >= RELIABILITY_FLOOR && p.edge > 0,
  );
  // 2. Reject anything that fails verdict tiering.
  const passing = floorOk.filter((p) => p.verdict !== "Pass");
  // 3. Sort by quality_score desc.
  const sorted = [...passing].sort((a, b) => b.quality_score - a.quality_score);

  // ── Free Picks: per-sport + low-reliability caps ──
  const sportCounts: Record<string, number> = {};
  let lowRelCount = 0;
  const freePicks: ScoredPlay[] = [];
  for (const p of sorted) {
    if (freePicks.length >= FREE_PICKS_CAP) break;
    sportCounts[p.sport] = sportCounts[p.sport] || 0;
    if (sportCounts[p.sport] >= PER_SPORT_CAP) continue;
    const isLow = p.reliability < 0.65;
    if (isLow && lowRelCount >= MAX_LOW_RELIABILITY_TOTAL) continue;
    freePicks.push(p);
    sportCounts[p.sport]++;
    if (isLow) lowRelCount++;
  }

  // ── Today's Edge: top 5 Strong picks, max 2 per sport for diversity ──
  const strongs = sorted.filter((p) => p.verdict === "Strong");
  const todaysEdge: ScoredPlay[] = [];
  const edgeSportCount: Record<string, number> = {};
  const edgeKeys = new Set<string>();
  const keyOf = (p: ScoredPlay) =>
    `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;

  for (const p of strongs) {
    if (todaysEdge.length >= TODAYS_EDGE_CAP) break;
    if ((edgeSportCount[p.sport] || 0) >= 2) continue;
    todaysEdge.push(p);
    edgeKeys.add(keyOf(p));
    edgeSportCount[p.sport] = (edgeSportCount[p.sport] || 0) + 1;
  }
  // Fallback 1: fill remaining Strong slots ignoring the per-sport cap.
  if (todaysEdge.length < TODAYS_EDGE_CAP) {
    for (const p of strongs) {
      if (todaysEdge.length >= TODAYS_EDGE_CAP) break;
      const k = keyOf(p);
      if (edgeKeys.has(k)) continue;
      todaysEdge.push(p);
      edgeKeys.add(k);
    }
  }
  // Fallback 2: fill with the best Lean picks if we STILL don't have 5 Strongs.
  // This prevents the carousel from silently rendering empty on slow slates.
  if (todaysEdge.length < TODAYS_EDGE_CAP) {
    for (const p of sorted) {
      if (todaysEdge.length >= TODAYS_EDGE_CAP) break;
      const k = keyOf(p);
      if (edgeKeys.has(k)) continue;
      todaysEdge.push(p);
      edgeKeys.add(k);
    }
  }

  // ── Daily Picks: top Strong + Lean up to cap ──
  const dailyPicks = sorted.slice(0, DAILY_PICKS_CAP);

  return { todaysEdge, dailyPicks, freePicks, sorted };
}

// Sanity checks
export function sanityCheck(plays: ScoredPlay[]) {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const p of plays) {
    const key = `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}`;
    if (seen.has(key)) issues.push(`duplicate: ${key}`);
    seen.add(key);
    if (p.confidence < 0 || p.confidence > 1) issues.push(`confidence OOB: ${key} = ${p.confidence}`);
    if (Math.abs(p.edge) > 0.5) issues.push(`edge >50%: ${key} = ${p.edge}`);
    if (!isFinite(p.ev_pct)) issues.push(`EV non-finite: ${key}`);
    if (p.reliability < 0.4 || p.reliability > 1) issues.push(`reliability OOB: ${key} = ${p.reliability}`);
  }
  return issues;
}
