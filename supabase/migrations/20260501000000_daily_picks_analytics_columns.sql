-- Analytics fields for admin pick / edge history dashboards.
-- All columns are nullable so existing rows remain valid; the admin UI
-- and edge function tolerate NULLs and render "—" placeholders.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS league         text,
  ADD COLUMN IF NOT EXISTS model_used     text,
  ADD COLUMN IF NOT EXISTS model_version  text,
  ADD COLUMN IF NOT EXISTS edge_value     numeric,
  ADD COLUMN IF NOT EXISTS opening_odds   text,
  ADD COLUMN IF NOT EXISTS closing_odds   text,
  ADD COLUMN IF NOT EXISTS clv            numeric,
  ADD COLUMN IF NOT EXISTS stake_units    numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS profit_units   numeric,
  ADD COLUMN IF NOT EXISTS graded_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_daily_picks_model_used
  ON public.daily_picks (model_used);

CREATE INDEX IF NOT EXISTS idx_daily_picks_pick_date_tier_result
  ON public.daily_picks (pick_date DESC, tier, result);

CREATE INDEX IF NOT EXISTS idx_daily_picks_sport_pick_date
  ON public.daily_picks (sport, pick_date DESC);
