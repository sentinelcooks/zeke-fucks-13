-- Daily scan health view, consumed by the daily-scan-health Edge Function.
-- Aggregates scan_run_metrics rows over the last 7 days, grouped by
-- (pick_date, sport). The view is the single source of truth for the
-- end-of-day report; the Edge Function is a thin JSON wrapper so future
-- callers (admin page, Discord webhook, on-call dashboard) hit one shape.
--
-- All inputs already exist:
--   - public.scan_run_metrics (20260512000200_scan_run_metrics.sql)
--   - public.outcome_counts column (20260514000100_scan_run_metrics_outcome_counts.sql)
--   - public.jsonb_merge_counts(a,b) scalar helper
--
-- This migration adds:
--   1. An aggregate jsonb_merge_counts_agg() so we can SUM jsonb histograms
--      across rows within a GROUP BY.
--   2. The view public.v_daily_scan_health.

CREATE OR REPLACE AGGREGATE public.jsonb_merge_counts_agg(jsonb) (
  SFUNC     = public.jsonb_merge_counts,
  STYPE     = jsonb,
  INITCOND  = '{}'
);

CREATE OR REPLACE VIEW public.v_daily_scan_health AS
SELECT
  pick_date,
  sport,
  count(*)                                            AS runs,
  COALESCE(sum(discovered),       0)::bigint          AS discovered,
  COALESCE(sum(queued),           0)::bigint          AS queued,
  COALESCE(sum(processed),        0)::bigint          AS processed,
  COALESCE(sum(finalized_edge),   0)::bigint          AS finalized_edge,
  COALESCE(sum(finalized_daily),  0)::bigint          AS finalized_daily,
  COALESCE(sum(finalized_value),  0)::bigint          AS finalized_value,
  COALESCE(sum(failed_count),     0)::bigint          AS failed,
  COALESCE(sum(skipped_count),    0)::bigint          AS expired_skipped,
  public.jsonb_merge_counts_agg(COALESCE(outcome_counts, '{}'::jsonb))
                                                      AS outcome_counts,
  max(updated_at)                                     AS last_updated_at
FROM public.scan_run_metrics
WHERE pick_date >= current_date - INTERVAL '7 days'
GROUP BY pick_date, sport
ORDER BY pick_date DESC, sport;

REVOKE ALL ON public.v_daily_scan_health FROM PUBLIC;
GRANT SELECT ON public.v_daily_scan_health TO service_role;
