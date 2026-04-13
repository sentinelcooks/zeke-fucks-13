
CREATE TABLE public.nhl_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  prediction JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'RISKY'::text,
  prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  result TEXT DEFAULT 'pending'::text,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.nhl_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read nhl predictions"
ON public.nhl_predictions
FOR SELECT
USING (true);

CREATE POLICY "Service role manages nhl predictions"
ON public.nhl_predictions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
