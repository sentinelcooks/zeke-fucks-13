/**
 * Pure nflverse → feature-store transforms.
 *
 * Why this is not an Edge Function: a season of nflverse play-by-play is
 * ~200 MB of CSV (372 columns × ~50k plays). Supabase Edge Functions have a
 * hard ~2 s CPU budget, so parsing it there is impossible. The Node script
 * `scripts/nfl/ingest.ts` streams the files and feeds rows into these
 * functions; the output rows are then upserted into the `nfl_*` tables that
 * the edge functions read.
 *
 * Everything here is deterministic and dependency-free so it is unit-testable
 * under vitest and importable from Node (type stripping) and Deno.
 */

import type {
  NflGameRow,
  NflInjuryRow,
  NflPlayerWeekRow,
  NflPosition,
  NflTeamWeekRow,
} from "./types.ts";

export type CsvRecord = Record<string, string>;

// ─── CSV ──────────────────────────────────────────────────────────────────

/** Split one CSV line, honouring double-quoted fields and escaped quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/**
 * Incremental CSV reader. Feed it text chunks in order; it yields header-keyed
 * records. Quoted fields that span a chunk boundary or a newline are buffered
 * until their closing quote arrives.
 *
 * `columns` restricts the emitted record to the named columns, which keeps
 * memory flat when reading the 372-column play-by-play file.
 */
export class CsvStreamReader {
  private header: string[] | null = null;
  private keep: number[] | null = null;
  private pending = "";
  private readonly columns: readonly string[] | undefined;

  // Plain assignment rather than a parameter property: Node's type stripping
  // (used by scripts/nfl/*) rejects parameter properties.
  constructor(columns?: readonly string[]) {
    this.columns = columns;
  }

  /** Returns every complete record contained in `chunk` (+ earlier remainder). */
  push(chunk: string): CsvRecord[] {
    this.pending += chunk;
    const records: CsvRecord[] = [];
    let start = 0;
    let inQuotes = false;
    for (let i = 0; i < this.pending.length; i++) {
      const ch = this.pending[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "\n" && !inQuotes) {
        const line = this.pending.slice(start, i).replace(/\r$/, "");
        start = i + 1;
        const rec = this.consumeLine(line);
        if (rec) records.push(rec);
      }
    }
    this.pending = this.pending.slice(start);
    return records;
  }

  /** Flush a final line with no trailing newline. */
  end(): CsvRecord[] {
    const rest = this.pending.replace(/\r?\n?$/, "");
    this.pending = "";
    if (!rest) return [];
    const rec = this.consumeLine(rest);
    return rec ? [rec] : [];
  }

  private consumeLine(line: string): CsvRecord | null {
    if (!line) return null;
    const cells = parseCsvLine(line);
    if (!this.header) {
      this.header = cells;
      if (this.columns) {
        const wanted = new Set(this.columns);
        this.keep = cells.map((c, idx) => (wanted.has(c) ? idx : -1)).filter((i) => i >= 0);
      }
      return null;
    }
    const rec: CsvRecord = {};
    const idxs = this.keep ?? this.header.map((_, i) => i);
    for (const i of idxs) rec[this.header[i]] = cells[i] ?? "";
    return rec;
  }
}

/** Parse a complete CSV string (small files: schedules, injuries, snaps). */
export function parseCsv(text: string, columns?: readonly string[]): CsvRecord[] {
  const reader = new CsvStreamReader(columns);
  return [...reader.push(text), ...reader.end()];
}

// ─── Field helpers ────────────────────────────────────────────────────────

