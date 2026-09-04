// Pure helpers for routing scanner candidates to the analyzer that matches
// their market contract. Kept free of Deno/Supabase imports so routing and
// market-pool behavior can be covered by Vitest.

export type AnalyzerCandidate = {
  sport: string;
  bet_type: string;
  event_id?: string | null;
  commence_time?: string | null;
  player_name?: string | null;
  team?: string | null;
  opponent?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  prop_type?: string | null;
  line?: number | null;
  spread_line?: number | null;
  total_line?: number | null;
  direction?: string | null;
  odds?: string | number | null;
};

export type AnalyzerPoolCandidate = {
  bet_type: string;
  edge: number;
  quality_score?: number;
};

export function analyzerEndpointForCandidate(
  sport: string,
  betType: string,
  fallback: string | null = null,
): string | null {
  const normalizedSport = sport.toLowerCase();
  const normalizedBetType = betType.toLowerCase();

  if (
    normalizedBetType !== "prop" &&
    ["nba", "wnba", "mlb", "nhl"].includes(normalizedSport)
  ) {
    return "moneyline-api/analyze";
  }

  if (["nba", "wnba", "mlb", "nhl"].includes(normalizedSport)) {
    return "nba-api/analyze";
  }
  if (normalizedSport === "ufc") return "ufc-api/analyze";
  return fallback;
}

function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) =>
    (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const left = normalize(a);
  const right = normalize(b);
  return left.length > 0 && left === right;
}

