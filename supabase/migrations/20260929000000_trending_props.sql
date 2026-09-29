-- "Trending tonight" for the Analyze tab.
--
-- One row per sport, overwritten by the trending-props-<sport> Edge Functions.
-- The list is market heat (line/price movement across sportsbooks), NOT bet
-- volume — no source available to Sentinel reports bet counts. See
-- supabase/functions/_shared/trending_score.ts.

CREATE TABLE IF NOT EXISTS public.trending_props (
  sport          text PRIMARY KEY CHECK (sport IN ('nba', 'wnba', 'mlb', 'nhl', 'nfl')),
  slate_date     date        NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  items          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  events_scanned integer     NOT NULL DEFAULT 0
);

ALTER TABLE public.trending_props ENABLE ROW LEVEL SECURITY;

-- Same audience as daily_picks. The (select …) wrapper makes Postgres evaluate
-- the premium check once per query instead of once per row.
DROP POLICY IF EXISTS "Premium users can read trending props" ON public.trending_props;
CREATE POLICY "Premium users can read trending props"
  ON public.trending_props FOR SELECT TO authenticated
  USING ((SELECT public.has_active_premium((SELECT auth.uid()))));

DROP POLICY IF EXISTS "Service role full access on trending_props" ON public.trending_props;
CREATE POLICY "Service role full access on trending_props"
  ON public.trending_props FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Refresh schedule (pg_cron runs in UTC).
-- NBA / WNBA / MLB / NHL: 15:40–23:40 UTC every two hours (11:40am–7:40pm EDT),
--   when props are posted and moving. Each run is capped at 12 events.
-- NFL: 15:00 and 23:00 UTC, just after odds-snapshot-nfl-props (14:45 / 22:45)
--   plus Sunday 17:00 after the Sunday-morning snapshot. NFL reads existing
--   snapshots only and costs no Odds API credits.
DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'trending-props-nba', 'trending-props-wnba', 'trending-props-mlb',
    'trending-props-nhl', 'trending-props-nfl', 'trending-props-nfl-sunday'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name) THEN
      PERFORM cron.unschedule(v_name);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule('trending-props-nba', '40 15,17,19,21,23 * * *', $cron$
  SELECT public._cron_invoke_edge('trending-props-nba');
$cron$);

SELECT cron.schedule('trending-props-wnba', '42 15,17,19,21,23 * * *', $cron$
  SELECT public._cron_invoke_edge('trending-props-wnba');
$cron$);

SELECT cron.schedule('trending-props-mlb', '44 15,17,19,21,23 * * *', $cron$
  SELECT public._cron_invoke_edge('trending-props-mlb');
$cron$);

SELECT cron.schedule('trending-props-nhl', '46 15,17,19,21,23 * * *', $cron$
  SELECT public._cron_invoke_edge('trending-props-nhl');
$cron$);

SELECT cron.schedule('trending-props-nfl', '0 15,23 * * *', $cron$
  SELECT public._cron_invoke_edge('trending-props-nfl');
$cron$);

SELECT cron.schedule('trending-props-nfl-sunday', '0 17 * * 0', $cron$
  SELECT public._cron_invoke_edge('trending-props-nfl');
$cron$);
