-- NBA analyzer resume queue.
--
-- slate-scanner-nba can only call the analyzer for the first
-- NBA_ANALYZER_BUDGET_PER_RUN candidates per run. Remaining pool
-- candidates were tagged analyzer_skipped_reason and barred from
-- tier='edge' forever. This table + the process-nba-analyzer-queue
-- function let the deferred candidates be analyzed in later batches
-- so Today's Edge eventually reflects the full top pool.

CREATE TABLE IF NOT EXISTS public.nba_analyzer_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date       date NOT NULL,
  event_id        text,
  player_name     text NOT NULL,
  prop_type       text NOT NULL,
  direction       text NOT NULL,
  line            numeric NOT NULL,
  odds_snapshot   text NOT NULL,
  -- '<pick_date>|<event_id_or_empty>|<player_name>|<prop_type>|<direction>|<line>'
  -- Lowercased on the client. Suffixed with '#<id>' when the row reaches a
  -- terminal state so the live slot is freed for re-enqueue.
  dedupe_key      text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed','expired')),
  attempts        int  NOT NULL DEFAULT 0,
  max_attempts    int  NOT NULL DEFAULT 3,
  next_run_after  timestamptz NOT NULL DEFAULT now(),
  retry_after_ms  int,
  skipped_reason  text NOT NULL,
  payload         jsonb NOT NULL,
  diagnostics     jsonb,
  game_date       date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS nba_analyzer_queue_dedupe_key_uniq
  ON public.nba_analyzer_queue (dedupe_key);

CREATE INDEX IF NOT EXISTS nba_analyzer_queue_ready
  ON public.nba_analyzer_queue (status, next_run_after)
  WHERE status = 'pending';

ALTER TABLE public.nba_analyzer_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on nba_analyzer_queue"
  ON public.nba_analyzer_queue;
CREATE POLICY "Service role full access on nba_analyzer_queue"
  ON public.nba_analyzer_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ───────────────────── RPCs ─────────────────────
-- All locking + tier-promotion runs in real DB transactions through
-- SECURITY DEFINER RPCs. The edge function never issues raw locking
-- queries from JS.

