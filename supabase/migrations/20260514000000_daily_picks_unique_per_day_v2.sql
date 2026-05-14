-- Replace the unique index with a narrower per-pick identity that also
-- distinguishes by event/teams. Same name so callers needn't change.
-- NULLS NOT DISTINCT lets plain ON CONFLICT (...) match even when some
-- identifying columns (event_id for older rows; player_name for team bets)
-- are NULL, avoiding the old COALESCE expression-index trick that blocked
-- supabase-js .upsert({ onConflict }).

DROP INDEX IF EXISTS public.daily_picks_unique_per_day;

CREATE UNIQUE INDEX daily_picks_unique_per_day
  ON public.daily_picks (
    pick_date, sport, tier,
    player_name, prop_type, direction, line,
    event_id, home_team, away_team
  )
  NULLS NOT DISTINCT;

-- Single-row upserter. Insert if no row matches the new unique key;
-- otherwise refresh the user-facing + diagnostic columns and keep the
-- existing id. Returns id + inserted flag so callers can count duplicate
-- updates separately from fresh inserts. Idempotent: re-running the same
-- payload produces the same id and a duplicate update.
CREATE OR REPLACE FUNCTION public.upsert_daily_pick(p_row jsonb)
RETURNS TABLE (id uuid, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.daily_picks (
    id, created_at, pick_date, event_id, commence_time, game_date,
    sport, player_name, team, opponent, prop_type, line, direction,
    hit_rate, confidence, verdict, last_n_games, avg_value, reasoning,
    odds, result, bet_type, spread_line, total_line, home_team, away_team,
    tier, status, model_used, model_version, model_diagnostics, run_id
  )
  VALUES (
    COALESCE((p_row->>'id')::uuid, gen_random_uuid()),
    COALESCE((p_row->>'created_at')::timestamptz, now()),
    (p_row->>'pick_date')::date,
    NULLIF(p_row->>'event_id',''),
    NULLIF(p_row->>'commence_time','')::timestamptz,
    NULLIF(p_row->>'game_date','')::date,
    p_row->>'sport',
    NULLIF(p_row->>'player_name',''),
    NULLIF(p_row->>'team',''),
    NULLIF(p_row->>'opponent',''),
    p_row->>'prop_type',
    NULLIF(p_row->>'line','')::numeric,
    p_row->>'direction',
    NULLIF(p_row->>'hit_rate','')::numeric,
    NULLIF(p_row->>'confidence','')::numeric,
    NULLIF(p_row->>'verdict',''),
    NULLIF(p_row->>'last_n_games','')::int,
    NULLIF(p_row->>'avg_value','')::numeric,
    NULLIF(p_row->>'reasoning',''),
    NULLIF(p_row->>'odds',''),
    NULLIF(p_row->>'result',''),
    NULLIF(p_row->>'bet_type',''),
    NULLIF(p_row->>'spread_line','')::numeric,
    NULLIF(p_row->>'total_line','')::numeric,
    NULLIF(p_row->>'home_team',''),
    NULLIF(p_row->>'away_team',''),
    p_row->>'tier',
    NULLIF(p_row->>'status',''),
    NULLIF(p_row->>'model_used',''),
    NULLIF(p_row->>'model_version',''),
    COALESCE(p_row->'model_diagnostics', '{}'::jsonb),
    NULLIF(p_row->>'run_id','')::uuid
  )
  ON CONFLICT (pick_date, sport, tier, player_name, prop_type, direction,
               line, event_id, home_team, away_team)
  DO UPDATE SET
    verdict           = EXCLUDED.verdict,
    confidence        = EXCLUDED.confidence,
    hit_rate          = EXCLUDED.hit_rate,
    avg_value         = EXCLUDED.avg_value,
    reasoning         = EXCLUDED.reasoning,
    odds              = EXCLUDED.odds,
    model_used        = EXCLUDED.model_used,
    model_version     = EXCLUDED.model_version,
    -- Merge diagnostics: keep historical keys, overwrite with new on collision.
    -- Mirrors run_id into model_diagnostics.runId for forensic continuity.
    model_diagnostics = COALESCE(public.daily_picks.model_diagnostics, '{}'::jsonb)
                          || COALESCE(EXCLUDED.model_diagnostics, '{}'::jsonb)
                          || jsonb_build_object('runId', EXCLUDED.run_id),
    run_id            = EXCLUDED.run_id,
    -- Never silently flip a graded result back to pending. Once a pick is
    -- graded hit/miss/push it stays graded even if a later scan re-runs
    -- the analyzer for the same identity.
    result            = COALESCE(public.daily_picks.result, EXCLUDED.result),
    status            = EXCLUDED.status
  RETURNING public.daily_picks.id, (xmax = 0) AS inserted;
END $$;

REVOKE ALL ON FUNCTION public.upsert_daily_pick(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_daily_pick(jsonb) TO service_role;
