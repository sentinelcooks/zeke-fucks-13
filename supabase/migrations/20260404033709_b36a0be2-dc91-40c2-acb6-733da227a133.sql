
CREATE TABLE public.onboarding_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  referral TEXT,
  sports TEXT[] DEFAULT '{}',
  betting_style TEXT,
  ai_recommendations JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own onboarding" ON public.onboarding_responses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding" ON public.onboarding_responses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding" ON public.onboarding_responses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
