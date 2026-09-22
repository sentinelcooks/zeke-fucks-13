-- NFL feature store (shared RAW data for both NFL engines).
--
-- Populated by scripts/nfl/ingest.ts (Node, scheduled by
-- .github/workflows/nfl-ingest.yml) from nflverse public data. Play-by-play
-- is too large for an Edge Function's CPU budget, so ingestion happens
-- outside Supabase and upserts here with the service role.
--
-- These tables hold OBSERVED data only. Predictions live in the separate,
-- engine-specific tables created in 20260921000100_nfl_edge_engines.sql.
--
-- RLS: enabled with no anon/authenticated policies. Only the service role
-- (edge functions, ingest script) reads or writes.

CREATE TABLE IF NOT EXISTS public.nfl_games (
  game_id text NOT NULL,
  season integer NOT NULL,
  game_type text NOT NULL,
  week integer NOT NULL,
  gameday text NOT NULL,
  gametime text,
  kickoff timestamptz,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score numeric,
  away_score numeric,
  location text,
  roof text,
  surface text,
  temp numeric,
  wind numeric,
  home_rest numeric,
  away_rest numeric,
  div_game boolean NOT NULL,
  home_coach text,
  away_coach text,
  home_qb_id text,
  away_qb_id text,
  stadium_id text,
  spread_line numeric,
  total_line numeric,
  home_moneyline numeric,
  away_moneyline numeric,
  home_spread_odds numeric,
  away_spread_odds numeric,
  over_odds numeric,
  under_odds numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id)
);
CREATE INDEX IF NOT EXISTS nfl_games_season_week_idx ON public.nfl_games (season, week);
CREATE INDEX IF NOT EXISTS nfl_games_kickoff_idx ON public.nfl_games (kickoff);

CREATE TABLE IF NOT EXISTS public.nfl_team_week_features (
  season integer NOT NULL,
  week integer NOT NULL,
  game_id text NOT NULL,
  team text NOT NULL,
  opponent text NOT NULL,
  is_home boolean NOT NULL,
  points_for numeric,
  points_against numeric,
  off_plays numeric NOT NULL,
  off_epa_sum numeric NOT NULL,
  off_success numeric NOT NULL,
  off_dropbacks numeric NOT NULL,
  off_dropback_epa_sum numeric NOT NULL,
  off_dropback_success numeric NOT NULL,
  off_rushes numeric NOT NULL,
  off_rush_epa_sum numeric NOT NULL,
  off_rush_success numeric NOT NULL,
  off_explosive_pass numeric NOT NULL,
  off_explosive_rush numeric NOT NULL,
  off_sacks numeric NOT NULL,
  off_qb_hits numeric NOT NULL,
  off_pressured_dropbacks numeric NOT NULL,
  off_pressured_epa_sum numeric NOT NULL,
  off_interceptions numeric NOT NULL,
  off_fumbles numeric NOT NULL,
  off_fumbles_lost numeric NOT NULL,
  off_drives numeric NOT NULL,
  off_drive_points numeric NOT NULL,
  off_rz_drives numeric NOT NULL,
  off_rz_td_drives numeric NOT NULL,
  off_neutral_plays numeric NOT NULL,
  off_neutral_dropbacks numeric NOT NULL,
  off_pass_oe_sum numeric NOT NULL,
  off_pass_oe_n numeric NOT NULL,
  off_cpoe_sum numeric NOT NULL,
  off_cpoe_n numeric NOT NULL,
  off_qb_epa_sum numeric NOT NULL,
  off_seconds_per_play_sum numeric NOT NULL,
  off_seconds_per_play_n numeric NOT NULL,
  off_fg_att numeric NOT NULL,
  off_fg_made numeric NOT NULL,
  off_td numeric NOT NULL,
  def_plays numeric NOT NULL,
  def_epa_sum numeric NOT NULL,
  def_success numeric NOT NULL,
  def_dropbacks numeric NOT NULL,
  def_dropback_epa_sum numeric NOT NULL,
  def_dropback_success numeric NOT NULL,
  def_rushes numeric NOT NULL,
  def_rush_epa_sum numeric NOT NULL,
  def_rush_success numeric NOT NULL,
  def_explosive_pass numeric NOT NULL,
  def_explosive_rush numeric NOT NULL,
  def_sacks numeric NOT NULL,
  def_qb_hits numeric NOT NULL,
  def_interceptions numeric NOT NULL,
  def_fumbles_forced numeric NOT NULL,
  def_fumbles_recovered numeric NOT NULL,
  def_drives numeric NOT NULL,
  def_drive_points numeric NOT NULL,
  def_rz_drives numeric NOT NULL,
  def_rz_td_drives numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, team)
);
CREATE INDEX IF NOT EXISTS nfl_team_week_team_idx ON public.nfl_team_week_features (team, season, week);

