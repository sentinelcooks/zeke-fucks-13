ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS bet_type text NOT NULL DEFAULT 'prop',
  ADD COLUMN IF NOT EXISTS spread_line numeric,
  ADD COLUMN IF NOT EXISTS total_line numeric,
  ADD COLUMN IF NOT EXISTS home_team text,
  ADD COLUMN IF NOT EXISTS away_team text;