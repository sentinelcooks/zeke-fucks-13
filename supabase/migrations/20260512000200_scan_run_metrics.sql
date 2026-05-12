-- Per-scanner-run telemetry consumed by scan-run-status.
--
-- Written in two phases:
--   1. Discovery (slate-scanner-{nba,nhl,mlb}) upserts the initial row with
--      discovered/queued counts and prefilter reason histogram.
--   2. Each analyzer-worker-{sport} invocation upserts its incremental
--      contribution: processed, finalized tier counts, edge-gate blocked
--      reasons, hard-safety drops, low-confidence drops, last error.
--
-- The table is additive and independent of analyzer_queue / daily_picks; it
-- exists solely so the dashboard can poll a single row instead of joining
-- aggregates across analyzer_queue + daily_picks for every status request.
--
-- run_id is the primary key. (sport, pick_date) is indexed for the
-- "today's scan for sport X" lookup path used by scan-run-status when the
-- caller does not have a run_id handy.

CREATE TABLE IF NOT EXISTS public.scan_run_metrics (
  run_id                     uuid PRIMARY KEY,
  sport                      text NOT NULL,
  pick_date                  date NOT NULL,
  discovered                 int  NOT NULL DEFAULT 0,
  queued                     int  NOT NULL DEFAULT 0,
  processed                  int  NOT NULL DEFAULT 0,
  finalized_edge             int  NOT NULL DEFAULT 0,
  finalized_daily            int  NOT NULL DEFAULT 0,
  finalized_value            int  NOT NULL DEFAULT 0,
  pass_count                 int  NOT NULL DEFAULT 0,
  failed_count               int  NOT NULL DEFAULT 0,
  skipped_count              int  NOT NULL DEFAULT 0,
  low_confidence_drops       int  NOT NULL DEFAULT 0,
  -- jsonb reason histograms keyed by reason -> count. Updated atomically by
  -- the worker via jsonb_set so concurrent worker invocations don't clobber
  -- each other's contributions.
  prefilter_drop_reasons     jsonb NOT NULL DEFAULT '{}'::jsonb,
  edge_gate_blocked_reasons  jsonb NOT NULL DEFAULT '{}'::jsonb,
  hard_safety_drops          jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error                 text,
  started_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_run_metrics_sport_date_idx
  ON public.scan_run_metrics (sport, pick_date DESC);

ALTER TABLE public.scan_run_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on scan_run_metrics"
  ON public.scan_run_metrics;
CREATE POLICY "Service role full access on scan_run_metrics"
  ON public.scan_run_metrics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────
-- Helper RPC: increment counters and merge reason histograms atomically.
-- Workers call this once per processed row (or in small batches) so
-- concurrent invocations don't lose updates.
--
-- p_counters expected shape (all keys optional, all values must be int):
--   { "processed": 1, "finalized_edge": 0, "finalized_daily": 1,
--     "finalized_value": 0, "pass_count": 0, "failed_count": 0,
--     "skipped_count": 0, "low_confidence_drops": 0 }
--
-- p_reason_increments expected shape (all keys optional):
--   { "edge_gate_blocked_reasons": { "low_confidence": 2, "heavy_juice": 1 },
--     "hard_safety_drops":         { "extreme_juice": 1 },
--     "prefilter_drop_reasons":    { "odds_high": 3 } }
-- ──────────────────────────────────────────────────────────────────────

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

  -- Safe fallback: if the worker fires before discovery wrote the initial
  -- row (or discovery skipped), use current_date so the NOT NULL constraint
  -- on pick_date can't fail the worker. Discovery's upsert_scan_run_discovery
  -- will overwrite pick_date with the correct value when it runs.
  INSERT INTO public.scan_run_metrics (
    run_id, sport, pick_date,
    processed, finalized_edge, finalized_daily, finalized_value,
    pass_count, failed_count, skipped_count, low_confidence_drops,
    prefilter_drop_reasons, edge_gate_blocked_reasons, hard_safety_drops,
    last_error
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
    last_error  = COALESCE(p_last_error, public.scan_run_metrics.last_error),
    updated_at  = now();
END $$;

-- Sum-merge two jsonb objects whose values are integers.
-- {a:1,b:2} + {b:3,c:1} = {a:1,b:5,c:1}
CREATE OR REPLACE FUNCTION public.jsonb_merge_counts(a jsonb, b jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  result jsonb := COALESCE(a, '{}'::jsonb);
  k text;
  v int;
BEGIN
  IF b IS NULL OR jsonb_typeof(b) <> 'object' THEN
    RETURN result;
  END IF;

  FOR k, v IN
    SELECT key, COALESCE((value)::text::int, 0)
      FROM jsonb_each_text(b)
  LOOP
    result := jsonb_set(
      result,
      ARRAY[k],
      to_jsonb(COALESCE((result->>k)::int, 0) + v),
      true
    );
  END LOOP;

  RETURN result;
END $$;

-- Discovery upserts the initial row (or refreshes discovered/queued totals
-- on re-run for the same run_id, which shouldn't happen in practice but is
-- harmless if it does).
CREATE OR REPLACE FUNCTION public.upsert_scan_run_discovery(
  p_run_id                uuid,
  p_sport                 text,
  p_pick_date             date,
  p_discovered            int,
  p_queued                int,
  p_prefilter_drop_reasons jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'upsert_scan_run_discovery: p_run_id required';
  END IF;

  INSERT INTO public.scan_run_metrics (
    run_id, sport, pick_date, discovered, queued, prefilter_drop_reasons
  ) VALUES (
    p_run_id, p_sport, p_pick_date,
    COALESCE(p_discovered, 0),
    COALESCE(p_queued, 0),
    COALESCE(p_prefilter_drop_reasons, '{}'::jsonb)
  )
  ON CONFLICT (run_id) DO UPDATE SET
    discovered             = EXCLUDED.discovered,
    queued                 = EXCLUDED.queued,
    prefilter_drop_reasons = EXCLUDED.prefilter_drop_reasons,
    updated_at             = now();
END $$;

REVOKE ALL ON FUNCTION public.increment_scan_run_metrics(uuid, text, date, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_scan_run_metrics(uuid, text, date, jsonb, jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_scan_run_discovery(uuid, text, date, int, int, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_scan_run_discovery(uuid, text, date, int, int, jsonb) TO service_role;
