
-- 1. Add session expiry to key_sessions
ALTER TABLE public.key_sessions ADD COLUMN IF NOT EXISTS token_expires_at timestamp with time zone;

-- 2. Create fingerprint_log for drift detection
CREATE TABLE IF NOT EXISTS public.fingerprint_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key_id uuid NOT NULL REFERENCES public.license_keys(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  ip_address text,
  user_agent text,
  logged_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.fingerprint_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.fingerprint_log
  AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Index for drift lookups (unique fingerprints per key in time window)
CREATE INDEX IF NOT EXISTS idx_fingerprint_log_key_time ON public.fingerprint_log (license_key_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_fingerprint_log_key_fp ON public.fingerprint_log (license_key_id, device_fingerprint);

-- Enable pg_cron and pg_net for cleanup
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
