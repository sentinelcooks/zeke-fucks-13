
-- Table for auto-scraped/computed free props (from Odds API)
CREATE TABLE IF NOT EXISTS public.free_props (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  team text,
  opponent text,
  prop_type text NOT NULL,
  line numeric NOT NULL,
  direction text NOT NULL DEFAULT 'over',
  odds integer,
  edge numeric DEFAULT 0,
  confidence numeric DEFAULT 0,
  sport text NOT NULL DEFAULT 'nba',
  book text,
  prop_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Table for correlated props
CREATE TABLE IF NOT EXISTS public.correlated_props (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_player text NOT NULL,
  source_prop text NOT NULL,
  correlated_player text NOT NULL,
  correlated_prop text NOT NULL,
  correlated_team text,
  hit_rate numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  sport text NOT NULL DEFAULT 'nba',
  prop_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.free_props ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correlated_props ENABLE ROW LEVEL SECURITY;

-- Public read for authenticated users
CREATE POLICY "Authenticated users can read free_props" ON public.free_props
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read correlated_props" ON public.correlated_props
  FOR SELECT TO authenticated USING (true);

-- Service role can manage
CREATE POLICY "Service role can manage free_props" ON public.free_props
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage correlated_props" ON public.correlated_props
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_free_props_date_sport ON public.free_props(prop_date, sport);
CREATE INDEX idx_correlated_props_date ON public.correlated_props(prop_date, source_player);
