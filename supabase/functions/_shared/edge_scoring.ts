// Unified scoring + verdict tiering for the daily slate engine.
// score = edge_pct * confidence (both 0-1 scale; result also 0-1).

export interface ScoredPlay {
  sport: string;
  bet_type: "prop" | "moneyline" | "spread" | "total";
  player_name: string; // for game-line picks this is "Team A vs Team B"
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type: string; // "moneyline" | "spread" | "total" | actual prop key
  line: number;
  spread_line?: number | null;
  total_line?: number | null;
  direction: string; // "over"/"under"/"home"/"away"
  odds: number; // american
  projected_prob: number; // 0-1
  implied_prob: number; // 0-1
  edge: number; // 0-1 (projected - implied)
  ev_pct: number; // expected value % per $1
  confidence: number; // 0-1
  score: number; // edge * confidence, 0-1
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

export function tierVerdict(confidence: number): "Strong" | "Lean" | "Pass" {
  if (confidence >= 0.75) return "Strong";
  if (confidence >= 0.65) return "Lean";
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
}): string {
  const edgePct = (p.edge * 100).toFixed(1);
  const conf = (p.confidence * 100).toFixed(0);
  if (p.bet_type === "moneyline") {
    return `Model gives ${p.player_name} a ${conf}% win probability vs market — ${edgePct}% edge, ${p.ev_pct.toFixed(1)}% EV.`;
  }
  if (p.bet_type === "spread") {
    return `${p.player_name} ${p.direction === "home" ? "covers" : "fades"} the ${p.line} spread in ${conf}% of model sims (${edgePct}% edge).`;
  }
  if (p.bet_type === "total") {
    return `Pace + matchup model projects ${p.direction.toUpperCase()} ${p.line} at ${conf}% probability — ${edgePct}% edge.`;
  }
  return `${p.player_name} ${p.direction} ${p.line} ${p.prop_type}: ${conf}% hit rate, ${edgePct}% edge over the line.`;
}

export function score(play: Omit<ScoredPlay, "score" | "verdict" | "reasoning">): ScoredPlay {
  const s = play.edge * play.confidence;
  const verdict = tierVerdict(play.confidence);
  const reasoning = buildReasoning(play);
  return { ...play, score: s, verdict, reasoning };
}

export function rankAndDistribute(plays: ScoredPlay[]) {
  const sorted = [...plays].sort((a, b) => b.score - a.score);

  const todaysEdgeBySport: Record<string, ScoredPlay[]> = {};
  for (const p of sorted) {
    if (p.confidence < 0.75) continue;
    todaysEdgeBySport[p.sport] = todaysEdgeBySport[p.sport] || [];
    if (todaysEdgeBySport[p.sport].length < 5) todaysEdgeBySport[p.sport].push(p);
  }
  const todaysEdge = Object.values(todaysEdgeBySport).flat();

  const dailyPicks = sorted.filter((p) => p.confidence >= 0.7).slice(0, 20);
  const freePicks = sorted.filter((p) => p.confidence >= 0.65).slice(0, 30);

  return { todaysEdge, dailyPicks, freePicks, sorted };
}

// Sanity checks for validation tooling
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
  }
  return issues;
}
