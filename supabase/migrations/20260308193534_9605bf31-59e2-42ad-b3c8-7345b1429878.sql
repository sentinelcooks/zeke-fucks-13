
CREATE TABLE public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text,
  max_devices integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE public.key_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key_id uuid NOT NULL REFERENCES public.license_keys(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  ua_hash text NOT NULL,
  ip_hash text NOT NULL,
  ip_address text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_blocked boolean NOT NULL DEFAULT false,
  UNIQUE(license_key_id, device_fingerprint)
);

CREATE TABLE public.admin_whitelist_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_whitelist_ips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.license_keys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.key_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.admin_whitelist_ips FOR ALL USING (true) WITH CHECK (true);
