-- Generic analyzer queue for MLB / NHL / UFC / future sports.
--
-- The NBA queue (nba_analyzer_queue) stays in place untouched — NBA continues
-- to flow through process-nba-analyzer-queue. This generic table handles every
-- other sport. When the live scanner cannot finalize a candidate (rate-limit,
-- analyzer timeout, transient 5xx, budget cap), it enqueues the canonical
-- analyzer payload + a complete candidate_payload here. The processor
-- (process-analyzer-queue) drains pending rows on a 2-min cron, calls the
-- analyzer endpoint stored on the row, and writes the analyzer-finalized row
-- to public.daily_picks via the same applyAnalyzerFinalizeInsertGuard the
-- live scanner uses.

CREATE TABLE IF NOT EXISTS public.analyzer_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport             text NOT NULL,
  pick_date         date NOT NULL,
  analyzer_endpoint text NOT NULL,            -- e.g. 'nba-api/analyze'
  analyzer_payload  jsonb NOT NULL,           -- exact body to POST to analyzer
  candidate_payload jsonb NOT NULL,           -- full ScoredPlay + commence_time
                                              -- so processor can reconstruct
                                              -- the daily_picks row from queue
                                              -- alone, no scanner re-run.
  intended_tier     text,                     -- 'edge' | 'daily' | 'value'
  pre_gate_tier     text,
  scanner_trace_id  text,
  -- '<sport>|<pick_date>|<player_or_team>|<prop_or_bet>|<direction>|<line>|<event_or_homeAtAway>'
  -- Lowercased on the client. Suffixed with '#<id>' on terminal status so the
  -- live unique slot is freed for re-enqueue on the same identity tomorrow.
  dedupe_key        text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending',
                      'processing',
                      'done',
                      'failed',
                      'expired',
                      'missing_analyzer_endpoint'
                    )),
  attempts          int  NOT NULL DEFAULT 0,
  max_attempts      int  NOT NULL DEFAULT 5,
  next_run_after    timestamptz NOT NULL DEFAULT now(),
  retry_after_ms    int,
  error_reason      text,
  diagnostics       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- Live unique slot: only one non-terminal row per (sport, pick_date, dedupe_key).
-- Terminal rows have '#<id>' suffix and never collide.
CREATE UNIQUE INDEX IF NOT EXISTS analyzer_queue_dedupe_uniq
  ON public.analyzer_queue (sport, pick_date, dedupe_key);

CREATE INDEX IF NOT EXISTS analyzer_queue_ready_idx
  ON public.analyzer_queue (status, next_run_after)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS analyzer_queue_sport_date_idx
  ON public.analyzer_queue (sport, pick_date);

ALTER TABLE public.analyzer_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on analyzer_queue"
  ON public.analyzer_queue;
CREATE POLICY "Service role full access on analyzer_queue"
  ON public.analyzer_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ───────────────────── RPCs ─────────────────────

