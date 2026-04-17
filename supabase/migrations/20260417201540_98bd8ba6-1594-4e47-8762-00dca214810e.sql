ALTER TABLE public.daily_picks ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'daily';
CREATE INDEX IF NOT EXISTS idx_daily_picks_pick_date_tier ON public.daily_picks (pick_date, tier);