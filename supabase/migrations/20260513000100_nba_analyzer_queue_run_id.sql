-- INTERIM: Add run_id to nba_analyzer_queue so the new scanner ?wait=1 poll
-- mode (and scan-run-status) can report completion uniformly across all four
-- sports. NBA is still on the legacy nba_analyzer_queue; MLB/NHL/UFC use the
-- shared analyzer_queue. When NBA migrates to the shared queue in a later PR,
-- this column and the matching enqueue/refresh RPC change can be dropped along
-- with the rest of nba_analyzer_queue.

ALTER TABLE public.nba_analyzer_queue
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS nba_analyzer_queue_run_id_idx
  ON public.nba_analyzer_queue (run_id)
  WHERE run_id IS NOT NULL;

-- Extend enqueue_nba_analyzer_candidates to set run_id when present in the row
-- jsonb. CREATE OR REPLACE keeps the same signature so legacy callers that
-- don't supply run_id continue to work and simply leave run_id NULL.
CREATE OR REPLACE FUNCTION public.enqueue_nba_analyzer_candidates(p_rows jsonb)
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
    INSERT INTO public.nba_analyzer_queue (
      pick_date, event_id, player_name, prop_type, direction, line,
      odds_snapshot, dedupe_key, skipped_reason, payload, game_date, run_id
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
      NULLIF(r->>'game_date','')::date,
      NULLIF(r->>'run_id','')::uuid
    )
    ON CONFLICT (dedupe_key) DO UPDATE
      SET payload        = EXCLUDED.payload,
          odds_snapshot  = EXCLUDED.odds_snapshot,
          skipped_reason = EXCLUDED.skipped_reason,
          retry_after_ms = NULL,
          -- Refresh run_id only if a non-null one is provided; legacy callers
          -- without run_id must not clobber a previously-set run_id.
          run_id         = COALESCE(EXCLUDED.run_id, public.nba_analyzer_queue.run_id),
          updated_at     = now()
      WHERE public.nba_analyzer_queue.status = 'pending';

    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_nba_analyzer_candidates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_nba_analyzer_candidates(jsonb) TO service_role;
