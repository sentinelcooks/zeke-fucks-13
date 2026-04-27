-- Auto-grade pending picks every 30 minutes via pg_cron + pg_net.
--
-- Service role key + project URL are read from Supabase Vault. The owner
-- must run, ONCE, out of band (NOT in this migration, not committed):
--
--   SELECT vault.create_secret('https://<ref>.supabase.co', 'grade_picks_project_url');
--   SELECT vault.create_secret('<service-role-key>',        'grade_picks_service_role_key');
--
-- This migration NEVER embeds the key. If the secrets are not set, the cron
-- body short-circuits with a NOTICE and does nothing — no malformed HTTP
-- call is enqueued.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'grade-picks-every-30-min') THEN
    PERFORM cron.unschedule('grade-picks-every-30-min');
  END IF;
END $$;

SELECT cron.schedule(
  'grade-picks-every-30-min',
  '*/30 * * * *',
  $cron$
  DO $body$
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
      RAISE NOTICE 'grade-picks cron: vault secrets missing, skipping';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/grade-picks',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := '{}'::jsonb
    );
  END
  $body$;
  $cron$
);
