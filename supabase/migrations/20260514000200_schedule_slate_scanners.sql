-- Native Supabase cron orchestration for the nightly slate pipeline.
-- Replaces (a) the external "Edge Deployer bot" midnight trigger and
-- (b) the prior continuous every-10-min scanner / every-1-min analyzer
-- crons that were applied directly to prod (not committed to migrations).
--
-- Pattern mirrors 20260427000000_schedule_grade_picks.sql:
--   pg_cron schedules a SQL body, body reads URL + service-role key from
--   Vault, body POSTs to the Edge Function via pg_net.
--
-- Vault secrets are reused from grade-picks (already populated in prod):
--   grade_picks_project_url
--   grade_picks_service_role_key
--
-- Scanners fire at 00:05 ET, staggered by sport. Analyzer drainers fire
-- every 2 min so the queue loaded at midnight actually empties; they
-- self-throttle (SKIP-LOCKED claim, per-sport caps, ~45s soft deadline)
-- and are no-ops when the queue is empty.
--
-- pg_cron runs in UTC and Supabase does not expose per-job timezones, so
-- each scanner is registered twice (EST + EDT UTC slots). Each body guards
-- on America/New_York wall time so exactly one slot fires per day
-- regardless of DST.
--
-- ?wait=1 is intentionally omitted. Production cron uses fire-and-forget
-- POST '{}'; ?wait=1 stays manual/debug only (per CLAUDE.md non-negotiable).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Reusable invoker. SECURITY DEFINER so cron-owned jobs can read vault
-- secrets without granting vault access broadly.
CREATE OR REPLACE FUNCTION public._cron_invoke_edge(
  p_function text,
  p_body     jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, vault
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'grade_picks_project_url'
    LIMIT 1;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'grade_picks_service_role_key'
    LIMIT 1;

  IF v_url IS NULL OR length(trim(v_url)) = 0
     OR v_key IS NULL OR length(trim(v_key)) = 0 THEN
    RAISE NOTICE 'scanner cron: vault secrets missing, skipping %', p_function;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := COALESCE(p_body, '{}'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public._cron_invoke_edge(text, jsonb) FROM PUBLIC;

-- Drop any prior registrations so this migration is rerunnable AND
-- decommission the legacy continuous-poll jobs that were applied directly
-- to prod (every-10-min scanners, every-1-min analyzer workers, the dual
-- process-analyzer-queue jobs). Each unschedule is guarded so the
-- migration succeeds whether the job exists or not.
DO $$
DECLARE
  v_jobs text[] := ARRAY[
    -- New jobnames owned by this migration (rerun safety)
    'slate-scanner-nba-est', 'slate-scanner-nba-edt',
    'slate-scanner-mlb-est', 'slate-scanner-mlb-edt',
    'slate-scanner-nhl-est', 'slate-scanner-nhl-edt',
    'slate-scanner-ufc-est', 'slate-scanner-ufc-edt',
    'analyzer-worker-nba-2min',
    'analyzer-worker-mlb-2min',
    'analyzer-worker-nhl-2min',
    'process-analyzer-queue-2min',
    'process-nba-analyzer-queue-2min',
    -- Legacy jobnames being decommissioned
    'slate-scanner-nba-every-10-min',
    'slate-scanner-mlb-every-10-min',
    'slate-scanner-nhl-every-10-min',
    'analyzer-worker-nba-every-1-min',
    'analyzer-worker-mlb-every-1-min',
    'analyzer-worker-nhl-every-1-min',
    'process-analyzer-queue-every-2-min',
    'process-nba-analyzer-queue-every-2-min'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_jobs LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

-- Scanner schedule. Each sport: two UTC slots, body guards on NY wall time.
--
--   NBA  00:05 ET  (04:05 UTC EDT, 05:05 UTC EST)
--   MLB  00:10 ET  (04:10 UTC EDT, 05:10 UTC EST)
--   NHL  00:15 ET  (04:15 UTC EDT, 05:15 UTC EST)
--   UFC  00:20 ET  (04:20 UTC EDT, 05:20 UTC EST)

SELECT cron.schedule('slate-scanner-nba-edt', '5 4 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:05'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:10' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nba');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-nba-est', '5 5 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:05'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:10' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nba');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-mlb-edt', '10 4 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:10'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:15' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-mlb');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-mlb-est', '10 5 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:10'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:15' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-mlb');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-nhl-edt', '15 4 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:15'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:20' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nhl');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-nhl-est', '15 5 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:15'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:20' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nhl');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-ufc-edt', '20 4 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:20'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:25' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-ufc');
  END IF;
END $body$;
$cron$);

SELECT cron.schedule('slate-scanner-ufc-est', '20 5 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '00:20'
     AND (now() AT TIME ZONE 'America/New_York')::time < '00:25' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-ufc');
  END IF;
END $body$;
$cron$);

-- Analyzer drainers: every 2 minutes (down from every 1 min). Workers
-- self-throttle via SKIP-LOCKED claim + per-sport caps + soft deadline
-- (~45s) so concurrent firings are safe and idle fires are cheap.
-- These cannot be midnight-only: the queue loaded by the midnight scanner
-- needs to drain over the following hour or two.

SELECT cron.schedule('analyzer-worker-nba-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('analyzer-worker-nba');
$cron$);

SELECT cron.schedule('analyzer-worker-mlb-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('analyzer-worker-mlb');
$cron$);

SELECT cron.schedule('analyzer-worker-nhl-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('analyzer-worker-nhl');
$cron$);

-- process-analyzer-queue is the generic drainer (covers UFC + leftovers).
SELECT cron.schedule('process-analyzer-queue-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('process-analyzer-queue');
$cron$);

-- NBA still has its own legacy queue table (nba_analyzer_queue). Keep a
-- generic-drainer twin pointed at process-nba-analyzer-queue so NBA inline-
-- path candidates continue to be processed.
SELECT cron.schedule('process-nba-analyzer-queue-2min', '*/2 * * * *', $cron$
  SELECT public._cron_invoke_edge('process-nba-analyzer-queue');
$cron$);
