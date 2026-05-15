-- Migration C: partial UNIQUE index on api_key_hash.
--
-- Apply ONLY after the dedupe_keys admin action has run cleanly:
--   1. POST key-admin {action: "dedupe_keys"} → note duplicatesDisabled count
--   2. POST key-admin {action: "dedupe_keys"} a second time → expect 0
--   3. Then run this migration.
--
-- The index is partial (WHERE status <> 'disabled') so dedupe rows kept for
-- audit do not collide with the surviving active row. bulk_add_api_keys'
-- existence check is also gated on `status <> 'disabled'` for the same reason.

CREATE UNIQUE INDEX IF NOT EXISTS odds_api_keys_api_key_hash_uidx
  ON odds_api_keys(api_key_hash)
  WHERE status <> 'disabled';
