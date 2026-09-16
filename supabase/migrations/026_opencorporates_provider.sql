-- Widen org_api_settings.provider to accept 'opencorporates' (free-tier
-- company-officer lookup for bulk lead enrichment outside the UK).
ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','companies_house','apollo','hunter','anthropic','opencorporates']));