export function num(v: string | undefined): number | null {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function n0(v: string | undefined): number {
  return num(v) ?? 0;
}

function flag(v: string | undefined): boolean {
  return v === "1" || v === "TRUE" || v === "true";
}

function str(v: string | undefined): string | null {
  return v === undefined || v === "" || v === "NA" ? null : v;
}

/**
 * Canonical team abbreviations. nflverse already uses current codes in recent
 * seasons, but older rows carry relocated franchises.
 */
const TEAM_ALIASES: Record<string, string> = {
  OAK: "LV",
  SD: "LAC",
  STL: "LA",
  LAR: "LA",
  JAC: "JAX",
  WSH: "WAS",
};

export function canonTeam(abbr: string | null | undefined): string {
  const t = String(abbr ?? "").trim().toUpperCase();
  return TEAM_ALIASES[t] ?? t;
}

/** Name key used to join sources that do not share a player id (snap counts, sportsbook names). */
export function normalizePlayerName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert an America/New_York wall time to a UTC ISO string without a tz
 * library: try both possible offsets and keep the one that round-trips.
 */
export function easternToUtcIso(date: string, time: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hhmm = time && /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5).padStart(5, "0") : "13:00";
  for (const offset of [4, 5]) {
    const candidate = new Date(`${date}T${hhmm}:00Z`);
    candidate.setUTCHours(candidate.getUTCHours() + offset);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    if (`${get("year")}-${get("month")}-${get("day")}` === date && `${hour}:${get("minute")}` === hhmm) {
      return candidate.toISOString();
    }
  }
  return null;
}

// ─── Schedule ─────────────────────────────────────────────────────────────

export function toGameRow(r: CsvRecord): NflGameRow | null {
  const season = num(r.season);
  const week = num(r.week);
  if (!r.game_id || season === null || week === null) return null;
  return {
    game_id: r.game_id,
    season,
    game_type: r.game_type || "REG",
    week,
    gameday: r.gameday,
    gametime: str(r.gametime),
    kickoff: easternToUtcIso(r.gameday, str(r.gametime)),
    home_team: canonTeam(r.home_team),
    away_team: canonTeam(r.away_team),
    home_score: num(r.home_score),
    away_score: num(r.away_score),
    location: str(r.location),
    roof: str(r.roof),
    surface: str(r.surface),
    temp: num(r.temp),
    wind: num(r.wind),
    home_rest: num(r.home_rest),
    away_rest: num(r.away_rest),
    div_game: flag(r.div_game),
    home_coach: str(r.home_coach),
    away_coach: str(r.away_coach),
    home_qb_id: str(r.home_qb_id),
    away_qb_id: str(r.away_qb_id),
    stadium_id: str(r.stadium_id),
    spread_line: num(r.spread_line),
    total_line: num(r.total_line),
    home_moneyline: num(r.home_moneyline),
    away_moneyline: num(r.away_moneyline),
    home_spread_odds: num(r.home_spread_odds),
    away_spread_odds: num(r.away_spread_odds),
    over_odds: num(r.over_odds),
    under_odds: num(r.under_odds),
  };
}

// ─── Injuries ─────────────────────────────────────────────────────────────

