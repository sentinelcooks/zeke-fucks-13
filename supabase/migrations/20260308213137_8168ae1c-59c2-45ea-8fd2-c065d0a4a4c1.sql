
CREATE TABLE public.daily_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date date NOT NULL DEFAULT CURRENT_DATE,
  sport text NOT NULL DEFAULT 'nba',
  player_name text NOT NULL,
  team text,
  opponent text,
  prop_type text NOT NULL,
  line numeric NOT NULL,
  direction text NOT NULL DEFAULT 'over',
  hit_rate numeric NOT NULL DEFAULT 0,
  last_n_games integer NOT NULL DEFAULT 10,
  avg_value numeric,
  reasoning text,
  odds text,
  result text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read daily picks"
  ON public.daily_picks FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role full access on daily_picks"
  ON public.daily_picks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_daily_picks_date ON public.daily_picks(pick_date DESC);
