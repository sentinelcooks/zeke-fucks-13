export type GradeResult = "hit" | "miss" | "push";

export interface GradingGame {
  final: boolean;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homeWin: boolean;
  awayWin: boolean;
}

export interface GradingPick {
  bet_type?: string | null;
  direction?: string | null;
  team?: string | null;
  player_name?: string | null;
  line?: number | string | null;
  spread_line?: number | string | null;
  total_line?: number | string | null;
}

export interface MarketOddsSnapshot {
  book: string;
  market: string;
  outcome_name: string;
  outcome_description?: string | null;
  price: number;
  line?: number | null;
  snapshot_at: string;
}

export interface ClosingSnapshotSelection {
  snapshot: MarketOddsSnapshot | null;
  source: "selected_book" | "consensus_median" | "unavailable";
}

export const ESPN_SPORT_PATHS = {
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
} as const;

export type EspnGradingSport = keyof typeof ESPN_SPORT_PATHS;

export function espnSportPath(sport: EspnGradingSport): string {
  return ESPN_SPORT_PATHS[sport];
}

export function normalizeEntityName(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function teamMatches(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const an = normalizeEntityName(a);
  const bn = normalizeEntityName(b);
  return !!an && !!bn && (an === bn || an.includes(bn) || bn.includes(an));
}

export function parseAmericanOdds(odds: unknown): number | null {
  if (odds === null || odds === undefined || odds === "") return null;
  const value = Number(String(odds).trim().replace(/^\+/, ""));
  return Number.isFinite(value) && value !== 0 ? value : null;
}

export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function americanToImpliedProbability(odds: unknown): number | null {
  const american = parseAmericanOdds(odds);
  if (american === null) return null;
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

export function profitUnits(
  odds: unknown,
  result: string | null,
  stake = 1,
): number | null {
  const normalized = String(result ?? "").toLowerCase();
  if (normalized === "push") return 0;
  const isWin = normalized === "hit" || normalized === "win";
  const isLoss = normalized === "miss" || normalized === "loss";
  if (!isWin && !isLoss) return null;
  if (isLoss) return -stake;
  const american = parseAmericanOdds(odds);
  if (american === null) return null;
  return stake * (americanToDecimal(american) - 1);
}

export function gradeOverUnder(
  direction: string,
  actual: number,
  line: number,
): GradeResult | null {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return null;
  const normalized = String(direction ?? "").toLowerCase().trim();
  if (normalized !== "over" && normalized !== "under") return null;
  if (actual === line) return "push";
  if (normalized === "over") return actual > line ? "hit" : "miss";
  return actual < line ? "hit" : "miss";
}

export function gradeGameBet(
  pick: GradingPick,
  game: GradingGame,
): GradeResult | null {
  if (!game.final) return null;
  const betType = String(pick.bet_type ?? "").toLowerCase();
  const direction = String(pick.direction ?? "").toLowerCase();

  if (betType === "moneyline") {
    const pickedHome =
      teamMatches(pick.team, game.home) ||
      direction === "home" ||
      (direction === "win" && teamMatches(pick.player_name, game.home));
    const pickedAway =
      teamMatches(pick.team, game.away) ||
      direction === "away" ||
      (direction === "win" && teamMatches(pick.player_name, game.away));
    if (pickedHome === pickedAway) return null;
    return pickedHome
      ? (game.homeWin ? "hit" : "miss")
      : (game.awayWin ? "hit" : "miss");
  }

  if (betType === "spread") {
    const line = Number(pick.spread_line ?? pick.line);
    if (!Number.isFinite(line)) return null;
    const homeIsPick = direction === "home" || teamMatches(pick.team, game.home);
    const awayIsPick = direction === "away" || teamMatches(pick.team, game.away);
    if (homeIsPick === awayIsPick) return null;
    const teamScore = homeIsPick ? game.homeScore : game.awayScore;
    const opponentScore = homeIsPick ? game.awayScore : game.homeScore;
    const adjusted = teamScore + line;
    if (adjusted > opponentScore) return "hit";
    if (adjusted < opponentScore) return "miss";
    return "push";
  }

  if (betType === "total" || betType === "over_under") {
    const line = Number(pick.total_line ?? pick.line);
    return gradeOverUnder(direction, game.homeScore + game.awayScore, line);
  }

  return null;
}

type MlbStatKey =
  | "hits"
  | "rbi"
  | "home_runs"
  | "runs"
  | "total_bases"
  | "hits_runs_rbi"
  | "strikeouts_pit"
  | "strikeouts_bat"
  | "walks"
  | "stolen_bases";

export const MLB_PROP_TO_STAT: Record<string, MlbStatKey> = {
  hits: "hits",
  hit: "hits",
  mlb_hits: "hits",
  rbi: "rbi",
  rbis: "rbi",
  mlb_rbi: "rbi",
  hr: "home_runs",
  home_runs: "home_runs",
  mlb_hr: "home_runs",
  runs: "runs",
  mlb_runs: "runs",
  tb: "total_bases",
  total_bases: "total_bases",
  mlb_total_bases: "total_bases",
  "h+r+rbi": "hits_runs_rbi",
  "hits+runs+rbi": "hits_runs_rbi",
  "hits+runs+rbis": "hits_runs_rbi",
  batter_hits_runs_rbis: "hits_runs_rbi",
  k: "strikeouts_pit",
  ks: "strikeouts_pit",
  strikeouts: "strikeouts_pit",
  pitcher_strikeouts: "strikeouts_pit",
  mlb_strikeouts: "strikeouts_pit",
  batter_strikeouts: "strikeouts_bat",
  bb: "walks",
  walks: "walks",
  mlb_walks: "walks",
  sb: "stolen_bases",
  stolen_bases: "stolen_bases",
};

interface PropPlayerEntry {
  normName: string;
  lastName: string;
  group: string;
  stats: Record<string, number>;
}

function normalizePlayerName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !["jr", "sr", "ii", "iii", "iv"].includes(token))
    .join(" ")
    .trim();
}

