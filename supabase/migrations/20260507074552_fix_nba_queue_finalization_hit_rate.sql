-- Keep queue-finalized NBA confidence surfaces in sync.
--
-- The queue processor updates confidence after the analyzer returns, but the
-- original RPC bodies did not update daily_picks.hit_rate. Public UI surfaces
-- still read hit_rate in several places, so analyzer-finalized picks could show
-- stale confidence even after verdict/model_diagnostics were refreshed.

CREATE OR REPLACE FUNCTION public.promote_nba_queue_pick(
  p_queue_id uuid,
  p_final_pick_payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m         jsonb := p_final_pick_payload->'match';
  new_tier  text  := p_final_pick_payload->>'tier';
  v_target_id uuid;
  v_loser_id  uuid;
BEGIN
  SELECT id INTO v_target_id
    FROM public.daily_picks
   WHERE pick_date   = (m->>'pick_date')::date
     AND sport       = m->>'sport'
     AND player_name = m->>'player_name'
     AND prop_type   = m->>'prop_type'
     AND direction   = m->>'direction'
     AND line        = (m->>'line')::numeric
     AND tier        IS DISTINCT FROM new_tier
   FOR UPDATE
   LIMIT 1;

  SELECT id INTO v_loser_id
    FROM public.daily_picks
   WHERE pick_date   = (m->>'pick_date')::date
     AND sport       = m->>'sport'
     AND tier        = new_tier
     AND player_name = m->>'player_name'
     AND prop_type   = m->>'prop_type'
     AND direction   = m->>'direction'
     AND line        = (m->>'line')::numeric
   FOR UPDATE
   LIMIT 1;

  IF v_loser_id IS NOT NULL
     AND v_loser_id IS DISTINCT FROM v_target_id THEN
    DELETE FROM public.daily_picks WHERE id = v_loser_id;
  END IF;

  IF v_target_id IS NOT NULL THEN
    UPDATE public.daily_picks
       SET tier              = new_tier,
           verdict           = COALESCE(p_final_pick_payload->>'verdict', verdict),
           confidence        = COALESCE((p_final_pick_payload->>'confidence')::numeric, confidence),
           hit_rate          = COALESCE(
                                (p_final_pick_payload->>'hit_rate')::numeric,
                                round(((p_final_pick_payload->>'confidence')::numeric) * 100),
                                hit_rate
                              ),
           reasoning         = COALESCE(p_final_pick_payload->>'reasoning', reasoning),
           model_diagnostics = COALESCE(p_final_pick_payload->'model_diagnostics', model_diagnostics)
     WHERE id = v_target_id;
  END IF;

  UPDATE public.nba_analyzer_queue
     SET status       = 'done',
         processed_at = now(),
         updated_at   = now(),
         dedupe_key   = dedupe_key || '#' || id::text
   WHERE id = p_queue_id
     AND status = 'processing';
END $$;

CREATE OR REPLACE FUNCTION public.refresh_nba_pick_diagnostics(
  p_match jsonb,
  p_diagnostics jsonb,
  p_verdict text,
  p_confidence numeric,
  p_reasoning text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.daily_picks
     SET model_diagnostics = COALESCE(p_diagnostics, model_diagnostics),
         verdict           = COALESCE(p_verdict, verdict),
         confidence        = COALESCE(p_confidence, confidence),
         hit_rate          = COALESCE(round(p_confidence * 100), hit_rate),
         reasoning         = COALESCE(p_reasoning, reasoning)
   WHERE pick_date   = (p_match->>'pick_date')::date
     AND sport       = p_match->>'sport'
     AND player_name = p_match->>'player_name'
     AND prop_type   = p_match->>'prop_type'
     AND direction   = p_match->>'direction'
     AND line        = (p_match->>'line')::numeric;
END $$;

REVOKE ALL ON FUNCTION public.promote_nba_queue_pick(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_nba_pick_diagnostics(jsonb,jsonb,text,numeric,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.promote_nba_queue_pick(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_nba_pick_diagnostics(jsonb,jsonb,text,numeric,text) TO service_role;
