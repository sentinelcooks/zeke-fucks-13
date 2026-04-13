
CREATE TABLE public.parlay_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  stake NUMERIC NOT NULL DEFAULT 0,
  parlay_odds INTEGER NOT NULL DEFAULT 0,
  potential_payout NUMERIC NOT NULL DEFAULT 0,
  profit NUMERIC NOT NULL DEFAULT 0,
  overall_confidence NUMERIC NOT NULL DEFAULT 0,
  overall_grade TEXT NOT NULL DEFAULT 'risky',
  overall_writeup TEXT,
  unit_sizing TEXT,
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  result TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.parlay_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own parlay history"
ON public.parlay_history
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own parlay history"
ON public.parlay_history
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own parlay history"
ON public.parlay_history
FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own parlay history"
ON public.parlay_history
FOR UPDATE
USING (auth.uid() = user_id);
