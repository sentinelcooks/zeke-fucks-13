-- Phase 1: immutable prediction measurement and verified closing-line capture.
-- This migration does not change model weights or historical outcomes.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS grading_source text,
  ADD COLUMN IF NOT EXISTS opening_line numeric,
  ADD COLUMN IF NOT EXISTS opening_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_line numeric,
  ADD COLUMN IF NOT EXISTS closing_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_line_source text,
  ADD COLUMN IF NOT EXISTS clv_method text,
  ADD COLUMN IF NOT EXISTS selected_book text,
  ADD COLUMN IF NOT EXISTS score_kind text NOT NULL DEFAULT 'heuristic_score',
  ADD COLUMN IF NOT EXISTS calibration_status text NOT NULL DEFAULT 'not_calibrated',
  ADD COLUMN IF NOT EXISTS calibrated_probability numeric,
  ADD COLUMN IF NOT EXISTS prediction_recorded_at timestamptz;

UPDATE public.daily_picks
SET opening_odds = COALESCE(opening_odds, odds),
    opening_line = COALESCE(opening_line, line),
    opening_captured_at = COALESCE(opening_captured_at, created_at),
    prediction_recorded_at = COALESCE(prediction_recorded_at, created_at),
    score_kind = COALESCE(NULLIF(score_kind, ''), 'heuristic_score'),
    calibration_status = COALESCE(NULLIF(calibration_status, ''), 'not_calibrated')
WHERE opening_odds IS NULL
   OR opening_line IS NULL
   OR opening_captured_at IS NULL
   OR prediction_recorded_at IS NULL
   OR score_kind = ''
   OR calibration_status = '';

CREATE INDEX IF NOT EXISTS idx_daily_picks_measurement_cohort
  ON public.daily_picks (sport, bet_type, model_version, pick_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_picks_calibration_status
  ON public.daily_picks (sport, bet_type, calibration_status, graded_at DESC);

CREATE TABLE IF NOT EXISTS public.market_odds_snapshots (
  event_id text NOT NULL,
  sport text NOT NULL,
  book text NOT NULL,
  market text NOT NULL,
  outcome_name text NOT NULL,
  outcome_description text NOT NULL DEFAULT '',
  price integer NOT NULL,
  line numeric,
  commence_time timestamptz,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    event_id,
    book,
    market,
    outcome_name,
    outcome_description,
    snapshot_at
  )
);

CREATE INDEX IF NOT EXISTS idx_market_odds_snapshots_close_lookup
  ON public.market_odds_snapshots
    (event_id, sport, market, outcome_name, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_odds_snapshots_retention
  ON public.market_odds_snapshots (snapshot_at DESC);

ALTER TABLE public.market_odds_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages market odds snapshots"
  ON public.market_odds_snapshots;
CREATE POLICY "service role manages market odds snapshots"
  ON public.market_odds_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Capture MLB and WNBA game-market lines hourly. The function's quota guard
-- skips calls below the configured reserve, and all jobs use the existing
-- Vault-backed service-role invoker. Player-prop closing lines remain NULL
-- until a verified prop-history source is available; no substitute is used.
DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'odds-snapshot-mlb-hourly',
    'odds-snapshot-wnba-hourly'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule('odds-snapshot-mlb-hourly', '5 * * * *', $cron$
  SELECT public._cron_invoke_edge(
    'odds-snapshot',
    jsonb_build_object('sport', 'mlb')
  );
$cron$);

SELECT cron.schedule('odds-snapshot-wnba-hourly', '10 * * * *', $cron$
  SELECT public._cron_invoke_edge(
    'odds-snapshot',
    jsonb_build_object('sport', 'wnba')
  );
$cron$);
