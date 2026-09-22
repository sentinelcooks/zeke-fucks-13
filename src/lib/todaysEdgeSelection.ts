export type TodaysEdgeDiagnostics = Record<string, unknown> | null | undefined;

export interface TodaysEdgeCandidate {
  id: string;
  sport: string;
  tier?: string | null;
  status?: string | null;
  result?: string | null;
  score_kind?: string | null;
  calibration_status?: string | null;
  calibrated_probability?: number | null;
  confidence?: number | null;
  hit_rate?: number | null;
  event_id?: string | null;
  bet_type?: string | null;
  prop_type?: string | null;
  player_name?: string | null;
  direction?: string | null;
  line?: number | null;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  game_date?: string | null;
  commence_time?: string | null;
  model_diagnostics?: TodaysEdgeDiagnostics;
}

export type EdgePresentation = "validated" | "fallback";

export type PresentedTodaysEdgePick<T extends TodaysEdgeCandidate> = T & {
  edgePresentation: EdgePresentation;
  edgeWarning: string | null;
};

export interface TodaysEdgeSelection<T extends TodaysEdgeCandidate> {
  picks: PresentedTodaysEdgePick<T>[];
  fallbackIds: Set<string>;
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalGameMarket(value: unknown): string | null {
  const market = String(value ?? "").toLowerCase();
  if (market === "over_under") return "total";
  return ["moneyline", "spread", "total"].includes(market) ? market : null;
}

function matchupIdentity(pick: TodaysEdgeCandidate): string {
  if (pick.event_id) return `event:${normalized(pick.event_id)}`;
  const teams = [pick.away_team ?? pick.opponent, pick.home_team ?? pick.team]
    .map(normalized)
    .filter(Boolean)
    .sort();
  return `matchup:${teams.join("@")}@${normalized(pick.game_date)}`;
}

// One identity per market prevents opposing sides/totals for the same event.
// Player props intentionally omit direction so Over and Under cannot both win
// the same fallback slot for one player/line.
export function todaysEdgeConflictKey(pick: TodaysEdgeCandidate): string {
  const sport = normalized(pick.sport);
  const gameMarket = canonicalGameMarket(pick.bet_type);
  if (gameMarket) return `${sport}|${matchupIdentity(pick)}|${gameMarket}`;
  return [
    sport,
    matchupIdentity(pick),
    normalized(pick.player_name),
    normalized(pick.prop_type),
    String(pick.line ?? ""),
  ].join("|");
}

export function modelScorePercent(pick: TodaysEdgeCandidate): number {
  const raw = Number(pick.confidence ?? pick.hit_rate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw));
}

function compareQuality<T extends TodaysEdgeCandidate>(left: T, right: T): number {
  const scoreDelta = modelScorePercent(right) - modelScorePercent(left);
  if (scoreDelta !== 0) return scoreDelta;
  const leftRaw = Number(left.model_diagnostics?.raw_model_score ?? 0);
  const rightRaw = Number(right.model_diagnostics?.raw_model_score ?? 0);
  if (Number.isFinite(leftRaw) && Number.isFinite(rightRaw) && leftRaw !== rightRaw) {
    return rightRaw - leftRaw;
  }
  return left.id.localeCompare(right.id);
}

function isValidatedEdge(pick: TodaysEdgeCandidate): boolean {
  return String(pick.tier ?? "").toLowerCase() === "edge" &&
    String(pick.status ?? "").toLowerCase() !== "empty_slate" &&
    pick.score_kind === "calibrated_probability" &&
    pick.calibration_status === "validated" &&
    typeof pick.calibrated_probability === "number" &&
    Number.isFinite(pick.calibrated_probability);
}

function isFallbackCandidate(pick: TodaysEdgeCandidate): boolean {
  return String(pick.tier ?? "").toLowerCase() === "daily" &&
    pick.score_kind === "heuristic_score" &&
    pick.model_diagnostics?.shadow_edge_candidate === true &&
    pick.model_diagnostics?.confidenceSource === "analyzer";
}

const OPPOSING_DIRECTIONS: Array<[string, string]> = [
  ["over", "under"],
  ["home", "away"],
];

function directionOf(pick: TodaysEdgeCandidate): string {
  return String(pick.direction ?? "").toLowerCase().trim();
}

/**
 * True when a conflict group holds BOTH sides of the same market at the same
 * model score.
 *
 * The scanner currently writes both directions of a market as separate picks,
 * and for some markets it writes them with identical confidence — e.g. a 9.5
 * total stored as over:0.68 AND under:0.68. That is not a lean. It is the model
 * declining to pick a side, and exactly one of the pair is guaranteed to lose.
 *
 * Surfacing either half as a "68 model score" edge would be the confidence
 * inflation the scoring rules prohibit, and which half got shown came down to an
 * arbitrary id tie-break — so the lineup could say Over while the next day's
 * recap said Under for the same market.
 *
 * The real fix belongs upstream in pick generation; until then this refuses to
 * present a coin flip as a directional signal.
 */
