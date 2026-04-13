
-- Add session_token to key_sessions for server-side validation
ALTER TABLE public.key_sessions ADD COLUMN IF NOT EXISTS session_token text;

-- Create login_attempts table for rate limiting
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL,
  attempted_at timestamp with time zone NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false
);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.login_attempts
  AS RESTRICTIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Index for fast rate limit lookups
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON public.login_attempts (ip_address, attempted_at);

-- Index for fast session token lookups
CREATE INDEX IF NOT EXISTS idx_key_sessions_token ON public.key_sessions (session_token);
