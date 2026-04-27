-- Add event-level fields so daily_picks can be filtered by actual game date,
-- not by scanner generation date (pick_date). Non-destructive.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS commence_time timestamptz,
  ADD COLUMN IF NOT EXISTS game_date date,
  ADD COLUMN IF NOT EXISTS home_team text,
  ADD COLUMN IF NOT EXISTS away_team text;

CREATE INDEX IF NOT EXISTS idx_daily_picks_game_date     ON public.daily_picks(game_date);
CREATE INDEX IF NOT EXISTS idx_daily_picks_commence_time ON public.daily_picks(commence_time);
CREATE INDEX IF NOT EXISTS idx_daily_picks_event_id      ON public.daily_picks(event_id);

-- Safe one-shot backfill: derive game_date from commence_time only where it
-- is missing. Uses America/New_York to match the public-display timezone.
UPDATE public.daily_picks
SET game_date = (commence_time AT TIME ZONE 'America/New_York')::date
WHERE game_date IS NULL AND commence_time IS NOT NULL;