function hasNoDirectionalSignal<T extends TodaysEdgeCandidate>(group: T[]): boolean {
  if (group.length < 2) return false;
  const top = modelScorePercent(group[0]);
  const tied = group.filter((row) => modelScorePercent(row) === top);
  if (tied.length < 2) return false;

  const directions = new Set(tied.map(directionOf));
  return OPPOSING_DIRECTIONS.some(([a, b]) => directions.has(a) && directions.has(b));
}

function dedupeConflicts<T extends TodaysEdgeCandidate>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of [...rows].sort(compareQuality)) {
    const key = todaysEdgeConflictKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const winners: T[] = [];
  for (const group of groups.values()) {
    // Sorted by compareQuality, so group[0] is the best candidate.
    if (hasNoDirectionalSignal(group)) continue;
    winners.push(group[0]);
  }
  return winners;
}

/**
 * Most picks a single market or prop type may occupy in the lineup.
 *
 * Two is deliberate: it still lets a genuinely strong category take more than
 * its share, while guaranteeing a five-pick lineup spans at least three kinds
 * of bet.
 */
export const MAX_PICKS_PER_CATEGORY = 2;

/**
 * Groups a pick by what KIND of bet it is — moneyline / spread / total for game
 * markets, or the specific prop type for player props.
 */
export function edgeCategoryOf(pick: TodaysEdgeCandidate): string {
  const betType = normalized(pick.bet_type);
  if (betType && betType !== "prop") {
    // "total" and "over_under" are the same market under two names.
    return `market:${betType === "total" ? "overunder" : betType}`;
  }
  return `prop:${normalized(pick.prop_type)}`;
}

/**
 * Picks the lineup from a quality-ranked list while capping how much of it any
 * one category can take.
 *
 * Straight top-N was producing a lineup of five RBI props. Measured over two
 * real slates, the eligible pool was 56 rbi and 46 hits against 6 totals,
 * 5 moneylines and 1 spread — so RBI and hits were 83% of everything available
 * and simply crowded the top five. The user is being shown "today's five best
 * plays" and was getting five of essentially the same bet.
 *
 * The cap only reorders WHICH strong picks appear; it never promotes a weak
 * pick over a strong one within a category, and if the cap cannot fill every
 * slot the remainder is filled by rank so the lineup is never short.
 */
export function diversifyByCategory<T extends TodaysEdgeCandidate>(
  ranked: T[],
  slots: number,
): T[] {
  if (slots <= 0) return [];

  const selected: T[] = [];
  const taken = new Set<string>();
  const counts = new Map<string, number>();

  // Pass 1 — best first, honouring the per-category cap.
  for (const pick of ranked) {
    if (selected.length >= slots) break;
    const category = edgeCategoryOf(pick);
    if ((counts.get(category) ?? 0) >= MAX_PICKS_PER_CATEGORY) continue;
    selected.push(pick);
    taken.add(pick.id);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  // Pass 2 — a thin slate may not offer enough categories to fill the lineup.
  // Better a full lineup than an artificially short one, so relax the cap.
  for (const pick of ranked) {
    if (selected.length >= slots) break;
    if (taken.has(pick.id)) continue;
    selected.push(pick);
    taken.add(pick.id);
  }

  return selected;
}

export function selectTodaysEdgePicks<T extends TodaysEdgeCandidate>(
  rows: T[],
  fallbackLimit = 5,
): TodaysEdgeSelection<T> {
  const safeLimit = Math.max(0, Math.floor(fallbackLimit));
  const validated = dedupeConflicts(rows.filter(isValidatedEdge));
  const validatedKeys = new Set(validated.map(todaysEdgeConflictKey));
  const validatedSports = new Set(validated.map((pick) => String(pick.sport).toLowerCase()));
  const fallbackIds = new Set<string>();
  const fallback: PresentedTodaysEdgePick<T>[] = [];

  const fallbackSlots = Math.max(0, safeLimit - validated.length);
  const ranked = dedupeConflicts(
    rows.filter(
      (pick) => isFallbackCandidate(pick) && !validatedSports.has(String(pick.sport).toLowerCase()),
    ),
  ).filter((pick) => !validatedKeys.has(todaysEdgeConflictKey(pick)));

  const selected = diversifyByCategory(ranked, fallbackSlots);

  for (const pick of selected) {
    fallbackIds.add(pick.id);
    fallback.push({
      ...pick,
      calibrated_probability: undefined,
      edgePresentation: "fallback",
      edgeWarning: typeof pick.model_diagnostics?.shadow_edge_warning === "string"
        ? pick.model_diagnostics.shadow_edge_warning
        : null,
    });
  }

  return {
    picks: [
      ...validated.map((pick) => ({
        ...pick,
        edgePresentation: "validated" as const,
        edgeWarning: null,
      })),
      ...fallback,
    ],
    fallbackIds,
  };
}
