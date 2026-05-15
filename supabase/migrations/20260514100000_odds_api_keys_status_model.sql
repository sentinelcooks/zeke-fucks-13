-- Migration A: status-driven model for odds_api_keys.
-- Additive only. Preserves is_active and exhausted_at for one release so
-- a rollback to the prior code path is possible.
-- The partial UNIQUE index is added in a follow-up migration (Migration C)
-- after dedupe_keys has been run to mark duplicate rows status='disabled'.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE odds_api_keys
  ADD COLUMN IF NOT EXISTS status text
    NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('available','rate_limited','exhausted_quota','invalid_auth','disabled','unknown')),
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limited_until timestamptz,
  ADD COLUMN IF NOT EXISTS quota_reset_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_errors int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_key_hash text;

-- Backfill status from existing flags. Rows that were flagged exhausted but
-- still report requests_remaining > 0 are the stale-flag bucket → 'unknown'
-- so recheck_keys probes them and promotes to 'available' if quota is real.
UPDATE odds_api_keys SET status =
  CASE
    WHEN is_active = false THEN 'disabled'
    WHEN exhausted_at IS NULL THEN 'available'
    WHEN requests_remaining IS NOT NULL AND requests_remaining > 0 THEN 'unknown'
    ELSE 'exhausted_quota'
  END
WHERE status = 'unknown';

-- Normalize = trim() only. Odds API keys are case-sensitive — never lowercase.
UPDATE odds_api_keys
  SET api_key_hash = encode(extensions.digest(convert_to(trim(api_key), 'UTF8'), 'sha256'), 'hex')
WHERE api_key_hash IS NULL;

CREATE INDEX IF NOT EXISTS odds_api_keys_status_lastused_idx
  ON odds_api_keys(status, last_used_at NULLS FIRST)
  WHERE status = 'available';

CREATE INDEX IF NOT EXISTS odds_api_keys_recheck_idx
  ON odds_api_keys(status, last_checked_at NULLS FIRST)
  WHERE status IN ('exhausted_quota','rate_limited','unknown');

CREATE INDEX IF NOT EXISTS odds_api_keys_api_key_hash_idx
  ON odds_api_keys(api_key_hash);

