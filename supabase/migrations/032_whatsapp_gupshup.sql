-- ============================================================
-- 032_whatsapp_gupshup.sql — Gupshup Partner provider fields
--
-- Platform-operators assign one Gupshup app + phone number per
-- account. `access_token` stores the encrypted per-app API token;
-- Meta direct-connect rows keep provider = 'meta'.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS gupshup_app_id text,
  ADD COLUMN IF NOT EXISTS gs_app_id text,
  ADD COLUMN IF NOT EXISTS display_phone_number text;

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;

ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
  CHECK (provider IN ('meta', 'gupshup'));

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_gs_app_id
  ON whatsapp_config (gs_app_id)
  WHERE gs_app_id IS NOT NULL;
