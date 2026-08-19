-- Keep each scheduled discovery invocation inside the Edge runtime budget.
-- MLB and WNBA still scan the complete available slate, but fan out five
-- deterministic four-event windows instead of one long request. The first
-- window also discovers game markets; later windows only discover props.
-- Analyzer workers retain their existing two-minute schedules and queue
-- deduplication, so batches cannot publish duplicate picks.

-- Atomically claim the least-recently-used uploaded key. Bounded concurrent
-- MLB market requests otherwise can select the same row before any request
-- finishes and updates last_used_at. This keeps the existing mass-upload pool
-- and status model while making rotation deterministic under concurrency.
CREATE OR REPLACE FUNCTION public.claim_available_odds_api_key()
RETURNS TABLE(key_id uuid, key_value text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT k.id
      FROM public.odds_api_keys k
     WHERE k.status = 'available'
     ORDER BY k.last_used_at ASC NULLS FIRST, k.created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.odds_api_keys k
       SET last_used_at = clock_timestamp()
      FROM candidate c
     WHERE k.id = c.id
     RETURNING k.id, k.api_key
  )
  SELECT c.id, c.api_key FROM claimed c;
$$;

REVOKE ALL ON FUNCTION public.claim_available_odds_api_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_available_odds_api_key() TO service_role;

DO $$
DECLARE
  v_jobs text[] := ARRAY[
    'slate-scanner-mlb-est',
    'slate-scanner-mlb-edt',
    'slate-scanner-wnba-est',
    'slate-scanner-wnba-edt'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_jobs LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

-- MLB: 00:10, 00:12, 00:14, 00:16, and 00:18 America/New_York.
-- Dual UTC schedules are guarded by New York wall time for DST.
SELECT cron.schedule('slate-scanner-mlb-edt', '10,12,14,16,18 4 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '00:10' AND v_local::time < '00:20' THEN
    v_batch := (EXTRACT(minute FROM v_local)::integer - 10) / 2;
    PERFORM public._cron_invoke_edge(
      'slate-scanner-mlb',
      jsonb_build_object(
        'batch_index', v_batch,
        'prop_event_offset', v_batch * 4,
        'prop_event_limit', 4,
        'include_game_lines', v_batch = 0
      )
    );
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-mlb-est', '10,12,14,16,18 5 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '00:10' AND v_local::time < '00:20' THEN
    v_batch := (EXTRACT(minute FROM v_local)::integer - 10) / 2;
    PERFORM public._cron_invoke_edge(
      'slate-scanner-mlb',
      jsonb_build_object(
        'batch_index', v_batch,
        'prop_event_offset', v_batch * 4,
        'prop_event_limit', 4,
        'include_game_lines', v_batch = 0
      )
    );
  END IF;
END $body$;
$cron$);

-- WNBA: 00:25, 00:27, 00:29, 00:31, and 00:33 America/New_York.
SELECT cron.schedule('slate-scanner-wnba-edt', '25,27,29,31,33 4 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '00:25' AND v_local::time < '00:35' THEN
    v_batch := (EXTRACT(minute FROM v_local)::integer - 25) / 2;
    PERFORM public._cron_invoke_edge(
      'slate-scanner-wnba',
      jsonb_build_object(
        'batch_index', v_batch,
        'prop_event_offset', v_batch * 4,
        'prop_event_limit', 4,
        'include_game_lines', v_batch = 0
      )
    );
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-wnba-est', '25,27,29,31,33 5 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '00:25' AND v_local::time < '00:35' THEN
    v_batch := (EXTRACT(minute FROM v_local)::integer - 25) / 2;
    PERFORM public._cron_invoke_edge(
      'slate-scanner-wnba',
      jsonb_build_object(
        'batch_index', v_batch,
        'prop_event_offset', v_batch * 4,
        'prop_event_limit', 4,
        'include_game_lines', v_batch = 0
      )
    );
  END IF;
END $body$;
$cron$);
