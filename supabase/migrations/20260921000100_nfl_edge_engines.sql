-- NFL edge engines: SEPARATE prediction, backtest and performance storage for
-- the two NFL products.
--
--   nfl_game_edge_predictions      ← nfl-game-edge          (ML / spread / total)
--   nfl_player_prop_predictions    ← nfl-player-prop-edge   (player props)
--   nfl_game_backtest_runs         ← scripts/nfl/backtest-game.ts
--   nfl_player_prop_backtest_runs  ← scripts/nfl/backtest-prop.ts
--
-- The engines never share a table, a metric or a view. Every prediction row
-- (PLAY and NO PLAY) is persisted with its immutable model_version, must be
-- written before kickoff, and its model outputs cannot be edited afterwards —
-- only grading columns change. That makes these rows valid evaluation evidence
-- under docs/claude/model-validation-runbook.md.
--
-- RLS: enabled, no anon/authenticated policies. Clients read through the
-- edge functions (premium-gated) or nfl-admin-analytics (admin password).

-- ─── Game edge predictions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfl_game_edge_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  commence_time timestamptz,
  market_type text NOT NULL CHECK (market_type IN ('moneyline', 'spread', 'total')),
  selection text NOT NULL,
  side text NOT NULL CHECK (side IN ('home', 'away', 'over', 'under')),
  line numeric,
  model_version text NOT NULL,
  model_probability numeric NOT NULL,
  push_probability numeric NOT NULL DEFAULT 0,
  market_probability numeric,
  no_vig_probability numeric,
  fair_price integer,
  market_price integer,
  market_book text,
  opening_line numeric,
  opening_price integer,
  edge_percentage numeric,
  expected_value numeric,
  confidence numeric NOT NULL,
  confidence_components jsonb,
  projected_score jsonb,
  projected_margin numeric,
  projected_total numeric,
  fair_line numeric,
  status text NOT NULL CHECK (status IN ('PLAY', 'NO PLAY')),
  no_play_reasons text[] NOT NULL DEFAULT '{}',
  data_quality numeric,
  factors jsonb,
  calibration_status text NOT NULL DEFAULT 'unvalidated',
  "timestamp" timestamptz NOT NULL,
  scan_bucket text NOT NULL,
  -- Grading (written by nfl-grade)
  closing_line numeric,
  closing_price integer,
  closing_no_vig_probability numeric,
  clv numeric,
  result text CHECK (result IN ('win', 'loss', 'push', 'void')),
  profit_units numeric,
  roi numeric,
  graded_at timestamptz,
  grading_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfl_game_pred_pregame CHECK (commence_time IS NULL OR "timestamp" < commence_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS nfl_game_pred_identity
  ON public.nfl_game_edge_predictions (game_id, market_type, side, coalesce(line, -9999), model_version, scan_bucket);
CREATE INDEX IF NOT EXISTS nfl_game_pred_version_idx ON public.nfl_game_edge_predictions (model_version, market_type, status);
CREATE INDEX IF NOT EXISTS nfl_game_pred_week_idx ON public.nfl_game_edge_predictions (season, week);
CREATE INDEX IF NOT EXISTS nfl_game_pred_ungraded_idx ON public.nfl_game_edge_predictions (commence_time) WHERE result IS NULL;

-- ─── Player prop predictions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfl_player_prop_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  commence_time timestamptz,
  player_id text NOT NULL,
  player_name text NOT NULL,
  team text NOT NULL,
  opponent text,
  position text NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'K', 'FB')),
  prop_type text NOT NULL,
  side text NOT NULL CHECK (side IN ('over', 'under')),
  line numeric NOT NULL,
  market_price integer,
  market_book text,
  opening_line numeric,
  opening_price integer,
  current_line numeric,
  best_price integer,
  line_movement numeric,
  model_version text NOT NULL,
  projection numeric NOT NULL,
  median_projection numeric NOT NULL,
  std_dev numeric,
  p10 numeric,
  p90 numeric,
  distribution text,
  over_probability numeric NOT NULL,
  under_probability numeric NOT NULL,
  push_probability numeric NOT NULL DEFAULT 0,
  model_probability numeric NOT NULL,
  market_probability numeric,
  no_vig_probability numeric,
  no_vig_method text,
  fair_price integer,
  edge_percentage numeric,
  expected_value numeric,
  confidence numeric NOT NULL,
  confidence_components jsonb,
  expected_snap_percentage numeric,
  injury_status text,
  role_projection jsonb,
  status text NOT NULL CHECK (status IN ('PLAY', 'NO PLAY')),
  no_play_reasons text[] NOT NULL DEFAULT '{}',
  data_quality numeric,
  factors jsonb,
  calibration_status text NOT NULL DEFAULT 'unvalidated',
  "timestamp" timestamptz NOT NULL,
  scan_bucket text NOT NULL,
  -- Grading (written by nfl-grade)
  closing_line numeric,
  closing_price integer,
  closing_no_vig_probability numeric,
  clv numeric,
  actual_value numeric,
  result text CHECK (result IN ('win', 'loss', 'push', 'void')),
  profit_units numeric,
  roi numeric,
  graded_at timestamptz,
  grading_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfl_prop_pred_pregame CHECK (commence_time IS NULL OR "timestamp" < commence_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS nfl_prop_pred_identity
  ON public.nfl_player_prop_predictions (game_id, player_id, prop_type, side, line, model_version, scan_bucket);
CREATE INDEX IF NOT EXISTS nfl_prop_pred_version_idx ON public.nfl_player_prop_predictions (model_version, prop_type, status);
CREATE INDEX IF NOT EXISTS nfl_prop_pred_week_idx ON public.nfl_player_prop_predictions (season, week);
CREATE INDEX IF NOT EXISTS nfl_prop_pred_ungraded_idx ON public.nfl_player_prop_predictions (commence_time) WHERE result IS NULL;

-- ─── Immutable model outputs ─────────────────────────────────────────────
-- Once written, a prediction's model outputs are frozen; only grading
-- columns may change. Prevents silent post-hoc "improvement" of the record.
CREATE OR REPLACE FUNCTION public.nfl_prediction_freeze()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.model_version IS DISTINCT FROM OLD.model_version
     OR NEW.model_probability IS DISTINCT FROM OLD.model_probability
     OR NEW.no_vig_probability IS DISTINCT FROM OLD.no_vig_probability
     OR NEW.market_price IS DISTINCT FROM OLD.market_price
     OR NEW.line IS DISTINCT FROM OLD.line
     OR NEW.edge_percentage IS DISTINCT FROM OLD.edge_percentage
     OR NEW.expected_value IS DISTINCT FROM OLD.expected_value
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW."timestamp" IS DISTINCT FROM OLD."timestamp" THEN
    RAISE EXCEPTION 'NFL prediction model outputs are immutable (id %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nfl_game_pred_freeze ON public.nfl_game_edge_predictions;
CREATE TRIGGER nfl_game_pred_freeze BEFORE UPDATE ON public.nfl_game_edge_predictions
  FOR EACH ROW EXECUTE FUNCTION public.nfl_prediction_freeze();
DROP TRIGGER IF EXISTS nfl_prop_pred_freeze ON public.nfl_player_prop_predictions;
CREATE TRIGGER nfl_prop_pred_freeze BEFORE UPDATE ON public.nfl_player_prop_predictions
  FOR EACH ROW EXECUTE FUNCTION public.nfl_prediction_freeze();

-- ─── Backtest runs (one table per engine) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nfl_game_backtest_runs (
  id bigserial PRIMARY KEY,
  model_version text NOT NULL,
  seasons text NOT NULL,
  market_source text NOT NULL,
  params jsonb,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfl_game_bt_version_idx ON public.nfl_game_backtest_runs (model_version, created_at DESC);

CREATE TABLE IF NOT EXISTS public.nfl_player_prop_backtest_runs (
  id bigserial PRIMARY KEY,
  model_version text NOT NULL,
  seasons text NOT NULL,
  market_source text NOT NULL,
  params jsonb,
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfl_prop_bt_version_idx ON public.nfl_player_prop_backtest_runs (model_version, created_at DESC);

-- ─── Live performance (graded PLAYs only; one view per engine) ───────────
CREATE OR REPLACE VIEW public.nfl_game_edge_performance
WITH (security_invoker = true) AS
SELECT model_version, market_type,
  count(*) FILTER (WHERE result IN ('win', 'loss', 'push')) AS bets,
  count(*) FILTER (WHERE result = 'win') AS wins,
  count(*) FILTER (WHERE result = 'loss') AS losses,
  count(*) FILTER (WHERE result = 'push') AS pushes,
  sum(profit_units) AS profit_units,
  avg(profit_units) FILTER (WHERE result IN ('win', 'loss', 'push')) AS roi,
  avg(clv) AS avg_clv,
  avg(edge_percentage) AS avg_edge,
  avg(expected_value) AS avg_ev,
  avg(confidence) AS avg_confidence
FROM public.nfl_game_edge_predictions
WHERE status = 'PLAY'
GROUP BY model_version, market_type;

CREATE OR REPLACE VIEW public.nfl_player_prop_performance
WITH (security_invoker = true) AS
SELECT model_version, prop_type, position,
  count(*) FILTER (WHERE result IN ('win', 'loss', 'push')) AS bets,
  count(*) FILTER (WHERE result = 'win') AS wins,
  count(*) FILTER (WHERE result = 'loss') AS losses,
  count(*) FILTER (WHERE result = 'push') AS pushes,
  sum(profit_units) AS profit_units,
  avg(profit_units) FILTER (WHERE result IN ('win', 'loss', 'push')) AS roi,
  avg(clv) AS avg_clv,
  avg(edge_percentage) AS avg_edge,
  avg(expected_value) AS avg_ev,
  avg(confidence) AS avg_confidence,
  avg(abs(projection - actual_value)) AS mae
FROM public.nfl_player_prop_predictions
WHERE status = 'PLAY'
GROUP BY model_version, prop_type, position;

ALTER TABLE public.nfl_game_edge_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_player_prop_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_game_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_player_prop_backtest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nfl_game_edge_performance FROM anon, authenticated;
REVOKE ALL ON public.nfl_player_prop_performance FROM anon, authenticated;

-- Runtime gate overrides (JSON merged over _shared/thresholds.ts defaults).
INSERT INTO public.app_config (key, value)
VALUES ('nfl_game_edge_gates', '{}'), ('nfl_prop_edge_gates', '{}')
ON CONFLICT (key) DO NOTHING;
