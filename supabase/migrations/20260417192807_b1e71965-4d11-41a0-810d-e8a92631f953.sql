
ALTER TABLE public.free_props
  ADD COLUMN IF NOT EXISTS bet_type text NOT NULL DEFAULT 'prop',
  ADD COLUMN IF NOT EXISTS home_team text,
  ADD COLUMN IF NOT EXISTS away_team text,
  ADD COLUMN IF NOT EXISTS spread_line numeric,
  ADD COLUMN IF NOT EXISTS total_line numeric,
  ADD COLUMN IF NOT EXISTS reasoning text;

CREATE INDEX IF NOT EXISTS idx_free_props_date_sport_conf
  ON public.free_props (prop_date DESC, sport, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_daily_picks_date_sport_hit
  ON public.daily_picks (pick_date DESC, sport, hit_rate DESC);
