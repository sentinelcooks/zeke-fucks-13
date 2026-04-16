-- Prediction snapshots: full feature log per prediction
CREATE TABLE public.prediction_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sport TEXT NOT NULL,
  market_type TEXT NOT NULL,
  player_or_team TEXT NOT NULL,
  prop_type TEXT,
  line NUMERIC,
  direction TEXT,
  confidence NUMERIC NOT NULL,
  ev_percent NUMERIC,
  odds_at_time INTEGER,
  verdict TEXT,
  unit_size NUMERIC,
  top_factors JSONB,
  data_quality TEXT,
  variance_level TEXT,
  lineup_confirmed BOOLEAN,
  injury_flags JSONB,
  game_environment JSONB,
  actual_outcome TEXT DEFAULT NULL,
  outcome_value NUMERIC DEFAULT NULL,
  outcome_logged_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_prediction_snapshots_sport_market ON public.prediction_snapshots(sport, market_type);
CREATE INDEX idx_prediction_snapshots_created ON public.prediction_snapshots(created_at);
CREATE INDEX idx_prediction_snapshots_user ON public.prediction_snapshots(user_id);
CREATE INDEX idx_prediction_snapshots_verdict ON public.prediction_snapshots(verdict);

ALTER TABLE public.prediction_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own snapshots"
  ON public.prediction_snapshots
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own snapshots"
  ON public.prediction_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on snapshots"
  ON public.prediction_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Outcomes: graded results
CREATE TABLE public.outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID REFERENCES public.prediction_snapshots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  player_or_team TEXT NOT NULL,
  prop_type TEXT,
  line NUMERIC,
  direction TEXT,
  predicted_confidence NUMERIC,
  actual_result TEXT NOT NULL,
  actual_value NUMERIC,
  profit_loss NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outcomes_sport ON public.outcomes(sport);
CREATE INDEX idx_outcomes_user ON public.outcomes(user_id);
CREATE INDEX idx_outcomes_result ON public.outcomes(actual_result);

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own outcomes"
  ON public.outcomes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own outcomes"
  ON public.outcomes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access on outcomes"
  ON public.outcomes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);