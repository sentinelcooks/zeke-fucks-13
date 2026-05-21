-- Tighten the game-alerts cron from every 5 minutes to every minute, with a
-- 2-minute overlap window so a reminder row inserted in the gap is still caught.
--
-- Behavior is otherwise identical to 20260501010000_schedule_game_alerts.sql:
--   - reads Vault secrets game_alerts_project_url + game_alerts_service_role_key
--   - short-circuits with NOTICE if either is missing
--   - exactly-once guaranteed by alert_sent_at IS NULL guard

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'game-alerts-every-5-min') THEN
    PERFORM cron.unschedule('game-alerts-every-5-min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'game-alerts-every-minute') THEN
    PERFORM cron.unschedule('game-alerts-every-minute');
  END IF;
END $$;

SELECT cron.schedule(
  'game-alerts-every-minute',
  '* * * * *',
  $cron$
  DO $body$
  DECLARE
    v_url       text;
    v_key       text;
    v_window_lo timestamptz;
    v_window_hi timestamptz;
    rec         record;
  BEGIN
    -- 9..11 min ahead: 2-minute overlap absorbs cron jitter and rows added late.
    v_window_lo := now() + interval '9 minutes';
    v_window_hi := now() + interval '11 minutes';

    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'game_alerts_project_url'
      LIMIT 1;

    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name = 'game_alerts_service_role_key'
      LIMIT 1;

    IF v_url IS NULL OR length(trim(v_url)) = 0
       OR v_key IS NULL OR length(trim(v_key)) = 0 THEN
      RAISE NOTICE 'game-alerts cron: vault secrets missing, skipping';
      RETURN;
    END IF;

    FOR rec IN
      SELECT DISTINCT
        gn.id   AS game_notification_id,
        gn.user_id,
        gn.game_id,
        gn.home_team,
        gn.away_team,
        gn.commence_time,
        gn.sport_key
      FROM public.game_notifications gn
      INNER JOIN public.mobile_push_tokens mpt
        ON  mpt.user_id  = gn.user_id
        AND mpt.platform = 'ios'
        AND mpt.enabled  = true
      WHERE gn.commence_time >= v_window_lo
        AND gn.commence_time <  v_window_hi
        AND gn.alert_sent_at IS NULL
    LOOP
      PERFORM net.http_post(
        url     := v_url || '/functions/v1/send-game-alert',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body    := jsonb_build_object(
          'game_notification_id', rec.game_notification_id,
          'user_id',              rec.user_id,
          'game_id',              rec.game_id,
          'home_team',            rec.home_team,
          'away_team',            rec.away_team,
          'commence_time',        rec.commence_time,
          'sport_key',            rec.sport_key
        )
      );
    END LOOP;
  END
  $body$;
  $cron$
);
