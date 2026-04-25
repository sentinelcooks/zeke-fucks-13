-- Edge History: persists top-5 daily picks for backtesting and Admin view
CREATE TABLE IF NOT EXISTS public.edge_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_date         DATE NOT NULL,
  sport             TEXT NOT NULL,
  league            TEXT,
  event_id          TEXT,
  teams             TEXT,
  player_or_fighter TEXT,
  market            TEXT NOT NULL,
  selection         TEXT NOT NULL,
  line              NUMERIC,
  odds              INT,
  sportsbook        TEXT,
  implied_prob      NUMERIC,
  model_prob        NUMERIC,
  ev_pct            NUMERIC,
  confidence        NUMERIC,
  units             NUMERIC,
  risk_tier         TEXT,
  reasoning         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  result_payload    JSONB,
  source_function   TEXT,
  source_version    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT edge_history_unique
    UNIQUE (pick_date, sport, player_or_fighter, market, selection)
);

CREATE INDEX IF NOT EXISTS idx_edge_history_date_sport
  ON public.edge_history (pick_date DESC, sport);

ALTER TABLE public.edge_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON public.edge_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "admin read" ON public.edge_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );
