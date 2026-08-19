-- Current, traceable MLB park run factors. No historical constants are seeded:
-- the refresh function derives each row from completed official MLB games.

CREATE TABLE IF NOT EXISTS public.mlb_park_factors (
  venue_id bigint NOT NULL,
  venue_name text NOT NULL,
  season integer NOT NULL,
  run_factor numeric(6,3) NOT NULL CHECK (run_factor BETWEEN 0.500 AND 1.500),
  home_games integer NOT NULL CHECK (home_games >= 20),
  road_games integer NOT NULL CHECK (road_games >= 20),
  as_of date NOT NULL,
  source text NOT NULL,
  methodology_version text NOT NULL DEFAULT 'home_road_run_environment_v1',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, season)
);

ALTER TABLE public.mlb_park_factors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mlb_park_factors FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mlb_park_factors TO service_role;

CREATE INDEX IF NOT EXISTS mlb_park_factors_season_as_of_idx
  ON public.mlb_park_factors (season, as_of DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-mlb-park-factors-daily') THEN
    PERFORM cron.unschedule('refresh-mlb-park-factors-daily');
  END IF;
END $$;

SELECT cron.schedule('refresh-mlb-park-factors-daily', '15 7 * * *', $cron$
  SELECT public._cron_invoke_edge('refresh-mlb-park-factors', '{}'::jsonb);
$cron$);
