/**
 * MLB team-market model (moneyline / spread) — 29 explicit factors.
 *
 * Replaces the 4-factor `mlb_team_market_projection.ts` path. Every factor here
 * runs on an input that `_shared/mlb_data.ts` already fetches — pitcher recent
 * form and workload, platoon splits, bullpen fatigue, pitch-type whiff
 * matchups, park run factor and weather were all being retrieved and then
 * discarded by the old model.
 *
 * Design rules (docs/claude/sentinel-backend-rules.md):
 *
 *  - Pure and deterministic. No I/O, no clock reads, no randomness. Same input
 *    always produces the same score, so results are reproducible and testable.
 *  - Every factor is named, weighted, and carries the numbers behind it in
 *    `detail`, so a contribution can always be audited.
 *  - A factor with missing input is DROPPED, not defaulted to 50. Defaulting to
 *    neutral silently dilutes a real signal toward the mean; dropping it and
 *    renormalising the remaining weights keeps the surviving factors honest and
 *    records the gap in `missingInputs`.
 *  - Weights are grouped so correlated factors cannot compound. ERA, WHIP, H/9
 *    and recent ERA all measure starter quality; individually they are small and
 *    the GROUP is what carries weight. This is the double-counting guard the
 *    scoring audit checklist calls for.
 *  - The output is a directional heuristic score, never a win probability.
 *    Probability claims require out-of-sample calibration evidence for an
 *    immutable model_version — see docs/claude/model-validation-runbook.md.
 */

export const MLB_GAME_MODEL_VERSION = "mlb_game_model.v1";

export type MlbTeamMarket = "moneyline" | "spread";

export type MlbFactorGroup =
  | "offense"
  | "starter"
  | "bullpen"
  | "environment";

export interface MlbFactor {
  key: string;
  label: string;
  group: MlbFactorGroup;
  /** 0-100 from team1's perspective. 50 is dead neutral. */
  team1Score: number;
  team2Score: number;
  weight: number;
  detail: string;
}

export interface MlbHandSplit {
  hand: "L" | "R";
  plateAppearances: number;
  strikeoutRate: number | null;
  walkRate: number | null;
  ops: number | null;
}

export interface MlbTeamModelInput {
  name: string;
  /** Season batting */
  runsPerGame?: number | null;
  ops?: number | null;
  battingAverage?: number | null;
  strikeoutRate?: number | null;
  walkRate?: number | null;
  gamesPlayed?: number | null;
  splitVsPitcherHand?: MlbHandSplit | null;
  lineupConfirmed?: boolean | null;

  /** Probable starter */
  starterName?: string | null;
  starterHand?: "L" | "R" | null;
  starterEra?: number | null;
  starterWhip?: number | null;
  starterK9?: number | null;
  starterBb9?: number | null;
  starterH9?: number | null;
  starterInningsPitched?: number | null;
  starterRecentEra?: number | null;
  starterRecentWhip?: number | null;
  starterRecentK9?: number | null;
  /** Mean outs recorded over the last 3 starts — proxy for bullpen exposure. */
  starterAvgOutsLast3?: number | null;
  starterDaysRest?: number | null;
  starterPitchesLastStart?: number | null;
  starterAvgPitchesLast3?: number | null;
  /**
   * Opponent whiff rate on this starter's actual pitch mix minus their overall
   * whiff rate. Positive = this starter's mix misses more bats than the
   * opposing lineup usually whiffs at.
   */
  pitchMixWhiffEdge?: number | null;

  /** Bullpen */
  bullpenEra?: number | null;
  bullpenFreshness?: number | null;
  bullpenTaxedCount?: number | null;
  bullpenPitchesLastTwoDays?: number | null;

  isHome?: boolean;
}

export interface MlbGameModelInput {
  market: MlbTeamMarket;
  team1: MlbTeamModelInput;
  team2: MlbTeamModelInput;
  /** Spread line from team1's perspective, e.g. -1.5. Required for spread. */
  team1Spread?: number | null;
  parkRunFactor?: number | null;
  temperatureF?: number | null;
  windMph?: number | null;
  windDirection?: string | null;
  roofType?: string | null;
}

