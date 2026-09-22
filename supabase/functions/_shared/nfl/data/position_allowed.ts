/**
 * Observed production ALLOWED by each defense to each offensive position,
 * per game. Shared raw data (a plain aggregation of box scores), mirrored in
 * SQL by the `nfl_position_allowed` view so edge functions can read it without
 * pulling every player row.
 */

import type { NflPlayerWeekRow } from "./types.ts";

export interface NflPositionAllowedRow {
  season: number;
  week: number;
  defense: string;
  position: string;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  pass_attempts: number;
  completions: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  fg_att: number;
  fg_made: number;
}

export function aggregatePositionAllowed(rows: NflPlayerWeekRow[]): NflPositionAllowedRow[] {
  const map = new Map<string, NflPositionAllowedRow>();
  for (const r of rows) {
    const k = `${r.season}|${r.week}|${r.opponent}|${r.position}`;
    let a = map.get(k);
    if (!a) {
      a = {
        season: r.season, week: r.week, defense: r.opponent, position: r.position,
        targets: 0, receptions: 0, receiving_yards: 0, receiving_tds: 0,
        carries: 0, rushing_yards: 0, rushing_tds: 0,
        pass_attempts: 0, completions: 0, passing_yards: 0, passing_tds: 0, interceptions: 0,
        fg_att: 0, fg_made: 0,
      };
      map.set(k, a);
    }
    a.targets += r.targets;
    a.receptions += r.receptions;
    a.receiving_yards += r.receiving_yards;
    a.receiving_tds += r.receiving_tds;
    a.carries += r.carries;
    a.rushing_yards += r.rushing_yards;
    a.rushing_tds += r.rushing_tds;
    a.pass_attempts += r.pass_attempts;
    a.completions += r.completions;
    a.passing_yards += r.passing_yards;
    a.passing_tds += r.passing_tds;
    a.interceptions += r.interceptions;
    a.fg_att += r.fg_att;
    a.fg_made += r.fg_made;
  }
  return [...map.values()];
}
