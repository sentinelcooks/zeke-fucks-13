-- Move the daily slate scan from just after midnight ET to 4 AM ET.
--
-- Why: West-coast games start as late as ~10 PM ET and run past midnight. With
-- the day rolling at 00:00 ET, a still-live pick was pushed into "Yesterday's
-- Edge" as PENDING, and the next day's lineup was published while games from the
-- previous slate were still being played. By 4 AM ET no North American game is
-- in progress, so the new lineup and yesterday's settled results now appear
-- together. The app's slate boundary moved to the same hour
-- (src/lib/gameDate.ts, SLATE_ROLLOVER_HOUR_ET).
--
-- What changes: ONLY the time. Every job body is carried over verbatim from the
-- live definition except its New York wall-time guard (00:xx -> 04:xx). The
-- MLB/WNBA batch arithmetic keys off the minute, which is unchanged.
--
-- pg_cron runs in GMT, so each scanner keeps its EDT/EST pair. At 4 AM ET the
-- EDT job fires at 08:xx UTC and the EST job at 09:xx UTC; the wall-time guard
-- makes exactly one of the pair do work on any given date, so DST needs no
-- manual change.
--
-- Scan order is unchanged: NBA 04:05, MLB 04:10-04:18, NHL 04:15, UFC 04:20,
-- WNBA 04:25-04:33 (America/New_York).

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[    'slate-scanner-mlb-edt',
    'slate-scanner-mlb-est',
    'slate-scanner-nba-edt',
    'slate-scanner-nba-est',
    'slate-scanner-nhl-edt',
    'slate-scanner-nhl-est',
    'slate-scanner-ufc-edt',
    'slate-scanner-ufc-est',
    'slate-scanner-wnba-edt',
    'slate-scanner-wnba-est'  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

-- slate-scanner-mlb-edt: was '10,12,14,16,18 4 * * *' (guard 00:10)
SELECT cron.schedule('slate-scanner-mlb-edt', '10,12,14,16,18 8 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '04:10' AND v_local::time < '04:20' THEN
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

-- slate-scanner-mlb-est: was '10,12,14,16,18 5 * * *' (guard 00:10)
SELECT cron.schedule('slate-scanner-mlb-est', '10,12,14,16,18 9 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '04:10' AND v_local::time < '04:20' THEN
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

-- slate-scanner-nba-edt: was '5 4 * * *' (guard 00:05)
SELECT cron.schedule('slate-scanner-nba-edt', '5 8 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:05'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:10' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nba');
  END IF;
END $body$;
$cron$);

-- slate-scanner-nba-est: was '5 5 * * *' (guard 00:05)
SELECT cron.schedule('slate-scanner-nba-est', '5 9 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:05'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:10' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nba');
  END IF;
END $body$;
$cron$);

-- slate-scanner-nhl-edt: was '15 4 * * *' (guard 00:15)
SELECT cron.schedule('slate-scanner-nhl-edt', '15 8 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:15'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:20' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nhl');
  END IF;
END $body$;
$cron$);

-- slate-scanner-nhl-est: was '15 5 * * *' (guard 00:15)
SELECT cron.schedule('slate-scanner-nhl-est', '15 9 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:15'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:20' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-nhl');
  END IF;
END $body$;
$cron$);

-- slate-scanner-ufc-edt: was '20 4 * * *' (guard 00:20)
SELECT cron.schedule('slate-scanner-ufc-edt', '20 8 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:20'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:25' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-ufc');
  END IF;
END $body$;
$cron$);

-- slate-scanner-ufc-est: was '20 5 * * *' (guard 00:20)
SELECT cron.schedule('slate-scanner-ufc-est', '20 9 * * *', $cron$
DO $body$ BEGIN
  IF (now() AT TIME ZONE 'America/New_York')::time >= '04:20'
     AND (now() AT TIME ZONE 'America/New_York')::time < '04:25' THEN
    PERFORM public._cron_invoke_edge('slate-scanner-ufc');
  END IF;
END $body$;
$cron$);

-- slate-scanner-wnba-edt: was '25,27,29,31,33 4 * * *' (guard 00:25)
SELECT cron.schedule('slate-scanner-wnba-edt', '25,27,29,31,33 8 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '04:25' AND v_local::time < '04:35' THEN
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

-- slate-scanner-wnba-est: was '25,27,29,31,33 5 * * *' (guard 00:25)
SELECT cron.schedule('slate-scanner-wnba-est', '25,27,29,31,33 9 * * *', $cron$
DO $body$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_batch integer;
BEGIN
  IF v_local::time >= '04:25' AND v_local::time < '04:35' THEN
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
