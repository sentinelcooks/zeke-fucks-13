-- Phase 5: persist reproducible model-evaluation runs and isolate every
-- calibration by the exact immutable model version that produced its scores.

ALTER TABLE public.model_calibration
  ADD COLUMN IF NOT EXISTS model_version text;

-- Legacy active rows were not version-bound. Preserve them for audit history,
-- but never apply them to the rebuilt MLB/WNBA models.
UPDATE public.model_calibration
SET active = false,
    holdout_passed = false,
    activation_reason = 'model_version_not_recorded'
WHERE active = true
   OR model_version IS NULL
   OR btrim(model_version) = '';

CREATE INDEX IF NOT EXISTS model_calibration_version_lookup_idx
  ON public.model_calibration
    (lower(sport), lower(bet_type), model_version, fitted_at DESC);

CREATE TABLE IF NOT EXISTS public.model_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz,
  period_end timestamptz,
  methodology text NOT NULL,
  request_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_rows integer NOT NULL DEFAULT 0 CHECK (input_rows >= 0),
  included_rows integer NOT NULL DEFAULT 0 CHECK (included_rows >= 0),
  release_status text NOT NULL CHECK (
    release_status IN ('validated', 'insufficient_evidence', 'failed', 'no_edge_cohorts')
  ),
  report jsonb NOT NULL,
  created_by text NOT NULL DEFAULT 'model-evaluation'
);

CREATE INDEX IF NOT EXISTS model_evaluation_runs_evaluated_idx
  ON public.model_evaluation_runs (evaluated_at DESC);

CREATE INDEX IF NOT EXISTS model_evaluation_runs_status_idx
  ON public.model_evaluation_runs (release_status, evaluated_at DESC);

ALTER TABLE public.model_evaluation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages model evaluation runs"
  ON public.model_evaluation_runs;
CREATE POLICY "service role manages model evaluation runs"
  ON public.model_evaluation_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'model-evaluation-nightly') THEN
    PERFORM cron.unschedule('model-evaluation-nightly');
  END IF;
END $$;

-- Grading runs before calibration; evaluation runs afterward and persists the
-- evidence report without changing weights or promoting a model.
SELECT cron.schedule('model-evaluation-nightly', '0 7 * * *', $cron$
  SELECT public._cron_invoke_edge(
    'model-evaluation',
    jsonb_build_object('days', 365, 'persist', true)
  );
$cron$);
