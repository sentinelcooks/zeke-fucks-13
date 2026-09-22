-- NFL schedules (pg_cron runs in UTC).
--
--   odds-snapshot  nfl game markets      hourly             (opening → closing line history)
--   odds-snapshot  nfl player props      14:45, 22:45 daily + Sun 16:45
--                                        (~13 markets × ≤16 events ≈ ≤208 Odds API credits per run)
--   nfl-game-edge         slate          every 3 h at :05   (after the game-market snapshot)
--   nfl-player-prop-edge  slate          14:55, 22:55 daily + Sun 16:55 (after prop snapshots)
--   nfl-grade                            11:30 daily        (after the 10:00 UTC nflverse ingest,
--                                                            .github/workflows/nfl-ingest.yml)
--
-- The two engines are scheduled independently; neither job depends on the
-- other's output. All jobs go through public._cron_invoke_edge (service role).

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'odds-snapshot-nfl-hourly',
    'odds-snapshot-nfl-props',
    'odds-snapshot-nfl-props-sunday',
    'nfl-game-edge-slate',
    'nfl-player-prop-edge-slate',
    'nfl-player-prop-edge-slate-sunday',
    'nfl-grade-daily'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule('odds-snapshot-nfl-hourly', '20 * * * *', $cron$
  SELECT public._cron_invoke_edge('odds-snapshot', jsonb_build_object('sport', 'nfl'));
$cron$);

SELECT cron.schedule('odds-snapshot-nfl-props', '45 14,22 * * *', $cron$
  SELECT public._cron_invoke_edge('odds-snapshot', jsonb_build_object('sport', 'nfl', 'props', true));
$cron$);

SELECT cron.schedule('odds-snapshot-nfl-props-sunday', '45 16 * * 0', $cron$
  SELECT public._cron_invoke_edge('odds-snapshot', jsonb_build_object('sport', 'nfl', 'props', true));
$cron$);

SELECT cron.schedule('nfl-game-edge-slate', '5 */3 * * *', $cron$
  SELECT public._cron_invoke_edge('nfl-game-edge', jsonb_build_object('slate', true, 'days', 7));
$cron$);

SELECT cron.schedule('nfl-player-prop-edge-slate', '55 14,22 * * *', $cron$
  SELECT public._cron_invoke_edge('nfl-player-prop-edge', jsonb_build_object('slate', true, 'days', 7));
$cron$);

SELECT cron.schedule('nfl-player-prop-edge-slate-sunday', '55 16 * * 0', $cron$
  SELECT public._cron_invoke_edge('nfl-player-prop-edge', jsonb_build_object('slate', true, 'days', 2));
$cron$);

SELECT cron.schedule('nfl-grade-daily', '30 11 * * *', $cron$
  SELECT public._cron_invoke_edge('nfl-grade', jsonb_build_object('days', 10));
$cron$);
