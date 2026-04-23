-- app_config: secure key-value store for admin-managed configuration
-- RLS enabled with no policies = only service_role (Edge Functions) can access
CREATE TABLE IF NOT EXISTS app_config (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE NOT NULL,
  value      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Seed the odds_api_key row so status checks always find a record
INSERT INTO app_config (key, value) VALUES ('odds_api_key', '')
ON CONFLICT (key) DO NOTHING;
