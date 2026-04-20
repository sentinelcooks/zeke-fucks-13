-- 1. De-duplicate existing daily_picks rows (keep oldest id per natural key)
DELETE FROM public.daily_picks a
USING public.daily_picks b
WHERE a.ctid > b.ctid
  AND a.pick_date = b.pick_date
  AND a.sport = b.sport
  AND a.tier = b.tier
  AND COALESCE(a.player_name,'') = COALESCE(b.player_name,'')
  AND COALESCE(a.prop_type,'') = COALESCE(b.prop_type,'')
  AND COALESCE(a.direction,'') = COALESCE(b.direction,'')
  AND COALESCE(a.line, -9999) = COALESCE(b.line, -9999);

-- 2. Add unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS daily_picks_unique_per_day
ON public.daily_picks (
  pick_date, sport, tier,
  (COALESCE(player_name,'')),
  (COALESCE(prop_type,'')),
  (COALESCE(direction,'')),
  (COALESCE(line, -9999))
);

-- 3. Create lock table for daily-picks runs
CREATE TABLE IF NOT EXISTS public.daily_picks_runs (
  date DATE PRIMARY KEY,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_picks_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on daily_picks_runs"
ON public.daily_picks_runs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);