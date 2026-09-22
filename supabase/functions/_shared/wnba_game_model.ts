/**
 * WNBA team-market model (moneyline / spread / total) — 25 explicit factors.
 *
 * Mirrors the architecture of `mlb_game_model.ts` deliberately: same group-budget
 * weighting, same drop-don't-default rule for missing inputs, same refusal to
 * emit anything that could be read as a win probability. Two sports, one set of
 * scoring semantics, so a score of 68 means the same thing on either tab.
 *
 * Every input here is something `_shared/wnba_model.ts` already retrieves —
 * efficiency ratings, pace, home/away splits, rest and back-to-backs, travel,
 * and injury-report minutes.
 *
 * See docs/claude/sentinel-backend-rules.md ("Protect predictive integrity",
 * "Reduce false confidence").
 */

export const WNBA_GAME_MODEL_VERSION = "wnba_game_model.v1";

export type WnbaTeamMarket = "moneyline" | "spread" | "total";

export type WnbaFactorGroup =
  | "efficiency"
  | "form"
  | "situational"
  | "availability"
  | "environment";

export interface WnbaGameFactor {
  key: string;
  label: string;
  group: WnbaFactorGroup;
  team1Score: number;
  team2Score: number;
  weight: number;
  detail: string;
}

export interface WnbaTeamModelInput {
  name: string;
  games?: number | null;
  winRate?: number | null;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
  netPoints?: number | null;

  recentGames?: number | null;
  recentPointsFor?: number | null;
  recentPointsAgainst?: number | null;
  recentNetPoints?: number | null;

  pace?: number | null;
  offensiveRating?: number | null;
  defensiveRating?: number | null;

  /** Net points in this team's own venue split (home split for the home side). */
  venueNetPoints?: number | null;
  venueWinRate?: number | null;

  restDays?: number | null;
  backToBack?: boolean | null;
  /** True when the team's previous game was in a different city. */
  travelled?: boolean | null;

  unavailableMinutes?: number | null;
  questionableMinutes?: number | null;
  availabilityResolved?: boolean | null;

  isHome?: boolean;
}

export interface WnbaGameModelInput {
  market: WnbaTeamMarket;
  team1: WnbaTeamModelInput;
  team2: WnbaTeamModelInput;
  /** Spread from team1's perspective. Required for the spread market. */
  team1Spread?: number | null;
  /** Posted game total. Required for the total market. */
  totalLine?: number | null;
  /** "over" | "under" — which side of the total is being evaluated. */
  totalSide?: "over" | "under" | null;
}

export interface WnbaGameModelResult {
  modelVersion: string;
  market: WnbaTeamMarket;
  /** For total markets this is the score for `totalSide`, not for team1. */
  team1Score: number;
  predictedMargin: number | null;
  projectedTotal: number | null;
  verdict: string;
  factors: WnbaGameFactor[];
  missingInputs: string[];
  dataCoverage: number;
  scoreKind: "heuristic_score";
}

/**
 * Efficiency carries the most weight because per-possession ratings are the
 * most stable predictor in basketball. Form is real but noisier. Availability
 * is small in budget yet decisive when a starter is out, which is why its
 * factors are scaled by minutes rather than headcount.
 */
