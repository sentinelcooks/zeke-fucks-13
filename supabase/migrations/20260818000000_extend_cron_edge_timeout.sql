-- Scanner discovery and bounded analyzer workers routinely take longer than
-- pg_net's 5-second default. Keep the existing service-role-only helper and
-- headers, but give Edge Functions enough time to return a response instead
-- of aborting otherwise healthy scheduled work during cold starts.
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
    url                  := v_url || '/functions/v1/' || p_function,
    headers              := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey',        v_key
    ),
    body                 := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 120000
  );
END $$;

REVOKE ALL ON FUNCTION public._cron_invoke_edge(text, jsonb) FROM PUBLIC;
