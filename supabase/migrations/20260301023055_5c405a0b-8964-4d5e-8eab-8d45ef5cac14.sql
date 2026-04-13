CREATE TABLE public.plays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  license_key TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'nba',
  player_or_fighter TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  line NUMERIC,
  odds INTEGER NOT NULL DEFAULT -110,
  stake NUMERIC NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'win', 'loss', 'push')),
  payout NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage plays by license key" ON public.plays
  FOR ALL USING (true) WITH CHECK (true);