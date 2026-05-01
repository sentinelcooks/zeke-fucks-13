-- Push notifications v2: real iOS push via APNs.
--
-- Two new tables:
--   mobile_push_tokens  — stores APNs device tokens per user/device
--   game_notifications  — per-game alert prefs (replaces localStorage in GamesPage)
--                         with send-tracking columns to guarantee each alert fires once
--
-- We do NOT touch the existing public.push_subscriptions table — it was created
-- for web push and is unused. Leaving it untouched keeps the migration safe.
--
-- Migration is fully idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
-- CREATE INDEX IF NOT EXISTS) so `supabase db push` can be re-run safely.

-- ── mobile_push_tokens: APNs device tokens ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mobile_push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform     text NOT NULL DEFAULT 'ios'
    CHECK (platform IN ('ios', 'android', 'web')),
  device_token text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, device_token)
);

ALTER TABLE public.mobile_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_tokens" ON public.mobile_push_tokens;
CREATE POLICY "users_manage_own_tokens"
  ON public.mobile_push_tokens FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS mobile_push_tokens_user_id_idx
  ON public.mobile_push_tokens (user_id);

-- ── game_notifications: per-game alert prefs ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id       text NOT NULL,
  sport_key     text NOT NULL,
  home_team     text NOT NULL,
  away_team     text NOT NULL,
  commence_time timestamptz NOT NULL,
  alert_sent_at timestamptz,            -- null = not yet sent
  alert_status  text,                   -- 'sent' | 'failed'
  alert_error   text,                   -- failure reason (APNs error string)
  created_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, game_id)
);

ALTER TABLE public.game_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_game_notifications" ON public.game_notifications;
CREATE POLICY "users_manage_own_game_notifications"
  ON public.game_notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Partial index: cron only ever queries unsent rows in a 5-min window.
CREATE INDEX IF NOT EXISTS game_notifications_commence_unsent_idx
  ON public.game_notifications (commence_time)
  WHERE alert_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS game_notifications_user_id_idx
  ON public.game_notifications (user_id);