CREATE TABLE IF NOT EXISTS public.nfl_player_week (
  season integer NOT NULL,
  week integer NOT NULL,
  game_id text NOT NULL,
  player_id text NOT NULL,
  player_name text NOT NULL,
  position text NOT NULL,
  team text NOT NULL,
  opponent text NOT NULL,
  is_home boolean,
  offense_snaps numeric,
  offense_pct numeric,
  team_offense_snaps numeric,
  routes numeric,
  targets numeric NOT NULL,
  rz_targets numeric NOT NULL,
  air_yards numeric NOT NULL,
  target_share numeric,
  air_yards_share numeric,
  carries numeric NOT NULL,
  rz_carries numeric NOT NULL,
  gl_carries numeric NOT NULL,
  team_carries numeric,
  team_dropbacks numeric,
  receptions numeric NOT NULL,
  receiving_yards numeric NOT NULL,
  receiving_tds numeric NOT NULL,
  rushing_yards numeric NOT NULL,
  rushing_tds numeric NOT NULL,
  pass_attempts numeric NOT NULL,
  completions numeric NOT NULL,
  passing_yards numeric NOT NULL,
  passing_tds numeric NOT NULL,
  interceptions numeric NOT NULL,
  sacks_taken numeric NOT NULL,
  passing_epa numeric,
  passing_cpoe numeric,
  rushing_epa numeric,
  receiving_epa numeric,
  fg_made numeric NOT NULL,
  fg_att numeric NOT NULL,
  fg_made_40_plus numeric NOT NULL,
  fg_att_40_plus numeric NOT NULL,
  pat_made numeric NOT NULL,
  pat_att numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, player_id)
);
CREATE INDEX IF NOT EXISTS nfl_player_week_player_idx ON public.nfl_player_week (player_id, season, week);
CREATE INDEX IF NOT EXISTS nfl_player_week_team_idx ON public.nfl_player_week (team, season, week);
CREATE INDEX IF NOT EXISTS nfl_player_week_opp_pos_idx ON public.nfl_player_week (opponent, position, season);

CREATE TABLE IF NOT EXISTS public.nfl_injuries (
  season integer NOT NULL,
  week integer NOT NULL,
  team text NOT NULL,
  player_id text NOT NULL,
  player_name text NOT NULL,
  position text NOT NULL,
  report_status text,
  practice_status text,
  report_primary_injury text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, team, player_id)
);

CREATE TABLE IF NOT EXISTS public.nfl_ingest_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  seasons integer[] NOT NULL,
  row_counts jsonb NOT NULL
);

-- Production allowed by each defense to each position, per game. Mirrors
-- _shared/nfl/data/position_allowed.ts so edge functions avoid pulling every
-- player row.
CREATE OR REPLACE VIEW public.nfl_position_allowed
WITH (security_invoker = true) AS
SELECT season, week, opponent AS defense, position,
  sum(targets) AS targets, sum(receptions) AS receptions, sum(receiving_yards) AS receiving_yards,
  sum(receiving_tds) AS receiving_tds, sum(carries) AS carries, sum(rushing_yards) AS rushing_yards,
  sum(rushing_tds) AS rushing_tds, sum(pass_attempts) AS pass_attempts, sum(completions) AS completions,
  sum(passing_yards) AS passing_yards, sum(passing_tds) AS passing_tds, sum(interceptions) AS interceptions,
  sum(fg_att) AS fg_att, sum(fg_made) AS fg_made
FROM public.nfl_player_week
GROUP BY season, week, opponent, position;

ALTER TABLE public.nfl_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_team_week_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_player_week ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_injuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_ingest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfl_position_allowed FROM anon, authenticated;
