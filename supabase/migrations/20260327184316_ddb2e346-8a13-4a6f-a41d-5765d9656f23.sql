
CREATE TABLE public.odds_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  requests_remaining integer DEFAULT NULL,
  requests_used integer DEFAULT NULL,
  last_used_at timestamptz DEFAULT NULL,
  last_error text DEFAULT NULL,
  exhausted_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.odds_api_keys ENABLE ROW LEVEL SECURITY;

-- No public RLS policies - only service role access from edge functions