-- Enqueue (or refresh) NBA analyzer-deferred candidates.
-- p_rows is a JSON array; each item must contain pick_date, event_id,
-- player_name, prop_type, direction, line, odds_snapshot, dedupe_key,
-- skipped_reason, payload, game_date.
--
-- Behavior on dedupe_key collision (live row already exists):
--   - status='pending'    : refresh payload/odds_snapshot/skipped_reason
--                           and clear retry_after_ms; do NOT touch attempts
--                           or next_run_after.
--   - status='processing' : leave the row alone (worker is mid-flight).
-- Terminal rows (done/failed/expired) have suffixed dedupe_keys, so they
-- can never collide with a fresh '<pick_date>|...' key.
CREATE OR REPLACE FUNCTION public.enqueue_nba_analyzer_candidates(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inserted_count int := 0;
  refreshed_count int := 0;
  r jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.nba_analyzer_queue (
      pick_date, event_id, player_name, prop_type, direction, line,
      odds_snapshot, dedupe_key, skipped_reason, payload, game_date
    ) VALUES (
      (r->>'pick_date')::date,
      r->>'event_id',
      r->>'player_name',
      r->>'prop_type',
      r->>'direction',
      (r->>'line')::numeric,
      r->>'odds_snapshot',
      r->>'dedupe_key',
      r->>'skipped_reason',
      r->'payload',
      NULLIF(r->>'game_date','')::date
    )
    ON CONFLICT (dedupe_key) DO UPDATE
      SET payload        = EXCLUDED.payload,
          odds_snapshot  = EXCLUDED.odds_snapshot,
          skipped_reason = EXCLUDED.skipped_reason,
          retry_after_ms = NULL,
          updated_at     = now()
      WHERE public.nba_analyzer_queue.status = 'pending';

    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_nba_analyzer_candidates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_nba_analyzer_candidates(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_nba_analyzer_queue(p_batch_size int)
RETURNS SETOF public.nba_analyzer_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.nba_analyzer_queue
     WHERE status = 'pending'
       AND next_run_after <= now()
       AND attempts < max_attempts
     ORDER BY pick_date DESC, created_at ASC
     LIMIT GREATEST(1, LEAST(p_batch_size, 25))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.nba_analyzer_queue q
     SET status = 'processing',
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
   RETURNING q.*;
END $$;

-- p_final_pick_payload shape:
-- {
--   tier: 'edge' | 'daily' | 'value',
--   verdict: text,
--   confidence: numeric,
--   reasoning: text,
--   model_diagnostics: jsonb,
--   match: { pick_date, sport, player_name, prop_type, direction, line }
-- }
CREATE OR REPLACE FUNCTION public.promote_nba_queue_pick(
  p_queue_id uuid,
  p_final_pick_payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m         jsonb := p_final_pick_payload->'match';
  new_tier  text  := p_final_pick_payload->>'tier';
  v_target_id uuid;
  v_loser_id  uuid;
BEGIN
  SELECT id INTO v_target_id
    FROM public.daily_picks
   WHERE pick_date   = (m->>'pick_date')::date
     AND sport       = m->>'sport'
     AND player_name = m->>'player_name'
     AND prop_type   = m->>'prop_type'
     AND direction   = m->>'direction'
     AND line        = (m->>'line')::numeric
     AND tier        IS DISTINCT FROM new_tier
   FOR UPDATE
   LIMIT 1;

  SELECT id INTO v_loser_id
    FROM public.daily_picks
   WHERE pick_date   = (m->>'pick_date')::date
     AND sport       = m->>'sport'
     AND tier        = new_tier
     AND player_name = m->>'player_name'
     AND prop_type   = m->>'prop_type'
     AND direction   = m->>'direction'
     AND line        = (m->>'line')::numeric
   FOR UPDATE
   LIMIT 1;

  IF v_loser_id IS NOT NULL
     AND v_loser_id IS DISTINCT FROM v_target_id THEN
    DELETE FROM public.daily_picks WHERE id = v_loser_id;
  END IF;

  IF v_target_id IS NOT NULL THEN
    UPDATE public.daily_picks
       SET tier              = new_tier,
           verdict           = COALESCE(p_final_pick_payload->>'verdict', verdict),
           confidence        = COALESCE((p_final_pick_payload->>'confidence')::numeric, confidence),
           reasoning         = COALESCE(p_final_pick_payload->>'reasoning', reasoning),
           model_diagnostics = COALESCE(p_final_pick_payload->'model_diagnostics', model_diagnostics)
     WHERE id = v_target_id;
  END IF;

  UPDATE public.nba_analyzer_queue
     SET status       = 'done',
         processed_at = now(),
         updated_at   = now(),
         dedupe_key   = dedupe_key || '#' || id::text
   WHERE id = p_queue_id
     AND status = 'processing';
END $$;

-- Update an analyzed daily_picks row in place WITHOUT changing its tier
-- (e.g. analyzer returned PASS/RISKY, gate failed, or edge cap full).
-- Clears analyzer_skipped_reason from model_diagnostics. The diagnostics
-- argument is the new model_diagnostics blob (already merged client-side).
CREATE OR REPLACE FUNCTION public.refresh_nba_pick_diagnostics(
  p_match jsonb,
  p_diagnostics jsonb,
  p_verdict text,
  p_confidence numeric,
  p_reasoning text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.daily_picks
     SET model_diagnostics = COALESCE(p_diagnostics, model_diagnostics),
         verdict           = COALESCE(p_verdict, verdict),
         confidence        = COALESCE(p_confidence, confidence),
         reasoning         = COALESCE(p_reasoning, reasoning)
   WHERE pick_date   = (p_match->>'pick_date')::date
     AND sport       = p_match->>'sport'
     AND player_name = p_match->>'player_name'
     AND prop_type   = p_match->>'prop_type'
     AND direction   = p_match->>'direction'
     AND line        = (p_match->>'line')::numeric;
END $$;

CREATE OR REPLACE FUNCTION public.finalize_nba_queue_row(
  p_queue_id uuid,
  p_status text,
  p_diagnostics jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('done','failed','expired') THEN
    RAISE EXCEPTION 'finalize_nba_queue_row: invalid status %', p_status;
  END IF;

  UPDATE public.nba_analyzer_queue
     SET status       = p_status,
         diagnostics  = COALESCE(p_diagnostics, diagnostics),
         processed_at = now(),
         updated_at   = now(),
         dedupe_key   = dedupe_key || '#' || id::text
   WHERE id = p_queue_id
     AND status = 'processing';
END $$;

-- p_increment_attempts MUST be true only for the row that actually
-- consumed an analyzer call (the one that returned 429, or a non-429
-- transient failure). Unprocessed rows rolled back as collateral when
-- a peer hit a rate limit must pass false so they don't burn
-- max_attempts for work they never performed.
CREATE OR REPLACE FUNCTION public.reschedule_nba_queue_row(
  p_queue_id uuid,
  p_retry_after_ms int,
  p_diagnostics jsonb,
  p_increment_attempts boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.nba_analyzer_queue
     SET status         = 'pending',
         attempts       = CASE WHEN p_increment_attempts THEN attempts + 1 ELSE attempts END,
         retry_after_ms = p_retry_after_ms,
         next_run_after = now()
                        + make_interval(
                            secs => GREATEST(60, COALESCE(p_retry_after_ms, 60000) / 1000)
                          ),
         diagnostics    = COALESCE(p_diagnostics, diagnostics),
         updated_at     = now()
   WHERE id = p_queue_id;
END $$;

REVOKE ALL ON FUNCTION public.claim_nba_analyzer_queue(int)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_nba_queue_pick(uuid, jsonb)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_nba_pick_diagnostics(jsonb,jsonb,text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_nba_queue_row(uuid, text, jsonb)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reschedule_nba_queue_row(uuid, int, jsonb, boolean)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_nba_analyzer_queue(int)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_nba_queue_pick(uuid, jsonb)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_nba_pick_diagnostics(jsonb,jsonb,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_nba_queue_row(uuid, text, jsonb)              TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_nba_queue_row(uuid, int, jsonb, boolean)    TO service_role;

-- ───────────────────── pg_cron schedule ─────────────────────
-- Reuses the same vault secrets as 20260427000000_schedule_grade_picks.sql:
--   vault.create_secret('https://<ref>.supabase.co', 'grade_picks_project_url');
--   vault.create_secret('<service-role-key>',        'grade_picks_service_role_key');
-- (DO NOT commit the secret values; create them out of band.)

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-nba-analyzer-queue-every-2-min') THEN
    PERFORM cron.unschedule('process-nba-analyzer-queue-every-2-min');
  END IF;
END $$;

SELECT cron.schedule(
  'process-nba-analyzer-queue-every-2-min',
  '*/2 * * * *',
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
      RAISE NOTICE 'process-nba-analyzer-queue cron: vault secrets missing, skipping';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/process-nba-analyzer-queue',
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
