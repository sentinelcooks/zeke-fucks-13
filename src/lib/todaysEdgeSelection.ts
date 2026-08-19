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

const FALLBACK_SPORTS = new Set(["mlb", "wnba"]);

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
  const sport = String(pick.sport ?? "").toLowerCase();
  return FALLBACK_SPORTS.has(sport) &&
    String(pick.tier ?? "").toLowerCase() === "daily" &&
    pick.score_kind === "heuristic_score" &&
    pick.model_diagnostics?.shadow_edge_candidate === true;
}

function dedupeConflicts<T extends TodaysEdgeCandidate>(rows: T[]): T[] {
  const winners = new Map<string, T>();
  for (const row of [...rows].sort(compareQuality)) {
    const key = todaysEdgeConflictKey(row);
    if (!winners.has(key)) winners.set(key, row);
  }
  return [...winners.values()];
}

export function selectTodaysEdgePicks<T extends TodaysEdgeCandidate>(
  rows: T[],
  fallbackLimitPerSport = 4,
): TodaysEdgeSelection<T> {
  const safeLimit = Math.max(0, Math.floor(fallbackLimitPerSport));
  const validated = dedupeConflicts(rows.filter(isValidatedEdge));
  const validatedSports = new Set(validated.map((pick) => String(pick.sport).toLowerCase()));
  const fallbackIds = new Set<string>();
  const fallback: PresentedTodaysEdgePick<T>[] = [];

  for (const sport of FALLBACK_SPORTS) {
    if (validatedSports.has(sport) || safeLimit === 0) continue;
    const selected = dedupeConflicts(
      rows.filter((pick) => String(pick.sport).toLowerCase() === sport && isFallbackCandidate(pick)),
    ).slice(0, safeLimit);
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
