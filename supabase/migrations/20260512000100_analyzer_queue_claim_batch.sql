-- Per-sport claim RPC used by the new analyzer-worker-{nba,nhl,mlb} functions.
--
-- Differs from the existing claim_analyzer_queue(p_batch_size) in four ways:
--   1. Per-sport: caller passes p_sport; lets us run workers in parallel
--      without one sport starving another. The legacy claim_analyzer_queue
--      stays in place (it filters sport <> 'nba' and is invoked by
--      process-analyzer-queue every 2 minutes as a safety net).
--   2. Ownership: stamps lock_owner / locked_at so we can trace which worker
--      invocation is mid-flight on a row and detect stale locks later.
--   3. Attempt budget: caller passes p_max_attempts. Reads the row's own
--      max_attempts as a hard ceiling too, so callers cannot bypass the
--      per-row cap configured at enqueue time.
--   4. Stale-lock reclaim: rows stuck in 'processing' with locked_at older
--      than p_stale_lock_seconds (default 300s = 5 min) are eligible to be
--      reclaimed. This protects against workers that crash mid-row or hit
--      Edge Function worker_resource_limit before they could reschedule.
--
-- The function is SECURITY DEFINER (matching the existing RPCs) and only
-- granted to service_role.

CREATE OR REPLACE FUNCTION public.claim_analyzer_queue_batch(
  p_sport               text,
  p_owner               text,
  p_batch_size          int,
  p_max_attempts        int,
  p_stale_lock_seconds  int DEFAULT 300
) RETURNS SETOF public.analyzer_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stale_seconds int := GREATEST(60, COALESCE(p_stale_lock_seconds, 300));
BEGIN
  IF p_sport IS NULL OR length(trim(p_sport)) = 0 THEN
    RAISE EXCEPTION 'claim_analyzer_queue_batch: p_sport required';
  END IF;
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'claim_analyzer_queue_batch: p_owner required';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM public.analyzer_queue
     WHERE sport = p_sport
       AND attempts < LEAST(max_attempts, COALESCE(p_max_attempts, max_attempts))
       AND (
         -- Fresh pending row whose next_run_after has elapsed.
         (status = 'pending' AND next_run_after <= now())
         OR
         -- Stale 'processing' row whose owning worker likely crashed.
         -- locked_at NULL is treated as stale to be safe (shouldn't happen
         -- under the new RPC but legacy rows or interrupted upgrades could
         -- leave one).
         (
           status = 'processing'
           AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => v_stale_seconds))
         )
       )
     ORDER BY created_at ASC
     LIMIT GREATEST(1, LEAST(COALESCE(p_batch_size, 10), 50))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.analyzer_queue q
     SET status     = 'processing',
         attempts   = q.attempts + 1,
         lock_owner = p_owner,
         locked_at  = now(),
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
   RETURNING q.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_analyzer_queue_batch(text, text, int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_analyzer_queue_batch(text, text, int, int, int) TO service_role;
