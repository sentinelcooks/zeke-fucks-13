-- Per-row outcome telemetry for the analyzer queue. Adds:
--   1. scan_run_metrics.outcome_counts (jsonb) — histogram keyed by
--      <outcome>_<sub_reason>, merged via the existing jsonb_merge_counts()
--      helper. Lets scan-run-status answer "why no daily_pick" without
--      re-running the scanner.
--   2. increment_scan_run_metrics now merges outcome_counts under
--      p_reason_increments alongside the existing reason histograms.
--   3. finalize_analyzer_queue_row gains an optional p_error_reason arg.
--      On status='done' it sets error_reason=NULL (clears the sticky
--      enqueue-time 'discovery' marker). On failed/expired it stamps the
--      caller-provided terminal reason. Default NULL keeps legacy callers
--      working — they fall back to COALESCE preservation.
--
-- All additive. No data backfill required: outcome_counts defaults to '{}'.

ALTER TABLE public.scan_run_metrics
  ADD COLUMN IF NOT EXISTS outcome_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.increment_scan_run_metrics(
  p_run_id            uuid,
  p_sport             text,
  p_pick_date         date,
  p_counters          jsonb,
  p_reason_increments jsonb,
  p_last_error        text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_counters jsonb := COALESCE(p_counters, '{}'::jsonb);
  v_reasons  jsonb := COALESCE(p_reason_increments, '{}'::jsonb);
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'increment_scan_run_metrics: p_run_id required';
  END IF;

  INSERT INTO public.scan_run_metrics (
    run_id, sport, pick_date,
    processed, finalized_edge, finalized_daily, finalized_value,
    pass_count, failed_count, skipped_count, low_confidence_drops,
    prefilter_drop_reasons, edge_gate_blocked_reasons, hard_safety_drops,
    outcome_counts, last_error
  ) VALUES (
    p_run_id,
    COALESCE(NULLIF(p_sport, ''), 'unknown'),
    COALESCE(p_pick_date, current_date),
    COALESCE((v_counters->>'processed')::int, 0),
    COALESCE((v_counters->>'finalized_edge')::int, 0),
    COALESCE((v_counters->>'finalized_daily')::int, 0),
    COALESCE((v_counters->>'finalized_value')::int, 0),
    COALESCE((v_counters->>'pass_count')::int, 0),
    COALESCE((v_counters->>'failed_count')::int, 0),
    COALESCE((v_counters->>'skipped_count')::int, 0),
    COALESCE((v_counters->>'low_confidence_drops')::int, 0),
    COALESCE(v_reasons->'prefilter_drop_reasons',    '{}'::jsonb),
    COALESCE(v_reasons->'edge_gate_blocked_reasons', '{}'::jsonb),
    COALESCE(v_reasons->'hard_safety_drops',         '{}'::jsonb),
    COALESCE(v_reasons->'outcome_counts',            '{}'::jsonb),
    p_last_error
  )
  ON CONFLICT (run_id) DO UPDATE SET
    processed            = public.scan_run_metrics.processed
                         + COALESCE((v_counters->>'processed')::int, 0),
    finalized_edge       = public.scan_run_metrics.finalized_edge
                         + COALESCE((v_counters->>'finalized_edge')::int, 0),
    finalized_daily      = public.scan_run_metrics.finalized_daily
                         + COALESCE((v_counters->>'finalized_daily')::int, 0),
    finalized_value      = public.scan_run_metrics.finalized_value
                         + COALESCE((v_counters->>'finalized_value')::int, 0),
    pass_count           = public.scan_run_metrics.pass_count
                         + COALESCE((v_counters->>'pass_count')::int, 0),
    failed_count         = public.scan_run_metrics.failed_count
                         + COALESCE((v_counters->>'failed_count')::int, 0),
    skipped_count        = public.scan_run_metrics.skipped_count
                         + COALESCE((v_counters->>'skipped_count')::int, 0),
    low_confidence_drops = public.scan_run_metrics.low_confidence_drops
                         + COALESCE((v_counters->>'low_confidence_drops')::int, 0),
    prefilter_drop_reasons    = public.jsonb_merge_counts(
      public.scan_run_metrics.prefilter_drop_reasons,
      COALESCE(v_reasons->'prefilter_drop_reasons', '{}'::jsonb)
    ),
    edge_gate_blocked_reasons = public.jsonb_merge_counts(
      public.scan_run_metrics.edge_gate_blocked_reasons,
      COALESCE(v_reasons->'edge_gate_blocked_reasons', '{}'::jsonb)
    ),
    hard_safety_drops         = public.jsonb_merge_counts(
      public.scan_run_metrics.hard_safety_drops,
      COALESCE(v_reasons->'hard_safety_drops', '{}'::jsonb)
    ),
    outcome_counts            = public.jsonb_merge_counts(
      public.scan_run_metrics.outcome_counts,
      COALESCE(v_reasons->'outcome_counts', '{}'::jsonb)
    ),
    last_error  = COALESCE(p_last_error, public.scan_run_metrics.last_error),
    updated_at  = now();
END $$;

REVOKE ALL ON FUNCTION public.increment_scan_run_metrics(uuid, text, date, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_scan_run_metrics(uuid, text, date, jsonb, jsonb, text) TO service_role;

-- Replace finalize_analyzer_queue_row: optional 4th arg p_error_reason.
-- Default NULL preserves the existing column value for legacy callers.
-- On status='done' the column is forcibly cleared so the sticky enqueue-time
-- 'discovery' marker no longer pollutes "WHERE error_reason='discovery'"
-- queries against terminated rows.
--
-- Postgres treats different arg counts as distinct overloads, not as a
-- replacement of CREATE OR REPLACE. Drop the prior 3-arg signature first
-- so every caller routes through the new 4-arg version and the
-- error_reason-clearing branch is non-bypassable.
DROP FUNCTION IF EXISTS public.finalize_analyzer_queue_row(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.finalize_analyzer_queue_row(
  p_queue_id     uuid,
  p_status       text,
  p_diagnostics  jsonb,
  p_error_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('done','failed','expired','missing_analyzer_endpoint') THEN
    RAISE EXCEPTION 'finalize_analyzer_queue_row: invalid status %', p_status;
  END IF;

  UPDATE public.analyzer_queue
     SET status       = p_status,
         diagnostics  = COALESCE(p_diagnostics, diagnostics),
         error_reason = CASE
                          WHEN p_status = 'done' THEN NULL
                          ELSE COALESCE(p_error_reason, error_reason)
                        END,
         processed_at = now(),
         updated_at   = now(),
         dedupe_key   = dedupe_key || '#' || id::text
   WHERE id = p_queue_id
     AND status IN ('processing','pending');
END $$;

REVOKE ALL ON FUNCTION public.finalize_analyzer_queue_row(uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_analyzer_queue_row(uuid, text, jsonb, text) TO service_role;
