-- Add run_id to daily_picks so every pick can be traced back to the scanner
-- run that produced it. Nullable: historical rows keep NULL. Populated by both
-- the synchronous scanner insert path and the async analyzer-queue worker.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE INDEX IF NOT EXISTS idx_daily_picks_run_id
  ON public.daily_picks (run_id)
  WHERE run_id IS NOT NULL;
