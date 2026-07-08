-- ============================================================
-- 033_gupshup_app_name.sql — Gupshup Self-Serve app name
--
-- Self-Serve sends (api.gupshup.io/wa/api/v1/msg) require src.name
-- (the app's display name in Gupshup Console), not only the UUID.
-- Partner V3 still uses gupshup_app_id.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS gupshup_app_name text;