export function toInjuryRow(r: CsvRecord): NflInjuryRow | null {
  const season = num(r.season);
  const week = num(r.week);
  if (season === null || week === null || !r.gsis_id) return null;
  return {
    season,
    week,
    team: canonTeam(r.team),
    player_id: r.gsis_id,
    player_name: r.full_name || `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
    position: r.position || "",
    report_status: str(r.report_status),
    practice_status: str(r.practice_status),
    report_primary_injury: str(r.report_primary_injury),
  };
}

// ─── Play-by-play → team-week + player opportunity extras ────────────────

/** Columns read from play-by-play. Everything else is discarded while streaming. */
export const PBP_COLUMNS = [
  "game_id", "season", "season_type", "week", "home_team", "away_team", "posteam", "defteam",
  "yardline_100", "qtr", "game_seconds_remaining", "fixed_drive", "fixed_drive_result",
  "play_type", "pass", "rush", "qb_dropback", "qb_kneel", "qb_spike", "pass_attempt", "rush_attempt",
  "complete_pass", "yards_gained", "epa", "success", "wp", "sack", "qb_hit", "interception",
  "fumble", "fumble_lost", "fumbled_1_team", "touchdown", "td_team", "field_goal_attempt",
  "field_goal_result", "receiver_player_id", "rusher_player_id", "cpoe", "qb_epa", "pass_oe",
  "home_score", "away_score",
] as const;

interface DriveState {
  game_id: string;
  team: string;
  minYardline: number;
  result: string | null;
}

interface OffenseAcc {
  game_id: string;
  season: number;
  week: number;
  team: string;
  opponent: string;
  is_home: boolean;
  points_for: number | null;
  points_against: number | null;
  plays: number; epa: number; success: number;
  dropbacks: number; dbEpa: number; dbSuccess: number;
  rushes: number; rushEpa: number; rushSuccess: number;
  expPass: number; expRush: number;
  sacks: number; hits: number; pressured: number; pressuredEpa: number;
  ints: number; fumbles: number; fumblesLost: number;
  neutralPlays: number; neutralDropbacks: number;
  passOe: number; passOeN: number; cpoe: number; cpoeN: number; qbEpa: number;
  secPerPlay: number; secPerPlayN: number;
  fgAtt: number; fgMade: number; td: number;
  carries: number;
}

export interface PlayerOpportunityExtras {
  rz_targets: number;
  rz_carries: number;
  gl_carries: number;
}

/**
 * Streaming play-by-play aggregator. Call `add()` for each play record, then
 * `finish()` once. Memory is O(games × teams + drives + players), independent
 * of play count.
 */
export class PbpAggregator {
  private offense = new Map<string, OffenseAcc>(); // `${game_id}|${team}`
  private drives = new Map<string, DriveState>(); // `${game_id}|${team}|${fixed_drive}`
  private lastClock = new Map<string, number>(); // drive key → last game_seconds_remaining
  private players = new Map<string, PlayerOpportunityExtras>(); // `${game_id}|${player_id}`

  add(r: CsvRecord): void {
    const posteam = canonTeam(r.posteam);
    const defteam = canonTeam(r.defteam);
    if (!r.game_id || !posteam || !defteam) return;
    const season = num(r.season);
    const week = num(r.week);
    if (season === null || week === null) return;

    const home = canonTeam(r.home_team);
    const key = `${r.game_id}|${posteam}`;
    let acc = this.offense.get(key);
    if (!acc) {
      const isHome = posteam === home;
      const hs = num(r.home_score);
      const as = num(r.away_score);
      acc = newOffenseAcc(r.game_id, season, week, posteam, defteam, isHome,
        isHome ? hs : as, isHome ? as : hs);
      this.offense.set(key, acc);
    }

    const yardline = num(r.yardline_100);
    const fixedDrive = r.fixed_drive;
    if (fixedDrive) {
      const dk = `${r.game_id}|${posteam}|${fixedDrive}`;
      let d = this.drives.get(dk);
      if (!d) {
        d = { game_id: r.game_id, team: posteam, minYardline: 100, result: null };
        this.drives.set(dk, d);
      }
      if (yardline !== null) d.minYardline = Math.min(d.minYardline, yardline);
      if (r.fixed_drive_result) d.result = r.fixed_drive_result;
    }

    if (flag(r.field_goal_attempt)) {
      acc.fgAtt += 1;
      if (r.field_goal_result === "made") acc.fgMade += 1;
    }
    if (flag(r.touchdown) && canonTeam(r.td_team) === posteam) acc.td += 1;

    // Player opportunity extras (counted on real attempts only).
    if (flag(r.pass_attempt) && r.receiver_player_id && yardline !== null && yardline <= 20 && !flag(r.sack)) {
      this.player(r.game_id, r.receiver_player_id).rz_targets += 1;
    }
    if (flag(r.rush_attempt) && r.rusher_player_id && yardline !== null) {
      if (yardline <= 20) this.player(r.game_id, r.rusher_player_id).rz_carries += 1;
      if (yardline <= 5) this.player(r.game_id, r.rusher_player_id).gl_carries += 1;
    }
    if (flag(r.rush_attempt)) acc.carries += 1;

    // Scrimmage plays with a valid EPA — the standard nflverse filter.
    const epa = num(r.epa);
    const isPass = flag(r.pass);
    const isRush = flag(r.rush);
    if (epa === null || (!isPass && !isRush) || flag(r.qb_kneel) || flag(r.qb_spike)) return;

    const success = flag(r.success) ? 1 : 0;
    const gained = n0(r.yards_gained);
    acc.plays += 1;
    acc.epa += epa;
    acc.success += success;

    const dropback = flag(r.qb_dropback);
    if (dropback) {
      acc.dropbacks += 1;
      acc.dbEpa += epa;
      acc.dbSuccess += success;
      const sacked = flag(r.sack);
      if (sacked) acc.sacks += 1;
      if (sacked || flag(r.qb_hit)) {
        acc.hits += 1;
        acc.pressured += 1;
        acc.pressuredEpa += epa;
      }
      const qbEpa = num(r.qb_epa);
      if (qbEpa !== null) acc.qbEpa += qbEpa;
      const cpoe = num(r.cpoe);
      if (cpoe !== null) { acc.cpoe += cpoe; acc.cpoeN += 1; }
      if (flag(r.complete_pass) && gained >= 20) acc.expPass += 1;
    } else if (isRush) {
      acc.rushes += 1;
      acc.rushEpa += epa;
      acc.rushSuccess += success;
      if (gained >= 10) acc.expRush += 1;
    }
    if (flag(r.interception)) acc.ints += 1;
    if (flag(r.fumble) && canonTeam(r.fumbled_1_team) === posteam) {
      acc.fumbles += 1;
      if (flag(r.fumble_lost)) acc.fumblesLost += 1;
    }
    const passOe = num(r.pass_oe);
    if (passOe !== null) { acc.passOe += passOe; acc.passOeN += 1; }

    // Neutral situation: quarters 1-3, win probability 20-80%.
    const qtr = num(r.qtr);
    const wp = num(r.wp);
    if (qtr !== null && qtr <= 3 && wp !== null && wp >= 0.2 && wp <= 0.8) {
      acc.neutralPlays += 1;
      if (dropback) acc.neutralDropbacks += 1;
      const clock = num(r.game_seconds_remaining);
      if (clock !== null && fixedDrive) {
        const dk = `${r.game_id}|${posteam}|${fixedDrive}`;
        const prev = this.lastClock.get(dk);
        if (prev !== undefined) {
          const delta = prev - clock;
          if (delta > 0 && delta <= 60) { acc.secPerPlay += delta; acc.secPerPlayN += 1; }
        }
        this.lastClock.set(dk, clock);
      }
    }
  }

  private player(gameId: string, playerId: string): PlayerOpportunityExtras {
    const k = `${gameId}|${playerId}`;
    let p = this.players.get(k);
    if (!p) {
      p = { rz_targets: 0, rz_carries: 0, gl_carries: 0 };
      this.players.set(k, p);
    }
    return p;
  }

  finish(): {
    teamWeeks: NflTeamWeekRow[];
    playerExtras: Map<string, PlayerOpportunityExtras>;
    teamCounts: Map<string, { dropbacks: number; carries: number }>;
  } {
    // Drive-level outcomes per (game, team).
    const driveAgg = new Map<string, { drives: number; points: number; rz: number; rzTd: number }>();
    for (const d of this.drives.values()) {
      const k = `${d.game_id}|${d.team}`;
      const a = driveAgg.get(k) ?? { drives: 0, points: 0, rz: 0, rzTd: 0 };
      a.drives += 1;
      if (d.result === "Touchdown") a.points += 7;
      else if (d.result === "Field goal") a.points += 3;
      if (d.minYardline <= 20) {
        a.rz += 1;
        if (d.result === "Touchdown") a.rzTd += 1;
      }
      driveAgg.set(k, a);
    }

    const teamCounts = new Map<string, { dropbacks: number; carries: number }>();
    const teamWeeks: NflTeamWeekRow[] = [];
    for (const acc of this.offense.values()) {
      teamCounts.set(`${acc.game_id}|${acc.team}`, { dropbacks: acc.dropbacks, carries: acc.carries });
      const opp = this.offense.get(`${acc.game_id}|${acc.opponent}`);
      const dOff = driveAgg.get(`${acc.game_id}|${acc.team}`);
      const dDef = driveAgg.get(`${acc.game_id}|${acc.opponent}`);
      teamWeeks.push({
        season: acc.season,
        week: acc.week,
        game_id: acc.game_id,
        team: acc.team,
        opponent: acc.opponent,
        is_home: acc.is_home,
        points_for: acc.points_for,
        points_against: acc.points_against,
        off_plays: acc.plays,
        off_epa_sum: round4(acc.epa),
        off_success: acc.success,
        off_dropbacks: acc.dropbacks,
        off_dropback_epa_sum: round4(acc.dbEpa),
        off_dropback_success: acc.dbSuccess,
        off_rushes: acc.rushes,
        off_rush_epa_sum: round4(acc.rushEpa),
        off_rush_success: acc.rushSuccess,
        off_explosive_pass: acc.expPass,
        off_explosive_rush: acc.expRush,
        off_sacks: acc.sacks,
        off_qb_hits: acc.hits,
        off_pressured_dropbacks: acc.pressured,
        off_pressured_epa_sum: round4(acc.pressuredEpa),
        off_interceptions: acc.ints,
        off_fumbles: acc.fumbles,
        off_fumbles_lost: acc.fumblesLost,
        off_drives: dOff?.drives ?? 0,
        off_drive_points: dOff?.points ?? 0,
        off_rz_drives: dOff?.rz ?? 0,
        off_rz_td_drives: dOff?.rzTd ?? 0,
        off_neutral_plays: acc.neutralPlays,
        off_neutral_dropbacks: acc.neutralDropbacks,
        off_pass_oe_sum: round4(acc.passOe),
        off_pass_oe_n: acc.passOeN,
        off_cpoe_sum: round4(acc.cpoe),
        off_cpoe_n: acc.cpoeN,
        off_qb_epa_sum: round4(acc.qbEpa),
        off_seconds_per_play_sum: acc.secPerPlay,
        off_seconds_per_play_n: acc.secPerPlayN,
        off_fg_att: acc.fgAtt,
        off_fg_made: acc.fgMade,
        off_td: acc.td,
        def_plays: opp?.plays ?? 0,
        def_epa_sum: round4(opp?.epa ?? 0),
        def_success: opp?.success ?? 0,
        def_dropbacks: opp?.dropbacks ?? 0,
        def_dropback_epa_sum: round4(opp?.dbEpa ?? 0),
        def_dropback_success: opp?.dbSuccess ?? 0,
        def_rushes: opp?.rushes ?? 0,
        def_rush_epa_sum: round4(opp?.rushEpa ?? 0),
        def_rush_success: opp?.rushSuccess ?? 0,
        def_explosive_pass: opp?.expPass ?? 0,
        def_explosive_rush: opp?.expRush ?? 0,
        def_sacks: opp?.sacks ?? 0,
        def_qb_hits: opp?.hits ?? 0,
        def_interceptions: opp?.ints ?? 0,
        def_fumbles_forced: opp?.fumbles ?? 0,
        def_fumbles_recovered: opp?.fumblesLost ?? 0,
        def_drives: dDef?.drives ?? 0,
        def_drive_points: dDef?.points ?? 0,
        def_rz_drives: dDef?.rz ?? 0,
        def_rz_td_drives: dDef?.rzTd ?? 0,
      });
    }
    return { teamWeeks, playerExtras: this.players, teamCounts };
  }
}

function newOffenseAcc(
  game_id: string, season: number, week: number, team: string, opponent: string,
  is_home: boolean, points_for: number | null, points_against: number | null,
): OffenseAcc {
  return {
    game_id, season, week, team, opponent, is_home, points_for, points_against,
    plays: 0, epa: 0, success: 0, dropbacks: 0, dbEpa: 0, dbSuccess: 0,
    rushes: 0, rushEpa: 0, rushSuccess: 0, expPass: 0, expRush: 0,
    sacks: 0, hits: 0, pressured: 0, pressuredEpa: 0, ints: 0, fumbles: 0, fumblesLost: 0,
    neutralPlays: 0, neutralDropbacks: 0, passOe: 0, passOeN: 0, cpoe: 0, cpoeN: 0, qbEpa: 0,
    secPerPlay: 0, secPerPlayN: 0, fgAtt: 0, fgMade: 0, td: 0, carries: 0,
  };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

// ─── Player week (stats_player + snap counts + pbp extras) ───────────────

const OFFENSE_POSITIONS: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE", "K", "FB"]);

export interface SnapEntry {
  offense_snaps: number | null;
  offense_pct: number | null;
}

/** Key snap-count rows by name+team+game (snap counts use PFR ids, not gsis). */
export function buildSnapIndex(records: CsvRecord[]): {
  byPlayer: Map<string, SnapEntry>;
  teamSnaps: Map<string, number>;
} {
  const byPlayer = new Map<string, SnapEntry>();
  const teamSnaps = new Map<string, number>();
  for (const r of records) {
    const team = canonTeam(r.team);
    const snaps = num(r.offense_snaps);
    byPlayer.set(`${r.game_id}|${team}|${normalizePlayerName(r.player)}`, {
      offense_snaps: snaps,
      offense_pct: num(r.offense_pct),
    });
    // The busiest offensive player (usually an OL) played every team snap.
    const tk = `${r.game_id}|${team}`;
    if (snaps !== null && snaps > (teamSnaps.get(tk) ?? 0)) teamSnaps.set(tk, snaps);
  }
  return { byPlayer, teamSnaps };
}

export function toPlayerWeekRow(
  r: CsvRecord,
  snaps: ReturnType<typeof buildSnapIndex>,
  extras: Map<string, PlayerOpportunityExtras>,
  teamCounts: Map<string, { dropbacks: number; carries: number }>,
  homeByGame: Map<string, string>,
): NflPlayerWeekRow | null {
  const position = (r.position || "").toUpperCase();
  if (!OFFENSE_POSITIONS.has(position)) return null;
  const season = num(r.season);
  const week = num(r.week);
  if (season === null || week === null || !r.player_id || !r.game_id) return null;
  const team = canonTeam(r.team);
  const name = r.player_display_name || r.player_name || "";
  const snap = snaps.byPlayer.get(`${r.game_id}|${team}|${normalizePlayerName(name)}`);
  const ex = extras.get(`${r.game_id}|${r.player_id}`);
  const tc = teamCounts.get(`${r.game_id}|${team}`);
  const home = homeByGame.get(r.game_id);
  const fgBucket = (prefix: string) =>
    n0(r[`${prefix}_40_49`]) + n0(r[`${prefix}_50_59`]) + n0(r[`${prefix}_60_`]);
  return {
    season,
    week,
    game_id: r.game_id,
    player_id: r.player_id,
    player_name: name,
    position: position as NflPosition,
    team,
    opponent: canonTeam(r.opponent_team),
    is_home: home ? home === team : null,
    offense_snaps: snap?.offense_snaps ?? null,
    offense_pct: snap?.offense_pct ?? null,
    team_offense_snaps: snaps.teamSnaps.get(`${r.game_id}|${team}`) ?? null,
    routes: null,
    targets: n0(r.targets),
    rz_targets: ex?.rz_targets ?? 0,
    air_yards: n0(r.receiving_air_yards),
    target_share: num(r.target_share),
    air_yards_share: num(r.air_yards_share),
    carries: n0(r.carries),
    rz_carries: ex?.rz_carries ?? 0,
    gl_carries: ex?.gl_carries ?? 0,
    team_carries: tc?.carries ?? null,
    team_dropbacks: tc?.dropbacks ?? null,
    receptions: n0(r.receptions),
    receiving_yards: n0(r.receiving_yards),
    receiving_tds: n0(r.receiving_tds),
    rushing_yards: n0(r.rushing_yards),
    rushing_tds: n0(r.rushing_tds),
    pass_attempts: n0(r.attempts),
    completions: n0(r.completions),
    passing_yards: n0(r.passing_yards),
    passing_tds: n0(r.passing_tds),
    interceptions: n0(r.passing_interceptions ?? r.interceptions),
    sacks_taken: n0(r.sacks_suffered ?? r.sacks),
    passing_epa: num(r.passing_epa),
    passing_cpoe: num(r.passing_cpoe),
    rushing_epa: num(r.rushing_epa),
    receiving_epa: num(r.receiving_epa),
    fg_made: n0(r.fg_made),
    fg_att: n0(r.fg_att),
    fg_made_40_plus: fgBucket("fg_made"),
    fg_att_40_plus: fgBucket("fg_made") + fgBucket("fg_missed"),
    pat_made: n0(r.pat_made),
    pat_att: n0(r.pat_att),
  };
}
