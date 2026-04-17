// Unified scoring + verdict tiering for the daily slate engine.
// qualityScore = confidence * reliability * (1 + edge) * hitRateFactor
// All probabilities are 0-1 scale.

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
  projected_prob: number;
  implied_prob: number;
  edge: number;
  ev_pct: number;
  confidence: number;
  reliability: number;       // 0.4-1.0 market reliability
  score: number;             // legacy edge*confidence
  quality_score: number;     // composite curated score
  verdict: "Strong" | "Lean" | "Pass";
  reasoning: string;
}

export function americanToImpliedProb(odds: number): number {
  if (!odds) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function calcEv(projectedProb: number, americanOdds: number): number {
  const decimal = americanOdds > 0 ? americanOdds / 100 + 1 : 100 / -americanOdds + 1;
  return (projectedProb * (decimal - 1) - (1 - projectedProb)) * 100;
}

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
  odds: number
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
  reliability: number
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
  odds: number
): "Strong" | "Lean" | "Pass" {
  const key = (propType || "").toLowerCase().replace(/\s+/g, "_");
  const isUnder = (direction || "").toLowerCase() === "under";

  // Hard gate: longshots (any market with +250 or longer odds) require elite numbers
  const isLongshot = odds >= 250;
  // Hard gate: volatile-market unders need stricter numbers
  const isVolatileUnder = isUnder && LOW_RELIABILITY_PROPS.has(key);
  if (isLongshot) {
    if (confidence >= 0.72 && edge >= 0.06 && reliability >= 0.65) return "Strong";
    return "Pass";
  }
  if (isVolatileUnder) {
    if (confidence >= 0.70 && edge >= 0.06) return "Strong";
    return "Pass";
  }

  if (confidence >= 0.65 && edge >= 0.03 && reliability >= 0.70) return "Strong";
  if (confidence >= 0.60 && edge >= 0.025 && reliability >= 0.65) return "Lean";
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

export function score(
  play: Omit<ScoredPlay, "score" | "quality_score" | "verdict" | "reasoning" | "reliability"> & { reliability?: number }
): ScoredPlay {
  const reliability = play.reliability ?? getMarketReliability(play.bet_type, play.prop_type, play.direction, play.odds);
  const s = play.edge * play.confidence;
  const quality_score = computeQualityScore(play.confidence, play.edge, reliability);
  const verdict = tierVerdict(play.confidence, play.edge, reliability, play.bet_type, play.prop_type, play.direction, play.odds);
  const reasoning = buildReasoning({ ...play, reliability });
  return { ...play, reliability, score: s, quality_score, verdict, reasoning };
}

// ── Ranking + distribution with quality caps ──────────────
const PER_SPORT_CAP = 8;
const MAX_LOW_RELIABILITY_TOTAL = 1;
const FREE_PICKS_CAP = 20;
const TODAYS_EDGE_CAP = 5;
const DAILY_PICKS_CAP = 20;

export function rankAndDistribute(plays: ScoredPlay[]) {
  // 1. Hard floor: drop anything that fails the absolute minimums
  const floorOk = plays.filter(
    (p) => p.confidence >= 0.65 && p.reliability >= 0.70 && p.edge > 0
  );
  // 2. Reject anything that fails verdict tiering
  const passing = floorOk.filter((p) => p.verdict !== "Pass");
  // 3. Sort by quality_score desc
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

  // ── Today's Edge: top 5 globally, Strong only ──
  const todaysEdge = sorted.filter((p) => p.verdict === "Strong").slice(0, TODAYS_EDGE_CAP);

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
