-- Additive metadata for analyzer_queue to support the new per-sport
-- discovery -> queue -> worker pipeline. All changes are additive; existing
-- columns, RPCs (enqueue_analyzer_candidates, claim_analyzer_queue,
-- reschedule_analyzer_queue_row, finalize_analyzer_queue_row), the 2-min
-- process-analyzer-queue cron, and the NBA-specific nba_analyzer_queue path
-- continue to work unchanged.
--
-- New columns:
--   run_id          - groups all candidates discovered in a single scanner run
--                     so scan_run_metrics + scan-run-status can report
--                     processed/finalized/remaining counts per run.
--   lock_owner      - opaque identifier of the worker invocation that claimed
--                     a row; lets us detect stale locks and trace ownership.
--   locked_at       - when the row was claimed (status flipped to processing).
--   error_message   - free-form human-readable last error from the worker.
--                     Distinct from existing error_reason which is a short
--                     code consumed by the legacy process-analyzer-queue.
--   analyzer_result - terminal analyzer envelope: tier assigned, edge gate
--                     decision, hard-safety flags, confidence, verdict.
--                     The worker writes this so the gate "why" is queryable
--                     without re-running the analyzer.

ALTER TABLE public.analyzer_queue
  ADD COLUMN IF NOT EXISTS run_id          uuid,
  ADD COLUMN IF NOT EXISTS lock_owner      text,
  ADD COLUMN IF NOT EXISTS locked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS error_message   text,
  ADD COLUMN IF NOT EXISTS analyzer_result jsonb;

-- Lookups by (sport, run_id) for scan-run-status aggregation.
CREATE INDEX IF NOT EXISTS analyzer_queue_run_id_idx
  ON public.analyzer_queue (sport, run_id)
  WHERE run_id IS NOT NULL;

-- Claim path: per-sport pending rows ordered by created_at, bounded by attempts.
-- Partial index keeps it tight; status='pending' is the only state we claim.
CREATE INDEX IF NOT EXISTS analyzer_queue_claim_idx
  ON public.analyzer_queue (sport, attempts, created_at)
  WHERE status = 'pending';

-- Extend enqueue_analyzer_candidates to set run_id when present in the row
-- jsonb. CREATE OR REPLACE keeps the same signature so callers that don't
-- supply run_id (legacy scanner path during rollout) continue to work and
-- simply leave run_id NULL. New discovery path supplies it for every row in
-- a slate so scan_run_metrics can aggregate per-run telemetry.
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
      status, retry_after_ms, error_reason, run_id
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
      NULLIF(r->>'error_reason',''),
      NULLIF(r->>'run_id','')::uuid
    )
    ON CONFLICT (sport, pick_date, dedupe_key) DO UPDATE
      SET analyzer_payload  = EXCLUDED.analyzer_payload,
          candidate_payload = EXCLUDED.candidate_payload,
          analyzer_endpoint = EXCLUDED.analyzer_endpoint,
          error_reason      = EXCLUDED.error_reason,
          retry_after_ms    = EXCLUDED.retry_after_ms,
          -- Refresh run_id only if a non-null one is provided; legacy callers
          -- without run_id must not clobber a previously-set run_id.
          run_id            = COALESCE(EXCLUDED.run_id, public.analyzer_queue.run_id),
          updated_at        = now()
      WHERE public.analyzer_queue.status = 'pending';

    IF FOUND THEN inserted_count := inserted_count + 1; END IF;
  END LOOP;

  RETURN inserted_count;
END $$;
