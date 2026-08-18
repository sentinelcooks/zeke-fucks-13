-- Phase 2: only activate calibrations that improve an untouched chronological
-- holdout. Raw heuristic scores remain available for analysis, but cannot be
-- promoted as probabilities or edge picks without this evidence.

ALTER TABLE public.model_calibration
  ADD COLUMN IF NOT EXISTS train_samples integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_samples integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS holdout_brier numeric,
  ADD COLUMN IF NOT EXISTS holdout_log_loss numeric,
  ADD COLUMN IF NOT EXISTS holdout_baseline_brier numeric,
  ADD COLUMN IF NOT EXISTS holdout_baseline_log_loss numeric,
  ADD COLUMN IF NOT EXISTS evaluation_method text,
  ADD COLUMN IF NOT EXISTS holdout_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activation_reason text,
  ADD COLUMN IF NOT EXISTS data_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_end_at timestamptz;

-- Existing rows were fitted/evaluated in-sample and therefore do not meet the
-- new evidence standard. Keep them for audit history, but deactivate them.
UPDATE public.model_calibration
SET active = false,
    holdout_passed = false,
    activation_reason = COALESCE(activation_reason, 'legacy_in_sample_fit');

CREATE UNIQUE INDEX IF NOT EXISTS model_calibration_one_active_market_idx
  ON public.model_calibration (lower(sport), lower(bet_type))
  WHERE active = true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calibrate-model-nightly') THEN
    PERFORM cron.unschedule('calibrate-model-nightly');
  END IF;
END $$;

SELECT cron.schedule('calibrate-model-nightly', '30 6 * * *', $cron$
  SELECT public._cron_invoke_edge(
    'calibrate-model',
    jsonb_build_object('days', 365)
  );
$cron$);
