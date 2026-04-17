
-- Line history snapshots
CREATE TABLE IF NOT EXISTS public.odds_history (
  game_id text NOT NULL,
  sport text NOT NULL,
  book text NOT NULL,
  market text NOT NULL,
  price integer,
  line numeric,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, book, market, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_odds_history_game_market ON public.odds_history(game_id, market, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_history_sport_recent ON public.odds_history(sport, snapshot_at DESC);

ALTER TABLE public.odds_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on odds_history"
  ON public.odds_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Odds API call usage / credit tracking
CREATE TABLE IF NOT EXISTS public.odds_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  called_at timestamptz NOT NULL DEFAULT now(),
  endpoint text,
  sport text,
  markets text[] DEFAULT '{}',
  regions text[] DEFAULT '{}',
  books_count integer DEFAULT 0,
  credit_cost integer DEFAULT 0,
  requests_remaining integer,
  requests_used integer,
  key_id uuid
);
CREATE INDEX IF NOT EXISTS idx_odds_api_usage_recent ON public.odds_api_usage(called_at DESC);

ALTER TABLE public.odds_api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on odds_api_usage"
  ON public.odds_api_usage FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Per-factor audit log (proprietary — service role only)
CREATE TABLE IF NOT EXISTS public.nhl_factor_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  factor_name text NOT NULL,
  score numeric NOT NULL,
  weight numeric NOT NULL,
  bet_type text NOT NULL,
  model_version text NOT NULL DEFAULT 'v2.0',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nhl_factor_log_game_bet ON public.nhl_factor_log(game_id, bet_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_factor_log_version ON public.nhl_factor_log(model_version, created_at DESC);

ALTER TABLE public.nhl_factor_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on nhl_factor_log"
  ON public.nhl_factor_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);
