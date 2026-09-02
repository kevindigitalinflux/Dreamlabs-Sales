-- supabase/migrations/004_lead_scraper.sql
-- ─────────────────────────────────────────
-- CYCLE 4 PART A: apollo + hunter as BYO-key providers (org_api_settings).
-- Deliberately NO global fallback for either — paid providers, every org
-- (Kevin's included) must configure its own key.
-- ─────────────────────────────────────────

ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider IN ('gemini','google_places','companies_house','apollo','hunter'));
