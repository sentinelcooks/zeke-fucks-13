/**
 * NFL raw-data contracts shared by BOTH NFL engines.
 *
 * This directory is the only code the Game Edge engine (`../game/`) and the
 * Player Prop Edge engine (`../prop/`) may have in common besides pure math.
 * Everything here is *observed* data (box-score/play-by-play aggregates,
 * schedule, injuries, market prices). Nothing here is a prediction.
 *
 * Row shapes mirror the `nfl_*` feature-store tables one-to-one (snake_case),
 * so the same objects flow from the ingest script → Postgres → edge functions →
 * engines with no remapping layer.
 *
 * Must stay dependency-free: it is imported by Deno edge functions AND by the
 * Node ingest/backtest scripts under `scripts/nfl/`.
 */

/** One game from the nflverse schedule (`nfl_games`). */
export interface NflGameRow {
  game_id: string;
  season: number;
  game_type: string; // REG | WC | DIV | CON | SB
  week: number;
  gameday: string; // YYYY-MM-DD
  gametime: string | null; // HH:MM (ET)
  kickoff: string | null; // ISO timestamp (UTC) when derivable
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  location: string | null; // Home | Neutral
  roof: string | null; // dome | outdoors | closed | open
  surface: string | null;
  temp: number | null;
  wind: number | null;
  home_rest: number | null;
  away_rest: number | null;
  div_game: boolean;
  home_coach: string | null;
  away_coach: string | null;
  home_qb_id: string | null;
  away_qb_id: string | null;
  stadium_id: string | null;
  // Closing market from nflverse. Used ONLY by backtests as the historical
  // market; live predictions read `market_odds_snapshots` instead.
  spread_line: number | null; // positive = home favoured by that many points
  total_line: number | null;
  home_moneyline: number | null;
  away_moneyline: number | null;
  home_spread_odds: number | null;
  away_spread_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
}

/**
 * One team's side of one game (`nfl_team_week_features`). Offensive columns
 * describe what this team's offense did; defensive columns describe what the
 * opponent's offense did against it. Stored as raw sums + counts (never
 * pre-divided) so any window can be re-aggregated exactly.
 */
export interface NflTeamWeekRow {
  season: number;
  week: number;
  game_id: string;
  team: string;
  opponent: string;
  is_home: boolean;
  points_for: number | null;
  points_against: number | null;

  // Offense
  off_plays: number;
  off_epa_sum: number;
  off_success: number;
  off_dropbacks: number;
  off_dropback_epa_sum: number;
  off_dropback_success: number;
  off_rushes: number;
  off_rush_epa_sum: number;
  off_rush_success: number;
  off_explosive_pass: number; // completed passes gaining 20+
  off_explosive_rush: number; // rushes gaining 10+
  off_sacks: number;
  off_qb_hits: number; // sacks + QB hits on dropbacks (pressure proxy)
  off_pressured_dropbacks: number;
  off_pressured_epa_sum: number;
  off_interceptions: number;
  off_fumbles: number;
  off_fumbles_lost: number;
  off_drives: number;
  off_drive_points: number; // TD=7 (≈ incl. PAT), FG=3 on offensive drives
  off_rz_drives: number;
  off_rz_td_drives: number;
  off_neutral_plays: number; // 1st-3rd qtr, win prob 20-80%, dropback or rush
  off_neutral_dropbacks: number;
  off_pass_oe_sum: number; // Σ pass_oe (percentage points) on plays with xpass
  off_pass_oe_n: number;
  off_cpoe_sum: number;
  off_cpoe_n: number;
  off_qb_epa_sum: number;
  off_seconds_per_play_sum: number; // neutral-situation pace numerator
  off_seconds_per_play_n: number;
  off_fg_att: number;
  off_fg_made: number;
  off_td: number;

  // Defense (opponent offense vs this team)
  def_plays: number;
  def_epa_sum: number;
  def_success: number;
  def_dropbacks: number;
  def_dropback_epa_sum: number;
  def_dropback_success: number;
  def_rushes: number;
  def_rush_epa_sum: number;
  def_rush_success: number;
  def_explosive_pass: number;
  def_explosive_rush: number;
  def_sacks: number;
  def_qb_hits: number;
  def_interceptions: number;
  def_fumbles_forced: number; // opponent fumbles
  def_fumbles_recovered: number; // opponent fumbles lost
  def_drives: number;
  def_drive_points: number;
  def_rz_drives: number;
  def_rz_td_drives: number;
}

export type NflPosition = "QB" | "RB" | "WR" | "TE" | "K" | "FB";

/** One player's box score + opportunity data for one game (`nfl_player_week`). */
export interface NflPlayerWeekRow {
  season: number;
  week: number;
  game_id: string;
  player_id: string; // gsis id
  player_name: string;
  position: NflPosition;
  team: string;
  opponent: string;
  is_home: boolean | null;

  // Opportunity
  offense_snaps: number | null;
  offense_pct: number | null; // 0..1
  team_offense_snaps: number | null;
  routes: number | null; // null = no participation data (engine falls back to a flagged proxy)
  targets: number;
  rz_targets: number; // targets with yardline_100 <= 20
  air_yards: number;
  target_share: number | null;
  air_yards_share: number | null;
  carries: number;
  rz_carries: number;
  gl_carries: number; // yardline_100 <= 5
  team_carries: number | null;
  team_dropbacks: number | null;

  // Production
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  rushing_yards: number;
  rushing_tds: number;
  pass_attempts: number;
  completions: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  sacks_taken: number;
  passing_epa: number | null;
  passing_cpoe: number | null;
  rushing_epa: number | null;
  receiving_epa: number | null;
  fg_made: number;
  fg_att: number;
  fg_made_40_plus: number;
  fg_att_40_plus: number;
  pat_made: number;
  pat_att: number;
}

/** One weekly injury-report entry (`nfl_injuries`). */
export interface NflInjuryRow {
  season: number;
  week: number;
  team: string;
  player_id: string;
  player_name: string;
  position: string;
  report_status: string | null; // Out | Doubtful | Questionable | null
  practice_status: string | null;
  report_primary_injury: string | null;
}

/** A two-way price pair for one market as of one snapshot. */
export interface NflPricePair {
  /** Line for side A (home spread, total points, or prop line). Null for moneylines. */
  line: number | null;
  price_a: number; // American odds, side A (home / over)
  price_b: number; // American odds, side B (away / under)
}

/** Market state for one two-way market, assembled from `market_odds_snapshots`. */
export interface NflMarketQuote {
  current: NflPricePair;
  opening: NflPricePair | null;
  /** Best available price per side across books at the current line. */
  best_price_a: number | null;
  best_book_a: string | null;
  best_price_b: number | null;
  best_book_b: string | null;
  books: number;
  snapshot_at: string | null;
}