-- Bulk enqueue analyzer-deferred candidates.
-- p_rows: jsonb array. Each item must contain:
--   sport, pick_date, analyzer_endpoint, analyzer_payload, candidate_payload,
--   dedupe_key, intended_tier, pre_gate_tier, scanner_trace_id, error_reason,
--   retry_after_ms (optional).
--
-- ON CONFLICT (sport, pick_date, dedupe_key):
--   - status='pending': refresh analyzer_payload/candidate_payload/error_reason;
--                       do NOT touch attempts or next_run_after.
--   - status='processing': leave row alone (worker is mid-flight).
-- Terminal rows have '#<id>' suffixes and cannot collide with fresh keys.
CREATE OR REPLACE FUNCTION public.enqueue_analyzer_candidates(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inserted_count int := 0;
  r jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO public.analyzer_queue (
      sport, pick_date, analyzer_endpoint, analyzer_payload, candidate_payload,
      intended_tier, pre_gate_tier, scanner_trace_id, dedupe_key,
      status, retry_after_ms, error_reason
    ) VALUES (
      r->>'sport',
      (r->>'pick_date')::date,
      r->>'analyzer_endpoint',
      r->'analyzer_payload',
      r->'candidate_payload',
      NULLIF(r->>'intended_tier',''),
      NULLIF(r->>'pre_gate_tier',''),
      NULLIF(r->>'scanner_trace_id',''),
      r->>'dedupe_key',
      COALESCE(NULLIF(r->>'status',''), 'pending'),
      NULLIF(r->>'retry_after_ms','')::int,
      NULLIF(r->>'error_reason','')
    )
    ON CONFLICT (sport, pick_date, dedupe_key) DO UPDATE
      SET analyzer_payload  = EXCLUDED.analyzer_payload,
          candidate_payload = EXCLUDED.candidate_payload,
          analyzer_endpoint = EXCLUDED.analyzer_endpoint,
          error_reason      = EXCLUDED.error_reason,
          retry_after_ms    = EXCLUDED.retry_after_ms,
          updated_at        = now()
      WHERE public.analyzer_queue.status = 'pending';

    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_analyzer_candidates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_analyzer_candidates(jsonb) TO service_role;

-- Claim up to N pending rows whose next_run_after has elapsed.
-- Skips NBA: NBA continues to flow through nba_analyzer_queue.
CREATE OR REPLACE FUNCTION public.claim_analyzer_queue(p_batch_size int)
RETURNS SETOF public.analyzer_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.analyzer_queue
     WHERE status = 'pending'
       AND sport <> 'nba'
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

-- Reschedule a 'processing' row back to 'pending' after a transient failure.
-- p_increment_attempts MUST be true only for the row that actually consumed
-- an analyzer call. Collateral rows rolled back when a peer hit a rate limit
-- must pass false so they don't burn max_attempts for work never performed.
CREATE OR REPLACE FUNCTION public.reschedule_analyzer_queue_row(
  p_queue_id uuid,
  p_retry_after_ms int,
  p_diagnostics jsonb,
  p_increment_attempts boolean,
  p_error_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.analyzer_queue
     SET status         = 'pending',
         attempts       = CASE WHEN p_increment_attempts THEN attempts + 1 ELSE attempts END,
         retry_after_ms = p_retry_after_ms,
         next_run_after = now()
                        + make_interval(
                            secs => GREATEST(60, COALESCE(p_retry_after_ms, 60000) / 1000)
                          ),
         diagnostics    = COALESCE(p_diagnostics, diagnostics),
         error_reason   = COALESCE(p_error_reason, error_reason),
         updated_at     = now()
   WHERE id = p_queue_id;
END $$;

REVOKE ALL ON FUNCTION public.reschedule_analyzer_queue_row(uuid, int, jsonb, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_analyzer_queue_row(uuid, int, jsonb, boolean, text) TO service_role;

-- Terminal finalize: status MUST be one of done/failed/expired/missing_analyzer_endpoint.
-- Suffix dedupe_key with '#<id>' to free the live unique slot.
CREATE OR REPLACE FUNCTION public.finalize_analyzer_queue_row(
  p_queue_id uuid,
  p_status text,
  p_diagnostics jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('done','failed','expired','missing_analyzer_endpoint') THEN
    RAISE EXCEPTION 'finalize_analyzer_queue_row: invalid status %', p_status;
  END IF;

  UPDATE public.analyzer_queue
     SET status       = p_status,
         diagnostics  = COALESCE(p_diagnostics, diagnostics),
         processed_at = now(),
         updated_at   = now(),
         dedupe_key   = dedupe_key || '#' || id::text
   WHERE id = p_queue_id
     AND status IN ('processing','pending');
END $$;

REVOKE ALL ON FUNCTION public.finalize_analyzer_queue_row(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_analyzer_queue_row(uuid, text, jsonb) TO service_role;

-- ───────────────────── pg_cron schedule ─────────────────────
-- Reuses the same vault secrets as the NBA queue cron (project_url + service_role_key).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-analyzer-queue-every-2-min') THEN
    PERFORM cron.unschedule('process-analyzer-queue-every-2-min');
  END IF;
END $$;

SELECT cron.schedule(
  'process-analyzer-queue-every-2-min',
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
      RAISE NOTICE 'process-analyzer-queue cron: vault secrets missing, skipping';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/process-analyzer-queue',
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
