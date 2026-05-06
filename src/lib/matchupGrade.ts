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

/* ── Confidence / parlay grade helpers ── */

export type ConfidenceGrade = "strong" | "lean" | "risky";
export type CanonicalVerdict = "STRONG" | "LEAN" | "RISKY" | "PASS";

const STRONG = 72;
const LEAN = 58;
const RISKY = 42;

export function normalizeConfidencePercent(input: unknown, fallback = 0): number {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string"
      ? parseFloat(input)
      : NaN;
  if (!Number.isFinite(n)) return fallback;
  const percent = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, percent));
}

export function normalizeConfidence01(input: unknown, fallback = 0): number {
  return normalizeConfidencePercent(input, fallback * 100) / 100;
}

export function safeConfidence(input: unknown, fallback = 0): number {
  return normalizeConfidencePercent(input, fallback);
}

export function verdictFromConfidence(confidence: unknown): CanonicalVerdict {
  const n = normalizeConfidencePercent(confidence, 0);
  if (n >= STRONG) return "STRONG";
  if (n >= LEAN) return "LEAN";
  if (n >= RISKY) return "RISKY";
  return "PASS";
}

export function normalizeVerdict(verdict: unknown, confidence?: unknown): CanonicalVerdict {
  const v = String(verdict ?? "").trim().toUpperCase();
  if (v.includes("STRONG")) return "STRONG";
  if (v.includes("LEAN")) return "LEAN";
  if (v.includes("RISKY") || v.includes("SLIGHT") || v.includes("MARGINAL")) return "RISKY";
  if (v.includes("PASS") || v.includes("FADE") || v.includes("DO NOT BET") || v.includes("NO BET")) return "PASS";
  return verdictFromConfidence(confidence);
}

export function verdictDisplayText(verdict: unknown, confidence?: unknown): string {
  return normalizeVerdict(verdict, confidence);
}

export function verdictColorHex(verdict: unknown, confidence?: unknown): string {
  switch (normalizeVerdict(verdict, confidence)) {
    case "STRONG": return "#22c55e";
    case "LEAN": return "#22d3ee";
    case "RISKY": return "#f59e0b";
    case "PASS": return "#ef4444";
  }
}

export function gradeFromConfidence(conf: unknown): ConfidenceGrade {
  const n = safeConfidence(conf, NaN);
  if (!Number.isFinite(n)) return "risky";
  if (n >= STRONG) return "strong";
  if (n >= LEAN) return "lean";
  return "risky";
}

export function formatConfidence(conf: unknown): string {
  const n = safeConfidence(conf, NaN);
  return Number.isFinite(n) ? `${n.toFixed(0)}%` : "—";
}

export function extractConfidence(data: any): number {
  if (typeof data?.confidence === "number") return safeConfidence(data.confidence);
  if (typeof data?.confidence?.overall_confidence === "number")
    return safeConfidence(data.confidence.overall_confidence);
  if (typeof data?.ml_pick?.probability === "number")
    return safeConfidence(data.ml_pick.probability);
  if (typeof data?.probability === "number") return safeConfidence(data.probability);
  return 0;
}

export function normalizeGrade(grade: unknown): ConfidenceGrade {
  if (grade === "strong" || grade === "lean" || grade === "risky") return grade;
  return "risky";
}