export const WNBA_GROUP_BUDGET: Record<WnbaFactorGroup, number> = {
  efficiency: 34,
  form: 24,
  situational: 18,
  availability: 14,
  environment: 10,
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function wnbaScoreFromDiff(difference: number, multiplier: number): number {
  if (!Number.isFinite(difference)) return 50;
  return Math.max(10, Math.min(90, Math.round(50 + difference * multiplier)));
}

function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

interface PendingWnbaFactor {
  key: string;
  label: string;
  group: WnbaFactorGroup;
  team1Score: number;
  detail: string;
  share: number;
}

export function buildWnbaGameModel(input: WnbaGameModelInput): WnbaGameModelResult | null {
  const t1 = input.team1;
  const t2 = input.team2;
  const pending: PendingWnbaFactor[] = [];
  const missingInputs: string[] = [];

  const add = (
    key: string, label: string, group: WnbaFactorGroup,
    team1Score: number, share: number, detail: string,
  ) => pending.push({ key, label, group, team1Score, share, detail });

  const miss = (key: string) => { if (!missingInputs.includes(key)) missingInputs.push(key); };

  const pair = (
    key: string, label: string, group: WnbaFactorGroup, share: number,
    a: number | null, b: number | null, multiplier: number,
    detail: (a: number, b: number) => string,
    lowerIsBetter = false,
  ) => {
    if (a === null || b === null) { miss(key); return; }
    const diff = lowerIsBetter ? b - a : a - b;
    add(key, label, group, wnbaScoreFromDiff(diff, multiplier), share, detail(a, b));
  };

  // ------------------------------------------------------------- EFFICIENCY
  const t1Ortg = finite(t1.offensiveRating);
  const t2Ortg = finite(t2.offensiveRating);
  const t1Drtg = finite(t1.defensiveRating);
  const t2Drtg = finite(t2.defensiveRating);

  // Net rating is the headline efficiency number and takes the largest share.
  if (t1Ortg !== null && t2Ortg !== null && t1Drtg !== null && t2Drtg !== null) {
    const net1 = t1Ortg - t1Drtg;
    const net2 = t2Ortg - t2Drtg;
    add("net_rating", "Net rating", "efficiency",
      wnbaScoreFromDiff(net1 - net2, 2.2), 34,
      `${t1.name} net rating ${fmt(net1)} vs ${t2.name} ${fmt(net2)} per 100 possessions.`);
  } else {
    miss("net_rating");
  }

  pair("offensive_rating", "Offensive rating", "efficiency", 20, t1Ortg, t2Ortg, 1.6,
    (a, b) => `${t1.name} ${fmt(a)} points per 100 vs ${t2.name} ${fmt(b)}.`);

  pair("defensive_rating", "Defensive rating", "efficiency", 20, t1Drtg, t2Drtg, 1.6,
    (a, b) => `${t1.name} allows ${fmt(a)} per 100 vs ${t2.name} ${fmt(b)}. Lower is better.`, true);

  pair("season_net_points", "Season point differential", "efficiency", 14,
    finite(t1.netPoints), finite(t2.netPoints), 2.4,
    (a, b) => `${t1.name} ${a >= 0 ? "+" : ""}${fmt(a)} per game vs ${t2.name} ${b >= 0 ? "+" : ""}${fmt(b)}.`);

  pair("points_for", "Scoring output", "efficiency", 6,
    finite(t1.pointsFor), finite(t2.pointsFor), 1.1,
    (a, b) => `${t1.name} ${fmt(a)} points/game vs ${t2.name} ${fmt(b)}.`);

  pair("points_against", "Points allowed", "efficiency", 6,
    finite(t1.pointsAgainst), finite(t2.pointsAgainst), 1.1,
    (a, b) => `${t1.name} allows ${fmt(a)} vs ${t2.name} ${fmt(b)}. Lower is better.`, true);

  // -------------------------------------------------------------------- FORM
  pair("recent_net_points", "Recent point differential", "form", 34,
    finite(t1.recentNetPoints), finite(t2.recentNetPoints), 2.0,
    (a, b) => `Over the recent window ${t1.name} is ${a >= 0 ? "+" : ""}${fmt(a)} vs ${t2.name} ${b >= 0 ? "+" : ""}${fmt(b)}.`);

  pair("win_rate", "Season win rate", "form", 22,
    finite(t1.winRate), finite(t2.winRate), 42,
    (a, b) => `${t1.name} ${fmt(a * 100, 0)}% wins vs ${t2.name} ${fmt(b * 100, 0)}%.`);

  pair("recent_points_for", "Recent scoring", "form", 14,
    finite(t1.recentPointsFor), finite(t2.recentPointsFor), 0.9,
    (a, b) => `${t1.name} ${fmt(a)} recent points/game vs ${t2.name} ${fmt(b)}.`);

  pair("recent_points_against", "Recent defence", "form", 14,
    finite(t1.recentPointsAgainst), finite(t2.recentPointsAgainst), 0.9,
    (a, b) => `${t1.name} allowing ${fmt(a)} recently vs ${t2.name} ${fmt(b)}. Lower is better.`, true);

  // Trend = how far recent form sits from a team's OWN season baseline, split
  // into its offensive and defensive halves.
  //
  // These deliberately replace a single composite "form trend" factor rather
  // than sitting alongside one: net trend is exactly offensive trend minus
  // defensive trend, so scoring all three would count the same movement twice
  // (scoring audit checklist, "overlapping features effectively counted
  // twice"). Split apart they answer genuinely different questions — a team
  // scoring more and a team defending better are not the same read.
  //
  // Both are weighted modestly: a hot streak is the noisiest signal on this
  // list, and over-weighting it is the classic way a model chases variance.
  const trendOf = (recent: number | null, season: number | null): number | null =>
    recent === null || season === null ? null : recent - season;

  const off1 = trendOf(finite(t1.recentPointsFor), finite(t1.pointsFor));
  const off2 = trendOf(finite(t2.recentPointsFor), finite(t2.pointsFor));
  if (off1 !== null && off2 !== null) {
    add("offensive_trend", "Offensive trend vs baseline", "form",
      wnbaScoreFromDiff(off1 - off2, 1.2), 9,
      `${t1.name} scoring ${off1 >= 0 ? "+" : ""}${fmt(off1)} vs its own season average; ${t2.name} ${off2 >= 0 ? "+" : ""}${fmt(off2)}.`);
  } else {
    miss("offensive_trend");
  }

  const def1 = trendOf(finite(t1.recentPointsAgainst), finite(t1.pointsAgainst));
  const def2 = trendOf(finite(t2.recentPointsAgainst), finite(t2.pointsAgainst));
  if (def1 !== null && def2 !== null) {
    // Conceding fewer than your baseline is improvement, so lower is better.
    add("defensive_trend", "Defensive trend vs baseline", "form",
      wnbaScoreFromDiff(def2 - def1, 1.2), 9,
      `${t1.name} conceding ${def1 >= 0 ? "+" : ""}${fmt(def1)} vs its own season average; ${t2.name} ${def2 >= 0 ? "+" : ""}${fmt(def2)}. Lower is better.`);
  } else {
    miss("defensive_trend");
  }

  // ------------------------------------------------------------- SITUATIONAL
  // Venue split: each team is judged on the split it will actually play in.
  pair("venue_net_points", "Home/road split differential", "situational", 30,
    finite(t1.venueNetPoints), finite(t2.venueNetPoints), 2.0,
    (a, b) => `${t1.name} ${a >= 0 ? "+" : ""}${fmt(a)} in its ${t1.isHome ? "home" : "road"} split vs ${t2.name} ${b >= 0 ? "+" : ""}${fmt(b)} in its ${t2.isHome ? "home" : "road"} split.`);

  pair("venue_win_rate", "Home/road win rate", "situational", 16,
    finite(t1.venueWinRate), finite(t2.venueWinRate), 34,
    (a, b) => `${t1.name} ${fmt(a * 100, 0)}% in that split vs ${t2.name} ${fmt(b * 100, 0)}%.`);

  // Venue split RELATIVE to a team's own season baseline. Distinct from the
  // absolute split above: that asks "how good are they at home", this asks
  // "how much does playing here change them" — the fortress / poor-traveller
  // signal, which is invisible in an absolute number for a strong team that is
  // merely ordinary at home.
  const venueDelta = (team: WnbaTeamModelInput): number | null => {
    const venue = finite(team.venueNetPoints);
    const season = finite(team.netPoints);
    return venue === null || season === null ? null : venue - season;
  };
  const vd1 = venueDelta(t1);
  const vd2 = venueDelta(t2);
  if (vd1 !== null && vd2 !== null) {
    add("venue_split_delta", "Venue split vs own baseline", "situational",
      wnbaScoreFromDiff(vd1 - vd2, 1.5), 10,
      `${t1.name} is ${vd1 >= 0 ? "+" : ""}${fmt(vd1)} in its ${t1.isHome ? "home" : "road"} split versus its own season average; ${t2.name} ${vd2 >= 0 ? "+" : ""}${fmt(vd2)}.`);
  } else {
    miss("venue_split_delta");
  }

  // Rest is non-linear in a compressed WNBA schedule: one day off is normal,
  // zero is a genuine penalty, three-plus adds little.
  const restScore = (days: number | null, b2b: boolean | null): number | null => {
    if (b2b === true) return 36;
    if (days === null) return null;
    if (days <= 0) return 38;
    if (days === 1) return 48;
    if (days <= 3) return 52;
    return 51;
  };
  const rs1 = restScore(finite(t1.restDays), t1.backToBack ?? null);
  const rs2 = restScore(finite(t2.restDays), t2.backToBack ?? null);
  if (rs1 !== null && rs2 !== null) {
    add("rest", "Rest advantage", "situational", wnbaScoreFromDiff(rs1 - rs2, 1), 24,
      `${t1.name} ${t1.backToBack ? "on a back-to-back" : `${t1.restDays ?? "?"} day(s) rest`}; ${t2.name} ${t2.backToBack ? "on a back-to-back" : `${t2.restDays ?? "?"} day(s) rest`}.`);
  } else {
    miss("rest");
  }

  const b2b1 = t1.backToBack === true;
  const b2b2 = t2.backToBack === true;
  if (b2b1 !== b2b2) {
    add("back_to_back", "Back-to-back", "situational", b2b1 ? 40 : 60, 18,
      `${b2b1 ? t1.name : t2.name} is playing a second game on consecutive days.`);
  } else if (t1.backToBack === null || t2.backToBack === null) {
    miss("back_to_back");
  }

  const tv1 = t1.travelled === true;
  const tv2 = t2.travelled === true;
  if (tv1 !== tv2) {
    add("travel", "Travel", "situational", tv1 ? 46 : 54, 12,
      `${tv1 ? t1.name : t2.name} arrives from another city since its last game.`);
  } else if (t1.travelled === null || t2.travelled === null) {
    miss("travel");
  }

  // ------------------------------------------------------------ AVAILABILITY
  // Scaled by MINUTES, not by player count: losing one 34-minute starter matters
  // far more than three deep-bench absences, and a headcount would say otherwise.
  pair("unavailable_minutes", "Ruled-out minutes", "availability", 60,
    finite(t1.unavailableMinutes), finite(t2.unavailableMinutes), 0.55,
    (a, b) => `${t1.name} missing ${Math.round(a)} minutes/game of ruled-out players vs ${t2.name} ${Math.round(b)}.`, true);

  pair("questionable_minutes", "Questionable minutes", "availability", 25,
    finite(t1.questionableMinutes), finite(t2.questionableMinutes), 0.25,
    (a, b) => `${t1.name} has ${Math.round(a)} minutes/game listed questionable vs ${t2.name} ${Math.round(b)}.`, true);

  // Records whether the injury report actually resolved. Zero weight — it
  // reports confidence in the availability factors without tilting the score.
  const res1 = t1.availabilityResolved;
  const res2 = t2.availabilityResolved;
  if (res1 !== undefined || res2 !== undefined) {
    const bothResolved = res1 === true && res2 === true;
    add("availability_quality", "Injury report coverage", "availability", 50, 0,
      bothResolved
        ? "Injury report resolved for both teams."
        : "Injury report incomplete — availability factors are weaker than usual for this game.");
  }

  // ------------------------------------------------------------- ENVIRONMENT
  const t1Home = t1.isHome === true;
  const t2Home = t2.isHome === true;
  if (t1Home !== t2Home) {
    // WNBA home teams win around 56% — a slightly larger edge than MLB.
    add("home_court", "Home court advantage", "environment", t1Home ? 56 : 44, 55,
      t1Home ? `${t1.name} at home.` : `${t2.name} at home.`);
  } else {
    miss("home_court");
  }

  const p1 = finite(t1.pace);
  const p2 = finite(t2.pace);
  if (p1 !== null && p2 !== null) {
    // Pace does not decide a winner — more possessions simply give the better
    // team more chances to express its edge, shrinking upset variance.
    const betterTeam = Math.sign((finite(t1.netPoints) ?? 0) - (finite(t2.netPoints) ?? 0));
    const expectedPace = (p1 + p2) / 2;
    const tilt = ((expectedPace - 80) / 10) * betterTeam;
    add("pace", "Expected pace", "environment", wnbaScoreFromDiff(tilt, 6), 24,
      `Projected ${fmt(expectedPace)} possessions. ${expectedPace >= 82 ? "Faster game gives the stronger side more chances to separate" : expectedPace <= 76 ? "Slower game compresses the margin" : "Neutral tempo"}.`);

    // Tempo control, which is a different question from total possessions.
    // The projected pace lands between the two teams; whichever side sits
    // closer to it is playing nearer its own rhythm, while the other is pulled
    // out of shape. Small weight — it is a nudge, not a thesis.
    const drift1 = Math.abs(p1 - expectedPace);
    const drift2 = Math.abs(p2 - expectedPace);
    add("pace_mismatch", "Tempo control", "environment",
      wnbaScoreFromDiff(drift2 - drift1, 7), 10,
      `${t1.name} plays at ${fmt(p1)} and ${t2.name} at ${fmt(p2)}; the projected ${fmt(expectedPace)} sits closer to ${drift1 <= drift2 ? t1.name : t2.name}'s natural tempo.`);
  } else {
    miss("pace");
    miss("pace_mismatch");
  }

  const g1 = finite(t1.games);
  const g2 = finite(t2.games);
  if (g1 !== null && g2 !== null) {
    const minGames = Math.min(g1, g2);
    add("sample_size", "Season sample size", "environment", 50, 0,
      `${Math.round(minGames)} games of season data on the lighter side.${minGames < 10 ? " Small sample — rates are still volatile." : ""}`);
  }

  if (pending.length === 0) return null;

  const shareByGroup = new Map<WnbaFactorGroup, number>();
  for (const f of pending) {
    shareByGroup.set(f.group, (shareByGroup.get(f.group) ?? 0) + f.share);
  }

  const factors: WnbaGameFactor[] = pending.map((f) => {
    const groupShare = shareByGroup.get(f.group) ?? 0;
    const weight = groupShare > 0 ? (WNBA_GROUP_BUDGET[f.group] * f.share) / groupShare : 0;
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      team1Score: f.team1Score,
      team2Score: 100 - f.team1Score,
      weight: Math.round(weight * 100) / 100,
      detail: f.detail,
    };
  });

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const baseScore = totalWeight > 0
    ? Math.round(factors.reduce((sum, f) => sum + f.team1Score * f.weight, 0) / totalWeight)
    : 50;

  const maxBudget = Object.values(WNBA_GROUP_BUDGET).reduce((a, b) => a + b, 0);
  const coveredBudget = [...shareByGroup.keys()].reduce((sum, g) => sum + WNBA_GROUP_BUDGET[g], 0);
  const dataCoverage = Math.round((coveredBudget / maxBudget) * 100) / 100;

  const predictedMargin = buildWnbaMargin(t1, t2);
  const projectedTotal = buildWnbaTotal(t1, t2);

  if (input.market === "spread") {
    const spread = finite(input.team1Spread);
    if (spread === null || predictedMargin === null) return null;
    const team1Score = wnbaScoreFromDiff(predictedMargin + spread, 4.5);
    return {
      modelVersion: WNBA_GAME_MODEL_VERSION, market: "spread", team1Score,
      predictedMargin, projectedTotal,
      verdict: wnbaVerdict(team1Score, t1.name, t2.name),
      factors, missingInputs, dataCoverage, scoreKind: "heuristic_score",
    };
  }

  if (input.market === "total") {
    const line = finite(input.totalLine);
    if (line === null || projectedTotal === null) return null;
    const side = input.totalSide === "under" ? "under" : "over";
    const edge = side === "over" ? projectedTotal - line : line - projectedTotal;
    const score = wnbaScoreFromDiff(edge, 4);
    return {
      modelVersion: WNBA_GAME_MODEL_VERSION, market: "total", team1Score: score,
      predictedMargin, projectedTotal,
      verdict: score >= 58 ? `LEAN ${side.toUpperCase()}` : score <= 42 ? `LEAN ${side === "over" ? "UNDER" : "OVER"}` : "RISKY",
      factors, missingInputs, dataCoverage, scoreKind: "heuristic_score",
    };
  }

  return {
    modelVersion: WNBA_GAME_MODEL_VERSION, market: "moneyline", team1Score: baseScore,
    predictedMargin, projectedTotal,
    verdict: wnbaVerdict(baseScore, t1.name, t2.name),
    factors, missingInputs, dataCoverage, scoreKind: "heuristic_score",
  };
}

