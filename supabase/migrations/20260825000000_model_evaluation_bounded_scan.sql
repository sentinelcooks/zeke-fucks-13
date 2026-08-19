-- Support deterministic newest-first pagination for bounded calibration and
-- model-evaluation jobs. Keep the earlier single-column index for other
-- chronological consumers.

CREATE INDEX IF NOT EXISTS idx_daily_picks_verified_prediction_scan_latest
  ON public.daily_picks (prediction_recorded_at DESC, id DESC)
  WHERE result IN ('hit', 'miss', 'push')
    AND prediction_recorded_at IS NOT NULL;
