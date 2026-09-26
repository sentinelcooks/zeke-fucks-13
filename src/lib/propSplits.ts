/**
 * Game-log helpers for the prop analysis screen: parsing analyzer rows,
 * splits (Season / H2H / L5 / L10 / L20) and hit rates.
 *
 * Hit-rate rules mirror the analyzer (supabase/functions/_shared/prop_analysis_base.ts):
 * a game hits only when strictly over/under the line; pushes count toward the total.
 */

export type Direction = "over" | "under";
export type SplitKey = "season" | "h2h" | "l5" | "l10" | "l20";

export interface GameRowLike {
  date?: string;
  matchup?: string;
  result?: string;
  stat_value?: unknown;
  [key: string]: unknown;
}

export interface ParsedGame {
  /** Position in the analyzer's game_log (chronological, oldest first). */
  index: number;
  value: number;
  dateLabel: string;
  opponent: string;
  away: boolean;
  result: "W" | "L" | null;
  raw: GameRowLike;
}

/** "09/05" → "9/5"; ISO dates → "M/D" (read from the string, so no timezone shift). */
export function dateLabel(raw?: string): string {
  if (!raw) return "";
  const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) return `${Number(md[1])}/${Number(md[2])}`;
  const iso = raw.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[1])}/${Number(iso[2])}`;
  return raw;
}

/** "LAL vs. DEN" → DEN at home; "LAL @ DEN" → DEN away. */
export function opponentOf(matchup?: string): { opponent: string; away: boolean } {
  if (!matchup) return { opponent: "", away: false };
  const away = matchup.includes("@");
  const opponent = matchup.replace(/.*(?:vs\.?|@)\s*/i, "").trim();
  return { opponent, away };
}

export function parseGames(rows: unknown): ParsedGame[] {
  if (!Array.isArray(rows)) return [];
  const out: ParsedGame[] = [];
  rows.forEach((row: GameRowLike, index) => {
    const value = typeof row?.stat_value === "number" ? row.stat_value : Number(row?.stat_value);
    if (row?.stat_value == null || !Number.isFinite(value)) return;
    const { opponent, away } = opponentOf(row.matchup);
    const result = row.result === "W" || row.result === "L" ? row.result : null;
    out.push({ index, value, dateLabel: dateLabel(row.date), opponent, away, result, raw: row });
  });
  return out;
}

export function hitRate(values: number[], line: number, direction: Direction): { hits: number; total: number; pct: number | null } {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return { hits: 0, total: 0, pct: null };
  const hits = usable.filter((v) => (direction === "over" ? v > line : v < line)).length;
  return { hits, total: usable.length, pct: Math.round((hits / usable.length) * 100) };
}

export function splitGames(games: ParsedGame[], h2h: ParsedGame[], key: SplitKey): ParsedGame[] {
  switch (key) {
    case "l5": return games.slice(-5);
    case "l10": return games.slice(-10);
    case "l20": return games.slice(-20);
    case "h2h": return h2h;
    default: return games;
  }
}

export function average(values: number[]): number | null {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

// Prop groups, kept in step with GamesTable in src/pages/NbaPropsPage.tsx.
const MLB_HITTING = new Set(["hits", "runs", "rbi", "home_runs", "doubles", "total_bases", "walks", "stolen_bases", "h+r+rbi", "hits+runs"]);
const MLB_PITCHING = new Set(["strikeouts", "hits_allowed", "earned_runs", "walks_allowed", "outs_recorded", "pitcher_strikeouts"]);

/** Box-score columns (analyzer game_log keys) worth showing for a sport + prop. */
export function boxScoreColumns(sport: string, propType?: string | null): Array<[key: string, label: string]> {
  const prop = (propType || "").toLowerCase();
  if (prop.startsWith("1q_")) {
    return [["Q1_PTS", "1Q Pts"], ["Q1_REB", "1Q Reb"], ["Q1_AST", "1Q Ast"], ["Q1_FG3M", "1Q 3PM"], ["MIN", "Min"]];
  }
  if (sport === "mlb") {
    if (MLB_PITCHING.has(prop)) return [["IP", "IP"], ["K", "K"], ["ER", "ER"], ["BB", "BB"], ["OUTS", "Outs"], ["PC", "Pitches"]];
    return [["H", "Hits"], ["R", "Runs"], ["RBI", "RBI"], ["HR", "HR"], ["TB", "TB"], ["BB", "BB"], ["SB", "SB"]];
  }
  if (sport === "nhl") {
    return [["G", "Goals"], ["A", "Assists"], ["SOG", "SOG"], ["PIM", "PIM"], ["PM", "+/-"], ["PPG", "PPG"], ["TOI", "TOI"]];
  }
  return [["MIN", "Min"], ["PTS", "Pts"], ["REB", "Reb"], ["AST", "Ast"], ["FG3M", "3PM"], ["STL", "Stl"], ["BLK", "Blk"]];
}

export { MLB_HITTING, MLB_PITCHING };

/** Line step for the chart's line stepper: fine for small lines, coarse for yardage. */
export function lineStep(line: number): number {
  if (line >= 50) return 5;
  if (line >= 10) return 1;
  return 0.5;
}

export function formatLine(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