function buildWnbaMargin(t1: WnbaTeamModelInput, t2: WnbaTeamModelInput): number | null {
  const n1 = finite(t1.netPoints);
  const n2 = finite(t2.netPoints);
  if (n1 === null || n2 === null) return null;

  let margin = (n1 - n2) * 0.62;

  const r1 = finite(t1.recentNetPoints);
  const r2 = finite(t2.recentNetPoints);
  if (r1 !== null && r2 !== null) margin += ((r1 - r2) - (n1 - n2)) * 0.18;

  if (t1.isHome === true && t2.isHome !== true) margin += 1.9;
  if (t2.isHome === true && t1.isHome !== true) margin -= 1.9;

  if (t1.backToBack === true && t2.backToBack !== true) margin -= 1.4;
  if (t2.backToBack === true && t1.backToBack !== true) margin += 1.4;

  const u1 = finite(t1.unavailableMinutes) ?? 0;
  const u2 = finite(t2.unavailableMinutes) ?? 0;
  margin -= (u1 - u2) * 0.045;

  return Math.round(margin * 10) / 10;
}

function buildWnbaTotal(t1: WnbaTeamModelInput, t2: WnbaTeamModelInput): number | null {
  const f1 = finite(t1.pointsFor);
  const f2 = finite(t2.pointsFor);
  const a1 = finite(t1.pointsAgainst);
  const a2 = finite(t2.pointsAgainst);
  if (f1 === null || f2 === null || a1 === null || a2 === null) return null;
  // Each side's expected output is the midpoint of its own offence and the
  // opponent's defence.
  const projected = (f1 + a2) / 2 + (f2 + a1) / 2;
  return Math.round(projected * 10) / 10;
}

function wnbaVerdict(team1Score: number, team1Name: string, team2Name: string): string {
  if (team1Score >= 58) return `LEAN ${team1Name}`;
  if (team1Score <= 42) return `LEAN ${team2Name}`;
  return "RISKY";
}

export const WNBA_MODEL_FACTOR_KEYS = [
  // efficiency (6)
  "net_rating", "offensive_rating", "defensive_rating", "season_net_points",
  "points_for", "points_against",
  // form (6)
  "recent_net_points", "win_rate", "recent_points_for", "recent_points_against",
  "offensive_trend", "defensive_trend",
  // situational (6)
  "venue_net_points", "venue_win_rate", "venue_split_delta", "rest", "back_to_back", "travel",
  // availability (3)
  "unavailable_minutes", "questionable_minutes", "availability_quality",
  // environment (4)
  "home_court", "pace", "pace_mismatch", "sample_size",
] as const;
