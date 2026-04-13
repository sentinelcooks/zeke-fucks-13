
CREATE TABLE public.mlb_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  prediction JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'RISKY',
  prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  result TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mlb_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read mlb predictions"
  ON public.mlb_predictions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages mlb predictions"
  ON public.mlb_predictions FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_mlb_predictions_game_date ON public.mlb_predictions (game_id, prediction_date);
CREATE INDEX idx_mlb_predictions_bet_type ON public.mlb_predictions (bet_type, prediction_date);
