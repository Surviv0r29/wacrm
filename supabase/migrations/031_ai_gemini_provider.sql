-- ============================================================
-- 031_ai_gemini_provider.sql — Replace Anthropic with Gemini
--
-- Swaps the ai_configs.provider allow-list from openai|anthropic to
-- openai|gemini. Existing anthropic rows are migrated to gemini with
-- a sensible default model; admins must re-save with a Gemini API key.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

UPDATE ai_configs
SET provider = 'gemini',
    model = 'gemini-2.0-flash'
WHERE provider = 'anthropic';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'gemini'));
