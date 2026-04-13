
CREATE TABLE public.pick_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text NOT NULL,
  pick_id uuid REFERENCES public.daily_picks(id) ON DELETE SET NULL,
  player_name text NOT NULL,
  sport text NOT NULL DEFAULT 'nba',
  prop_type text NOT NULL,
  line numeric NOT NULL,
  direction text NOT NULL,
  hit_rate numeric NOT NULL DEFAULT 0,
  odds text,
  reasoning text,
  result text DEFAULT 'pending',
  pick_date date NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pick_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pick history"
  ON public.pick_history FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own pick history"
  ON public.pick_history FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can delete own pick history"
  ON public.pick_history FOR DELETE
  USING (true);

CREATE INDEX idx_pick_history_key ON public.pick_history(license_key);
CREATE INDEX idx_pick_history_date ON public.pick_history(pick_date DESC);
CREATE UNIQUE INDEX idx_pick_history_unique ON public.pick_history(license_key, pick_id);