function lastToken(name: string): string {
  const parts = normalizePlayerName(name).split(/\s+/);
  return parts[parts.length - 1] || "";
}

function indexSummary(summary: unknown): PropPlayerEntry[] {
  const out: PropPlayerEntry[] = [];
  const box = summary as { boxscore?: { players?: unknown[] } } | null;
  for (const rawTeam of box?.boxscore?.players ?? []) {
    const team = rawTeam as { statistics?: unknown[] };
    for (const rawGroup of team.statistics ?? []) {
      const statGroup = rawGroup as {
        name?: string;
        type?: string;
        labels?: unknown[];
        athletes?: unknown[];
      };
      const group = String(statGroup.name ?? statGroup.type ?? "").toLowerCase();
      const labels = (statGroup.labels ?? []).map((label) => String(label).toUpperCase());
      for (const rawAthlete of statGroup.athletes ?? []) {
        const athlete = rawAthlete as {
          athlete?: { displayName?: string; fullName?: string; name?: string };
          stats?: unknown[];
        };
        const rawName = String(
          athlete.athlete?.displayName ?? athlete.athlete?.fullName ?? athlete.athlete?.name ?? "",
        );
        if (!rawName) continue;
        const values = (athlete.stats ?? []).map((value) => String(value));
        const stats: Record<string, number> = {};
        labels.forEach((label, index) => {
          if (!label) return;
          const value = Number.parseFloat(values[index] ?? "");
          stats[label] = Number.isFinite(value) ? value : 0;
        });
        out.push({
          normName: normalizePlayerName(rawName),
          lastName: lastToken(rawName),
          group,
          stats,
        });
      }
    }
  }
  return out;
}

