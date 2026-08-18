-- Add WNBA to the existing nightly slate pipeline. The shared cron invoker
-- is created by 20260514000200_schedule_slate_scanners.sql and sends the
-- service-role credential expected by both functions.

-- Dedicated workers own NBA/WNBA/MLB/NHL finalization and apply the canonical
-- per-sport edge gate. Keep the legacy generic drainer from racing those
-- workers and finalizing a row with its older intended-tier behavior. UFC
-- and future fallback sports continue through process-analyzer-queue.
CREATE OR REPLACE FUNCTION public.claim_analyzer_queue(p_batch_size int)
RETURNS SETOF public.analyzer_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.analyzer_queue
     WHERE status = 'pending'
       AND sport NOT IN ('nba', 'wnba', 'mlb', 'nhl')
       AND next_run_after <= now()
       AND attempts < max_attempts
     ORDER BY pick_date DESC, created_at ASC
     LIMIT GREATEST(1, LEAST(p_batch_size, 25))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.analyzer_queue q
     SET status = 'processing',
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
   RETURNING q.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_analyzer_queue(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_analyzer_queue(int) TO service_role;

DO $$
DECLARE
  v_jobs text[] := ARRAY[
    'slate-scanner-wnba-est',
    'slate-scanner-wnba-edt',
    'analyzer-worker-wnba-2min'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_jobs LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

-- Run after the existing NBA/MLB/NHL/UFC discovery jobs to avoid competing
-- with them for Odds API and analyzer capacity. Dual UTC slots are guarded
-- by New York wall time so exactly one runs through DST changes.
SELECT cron.schedule('slate-scanner-wnba-edt', '25 4 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:25'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:30' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-wnba');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-wnba-est', '25 5 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:25'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:30' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-wnba');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('analyzer-worker-wnba-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('analyzer-worker-wnba');
$cron$);