function identityPart(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Moneylines and spreads are mutually exclusive recommendations. Totals are
// different: both Over and Under must reach the model so it can evaluate the
// real total line before one side is selected for presentation. Player props
// are not grouped here because different players and prop types are independent.
export function teamMarketExclusivityKey(
  candidate: AnalyzerCandidate,
): string | null {
  const rawBetType = candidate.bet_type.toLowerCase();
  const betType = rawBetType === "over_under" ? "total" : rawBetType;
  if (!["moneyline", "spread", "total"].includes(betType)) return null;

  const eventId = identityPart(candidate.event_id);
  const homeTeam = identityPart(candidate.home_team);
  const awayTeam = identityPart(candidate.away_team);
  const commenceTime = identityPart(candidate.commence_time);
  const matchup = homeTeam && awayTeam
    ? `${awayTeam}@${homeTeam}${commenceTime ? `:${commenceTime}` : ""}`
    : "";
  const eventIdentity = eventId ? `event:${eventId}` : matchup ? `matchup:${matchup}` : "";
  if (!eventIdentity) return null;

  const totalDirection = identityPart(candidate.direction);
  const marketIdentity = betType === "total" &&
      (totalDirection === "over" || totalDirection === "under")
    ? `${betType}:${totalDirection}`
    : betType;

  return `${identityPart(candidate.sport)}|${eventIdentity}|${marketIdentity}`;
}

export function buildAnalyzerRequest(
  candidate: AnalyzerCandidate,
  fallbackEndpoint: string | null = null,
): { endpoint: string | null; payload: Record<string, unknown> } {
  const endpoint = analyzerEndpointForCandidate(
    candidate.sport,
    candidate.bet_type,
    fallbackEndpoint,
  );

  // Preserve the existing UFC analyzer payload contract. UFC matchup
  // routing is separate from the team-market work in this patch.
  if (candidate.sport.toLowerCase() === "ufc") {
    return {
      endpoint,
      payload: {
        player: candidate.player_name ?? "",
        prop_type: candidate.prop_type ?? "",
        line: candidate.line ?? 0,
        over_under: candidate.direction ?? "",
        opponent: candidate.opponent ?? "",
        team: candidate.team ?? null,
        home_team: candidate.home_team ?? null,
        away_team: candidate.away_team ?? null,
        sport: candidate.sport,
        bet_type: "player_prop",
        american_odds: candidate.odds ?? null,
      },
    };
  }

  if (candidate.bet_type === "prop") {
    return {
      endpoint,
      payload: {
        player: candidate.player_name ?? "",
        prop_type: candidate.prop_type ?? "",
        line: candidate.line ?? 0,
        over_under: candidate.direction ?? "",
        opponent: candidate.opponent ?? "",
        team: candidate.team ?? null,
        home_team: candidate.home_team ?? null,
        away_team: candidate.away_team ?? null,
        sport: candidate.sport,
        bet_type: "player_prop",
        american_odds: candidate.odds ?? null,
      },
    };
  }

  // moneyline-api evaluates team1 as the selected side for moneylines and
  // spreads. Totals are side-neutral, so keep the scheduled home/away pair.
  const selectedTeam = candidate.team ?? null;
  const homeTeam = candidate.home_team ?? null;
  const awayTeam = candidate.away_team ?? null;
  const inferredOpponent = sameTeam(selectedTeam, homeTeam) ? awayTeam : homeTeam;
  const team1 = candidate.bet_type === "total"
    ? homeTeam
    : selectedTeam ?? homeTeam;
  const team2 = candidate.bet_type === "total"
    ? awayTeam
    : candidate.opponent ?? inferredOpponent ?? awayTeam;

  return {
    endpoint,
    payload: {
      bet_type: candidate.bet_type,
      team1,
      team2,
      sport: candidate.sport,
      american_odds: candidate.odds ?? null,
      ...(candidate.bet_type === "spread"
        ? {
            spread_team: selectedTeam ?? team1,
            spread_line: candidate.spread_line ?? candidate.line ?? 0,
          }
        : {}),
      ...(candidate.bet_type === "total"
        ? {
            total_line: candidate.total_line ?? candidate.line ?? 0,
            over_under: candidate.direction ?? "",
          }
        : {}),
    },
  };
}

export function analyzerConfidenceRaw(response: unknown): number {
  if (!response || typeof response !== "object") return Number.NaN;
  const value = response as Record<string, unknown>;
  const decision = value.decision && typeof value.decision === "object"
    ? value.decision as Record<string, unknown>
    : null;
  const prediction = value.prediction && typeof value.prediction === "object"
    ? value.prediction as Record<string, unknown>
    : null;
  return Number(
    prediction?.confidence ??
      decision?.displayConfidence ??
      decision?.confidence ??
      value.canonical_confidence ??
      value.displayConfidence ??
      value.confidence ??
      value.team1_pct ??
      Number.NaN,
  );
}

// Reserve a small slice of a bounded analyzer pool for every available bet
// type, then fill the rest by edge. This prevents large prop slates from
// crowding moneylines, spreads, and totals out of the queue entirely.
export function selectAnalyzerPoolDiversifiedByBetType<T extends AnalyzerPoolCandidate>(
  candidates: T[],
  cap: number,
  minimumPerBetType = 6,
): { selected: T[]; excluded: T[]; truncated: boolean } {
  const boundedCap = Math.max(0, Math.floor(cap));
  const sorted = [...candidates].sort((a, b) =>
    (b.edge - a.edge) || ((b.quality_score ?? 0) - (a.quality_score ?? 0))
  );
  if (boundedCap === 0) {
    return { selected: [], excluded: sorted, truncated: sorted.length > 0 };
  }
  if (sorted.length <= boundedCap) {
    return { selected: sorted, excluded: [], truncated: false };
  }

  const betTypes = [...new Set(sorted.map((candidate) => candidate.bet_type))];
  const reserve = Math.min(
    Math.max(1, Math.floor(minimumPerBetType)),
    Math.max(1, Math.floor(boundedCap / Math.max(1, betTypes.length))),
  );
  const selectedSet = new Set<T>();

  for (const betType of betTypes) {
    for (const candidate of sorted.filter((item) => item.bet_type === betType).slice(0, reserve)) {
      if (selectedSet.size >= boundedCap) break;
      selectedSet.add(candidate);
    }
  }

  for (const candidate of sorted) {
    if (selectedSet.size >= boundedCap) break;
    selectedSet.add(candidate);
  }

  const selected = sorted.filter((candidate) => selectedSet.has(candidate));
  const excluded = sorted.filter((candidate) => !selectedSet.has(candidate));
  return { selected, excluded, truncated: excluded.length > 0 };
}