export function getMlbPlayerStat(
  summary: unknown,
  playerName: string,
  propType: string,
): { found: boolean; actual: number | null; reason?: string } {
  const key = MLB_PROP_TO_STAT[String(propType ?? "").toLowerCase()];
  if (!key) return { found: false, actual: null, reason: "unsupported_prop" };

  const entries = indexSummary(summary);
  if (entries.length === 0) return { found: false, actual: null, reason: "no_data" };

  const target = normalizePlayerName(playerName);
  let matches = entries.filter((entry) => entry.normName === target);
  if (matches.length === 0) {
    const last = lastToken(playerName);
    const lastMatches = entries.filter((entry) => entry.lastName === last);
    if (new Set(lastMatches.map((entry) => entry.normName)).size > 1) {
      return { found: false, actual: null, reason: "ambiguous_player" };
    }
    matches = lastMatches;
  }
  if (matches.length === 0) {
    return { found: false, actual: null, reason: "player_not_found" };
  }

  const pitching = key === "strikeouts_pit";
  const preferredGroup = pitching ? "pitching" : "batting";
  const entry = matches.find((candidate) => candidate.group === preferredGroup);
  if (!entry) {
    // Never grade pitcher strikeouts from a batter row (or vice versa).
    return { found: false, actual: null, reason: "player_stat_group_missing" };
  }
  const pick = (...labels: string[]): number | null => {
    for (const label of labels) {
      const value = entry.stats[label.toUpperCase()];
      if (Number.isFinite(value)) return value;
    }
    return null;
  };

  const required = (...values: Array<number | null>): number | null => {
    if (values.some((value) => value === null)) return null;
    return values.reduce((sum, value) => sum + (value as number), 0);
  };
  let actual: number | null;
  switch (key) {
    case "hits": actual = pick("H"); break;
    case "rbi": actual = pick("RBI"); break;
    case "home_runs": actual = pick("HR"); break;
    case "runs": actual = pick("R"); break;
    case "walks": actual = pick("BB"); break;
    case "stolen_bases": actual = pick("SB"); break;
    case "strikeouts_pit": actual = pick("K", "SO"); break;
    case "strikeouts_bat": actual = pick("SO", "K"); break;
    case "hits_runs_rbi": actual = required(pick("H"), pick("R"), pick("RBI")); break;
    case "total_bases": {
      const h = pick("H");
      const doubles = pick("2B");
      const triples = pick("3B");
      const homeRuns = pick("HR");
      actual = h !== null && doubles !== null && triples !== null && homeRuns !== null
        ? h + doubles + 2 * triples + 3 * homeRuns
        : null;
      break;
    }
  }
  return Number.isFinite(actual)
    ? { found: true, actual: actual as number }
    : { found: false, actual: null, reason: "no_data" };
}

export function marketKeyForPick(betType: string): string | null {
  const normalized = String(betType ?? "").toLowerCase();
  if (normalized === "moneyline") return "h2h";
  if (normalized === "spread") return "spreads";
  if (normalized === "total" || normalized === "over_under") return "totals";
  return null;
}

export function outcomeMatchesPick(
  pick: GradingPick,
  snapshot: MarketOddsSnapshot,
): boolean {
  const betType = String(pick.bet_type ?? "").toLowerCase();
  const direction = String(pick.direction ?? "").toLowerCase();
  if (betType === "total" || betType === "over_under") {
    return normalizeEntityName(snapshot.outcome_name) === normalizeEntityName(direction);
  }
  return teamMatches(snapshot.outcome_name, pick.team);
}

export function selectClosingSnapshot(
  snapshots: MarketOddsSnapshot[],
  pick: GradingPick,
  selectedBook?: string | null,
): ClosingSnapshotSelection {
  const expectedMarket = marketKeyForPick(String(pick.bet_type ?? ""));
  if (!expectedMarket) return { snapshot: null, source: "unavailable" };
  const matching = snapshots
    .filter((row) => row.market === expectedMarket && outcomeMatchesPick(pick, row))
    .filter((row) => Number.isFinite(row.price))
    .sort((a, b) => Date.parse(b.snapshot_at) - Date.parse(a.snapshot_at));
  if (matching.length === 0) return { snapshot: null, source: "unavailable" };

  if (selectedBook) {
    const exact = matching.find((row) => row.book === selectedBook);
    if (exact) return { snapshot: exact, source: "selected_book" };
  }

  // One latest quote per book, then choose the median implied probability.
  // This avoids calling a best-price outlier a market close when the original
  // scanner did not persist the selected sportsbook.
  const latestByBook = new Map<string, MarketOddsSnapshot>();
  for (const row of matching) {
    if (!latestByBook.has(row.book)) latestByBook.set(row.book, row);
  }
  const consensus = [...latestByBook.values()].sort((a, b) => {
    const ap = americanToImpliedProbability(a.price) ?? 0;
    const bp = americanToImpliedProbability(b.price) ?? 0;
    return ap - bp;
  });
  return {
    snapshot: consensus[Math.floor(consensus.length / 2)] ?? null,
    source: "consensus_median",
  };
}

export function probabilityClvPercentagePoints(
  openingOdds: unknown,
  closingOdds: unknown,
): number | null {
  const opening = americanToImpliedProbability(openingOdds);
  const closing = americanToImpliedProbability(closingOdds);
  if (opening === null || closing === null) return null;
  return Math.round((closing - opening) * 10_000) / 100;
}
