ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS verdict text;

COMMENT ON COLUMN public.daily_picks.verdict IS
  'Canonical stored pick verdict used by public pick surfaces. For NBA scanner-selected rows this must match the finalized nba-api/analyze verdict.';
