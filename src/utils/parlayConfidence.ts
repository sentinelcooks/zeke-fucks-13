import { americanToImplied } from "./oddsFormat";

export type ParlayLabel = "Strong" | "Edge" | "Solid" | "Lean" | "Risky";
export type ParlayTone = "green" | "blue" | "yellow" | "orange" | "red";
export type ConfidenceSource = "model" | "odds" | "fallback";
export type ParlayResult = "win" | "loss" | "push" | "pending";

const FALLBACK_PROB = 0.5;

export function normalizeConfidence(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  let p = raw > 1 ? raw / 100 : raw;
  if (p < 0) p = 0;
  if (p > 1) p = 1;
  return p;
}

export function parlayLabel(combinedProb: number): { label: ParlayLabel; tone: ParlayTone } {
  if (combinedProb >= 0.6) return { label: "Strong", tone: "green" };
  if (combinedProb >= 0.5) return { label: "Edge", tone: "blue" };
  if (combinedProb >= 0.4) return { label: "Solid", tone: "yellow" };
  if (combinedProb >= 0.3) return { label: "Lean", tone: "orange" };
  return { label: "Risky", tone: "red" };
}

export function combineLegProbabilities(probs: number[]): number {
  if (probs.length === 0) return 0;
  return probs.reduce((acc, p) => acc * p, 1);
}

export function gradeParlayFromLegResults(
  legResults: (string | null | undefined)[]
): ParlayResult {
  if (legResults.length === 0) return "pending";
  const norm = legResults.map((r) => (r ?? "pending").toLowerCase());
  if (norm.some((r) => r === "loss" || r === "miss")) return "loss";
  if (norm.some((r) => r === "pending" || r === "" || r == null)) return "pending";
  if (norm.every((r) => r === "push" || r === "void")) return "push";
  return "win";
}

export interface LegInput {
  sport?: string;
  player?: string;
  betType?: string;
  line?: string | number | null;
  direction?: string;
  odds?: string | number | null;
}

export interface ResolvedLegConfidence {
  probability: number;
  source: ConfidenceSource;
  pickId: string | null;
  result: string | null;
}

export interface DailyPickRow {
  id: string;
  sport: string;
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  hit_rate: number | null;
  result: string | null;
  pick_date: string;
}

export interface PickHistoryRow {
  id: string;
  sport: string;
  player_name: string;
  prop_type: string;
  direction: string;
  line: number;
  hit_rate: number | null;
  result: string | null;
}

function normProp(s?: string | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchPickRow<T extends { sport: string; player_name: string; prop_type: string; direction: string; line: number }>(
  rows: T[] | null | undefined,
  leg: LegInput
): T | null {
  if (!rows || rows.length === 0) return null;
  const legSport = (leg.sport ?? "").toLowerCase();
  const legPlayer = (leg.player ?? "").toLowerCase();
  const legProp = normProp(leg.betType);
  const legDir = (leg.direction ?? "").toLowerCase();
  const legLine = typeof leg.line === "number" ? leg.line : parseFloat(String(leg.line ?? ""));
  for (const r of rows) {
    if ((r.sport ?? "").toLowerCase() !== legSport) continue;
    if ((r.player_name ?? "").toLowerCase() !== legPlayer) continue;
    if (normProp(r.prop_type) !== legProp) continue;
    if ((r.direction ?? "").toLowerCase() !== legDir) continue;
    if (Number.isFinite(legLine) && Number(r.line) !== legLine) continue;
    return r;
  }
  return null;
}

export function resolveLegConfidence(
  leg: LegInput,
  dailyMatch: DailyPickRow | null,
  historyMatch: PickHistoryRow | null
): ResolvedLegConfidence {
  const dailyConf = normalizeConfidence(dailyMatch?.hit_rate ?? null);
  if (dailyConf != null && dailyConf > 0) {
    return {
      probability: dailyConf,
      source: "model",
      pickId: dailyMatch?.id ?? null,
      result: dailyMatch?.result ?? null,
    };
  }
  const histConf = normalizeConfidence(historyMatch?.hit_rate ?? null);
  if (histConf != null && histConf > 0) {
    return {
      probability: histConf,
      source: "model",
      pickId: historyMatch?.id ?? null,
      result: historyMatch?.result ?? null,
    };
  }
  const oddsRaw = leg.odds == null ? NaN : parseFloat(String(leg.odds));
  if (Number.isFinite(oddsRaw) && oddsRaw !== 0) {
    const implied = americanToImplied(oddsRaw);
    if (implied > 0) {
      return { probability: implied, source: "odds", pickId: null, result: null };
    }
  }
  return {
    probability: FALLBACK_PROB,
    source: "fallback",
    pickId: null,
    result: dailyMatch?.result ?? historyMatch?.result ?? null,
  };
}

export function gradeColorClasses(label: ParlayLabel): { text: string; bg: string } {
  switch (label) {
    case "Strong":
      return { text: "text-nba-green", bg: "bg-nba-green/15 text-nba-green" };
    case "Edge":
      return { text: "text-accent", bg: "bg-accent/15 text-accent" };
    case "Solid":
      return { text: "text-nba-yellow", bg: "bg-nba-yellow/15 text-nba-yellow" };
    case "Lean":
      return { text: "text-orange-400", bg: "bg-orange-400/15 text-orange-400" };
    case "Risky":
    default:
      return { text: "text-nba-red", bg: "bg-nba-red/15 text-nba-red" };
  }
}

export function gradeFromString(grade: string | null | undefined): ParlayLabel {
  const g = (grade ?? "").toLowerCase();
  if (g === "strong") return "Strong";
  if (g === "edge") return "Edge";
  if (g === "solid") return "Solid";
  if (g === "lean") return "Lean";
  return "Risky";
}
