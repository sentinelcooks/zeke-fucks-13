export type MatchupSource = "real" | "estimated" | "unavailable";

export interface MatchupMetric {
  label: string;
  value: string;
  source: MatchupSource;
}

export interface MatchupGrade {
  source: MatchupSource;
  gradeLabel: string | null;
  gradeScore: number | null;
  metrics: MatchupMetric[];
  summary: string | null;
  warnings: string[];
}

export function isValidMetric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v);
}

export function formatMatchupMetric(
  label: string,
  value: number | null | undefined,
  opts?: { decimals?: number; isRank?: boolean; source?: MatchupSource },
): MatchupMetric | null {
  if (!isValidMetric(value)) return null;
  const source = opts?.source ?? "real";
  if (opts?.isRank) {
    if (!Number.isInteger(value) || value < 1 || value > 32) return null;
    return { label, value: `#${value}`, source };
  }
  return { label, value: value.toFixed(opts?.decimals ?? 1), source };
}

type AnyPaceContext = {
  team?: Record<string, unknown> | null;
  opponent?: Record<string, unknown> | null;
  matchup_source?: MatchupSource;
} | null | undefined;

const num = (v: unknown): number | null => (isValidMetric(v) ? v : null);

export function buildMatchupGrade(
  sport: "nba" | "mlb" | "nhl" | "ufc" | string | undefined,
  paceContext: AnyPaceContext,
): MatchupGrade {
  const empty: MatchupGrade = {
    source: "unavailable",
    gradeLabel: null,
    gradeScore: null,
    metrics: [],
    summary: null,
    warnings: [],
  };

  const team = paceContext?.team ?? null;
  const opp = paceContext?.opponent ?? null;
  const declared: MatchupSource = paceContext?.matchup_source ?? "real";

  const metrics: MatchupMetric[] = [];
  const push = (m: MatchupMetric | null) => { if (m) metrics.push(m); };

  switch (sport) {
    case "nba": {
      push(formatMatchupMetric("OPP DEF RTG", num(opp?.["defRtg"])));
      push(formatMatchupMetric("PACE", num(team?.["pace"]) ?? num(opp?.["pace"])));
      break;
    }
    case "nhl": {
      push(formatMatchupMetric("OPP GA/G", num(opp?.["goalsAgainst"])));
      push(formatMatchupMetric("SHOTS/G", num(team?.["shotsPerGame"])));
      break;
    }
    case "mlb": {
      push(formatMatchupMetric("OPP RUNS/G", num(opp?.["runsPerGame"])));
      push(formatMatchupMetric("TEAM AVG", num(team?.["battingAvg"]), { decimals: 3 }));
      break;
    }
    case "ufc":
    default:
      break;
  }

  if (metrics.length === 0) return empty;

  return {
    source: declared === "estimated" ? "estimated" : "real",
    gradeLabel: null,
    gradeScore: null,
    metrics,
    summary: null,
    warnings: [],
  };
}
