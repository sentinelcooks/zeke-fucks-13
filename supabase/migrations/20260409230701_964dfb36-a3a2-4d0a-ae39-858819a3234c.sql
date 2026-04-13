
CREATE TABLE public.prop_explanations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prop_value TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'nba',
  betting_level TEXT NOT NULL DEFAULT 'beginner',
  explanation TEXT NOT NULL,
  example TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (prop_value, sport, betting_level)
);

ALTER TABLE public.prop_explanations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prop explanations"
ON public.prop_explanations
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Service role can manage prop explanations"
ON public.prop_explanations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
