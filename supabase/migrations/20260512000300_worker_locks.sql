-- Per-sport worker lock for analyzer-worker-{sport}.
--
-- Purpose: prevent two analyzer-worker invocations for the same sport from
-- running concurrently. The edge cap (EDGE_CAP_PER_SPORT) is enforced by
-- pre-querying daily_picks for tier='edge' and incrementing a local counter
-- per processed row. If two workers run in parallel they both see the same
-- starting count, and could each promote one extra row over the cap before
-- either's inserts become visible to the other.
--
-- pg_advisory_lock isn't reliable under Supabase's PgBouncer transaction-mode
-- pooling (connection-scoped locks vanish between PostgREST HTTP calls), so
-- we use a row-based lock with a TTL. The lock is "acquired" by claiming the
-- row if it doesn't exist, or by overwriting it if the existing owner's
-- acquired_at is older than the TTL (handles crashed workers).
--
-- This is best-effort: if a worker crashes without releasing, the next
-- invocation after `ttl_seconds` reclaims the lock. The default TTL is 90s,
-- which is just longer than the worker's softDeadlineMs (45s) plus the
-- typical analyzer call overhead.

CREATE TABLE IF NOT EXISTS public.worker_locks (
  scope        text PRIMARY KEY,
  owner        text NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on worker_locks"
  ON public.worker_locks;
CREATE POLICY "Service role full access on worker_locks"
  ON public.worker_locks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Try to acquire the lock for p_scope. Returns true if acquired (this caller
-- now owns the lock), false if another caller holds a non-stale lock.
-- p_ttl_seconds is the TTL after which an existing lock is considered stale
-- and may be stolen.
CREATE OR REPLACE FUNCTION public.try_acquire_worker_lock(
  p_scope        text,
  p_owner        text,
  p_ttl_seconds  int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ttl int := GREATEST(15, COALESCE(p_ttl_seconds, 90));
  v_inserted boolean := false;
BEGIN
  IF p_scope IS NULL OR length(trim(p_scope)) = 0 THEN
    RAISE EXCEPTION 'try_acquire_worker_lock: p_scope required';
  END IF;
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'try_acquire_worker_lock: p_owner required';
  END IF;

  INSERT INTO public.worker_locks (scope, owner, acquired_at)
  VALUES (p_scope, p_owner, now())
  ON CONFLICT (scope) DO UPDATE
    SET owner       = EXCLUDED.owner,
        acquired_at = EXCLUDED.acquired_at
    WHERE public.worker_locks.acquired_at
            < now() - make_interval(secs => v_ttl);

  -- ON CONFLICT DO UPDATE with WHERE that evaluates to false: no row is
  -- updated and FOUND remains true (the conflict happened). We need to
  -- check whether the row's owner is now ours.
  SELECT (owner = p_owner)
    INTO v_inserted
    FROM public.worker_locks
   WHERE scope = p_scope;

  RETURN COALESCE(v_inserted, false);
END $$;

-- Release the lock if (and only if) we still own it. Idempotent; safe to
-- call from a worker's `finally` block.
CREATE OR REPLACE FUNCTION public.release_worker_lock(
  p_scope text,
  p_owner text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.worker_locks
   WHERE scope = p_scope AND owner = p_owner;
END $$;

REVOKE ALL ON FUNCTION public.try_acquire_worker_lock(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_acquire_worker_lock(text, text, int) TO service_role;

REVOKE ALL ON FUNCTION public.release_worker_lock(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_worker_lock(text, text) TO service_role;