export interface MlbGameModelResult {
  modelVersion: string;
  market: MlbTeamMarket;
  team1Score: number;
  predictedMargin: number | null;
  verdict: string;
  factors: MlbFactor[];
  missingInputs: string[];
  /** Share of total possible weight that had real data behind it (0-1). */
  dataCoverage: number;
  /**
   * Always "heuristic_score". This model has no out-of-sample calibration, so
   * the caller must never present its output as a win probability.
   */
  scoreKind: "heuristic_score";
}

/**
 * Group weight budgets. A group's budget is split across whichever of its
 * factors have data, so four starter factors do not out-vote the entire offense
 * simply by being numerous.
 *
 * Starter carries the largest budget because in a single MLB game the probable
 * starter is the highest-variance-reducing known input; season team offense is
 * next; bullpen and environment are real but second-order over one game.
 */
export const MLB_GROUP_BUDGET: Record<MlbFactorGroup, number> = {
  starter: 38,
  offense: 34,
  bullpen: 14,
  environment: 14,
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Maps a raw differential onto 10-90. Clamped deliberately: no single factor may
 * express certainty, because no single factor earns it. `multiplier` converts
 * the stat's natural units into score points.
 */
export function scoreFromDiff(difference: number, multiplier: number): number {
  if (!Number.isFinite(difference)) return 50;
  return Math.max(10, Math.min(90, Math.round(50 + difference * multiplier)));
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

interface PendingFactor {
  key: string;
  label: string;
  group: MlbFactorGroup;
  team1Score: number;
  detail: string;
  /** Relative importance WITHIN its group. */
  share: number;
}

export function buildMlbGameModel(input: MlbGameModelInput): MlbGameModelResult | null {
  const t1 = input.team1;
  const t2 = input.team2;
  const pending: PendingFactor[] = [];
  const missingInputs: string[] = [];

  const add = (
    key: string,
    label: string,
    group: MlbFactorGroup,
    team1Score: number,
    share: number,
    detail: string,
  ) => pending.push({ key, label, group, team1Score, share, detail });

  const miss = (key: string) => { if (!missingInputs.includes(key)) missingInputs.push(key); };

  /**
   * Adds a factor only when BOTH sides have the input. A one-sided comparison is
   * not a comparison — scoring it would invent an edge out of missing data.
   */
  const pair = (
    key: string,
    label: string,
    group: MlbFactorGroup,
    share: number,
    a: number | null,
    b: number | null,
    multiplier: number,
    detail: (a: number, b: number) => string,
    /** true when a LOWER value is better for team1 (ERA, WHIP, K-rate…) */
    lowerIsBetter = false,
  ) => {
    if (a === null || b === null) { miss(key); return; }
    const diff = lowerIsBetter ? b - a : a - b;
    add(key, label, group, scoreFromDiff(diff, multiplier), share, detail(a, b));
  };

  // ---------------------------------------------------------------- OFFENSE
  const t1Rpg = finite(t1.runsPerGame);
  const t2Rpg = finite(t2.runsPerGame);
  // Runs/game is the single most direct expression of scoring ability, so it
  // takes the largest share of the offense budget.
  pair("runs_per_game", "Current-season run production", "offense", 30, t1Rpg, t2Rpg, 16,
    (a, b) => `${t1.name} ${fmt(a)} runs/game vs ${t2.name} ${fmt(b)}.`);

  pair("team_ops", "Current-season OPS", "offense", 22,
    finite(t1.ops), finite(t2.ops), 150,
    (a, b) => `${t1.name} OPS ${fmt(a, 3)} vs ${t2.name} OPS ${fmt(b, 3)}.`);

  pair("team_avg", "Team batting average", "offense", 8,
    finite(t1.battingAverage), finite(t2.battingAverage), 220,
    (a, b) => `${t1.name} AVG ${fmt(a, 3)} vs ${t2.name} AVG ${fmt(b, 3)}.`);

  // NOTE: the multiplier stays positive — `lowerIsBetter` already flips the
  // differential. Doing both inverts the factor.
  pair("team_k_rate", "Lineup strikeout rate", "offense", 12,
    finite(t1.strikeoutRate), finite(t2.strikeoutRate), 160,
    (a, b) => `${t1.name} K-rate ${fmt(a * 100, 1)}% vs ${t2.name} ${fmt(b * 100, 1)}%. Lower is better.`,
    true);

  pair("team_bb_rate", "Lineup walk rate", "offense", 8,
    finite(t1.walkRate), finite(t2.walkRate), 180,
    (a, b) => `${t1.name} BB-rate ${fmt(a * 100, 1)}% vs ${t2.name} ${fmt(b * 100, 1)}%.`);

  // Platoon splits: each lineup is scored against the hand it will ACTUALLY
  // face, which is why these are kept separate from the neutral OPS factor.
  const t1Split = t1.splitVsPitcherHand ?? null;
  const t2Split = t2.splitVsPitcherHand ?? null;
  const MIN_SPLIT_PA = 50; // below this the split is noise, not signal
  const splitUsable = (s: MlbHandSplit | null) =>
    s && Number.isFinite(s.plateAppearances) && s.plateAppearances >= MIN_SPLIT_PA ? s : null;
  const s1 = splitUsable(t1Split);
  const s2 = splitUsable(t2Split);

  if (s1 && s2 && finite(s1.ops) !== null && finite(s2.ops) !== null) {
    add("platoon_ops", "Platoon OPS vs opposing starter hand", "offense",
      scoreFromDiff((s1.ops as number) - (s2.ops as number), 150), 14,
      `${t1.name} OPS ${fmt(s1.ops as number, 3)} vs ${s1.hand}HP; ${t2.name} OPS ${fmt(s2.ops as number, 3)} vs ${s2.hand}HP.`);
  } else {
    miss("platoon_ops");
  }

  if (s1 && s2 && finite(s1.strikeoutRate) !== null && finite(s2.strikeoutRate) !== null) {
    add("platoon_k_rate", "Platoon strikeout rate vs starter hand", "offense",
      scoreFromDiff((s2.strikeoutRate as number) - (s1.strikeoutRate as number), 160), 6,
      `${t1.name} K-rate ${fmt((s1.strikeoutRate as number) * 100, 1)}% vs ${s1.hand}HP; ${t2.name} ${fmt((s2.strikeoutRate as number) * 100, 1)}% vs ${s2.hand}HP.`);
  } else {
    miss("platoon_k_rate");
  }

  // --------------------------------------------------------------- STARTER
  pair("starter_era", "Probable starter ERA", "starter", 20,
    finite(t1.starterEra), finite(t2.starterEra), 12,
    (a, b) => `${t1.name} starter ERA ${fmt(a)} vs ${t2.name} starter ERA ${fmt(b)}.`, true);

  pair("starter_whip", "Starter WHIP", "starter", 14,
    finite(t1.starterWhip), finite(t2.starterWhip), 45,
    (a, b) => `${t1.name} starter WHIP ${fmt(a)} vs ${t2.name} ${fmt(b)}.`, true);

  pair("starter_k9", "Starter strikeouts per 9", "starter", 13,
    finite(t1.starterK9), finite(t2.starterK9), 6,
    (a, b) => `${t1.name} starter ${fmt(a, 1)} K/9 vs ${t2.name} ${fmt(b, 1)} K/9.`);

  pair("starter_bb9", "Starter walks per 9", "starter", 9,
    finite(t1.starterBb9), finite(t2.starterBb9), 8,
    (a, b) => `${t1.name} starter ${fmt(a, 1)} BB/9 vs ${t2.name} ${fmt(b, 1)} BB/9. Lower is better.`, true);

  pair("starter_h9", "Starter hits allowed per 9", "starter", 7,
    finite(t1.starterH9), finite(t2.starterH9), 5,
    (a, b) => `${t1.name} starter ${fmt(a, 1)} H/9 vs ${t2.name} ${fmt(b, 1)} H/9. Lower is better.`, true);

  // Recent form is weighted meaningfully but under season ERA: 3 starts is a
  // small sample and over-trusting it is how a model chases noise.
  pair("starter_recent_era", "Starter ERA over last 3 starts", "starter", 12,
    finite(t1.starterRecentEra), finite(t2.starterRecentEra), 8,
    (a, b) => `${t1.name} starter ${fmt(a)} recent ERA vs ${t2.name} ${fmt(b)}.`, true);

  pair("starter_recent_whip", "Starter WHIP over last 3 starts", "starter", 6,
    finite(t1.starterRecentWhip), finite(t2.starterRecentWhip), 30,
    (a, b) => `${t1.name} starter ${fmt(a)} recent WHIP vs ${t2.name} ${fmt(b)}.`, true);

  pair("starter_recent_k9", "Starter K/9 over last 3 starts", "starter", 5,
    finite(t1.starterRecentK9), finite(t2.starterRecentK9), 4,
    (a, b) => `${t1.name} starter ${fmt(a, 1)} recent K/9 vs ${t2.name} ${fmt(b, 1)}.`);

  // A starter who works deeper hides a weaker bullpen; one who exits early
  // exposes it. 3 outs of difference is a full inning of bullpen leverage.
  pair("starter_length", "Expected starter length", "starter", 8,
    finite(t1.starterAvgOutsLast3), finite(t2.starterAvgOutsLast3), 2.2,
    (a, b) => `${t1.name} starter averaging ${fmt(a / 3, 1)} IP over last 3 vs ${t2.name} ${fmt(b / 3, 1)} IP.`);

  // Rest is non-linear: 4-5 days is normal, short rest is a real penalty, and
  // extra rest past 6 days adds nothing. Scored as a penalty, not a bonus.
  const restScore = (days: number | null): number | null => {
    if (days === null) return null;
    if (days <= 3) return 30;
    if (days === 4) return 48;
    if (days <= 6) return 50;
    return 47; // unusually long layoffs carry mild rust risk
  };
  const r1 = restScore(finite(t1.starterDaysRest));
  const r2 = restScore(finite(t2.starterDaysRest));
  if (r1 !== null && r2 !== null) {
    add("starter_rest", "Starter days of rest", "starter", scoreFromDiff(r1 - r2, 1), 3,
      `${t1.name} starter on ${t1.starterDaysRest} days rest vs ${t2.name} starter on ${t2.starterDaysRest}.`);
  } else {
    miss("starter_rest");
  }

  // Workload spike: a start well above a pitcher's recent norm tends to precede
  // a shorter, less effective outing.
  const spike = (last: number | null, avg: number | null): number | null =>
    last === null || avg === null || avg <= 0 ? null : last - avg;
  const sp1 = spike(finite(t1.starterPitchesLastStart), finite(t1.starterAvgPitchesLast3));
  const sp2 = spike(finite(t2.starterPitchesLastStart), finite(t2.starterAvgPitchesLast3));
  if (sp1 !== null && sp2 !== null) {
    add("starter_workload_spike", "Starter workload spike", "starter",
      scoreFromDiff(sp2 - sp1, 0.35), 3,
      `${t1.name} starter last outing ${sp1 >= 0 ? "+" : ""}${Math.round(sp1)} pitches vs recent average; ${t2.name} ${sp2 >= 0 ? "+" : ""}${Math.round(sp2)}.`);
  } else {
    miss("starter_workload_spike");
  }

  const mix1 = finite(t1.pitchMixWhiffEdge);
  const mix2 = finite(t2.pitchMixWhiffEdge);
  if (mix1 !== null && mix2 !== null) {
    add("pitch_mix_matchup", "Pitch-mix whiff matchup", "starter",
      scoreFromDiff(mix1 - mix2, 220), 5,
      `${t1.name} starter's mix draws ${fmt(mix1 * 100, 1)}pp more whiffs than the opposing lineup's baseline; ${t2.name} ${fmt(mix2 * 100, 1)}pp.`);
  } else {
    miss("pitch_mix_matchup");
  }

  // ---------------------------------------------------------------- BULLPEN
  pair("bullpen_era", "Relief pitching ERA", "bullpen", 55,
    finite(t1.bullpenEra), finite(t2.bullpenEra), 10,
    (a, b) => `${t1.name} bullpen ERA ${fmt(a)} vs ${t2.name} bullpen ERA ${fmt(b)}.`, true);

  pair("bullpen_freshness", "Bullpen freshness", "bullpen", 20,
    finite(t1.bullpenFreshness), finite(t2.bullpenFreshness), 0.35,
    (a, b) => `${t1.name} bullpen freshness ${Math.round(a)}/100 vs ${t2.name} ${Math.round(b)}/100.`);

  pair("bullpen_taxed", "Taxed relievers", "bullpen", 15,
    finite(t1.bullpenTaxedCount), finite(t2.bullpenTaxedCount), 7,
    (a, b) => `${t1.name} has ${Math.round(a)} taxed reliever(s) vs ${t2.name} ${Math.round(b)}.`, true);

  pair("bullpen_recent_load", "Bullpen pitches last two days", "bullpen", 10,
    finite(t1.bullpenPitchesLastTwoDays), finite(t2.bullpenPitchesLastTwoDays), 0.12,
    (a, b) => `${t1.name} bullpen threw ${Math.round(a)} pitches over two days vs ${t2.name} ${Math.round(b)}.`, true);

  // ------------------------------------------------------------ ENVIRONMENT
  // Home field is the one factor with a fixed prior rather than a differential.
  // ~54% historical home win rate in MLB is a small, real, and stable edge.
  const t1Home = t1.isHome === true;
  const t2Home = t2.isHome === true;
  if (t1Home !== t2Home) {
    add("home_field", "Home field advantage", "environment", t1Home ? 54 : 46, 34,
      t1Home ? `${t1.name} at home.` : `${t2.name} at home.`);
  } else {
    miss("home_field");
  }

  const roof = String(input.roofType ?? "").toLowerCase();
  const isIndoors = roof.includes("dome") || roof.includes("closed") || roof.includes("retractable-closed");

  // Environment factors below scale the RUN ENVIRONMENT. A hitter-friendly park
  // or a hot day helps whichever side hits better, so they are expressed as a
  // tilt toward the stronger offense rather than toward a fixed team.
  const offenceEdge = t1Rpg !== null && t2Rpg !== null ? Math.sign(t1Rpg - t2Rpg) : 0;

  const park = finite(input.parkRunFactor);
  if (park !== null) {
    const tilt = (park - 1) * offenceEdge;
    add("park_factor", "Park run environment", "environment", scoreFromDiff(tilt, 55), 26,
      `Venue run factor ${fmt(park)}. ${park >= 1 ? "Run-friendly" : "Run-suppressing"} park ${offenceEdge === 0 ? "with no offensive edge to amplify" : `amplifies the ${offenceEdge > 0 ? t1.name : t2.name} offence`}.`);
  } else {
    miss("park_factor");
  }

  const temp = finite(input.temperatureF);
  if (temp !== null && !isIndoors) {
    // Ball carries in heat; scoring climbs roughly monotonically above ~70F.
    const tilt = ((temp - 70) / 30) * offenceEdge;
    add("temperature", "Game temperature", "environment", scoreFromDiff(tilt, 14), 14,
      `${Math.round(temp)}F at first pitch. ${temp >= 75 ? "Warm air carries" : temp <= 55 ? "Cold air suppresses carry" : "Neutral conditions"}.`);
  } else if (temp === null) {
    miss("temperature");
  }

  const wind = finite(input.windMph);
  const windDir = String(input.windDirection ?? "").toLowerCase();
  if (wind !== null && !isIndoors && windDir) {
    const blowingOut = windDir.includes("out");
    const blowingIn = windDir.includes("in");
    if (blowingOut || blowingIn) {
      const tilt = (wind / 15) * (blowingOut ? 1 : -1) * offenceEdge;
      add("wind", "Wind", "environment", scoreFromDiff(tilt, 12), 14,
        `${Math.round(wind)} mph blowing ${blowingOut ? "out" : "in"}.`);
    } else {
      miss("wind");
    }
  } else if (wind === null) {
    miss("wind");
  }

  if (isIndoors) {
    add("roof", "Closed roof", "environment", 50, 12,
      "Roof closed — weather is neutralised for this game.");
  }

  // Sample-size guard: early-season team rates are unstable. This does not pick
  // a side, it records how much the season-long factors should be trusted.
  const g1 = finite(t1.gamesPlayed);
  const g2 = finite(t2.gamesPlayed);
  if (g1 !== null && g2 !== null) {
    const minGames = Math.min(g1, g2);
    add("sample_size", "Season sample size", "environment", 50, 0,
      `${Math.round(minGames)} games of season data on the lighter side.${minGames < 25 ? " Small sample — season rates are still volatile." : ""}`);
  }

  if (pending.length === 0) return null;

  // Renormalise: each group's budget is divided across only the factors that
  // actually had data, then every factor's final weight is budget * its share.
  const shareByGroup = new Map<MlbFactorGroup, number>();
  for (const f of pending) {
    shareByGroup.set(f.group, (shareByGroup.get(f.group) ?? 0) + f.share);
  }

  const factors: MlbFactor[] = pending.map((f) => {
    const groupShare = shareByGroup.get(f.group) ?? 0;
    const weight = groupShare > 0 ? (MLB_GROUP_BUDGET[f.group] * f.share) / groupShare : 0;
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

  // Coverage = how much of the full weight budget had real data behind it.
  const maxBudget = Object.values(MLB_GROUP_BUDGET).reduce((a, b) => a + b, 0);
  const coveredBudget = [...shareByGroup.keys()]
    .reduce((sum, g) => sum + MLB_GROUP_BUDGET[g], 0);
  const dataCoverage = Math.round((coveredBudget / maxBudget) * 100) / 100;

  const predictedMargin = buildPredictedMargin(t1, t2, input, offenceEdge);

  if (input.market === "spread") {
    const spread = finite(input.team1Spread);
    if (spread === null || predictedMargin === null) return null;
    // Spread scoring asks a different question than moneyline: not "who wins"
    // but "does the projected margin beat the number".
    const team1Score = scoreFromDiff(predictedMargin + spread, 12);
    return {
      modelVersion: MLB_GAME_MODEL_VERSION,
      market: "spread",
      team1Score,
      predictedMargin,
      verdict: verdictFor(team1Score, t1.name, t2.name),
      factors,
      missingInputs,
      dataCoverage,
      scoreKind: "heuristic_score",
    };
  }

  return {
    modelVersion: MLB_GAME_MODEL_VERSION,
    market: "moneyline",
    team1Score: baseScore,
    predictedMargin,
    verdict: verdictFor(baseScore, t1.name, t2.name),
    factors,
    missingInputs,
    dataCoverage,
    scoreKind: "heuristic_score",
  };
}

/**
 * Run-margin projection, kept separate from the 0-100 score because the two
 * answer different questions and must not be derived from one another (doing so
 * would double-count the same inputs into both outputs).
 */
function buildPredictedMargin(
  t1: MlbTeamModelInput,
  t2: MlbTeamModelInput,
  input: MlbGameModelInput,
  offenceEdge: number,
): number | null {
  const t1Rpg = finite(t1.runsPerGame);
  const t2Rpg = finite(t2.runsPerGame);
  if (t1Rpg === null || t2Rpg === null) return null;

  let margin = (t1Rpg - t2Rpg) * 0.9;

  const e1 = finite(t1.starterEra);
  const e2 = finite(t2.starterEra);
  if (e1 !== null && e2 !== null) margin += (e2 - e1) * 0.28;

  const b1 = finite(t1.bullpenEra);
  const b2 = finite(t2.bullpenEra);
  if (b1 !== null && b2 !== null) margin += (b2 - b1) * 0.12;

  // Home teams score marginally more; roughly a tenth of a run in modern MLB.
  if (t1.isHome === true && t2.isHome !== true) margin += 0.12;
  if (t2.isHome === true && t1.isHome !== true) margin -= 0.12;

  const park = finite(input.parkRunFactor);
  if (park !== null && offenceEdge !== 0) margin += (park - 1) * offenceEdge * 0.35;

  return Math.round(margin * 10) / 10;
}

function verdictFor(team1Score: number, team1Name: string, team2Name: string): string {
  if (team1Score >= 58) return `LEAN ${team1Name}`;
  if (team1Score <= 42) return `LEAN ${team2Name}`;
  return "RISKY";
}

/** Factor count actually implemented, used by tests and telemetry. */
export const MLB_MODEL_FACTOR_KEYS = [
  "runs_per_game", "team_ops", "team_avg", "team_k_rate", "team_bb_rate",
  "platoon_ops", "platoon_k_rate",
  "starter_era", "starter_whip", "starter_k9", "starter_bb9", "starter_h9",
  "starter_recent_era", "starter_recent_whip", "starter_recent_k9",
  "starter_length", "starter_rest", "starter_workload_spike", "pitch_mix_matchup",
  "bullpen_era", "bullpen_freshness", "bullpen_taxed", "bullpen_recent_load",
  "home_field", "park_factor", "temperature", "wind", "roof", "sample_size",
] as const;
