-- NFL forward test ("shadow picks").
--
-- Policy (owner directive 2026-09-22): only a PROVEN-profitable NFL model may
-- publish picks. Until a market / prop type is promoted, predictions that
-- pass every gate except "proven profitable" are stored as NO PLAY with
-- shadow_play = true. Shadow picks are graded like real ones (real prices,
-- closing lines, CLV) and are the evidence for promotion:
--   ≥ 150 graded shadow bets AND ROI > 0 AND average CLV > 0
-- (see _shared/thresholds.ts NFL_PROMOTION_RULE).
--
-- The two engines keep separate columns, views and evidence.

ALTER TABLE public.nfl_game_edge_predictions
  ADD COLUMN IF NOT EXISTS shadow_play boolean NOT NULL DEFAULT false;
ALTER TABLE public.nfl_player_prop_predictions
  ADD COLUMN IF NOT EXISTS shadow_play boolean NOT NULL DEFAULT false;

-- shadow_play is a model output: frozen like the rest.
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
     OR NEW.shadow_play IS DISTINCT FROM OLD.shadow_play
     OR NEW."timestamp" IS DISTINCT FROM OLD."timestamp" THEN
    RAISE EXCEPTION 'NFL prediction model outputs are immutable (id %)', OLD.id;
  END IF;
  RETURN NEW;
END $$;

-- One bet per game/market (or player/prop) per model version: the FIRST
-- qualifying scan, so repeated hourly scans do not multiply the sample.
CREATE OR REPLACE VIEW public.nfl_game_edge_forward_test
WITH (security_invoker = true) AS
WITH first_pick AS (
  SELECT DISTINCT ON (model_version, game_id, market_type) *
  FROM public.nfl_game_edge_predictions
  WHERE status = 'PLAY' OR shadow_play
  ORDER BY model_version, game_id, market_type, "timestamp"
)
SELECT model_version, market_type,
  count(*) FILTER (WHERE result IN ('win', 'loss', 'push')) AS bets,
  count(*) FILTER (WHERE result = 'win') AS wins,
  count(*) FILTER (WHERE result = 'loss') AS losses,
  sum(profit_units) AS profit_units,
  avg(profit_units) FILTER (WHERE result IN ('win', 'loss', 'push')) AS roi,
  avg(clv) AS avg_clv,
  count(clv) AS clv_n
FROM first_pick
GROUP BY model_version, market_type;

CREATE OR REPLACE VIEW public.nfl_player_prop_forward_test
WITH (security_invoker = true) AS
WITH first_pick AS (
  SELECT DISTINCT ON (model_version, game_id, player_id, prop_type) *
  FROM public.nfl_player_prop_predictions
  WHERE status = 'PLAY' OR shadow_play
  ORDER BY model_version, game_id, player_id, prop_type, "timestamp"
)
SELECT model_version, prop_type,
  count(*) FILTER (WHERE result IN ('win', 'loss', 'push')) AS bets,
  count(*) FILTER (WHERE result = 'win') AS wins,
  count(*) FILTER (WHERE result = 'loss') AS losses,
  sum(profit_units) AS profit_units,
  avg(profit_units) FILTER (WHERE result IN ('win', 'loss', 'push')) AS roi,
  avg(clv) AS avg_clv,
  count(clv) AS clv_n
FROM first_pick
GROUP BY model_version, prop_type;

REVOKE ALL ON public.nfl_game_edge_forward_test FROM anon, authenticated;
REVOKE ALL ON public.nfl_player_prop_forward_test FROM anon, authenticated;
