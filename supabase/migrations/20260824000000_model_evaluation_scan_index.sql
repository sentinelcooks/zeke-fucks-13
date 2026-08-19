-- Keep chronological calibration/evaluation scans inside the production
-- statement timeout. Both functions filter and order on the immutable pregame
-- timestamp, and unresolved rows are excluded by this partial index.

CREATE INDEX IF NOT EXISTS idx_daily_picks_verified_prediction_scan
  ON public.daily_picks (prediction_recorded_at ASC)
  WHERE result IN ('hit', 'miss', 'push')
    AND prediction_recorded_at IS NOT NULL;
