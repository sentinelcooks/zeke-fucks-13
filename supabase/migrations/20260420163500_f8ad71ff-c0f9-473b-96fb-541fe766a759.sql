ALTER TABLE public.onboarding_responses
  ADD COLUMN IF NOT EXISTS daily_tip_text text,
  ADD COLUMN IF NOT EXISTS daily_tip_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_tip_seed integer NOT NULL DEFAULT 0;