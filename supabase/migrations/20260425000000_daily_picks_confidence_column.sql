-- Daily picks confidence column
-- The frontend (ModernHomeLayout, FreePicksPage) orders by `confidence`
-- but the column never existed, so PostgREST returned 400 and the UI
-- silently rendered empty. This adds the column and an ordered index,
-- and backfills it from hit_rate (0-100 → 0-1) for any rows already
-- written in the legacy schema.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS confidence numeric;

UPDATE public.daily_picks
SET confidence = CASE
  WHEN hit_rate IS NULL THEN NULL
  WHEN hit_rate > 1 THEN hit_rate / 100.0
  ELSE hit_rate
END
WHERE confidence IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_picks_pick_date_confidence
  ON public.daily_picks (pick_date DESC, confidence DESC NULLS LAST);
